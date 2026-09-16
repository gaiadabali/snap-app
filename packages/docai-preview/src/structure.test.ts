import type { Document } from '@snap/api-contract/docdom';
import { describe, expect, it } from 'vitest';

import { abnIsValid, structure, toIsoDate } from './structure';

/**
 * The structurer, pinned — and most of it pins an ABSTENTION.
 *
 * `docs/ON-DEVICE.md` §6.1 names the quantity that decides whether this ships:
 * not fill rate but **wrong-when-shown**. A preview that is wrong one time in
 * twenty on the total teaches the user to wait for the server anyway, and has
 * cost the trust the whole pitch depends on. So the rules that matter most here
 * are the ones that decline.
 */

const NOW = new Date('2026-09-16T00:00:00Z');

let seq = 0;
const span = (text: string, x: number, conf = 0.95) => ({
  id: `s${seq++}`,
  text,
  box: { x, y: 0, width: Math.max(8, text.length * 8), height: 20 },
  provenance: { engine: 'test', confidence: conf, calibrated: false },
});

/** Build a document from lines of words. `y` increases down the page. */
function doc(rows: string[][], opts: { heights?: number[] } = {}): Document {
  seq = 0;
  const lines = rows.map((words, i) => {
    let x = 0;
    const spans = words.map((w) => {
      const s = span(w, x);
      s.box.y = i * 40;
      s.box.height = opts.heights?.[i] ?? 20;
      x += s.box.width + 8;
      return s;
    });
    return {
      id: `l${i}`,
      order: i,
      box: {
        x: 0,
        y: i * 40,
        width: x,
        height: opts.heights?.[i] ?? 20,
      },
      spans,
    };
  });
  return {
    version: '1.0.0',
    pages: [{ number: 1, width: 600, height: rows.length * 40 + 40 }],
    blocks: [{ id: 'b', kind: 'unknown', page: 1, order: 0,
      box: { x: 0, y: 0, width: 600, height: rows.length * 40 }, lines }],
    tables: [], figures: [], fields: [], unreadable: [],
  } as unknown as Document;
}

// 51824753556 is a genuine mod-89-valid ABN used throughout this repo's fixtures.
const VALID_ABN = '51824753556';

describe('the total', () => {
  it('is the money on a keyword line', () => {
    const f = structure(doc([['TOTAL', '$36.20']]), NOW)['header.payable_amount'];
    expect(f?.value).toBe('36.20');
    expect(f?.grounded).toBe(true);
  });

  it('reads a figure split across spans as one value', () => {
    // `$ 1 , 042.60` is four boxes and one number. Matching the longest run
    // first is what stops `042.60` winning and reporting a hundredth.
    const f = structure(doc([['TOTAL', '$', '1', ',', '042.60']]), NOW)['header.payable_amount'];
    expect(f?.value).toBe('1,042.60');
    expect(f?.spanIds).toHaveLength(4);
  });

  it('is not the subtotal, the GST line, or the change', () => {
    const f = structure(
      doc([['SUBTOTAL', '33.97'], ['GST', '2.23'], ['TOTAL', '36.20'], ['CHANGE', '13.80']]),
      NOW,
    )['header.payable_amount'];
    expect(f?.value).toBe('36.20');
  });

  it('prefers the LOWEST keyword line when several qualify', () => {
    // A docket prints the total, then repeats it on the payment line.
    const f = structure(doc([['TOTAL', '36.20'], ['EFTPOS', '36.20']]), NOW)['header.payable_amount'];
    expect(f?.page).toBe(1);
    expect(f?.value).toBe('36.20');
  });

  it('ABSTAINS when no keyword line carries an amount', () => {
    // No "largest number on the page" fallback: on a real docket that number is
    // routinely a phone number or an item code.
    const f = structure(doc([['DIESEL', '128.44L'], ['PUMP', '4'], ['0298334410', '']]), NOW)[
      'header.payable_amount'
    ];
    expect(f?.value).toBeNull();
    expect(f?.grounded).toBe(false);
  });
});

describe('GST', () => {
  it('is the money on a GST line', () => {
    const f = structure(doc([['TOTAL', '36.20'], ['GST', 'INCLUDED', '2.23']]), NOW)[
      'header.tax_amount'
    ];
    expect(f?.value).toBe('2.23');
  });

  it('is NEVER computed when the document does not print it', () => {
    // §3.4: the preview may not produce a figure the paper does not carry. On a
    // mixed GST-free docket one eleventh of the total is wrong precisely where
    // nobody would check it.
    const f = structure(doc([['TOTAL', '36.20']]), NOW)['header.tax_amount'];
    expect(f?.value).toBeNull();
    expect(f?.grounded).toBe(false);
  });

  it('does not read "TAX INVOICE" as a GST line', () => {
    const f = structure(doc([['***', 'TAX', 'INVOICE', '***'], ['INV', '88214']]), NOW)[
      'header.tax_amount'
    ];
    expect(f?.value).toBeNull();
  });
});

describe('the ABN', () => {
  it('is found on a labelled line', () => {
    const f = structure(doc([['ABN', VALID_ABN]]), NOW)['header.supplier_abn'];
    expect(f?.value).toBe(VALID_ABN);
  });

  it('is found when printed in the ATO grouping across spans', () => {
    const f = structure(doc([['ABN', '51', '824', '753', '556']]), NOW)['header.supplier_abn'];
    expect(f?.value).toBe(VALID_ABN);
  });

  it('CANNOT return an invalid one — mod-89 makes a hallucinated ABN unrepresentable', () => {
    // This is the strongest guarantee in the file. A wrong eleven digits almost
    // never passes the checksum, so there is no filtered guess here; there is
    // no guess at all.
    const f = structure(doc([['ABN', '12345678901']]), NOW)['header.supplier_abn'];
    expect(f?.value).toBeNull();
  });

  it('is not confused with a phone number or an ACN', () => {
    const f = structure(doc([['PH', '02', '9833', '4410'], ['ACN', '123456789']]), NOW)[
      'header.supplier_abn'
    ];
    expect(f?.value).toBeNull();
  });

  it('abstains on a docket that prints none', () => {
    const f = structure(doc([['ROADSIDE', 'COFFEE', 'VAN'], ['TOTAL', '8.50']]), NOW)[
      'header.supplier_abn'
    ];
    expect(f?.value).toBeNull();
  });
});

describe('the date', () => {
  it('reads Australian day-first forms', () => {
    for (const [printed, iso] of [
      ['06/09/2026', '2026-09-06'],
      ['31/08/26', '2026-08-31'],
      ['19.12.2025', '2025-12-19'],
      ['14 Aug 2026', '2026-08-14'],
    ] as const) {
      const f = structure(doc([[...printed.split(' ')]]), NOW)['header.issue_date'];
      expect(f?.normalisedValue, printed).toBe(iso);
    }
  });

  it('FLAGS day/month ambiguity instead of resolving it', () => {
    // 06/09/26 is a different BAS quarter depending on which half is the month.
    const f = structure(doc([['06/09/2026']]), NOW)['header.issue_date'];
    expect(f?.normalisedValue).toBe('2026-09-06');
    expect(f?.note).toMatch(/both plausible/i);
  });

  it('does not flag a date that cannot be ambiguous', () => {
    const f = structure(doc([['19/12/2025']]), NOW)['header.issue_date'];
    expect(f?.note).toBeUndefined();
  });

  it('rejects a date outside the plausibility window', () => {
    // A receipt dated 2006 is a misread century, not a 20-year-old expense.
    expect(structure(doc([['14/08/2006']]), NOW)['header.issue_date']?.value).toBeNull();
    // And next year has not happened.
    expect(structure(doc([['14/08/2027']]), NOW)['header.issue_date']?.value).toBeNull();
  });

  it('is day-first, never month-first', () => {
    expect(toIsoDate('08/14/2026')).toBeNull();
    expect(toIsoDate('03/04/2026')).toBe('2026-04-03');
    expect(toIsoDate('31/02/2026')).toBeNull();
  });
});

describe('tax invoice wording and supplier', () => {
  it('true only when the words actually appear', () => {
    expect(structure(doc([['***', 'TAX', 'INVOICE', '***']]), NOW)['header.says_tax_invoice']?.value)
      .toBe('true');
    // false is a REAL answer, not an abstention — a receipt is a receipt.
    expect(structure(doc([['RECEIPT']]), NOW)['header.says_tax_invoice']?.value).toBe('false');
  });

  it('picks the largest type at the head of the docket', () => {
    const d = doc(
      [['KALINDA', 'GROCERS'], ['303', 'Bourke', 'St', 'Elizabeth', 'SA'], ['TOTAL', '36.20']],
      { heights: [30, 14, 20] },
    );
    expect(structure(d, NOW)['header.supplier']?.value).toBe('KALINDA GROCERS');
  });

  it('is not the address, the phone number or the ABN line', () => {
    const d = doc(
      [['12', 'Hume', 'Hwy', 'Gundagai', 'NSW'], ['PH', '02', '6944', '1234'], ['ABN', VALID_ABN]],
      { heights: [30, 28, 26] },
    );
    expect(structure(d, NOW)['header.supplier']?.value).toBeNull();
  });
});

describe('every field is grounded by construction', () => {
  it('carries span ids, a box and the WEAKEST confidence', () => {
    const d = doc([['TOTAL', '$', '36.20']]);
    // Make the dollar sign the weak one.
    d.blocks[0]!.lines[0]!.spans[1]!.provenance.confidence = 0.55;
    const f = structure(d, NOW)['header.payable_amount'];
    expect(f?.spanIds.length).toBeGreaterThan(0);
    expect(f?.box).not.toBeNull();
    // A total whose dollar sign is a coin toss is not 95% right.
    expect(f?.confidence).toBe(0.55);
  });

  it('an abstained field points at nothing and claims no confidence', () => {
    const f = structure(doc([['NOTHING', 'HERE']]), NOW)['header.payable_amount'];
    expect(f?.spanIds).toEqual([]);
    expect(f?.box).toBeNull();
    expect(f?.confidence).toBe(0);
  });
});

describe('abnIsValid', () => {
  it('accepts a real ABN and rejects near misses', () => {
    expect(abnIsValid(VALID_ABN)).toBe(true);
    expect(abnIsValid('51824753557')).toBe(false);
    expect(abnIsValid('5182475355')).toBe(false);
    expect(abnIsValid('')).toBe(false);
  });
});

describe('a card number is not part of the total', () => {
  /** Lay out a payment line the way a docket does: label left, amount right. */
  function paymentLine(label: string[], amount: string, gap: number): Document {
    seq = 0;
    let x = 0;
    const spans = [...label, amount].map((t, i) => {
      const s = span(t, x);
      // The real gap on a right-aligned docket sits before the amount.
      x += s.box.width + (i === label.length - 1 ? gap : 6);
      return s;
    });
    return {
      version: '1.0.0',
      pages: [{ number: 1, width: 600, height: 80 }],
      blocks: [{ id: 'b', kind: 'unknown', page: 1, order: 0,
        box: { x: 0, y: 0, width: 600, height: 20 },
        lines: [{ id: 'l', order: 0, box: { x: 0, y: 0, width: 600, height: 20 }, spans }] }],
      tables: [], figures: [], fields: [], unreadable: [],
    } as unknown as Document;
  }

  it('does not fuse a masked card number with the amount beside it', () => {
    // The bug the first measurement found: `VISA ****4417   23.00` came back
    // as `441723.00`, on every tier-S document carrying a card number.
    const f = structure(paymentLine(['VISA', '****', '4417'], '23.00', 120), NOW)[
      'header.payable_amount'
    ];
    expect(f?.value).toBe('23.00');
  });

  it('still joins a figure split across adjacent boxes', () => {
    // The rule this adjacency check must not break: `$ 1 , 042.60` is four
    // boxes separated by hairlines and is one number.
    const f = structure(doc([['TOTAL', '$', '1', ',', '042.60']]), NOW)['header.payable_amount'];
    expect(f?.value).toBe('1,042.60');
  });
});
