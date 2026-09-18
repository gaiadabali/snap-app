import type { Document } from '@snap/api-contract/docdom';
import type { PreviewFields } from '@snap/docai-preview';
import { describe, expect, it } from 'vitest';

import {
  evaluateQualityGate,
  LOW_CONFIDENCE_GATE_ENABLED,
  LOW_CONFIDENCE_GATE_THRESHOLD,
} from './quality-gate';

/**
 * OD-13 — `docs/ON-DEVICE.md` §11 Stage 2.
 *
 * Two conditions are threshold-free and are asserted as LIVE here: a total
 * the structurer never found, and a recogniser that found no text at all.
 * The third — confidence against a number — is asserted to be BUILT AND OFF,
 * not merely absent, because "off" is a claim someone could accidentally
 * undo and this file is what would catch it.
 *
 * Every test in "never throws" breaks a guard on purpose and checks that the
 * break stays inside this module, per the non-negotiable rule: a gate that
 * cannot evaluate must let the capture through, not take it down.
 */

function span(text: string, confidence = 0.99) {
  return {
    id: 's', text, box: { x: 0, y: 0, width: 10, height: 10 },
    provenance: { engine: 'device-mlkit', confidence, calibrated: false },
  };
}

function docWith(lines: Array<ReturnType<typeof span>[]>): Partial<Document> {
  return {
    version: '1.0.0',
    pages: [{ number: 1, width: 100, height: 100, dpi: null, source: 'photo', restoration: [] }],
    blocks: [
      {
        id: 'b', kind: 'unknown', box: { x: 0, y: 0, width: 100, height: 100 }, page: 1, order: 0,
        provenance: { engine: 'device-mlkit', confidence: 0.99, calibrated: false },
        lines: lines.map((spans, i) => ({
          id: `l${i}`, box: { x: 0, y: i * 10, width: 100, height: 10 }, order: i, spans,
        })),
      },
    ],
    tables: [], figures: [], fields: [], unreadable: [],
  };
}

const readableDoc = docWith([[span('TOTAL'), span('48.50')]]);
const readableFields: PreviewFields = {
  'header.payable_amount': {
    value: '48.50', normalisedValue: '48.50', spanIds: ['s'], box: null, page: 1,
    confidence: 0.99, grounded: true,
  },
};

const noTotalFields: PreviewFields = {
  'header.payable_amount': {
    value: null, normalisedValue: null, spanIds: [], box: null, page: null,
    confidence: 0, grounded: false,
  },
};

describe('no-text — threshold-free, live', () => {
  it('fires when the document has zero blocks', () => {
    const empty: Partial<Document> = {
      version: '1.0.0', pages: [], blocks: [], tables: [], figures: [], fields: [], unreadable: [],
    };
    const result = evaluateQualityGate(empty, undefined);
    expect(result).toEqual({ reason: 'no-text', copy: expect.stringContaining("couldn't find any text") });
  });

  it('fires when every span is whitespace — a block exists but nothing was read', () => {
    const blank = docWith([[span('   '), span('')]]);
    expect(evaluateQualityGate(blank, undefined)?.reason).toBe('no-text');
  });

  it('does not fire when there is real text, even before the total is checked', () => {
    const result = evaluateQualityGate(readableDoc, readableFields);
    expect(result).toBeNull();
  });
});

describe('no-total — threshold-free, live', () => {
  it('fires when the structurer abstained on the total — a fact, not a score', () => {
    // Plenty of readable text; the structurer found none of it total-shaped.
    const doc = docWith([[span('THANK'), span('YOU')]]);
    const result = evaluateQualityGate(doc, noTotalFields);
    expect(result).toEqual({ reason: 'no-total', copy: expect.stringContaining("couldn't find a total") });
  });

  it('also fires when no fields were computed at all', () => {
    const doc = docWith([[span('THANK'), span('YOU')]]);
    expect(evaluateQualityGate(doc, undefined)?.reason).toBe('no-total');
  });

  it('does not fire once a total is present, regardless of its confidence', () => {
    // Confidence is irrelevant here on purpose — see the low-confidence tests
    // below for the ONE place a number is allowed to matter, and only when
    // explicitly turned on.
    const lowConfidenceButFound = docWith([[span('TOTAL', 0.10), span('48.50', 0.10)]]);
    expect(evaluateQualityGate(lowConfidenceButFound, readableFields)).toBeNull();
  });
});

describe('low-confidence — built, and OFF', () => {
  it('the flag defaults to disabled', () => {
    expect(LOW_CONFIDENCE_GATE_ENABLED).toBe(false);
  });

  it('the threshold defaults to null — not a plausible-looking number', () => {
    // This is deliberate belt-and-braces: even if the flag were flipped by
    // mistake, a null threshold keeps the gate silent rather than running on
    // whatever number happened to be left lying around.
    expect(LOW_CONFIDENCE_GATE_THRESHOLD).toBeNull();
  });

  it('never fires even on a document built to trip it, because it is disabled', () => {
    // Every span at 0.01 confidence, with the total field still present — if
    // the flag were ever flipped on with some plausible threshold, this exact
    // document would trigger it. With the flag off, it must not.
    const veryLowConfidence = docWith([[span('TOTAL', 0.01), span('48.50', 0.01)]]);
    const result = evaluateQualityGate(veryLowConfidence, readableFields);
    expect(result).toBeNull();
    expect(LOW_CONFIDENCE_GATE_ENABLED).toBe(false); // re-asserted: this test proves nothing if it drifted true
  });
});

describe('never throws — the non-negotiable', () => {
  it('a document whose blocks getter throws still returns null, not an exception', () => {
    const throwing: Partial<Document> = {
      get blocks(): never {
        throw new Error('simulated: a coordinate bug reading this DocDOM');
      },
    } as Partial<Document>;
    expect(() => evaluateQualityGate(throwing, readableFields)).not.toThrow();
    expect(evaluateQualityGate(throwing, readableFields)).toBeNull();
  });

  it('a document whose line spans throw mid-scan still returns null', () => {
    const throwingLine: Partial<Document> = {
      version: '1.0.0', pages: [], tables: [], figures: [], fields: [], unreadable: [],
      blocks: [
        {
          id: 'b', kind: 'unknown', box: { x: 0, y: 0, width: 1, height: 1 }, page: 1, order: 0,
          provenance: { engine: 'device-mlkit', confidence: 1, calibrated: false },
          lines: [
            {
              id: 'l', box: { x: 0, y: 0, width: 1, height: 1 }, order: 0,
              get spans(): never {
                throw new Error('simulated');
              },
            },
          ],
        },
      ] as never,
    };
    expect(evaluateQualityGate(throwingLine, readableFields)).toBeNull();
  });

  it('a fields object whose accessor throws still returns null', () => {
    const throwingFields = {
      get ['header.payable_amount'](): never {
        throw new Error('simulated');
      },
    } as unknown as PreviewFields;
    expect(evaluateQualityGate(readableDoc, throwingFields)).toBeNull();
  });

  it('null and undefined documents are handled without throwing', () => {
    expect(evaluateQualityGate(null, readableFields)).toBeNull();
    expect(evaluateQualityGate(undefined, readableFields)).toBeNull();
  });
});
