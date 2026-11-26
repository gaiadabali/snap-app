import { describe, expect, it } from 'vitest';

import { foldTotals } from './deduction-totals.js';
import { documentSourceLines, isGstFreeCode } from './deductions.repo.js';

/**
 * One receipt -> its source lines for the deduction totals, without a database: the split
 * lines' GST-inclusive amounts (the bug fixed 2026-11-26: a split line was counted at
 * `line_net_amount` even when that was the amount before GST), the rest under the receipt's
 * category, and who chose each part.
 */
const taxCats = new Map([
  ['tools', { label: 'D5', item_id: 'tools', private_use_percent: null }],
  ['tools50', { label: 'D5', item_id: 'tools', private_use_percent: 50 }],
  ['laundry', { label: 'D3', item_id: 'washPowder', private_use_percent: null }],
]);
const doc = (o: Partial<Parameters<typeof documentSourceLines>[0]> = {}) => ({
  document_id: 'doc-1', category_id: 'groceries', source: 'user', currency: 'AUD',
  payable: '64.3000', tax: '2.2700', page_sha: null, mime: null, storage_key: null, ...o,
});
const l = (lineNumber: number, amount: string, categoryId: string | null = null, gstFree = false) => ({ lineNumber, amount, gstFree, categoryId });
const brief = (xs: ReturnType<typeof documentSourceLines>) => xs.map((x) => [x.label, x.itemId, x.source, x.amountCents]);

describe('documentSourceLines', () => {
  it('a work item on a supermarket docket counts as printed (GST already in it); groceries stay out', () => {
    const lines = [l(1, '3.10', null, true), l(2, '25.00', 'tools'), l(3, '36.20', null, true)];
    expect(brief(documentSourceLines(doc(), lines, taxCats))).toEqual([['D5', 'tools', 'user', 2500n]]);
  });

  it('a tax invoice printed before GST: the split line counts with its GST, and the rest keeps only its own', () => {
    // 100 + 50 before GST, 15 GST, 165 paid. Before the fix: tools 100.00 and the rest 65.00.
    const out = documentSourceLines(
      doc({ category_id: 'laundry', payable: '165.0000', tax: '15.0000' }),
      [l(1, '100.00', 'tools'), l(2, '50.00')],
      taxCats,
    );
    expect(brief(out)).toEqual([['D5', 'tools', 'user', 11000n], ['D3', 'washPowder', 'user', 5500n]]);
    expect(out.reduce((a, x) => a + x.amountCents, 0n)).toBe(16500n);
  });

  it('a GST-free line on that invoice counts its amount, with no GST added', () => {
    const out = documentSourceLines(
      doc({ category_id: null, payable: '185.0000', tax: '15.0000' }),
      [l(1, '100.00'), l(2, '50.00'), l(3, '20.00', 'tools', true)],
      taxCats,
    );
    expect(brief(out)).toEqual([['D5', 'tools', 'user', 2000n]]);
  });

  it('a supplier-filed receipt: the person’s split line counts, the rest waits for them', () => {
    const out = documentSourceLines(doc({ category_id: 'laundry', source: 'supplier', payable: '30.0000', tax: null }), [l(1, '10.00', 'tools'), l(2, '20.00')], taxCats);
    expect(brief(out)).toEqual([['D5', 'tools', 'user', 1000n], ['D3', 'washPowder', 'supplier', 2000n]]);
  });

  it('a line in the receipt’s own category and the rest are one source line (one work-share rounding)', () => {
    const out = documentSourceLines(doc({ category_id: 'tools50', payable: '10.0100', tax: null }), [l(1, '5.01', 'tools50'), l(2, '5.00')], taxCats);
    expect(brief(out)).toEqual([['D5', 'tools', 'user', 1001n]]);
    // 1001 at 50% private use -> 501 (half up), not 251 + 250.
    expect(foldTotals('2025-26', out, 0).totalCents).toBe(501n);
  });

  it('a receipt with no lines filed is the whole total, as before', () => {
    expect(brief(documentSourceLines(doc({ category_id: 'tools', payable: '33.3000' }), [], taxCats))).toEqual([['D5', 'tools', 'user', 3330n]]);
  });

  it('a line in a category that is not a tax category is split off and sent nowhere', () => {
    const out = documentSourceLines(doc({ category_id: 'tools', payable: '30.0000', tax: null }), [l(1, '10.00', 'groceries'), l(2, '20.00')], taxCats);
    expect(brief(out)).toEqual([['D5', 'tools', 'user', 2000n]]);
  });

  it('GST codes: Z, E and O carry none', () => {
    expect(['S', 'Z', 'E', 'O', null].map(isGstFreeCode)).toEqual([false, true, true, true, false]);
  });
});
