import type { Document } from '@snap/docai';
import { describe, expect, it } from 'vitest';

import { POINTED_FIELDS, renderSpanCatalogue, resolve, resolveAll } from './grounded';

/**
 * C1 and C2, pinned.
 *
 * The claim these tests exist to defend is narrow and absolute: **a pointed
 * field cannot be invented.** Not "is unlikely to be" — cannot, because the
 * value is read out of the page by this module and the model never supplies
 * one. Most of what follows asserts a REFUSAL, for the reason
 * `docs/DEPLOY.md` §8 gives: a suite that only proves the happy path is what
 * let the RLS bypass survive.
 */

const span = (id: string, text: string, x: number, confidence = 0.95) => ({
  id,
  text,
  box: { x, y: 100, width: 40, height: 20 },
  provenance: { engine: 'ppocr-v5', confidence, calibrated: false },
});

const doc = (): Document =>
  ({
    version: '1.0.0',
    pages: [{ number: 1, width: 600, height: 800 }],
    blocks: [
      {
        id: 'b1',
        kind: 'unknown',
        page: 1,
        order: 0,
        box: { x: 0, y: 100, width: 600, height: 20 },
        lines: [
          {
            id: 'l1',
            order: 0,
            box: { x: 0, y: 100, width: 300, height: 20 },
            spans: [span('s1', 'TOTAL', 0), span('s2', '$', 50, 0.7), span('s3', '36.20', 90, 0.88)],
          },
          {
            id: 'l2',
            order: 1,
            box: { x: 0, y: 140, width: 300, height: 20 },
            spans: [span('s4', 'ABN', 0), span('s5', '46464680097', 40)],
          },
        ],
      },
    ],
    unreadable: [],
  }) as unknown as Document;

describe('the model points; the page supplies the value', () => {
  it('reads the value out of the spans, not out of the model', () => {
    const r = resolve(doc(), { spans: ['s3'], confidence: 0.4 });
    expect(r.value).toBe('36.20');
    expect(r.grounded).toBe(true);
    expect(r.spanIds).toEqual(['s3']);
  });

  it('joins a run of spans in the order given', () => {
    // `$ 36.20` printed across two boxes is one value.
    expect(resolve(doc(), { spans: ['s2', 's3'] }).value).toBe('$ 36.20');
  });

  it('delivers the bbox extraction-schema.json has always promised', () => {
    const r = resolve(doc(), { spans: ['s2', 's3'] });
    expect(r.box).toEqual({ x: 50, y: 100, width: 80, height: 20 });
    expect(r.page).toBe(1);
  });

  it('reports the WEAKEST supporting confidence, not the model’s own', () => {
    // s2 is 0.70, s3 is 0.88. A total whose dollar sign is a coin toss is not
    // 88% right — and the model claiming 0.99 changes nothing.
    const r = resolve(doc(), { spans: ['s2', 's3'], confidence: 0.99 });
    expect(r.confidence).toBe(0.7);
  });
});

describe('C2 — no span means null', () => {
  it('returns null when the model pointed at nothing', () => {
    for (const ref of [null, undefined, { spans: [] }]) {
      const r = resolve(doc(), ref as never);
      expect(r.value).toBeNull();
      expect(r.grounded).toBe(false);
      // Not a low confidence, not a guess with a warning. Null. (D16)
      expect(r.confidence).toBe(0);
    }
  });

  it('returns null — and SAYS SO — when the model invents a span id', () => {
    // The pointing equivalent of inventing a value. The difference is that
    // this one is visible: a fabricated identifier does not exist on the page,
    // so it can be counted, which a fabricated number never could.
    const r = resolve(doc(), { spans: ['sp-does-not-exist'] });
    expect(r.value).toBeNull();
    expect(r.grounded).toBe(false);
    expect(r.unknownSpans).toEqual(['sp-does-not-exist']);
  });

  it('rejects a run assembled from too many DISTINCT boxes', () => {
    // Nine distinct spans, not nine references. The first version of this test
    // repeated five ids nine times and passed only because the resolver did
    // not yet deduplicate — once it did, nine references to five spans is five
    // spans, which is correctly under the cap. The fixture was wrong, not the
    // rule.
    const wide = {
      version: '1.0.0',
      pages: [{ number: 1, width: 900, height: 200 }],
      blocks: [{
        id: 'b', kind: 'unknown', page: 1, order: 0,
        box: { x: 0, y: 100, width: 900, height: 20 },
        lines: [{
          id: 'l', order: 0, box: { x: 0, y: 100, width: 900, height: 20 },
          spans: Array.from({ length: 9 }, (_, i) => span(`w${i}`, String(i), i * 50)),
        }],
      }],
      unreadable: [],
    } as unknown as Document;

    const nine = Array.from({ length: 9 }, (_, i) => `w${i}`);
    expect(resolve(wide, { spans: nine }).grounded).toBe(false);
    // Eight is the cap, and the cap is inclusive.
    expect(resolve(wide, { spans: nine.slice(0, 8) }).grounded).toBe(true);
  });

  it('a field the OCR never read cannot come back with a value', () => {
    // The whole point, stated once: there is no span carrying an issue date on
    // this document, so no reference to it can exist, so no value can.
    const d = doc();
    const everySpanId = d.blocks.flatMap((b) => b.lines.flatMap((l) => l.spans.map((s) => s.id)));
    for (const id of everySpanId) {
      expect(resolve(d, { spans: [id] }).value).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('resolveAll', () => {
  it('scores only the fields the model attempted', () => {
    const out = resolveAll(doc(), {
      payableAmount: { spans: ['s3'] },
      supplierAbn: { spans: ['s5'] },
      // Not attempted: a docket with no document number. An abstention is the
      // correct answer and must not count against the rate.
      documentNumber: { spans: [] },
    });
    expect(out.groundedRate).toBe(1);
    expect(out.fields.payableAmount.value).toBe('36.20');
    expect(out.fields.supplierAbn.value).toBe('46464680097');
    expect(out.fields.documentNumber.value).toBeNull();
  });

  it('collects every invented span id across fields', () => {
    const out = resolveAll(doc(), {
      payableAmount: { spans: ['nope-1'] },
      taxAmount: { spans: ['nope-2'] },
    });
    expect(out.unknownSpans.sort()).toEqual(['nope-1', 'nope-2']);
    expect(out.groundedRate).toBe(0);
  });

  it('gives every pointed field an entry, present or not', () => {
    const out = resolveAll(doc(), {});
    expect(Object.keys(out.fields).sort()).toEqual([...POINTED_FIELDS].sort());
    for (const f of POINTED_FIELDS) expect(out.fields[f].value).toBeNull();
  });
});

describe('the catalogue the model chooses from', () => {
  it('lists every span with its own id, under the line it belongs to', () => {
    const rendered = renderSpanCatalogue(doc());
    expect(rendered).toContain('# TOTAL $ 36.20');
    expect(rendered).toContain('s3\t36.20');
    expect(rendered).toContain('s5\t46464680097');
  });

  it('uses the DocDOM ids verbatim, so nothing has to be translated back', () => {
    // The Phase 1 sidecar rule: translation is where coordinate bugs live.
    const rendered = renderSpanCatalogue(doc());
    for (const id of ['s1', 's2', 's3', 's4', 's5']) {
      expect(rendered).toContain(`${id}\t`);
    }
  });

  it('is bounded, so a dense page cannot blow the prompt', () => {
    expect(renderSpanCatalogue(doc(), 3).split('\n').length).toBeLessThanOrEqual(4);
  });
});

describe('a pointed date becomes ISO without the model converting it', () => {
  const dated = (text: string): Document =>
    ({
      version: '1.0.0',
      pages: [{ number: 1, width: 600, height: 800 }],
      blocks: [{
        id: 'b', kind: 'unknown', page: 1, order: 0,
        box: { x: 0, y: 0, width: 600, height: 20 },
        lines: [{
          id: 'l', order: 0, box: { x: 0, y: 0, width: 300, height: 20 },
          spans: [span('d1', text, 0)],
        }],
      }],
      unreadable: [],
    }) as unknown as Document;

  it('reads every Australian day-first form the corpus prints', () => {
    for (const [printed, expected] of [
      ['22/08/2026', '2026-08-22'],
      ['22 / 08 / 2026', '2026-08-22'],   // split across spans by the OCR
      ['04/01/26', '2026-01-04'],
      ['31-08-2026', '2026-08-31'],
      ['19.12.2025', '2025-12-19'],
      ['14 Aug 2026', '2026-08-14'],
      ['2026-08-22', '2026-08-22'],
    ] as const) {
      const r = resolve(dated(printed), { spans: ['d1'] }, 'date');
      expect(r.normalisedValue, printed).toBe(expected);
      // The page's own text survives, for the review overlay to highlight.
      expect(r.value).toBe(printed);
    }
  });

  it('is day-first, never month-first', () => {
    // 08/14/2026 is American. Guessing would re-introduce the ambiguity the
    // date validator exists to catch, so month 14 is simply not a date.
    expect(resolve(dated('08/14/2026'), { spans: ['d1'] }, 'date').normalisedValue).toBeNull();
    // And the unambiguous case reads as 3 April, never 4 March.
    expect(resolve(dated('03/04/2026'), { spans: ['d1'] }, 'date').normalisedValue)
      .toBe('2026-04-03');
  });

  it('refuses a day the month does not have', () => {
    expect(resolve(dated('31/02/2026'), { spans: ['d1'] }, 'date').normalisedValue).toBeNull();
  });

  it('refuses text that is not a date at all', () => {
    const r = resolve(dated('TOTAL'), { spans: ['d1'] }, 'date');
    expect(r.normalisedValue).toBeNull();
    expect(r.value).toBe('TOTAL'); // still grounded — it points at something real
  });
});

describe('a span named twice is a slip, not a repetition', () => {
  it('deduplicates while preserving order', () => {
    // A model repeated its references and produced `11 11 , , 000 000` for a
    // total printed once. A span is a specific box; naming it twice cannot
    // mean the value contains it twice.
    const r = resolve(doc(), { spans: ['s2', 's3', 's2', 's3'] });
    expect(r.value).toBe('$ 36.20');
    expect(r.spanIds).toEqual(['s2', 's3']);
  });
});
