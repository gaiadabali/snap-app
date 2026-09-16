import type { Document } from '@snap/api-contract/docdom';
import { describe, expect, it } from 'vitest';

import { structure } from './structure';

/**
 * The failures a real handset found, pinned.
 *
 * Every case here is taken from the 300-document run on the Galaxy A71
 * (`bench/corpus/device/mlkit/galaxy-a71-8gb/`), scored on 2026-09-16. The
 * suite in `structure.test.ts` was written from the rules; this one is written
 * from what the rules actually did to real recogniser output, which turned out
 * to be a different thing.
 *
 * The distinction that matters: `structure.test.ts` builds tidy input. ML Kit
 * does not. It merges a business name and a document banner onto one row
 * because the paper prints them on one line, it splits `DESCRIPTION` into
 * `DE SCRIPTION`, and it drops decimal points. Each of those defeated a rule
 * that passed its own unit test.
 */

const NOW = new Date('2026-09-16T00:00:00Z');

let seq = 0;
/** Build a document from rows of `[text, x]` words at a given line height. */
function doc(rows: Array<{ words: string[]; y: number; height?: number }>): Document {
  seq = 0;
  const lines = rows.map((row, i) => {
    let x = 0;
    const spans = row.words.map((w) => {
      const width = Math.max(8, w.length * 8);
      const span = {
        id: `s${seq++}`,
        text: w,
        box: { x, y: row.y, width, height: row.height ?? 20 },
        provenance: { engine: 'device-mlkit', confidence: 0.9, calibrated: false },
      };
      x += width + 8;
      return span;
    });
    return {
      id: `l${i}`,
      order: i,
      box: { x: 0, y: row.y, width: x, height: row.height ?? 20 },
      spans,
    };
  });
  return {
    version: '1.0.0',
    pages: [{ number: 1, width: 640, height: 900 }],
    blocks: [{ id: 'b', kind: 'unknown', page: 1, order: 0,
      box: { x: 0, y: 0, width: 640, height: 900 }, lines }],
    tables: [], figures: [], fields: [], unreadable: [],
  } as unknown as Document;
}

describe('GST is not the amount that is free of it', () => {
  it('never reads a GST-FREE subtotal as the GST', () => {
    // gen-supermarket-0002: reported 16.10 against a true GST of 1.46. The
    // number is plausible, it sits beside the word GST, and it is exactly the
    // amount carrying none.
    const f = structure(doc([
      { words: ['TOTAL', '17.56'], y: 100 },
      { words: ['GST', 'INCLUDED', '1.46'], y: 140 },
      { words: ['GST-FREE', 'SUBTOTAL', '16.10'], y: 180 },
    ]), NOW)['header.tax_amount'];
    expect(f?.value).toBe('1.46');
  });

  it('abstains rather than reporting a GST-FREE line when no real GST line exists', () => {
    const f = structure(doc([
      { words: ['TOTAL', '16.10'], y: 100 },
      { words: ['GST-FREE', 'SUBTOTAL', '16.10'], y: 140 },
    ]), NOW)['header.tax_amount'];
    expect(f?.value).toBeNull();
  });

  it('also refuses NO GST and EXEMPT wording', () => {
    for (const label of [['NO', 'GST', '12.00'], ['GST', 'EXEMPT', '12.00']]) {
      const f = structure(doc([
        { words: ['TOTAL', '12.00'], y: 100 },
        { words: label, y: 140 },
      ]), NOW)['header.tax_amount'];
      expect(f?.value, label.join(' ')).toBeNull();
    }
  });
});

describe('a GST larger than the total is impossible', () => {
  it('refuses it rather than showing it', () => {
    // gen-telco-0045: ML Kit read 6.82 as 682 against a total of 75.00.
    const f = structure(doc([
      { words: ['Subtotal', '(inc)', '75.00'], y: 100 },
      { words: ['GST', '682'], y: 140 },
      { words: ['Total', 'due', '$75.00'], y: 180 },
    ]), NOW)['header.tax_amount'];
    expect(f?.value).toBeNull();
  });

  it('still accepts a GST equal to the total, which a fully-taxed refund can be', () => {
    const f = structure(doc([
      { words: ['TOTAL', '10.00'], y: 100 },
      { words: ['GST', '10.00'], y: 140 },
    ]), NOW)['header.tax_amount'];
    expect(f?.value).toBe('10.00');
  });

  it('does not refuse a normal GST when the total is unreadable', () => {
    // No ceiling available is not a reason to abstain — that would trade a
    // measured 9.7% wrong for a much larger miss rate.
    const f = structure(doc([{ words: ['GST', 'INCLUDED', '2.72'], y: 140 }]), NOW)[
      'header.tax_amount'
    ];
    expect(f?.value).toBe('2.72');
  });
});

describe('the supplier shares its row with the document banner', () => {
  it('keeps the name when ML Kit merges it with TAX INVOICE', () => {
    // gen-trade_invoice-0005. Matching "TAX" discarded the whole line, so the
    // supplier became a line item on every trade invoice in the corpus.
    const f = structure(doc([
      { words: ['Westmead', 'Haulage', 'Pty', 'Ltd', 'TAX', 'INVOICE'], y: 100, height: 58 },
      { words: ['DE', 'SCRIPTION'], y: 300, height: 18 },
      { words: ['Insurance', 'surcharge', '(02)'], y: 340, height: 34 },
    ]), NOW)['header.supplier'];
    expect(f?.value).toBe('Westmead Haulage Pty Ltd');
  });

  it('drops a banner-only line entirely', () => {
    const f = structure(doc([
      { words: ['Corner', 'Lane', 'Coffee'], y: 100, height: 20 },
      { words: ['***', 'TAX', 'INVOICE', '***'], y: 140, height: 40 },
    ]), NOW)['header.supplier'];
    expect(f?.value).toBe('Corner Lane Coffee');
  });
});

describe('the topmost line wins, not the tallest', () => {
  it('prefers the supplier over a taller date stamp below it', () => {
    // gen-supermarket-0007: HILLVIEW FOOD STORE h=16, `18/01/2026 Op: TRENT`
    // h=22. Box height tracks digits and ascenders, not type size.
    const f = structure(doc([
      { words: ['HILLVIEW', 'FOOD', 'STORE'], y: 131, height: 16 },
      { words: ['18/01/2026', 'Op:', 'TRENT'], y: 298, height: 22 },
    ]), NOW)['header.supplier'];
    expect(f?.value).toBe('HILLVIEW FOOD STORE');
  });

  it('rejects an operator stamp that carries no digits', () => {
    // `Op: TRENT` names a person; requiring a digit after the label let it
    // through to become a supplier on gen-supermarket-0024.
    const f = structure(doc([
      { words: ['Op:', 'TRENT'], y: 100, height: 30 },
      { words: ['Brennan', 'Street', 'Grocery'], y: 140, height: 14 },
    ]), NOW)['header.supplier'];
    expect(f?.value).toBe('Brennan Street Grocery');
  });

  it('rejects a column heading the recogniser split in two', () => {
    // `DE SCRIPTION` does not match /\bDESCRIPTION\b/ — 26 of 43 failures.
    const f = structure(doc([
      { words: ['DE', 'SCRIPTION'], y: 100, height: 40 },
      { words: ['Kembla', 'Trade', 'Centre'], y: 140, height: 14 },
    ]), NOW)['header.supplier'];
    expect(f?.value).toBe('Kembla Trade Centre');
  });

  it('rejects consonant soup from a row of asterisks', () => {
    // `kk k` is what the recogniser made of `*** ***`.
    const f = structure(doc([
      { words: ['kk', 'k'], y: 100, height: 40 },
      { words: ['Brennan', 'Street', 'Grocery'], y: 140, height: 14 },
    ]), NOW)['header.supplier'];
    expect(f?.value).toBe('Brennan Street Grocery');
  });

  it('still does not mistake a business called PRICES PLUS for a column heading', () => {
    // The despacing must not turn every name containing a heading word into
    // one. `PRICESPLUS` contains `PRICE` but not as a word.
    const f = structure(doc([{ words: ['PRICES', 'PLUS'], y: 100, height: 30 }]), NOW)[
      'header.supplier'
    ];
    expect(f?.value).toBe('PRICES PLUS');
  });
});
