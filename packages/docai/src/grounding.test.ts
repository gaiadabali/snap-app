import { describe, expect, it } from 'vitest';

import { DOCDOM_VERSION, type Block, type Document, type Line, type Span } from './docdom.js';
import { groundExtraction, groundValue } from './grounding.js';

/**
 * Grounding is the enforcement of D16, so these tests are mostly about the
 * cases where a naive implementation would claim success it has not earned.
 */

let n = 0;
function span(text: string, confidence = 0.99, x = 10): Span {
  n += 1;
  return {
    id: `s${n}`,
    text,
    box: { x, y: 100, width: text.length * 9, height: 20 },
    provenance: { engine: 'ppocr-v5', confidence, calibrated: false },
  };
}

function doc(lines: Span[][]): Document {
  const blockLines: Line[] = lines.map((spans, i) => ({
    id: `l${i}`,
    box: { x: 0, y: 100 + i * 30, width: 500, height: 20 },
    spans,
    order: i,
  }));
  const block: Block = {
    id: 'b0',
    kind: 'paragraph',
    box: { x: 0, y: 0, width: 500, height: 500 },
    page: 1,
    order: 0,
    lines: blockLines,
    provenance: { engine: 'ppocr-v5', confidence: 0.9, calibrated: false },
  };
  return {
    version: DOCDOM_VERSION,
    pages: [{ number: 1, width: 600, height: 800, dpi: 200, source: 'scan', restoration: [] }],
    blocks: [block],
    tables: [],
    figures: [],
    fields: [],
    unreadable: [],
  };
}

describe('grounding a money value', () => {
  it('finds a value split across the boxes a recogniser actually produces', () => {
    // The exact segmentation PP-OCRv5 produced on a real page: currency
    // symbol, digits and separators each in their own box.
    const d = doc([[span('$'), span('1'), span(','), span('042.60')]]);
    const g = groundValue(d, 'money', '1042.60');
    expect(g.grounded).toBe(true);
    // Three, not four: the currency symbol is not part of the amount, and
    // shortest-run-first finds the digits without it. The highlight covers
    // `1,042.60` and stops at the `$`, which is the right box for the value
    // being asserted.
    expect(g.spanIds).toHaveLength(3);
    expect(g.box!.width).toBeGreaterThan(20);
  });

  it('agrees that 110 and 110.00 are the same amount', () => {
    expect(groundValue(doc([[span('110.00')]]), 'money', '110').grounded).toBe(true);
    expect(groundValue(doc([[span('110')]]), 'money', '110.00').grounded).toBe(true);
  });

  it('takes the WEAKEST span confidence, not the average', () => {
    // A total whose middle digit is a coin toss is not 96% right.
    const d = doc([[span('17', 0.99), span('519', 0.42), span('.31', 0.99)]]);
    expect(groundValue(d, 'money', '17519.31').confidence).toBeCloseTo(0.42, 2);
  });

  it('does not ground a value the page never states', () => {
    const d = doc([[span('110.00')]]);
    const g = groundValue(d, 'money', '17519.31');
    expect(g.grounded).toBe(false);
    expect(g.spanIds).toEqual([]);
    expect(g.box).toBeNull();
    // The value is returned unchanged: grounding reports, it does not delete.
    expect(g.value).toBe('17519.31');
  });

  it('stops assembling once a run would exceed the cap', () => {
    // A contiguous run inside ONE line that reads exactly the value is real
    // evidence however finely the engine boxed it — some recognisers segment
    // per character — so the cap is a bound on absurdity, not on segmentation.
    // Nine single-character boxes is past it.
    const d = doc([[
      span('1'), span('2'), span('3'), span('4'), span('5'),
      span('6'), span('7'), span('8'), span('9'),
    ]]);
    expect(groundValue(d, 'money', '123456789').grounded).toBe(false);
    // Eight is within it, and is still a genuine reading of the page.
    const eight = doc([[
      span('1'), span('2'), span('3'), span('4'),
      span('5'), span('6'), span('7'), span('8'),
    ]]);
    expect(groundValue(eight, 'money', '12345678').grounded).toBe(true);
  });

  it('prefers the span that states the value outright', () => {
    const d = doc([[span('110.00'), span('1'), span('10.00')]]);
    expect(groundValue(d, 'money', '110.00').spanIds).toHaveLength(1);
  });

  it('will not stitch a value across two lines', () => {
    const d = doc([[span('17')], [span('519.31')]]);
    expect(groundValue(d, 'money', '17519.31').grounded).toBe(false);
  });
});

describe('grounding an ABN', () => {
  it('matches however the document groups the digits', () => {
    const d = doc([[span('85'), span('129'), span('887'), span('341')]]);
    expect(groundValue(d, 'abn', '85129887341').grounded).toBe(true);
  });

  it('does not ground the misread the checksum rejects', () => {
    // The real gemma4:31b error. The page says ...341; the model said ...841.
    const d = doc([[span('85 129 887 341')]]);
    expect(groundValue(d, 'abn', '85129887841').grounded).toBe(false);
  });
});

describe('grounding a date', () => {
  it('matches the printed form, not the ISO the model returns', () => {
    for (const printed of ['14/08/2026', '14/08/26', '14 August 2026', '14 Aug 2026', '14-08-2026']) {
      const g = groundValue(doc([[span(printed)]]), 'date', '2026-08-14');
      expect(g.grounded, printed).toBe(true);
    }
  });

  it('does not match a month-first printing', () => {
    // `08/14/2026` is American. Accepting it here would quietly re-introduce
    // the day/month ambiguity `validators.ts` exists to raise.
    expect(groundValue(doc([[span('08/14/2026')]]), 'date', '2026-08-14').grounded).toBe(false);
  });
});

describe('grounding a whole extraction', () => {
  const d = doc([
    [span('Southern'), span('Cross'), span('Logistics')],
    [span('85 129 887 341')],
    [span('$'), span('17,519.31')],
  ]);

  it('reports which values the page does not support', () => {
    const r = groundExtraction(d, [
      { path: 'header.supplier', kind: 'text', value: 'Southern Cross Logistics' },
      { path: 'header.supplier_abn', kind: 'abn', value: '85129887841' }, // the misread
      { path: 'header.payable_amount', kind: 'money', value: '17519.31' },
    ]);
    expect(r.ungrounded).toEqual(['header.supplier_abn']);
    expect(r.rate).toBeCloseTo(2 / 3, 2);
    expect(r.fields['header.payable_amount']!.grounded).toBe(true);
  });

  it('does not count an absent value as a failure to ground', () => {
    // A field the model declined to read is an abstention, not a
    // hallucination, and must not be scored as one.
    const r = groundExtraction(d, [
      { path: 'header.document_number', kind: 'text', value: null },
      { path: 'header.payable_amount', kind: 'money', value: '17519.31' },
    ]);
    expect(r.ungrounded).toEqual([]);
    expect(r.rate).toBe(1);
  });

  it('is 1 when there was nothing to ground at all', () => {
    expect(groundExtraction(d, []).rate).toBe(1);
  });
});
