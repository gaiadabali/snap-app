import { describe, expect, it } from 'vitest';

import { foldTotals, fyLabel, fyStartYear, workShareCents } from './deduction-totals.js';

describe('workShareCents (D-1 contract)', () => {
  it.each([
    [10000n, null, 10000n],
    [10000n, 0, 10000n],
    [10000n, 1, 9900n],
    [10000n, 99, 100n],
    [1n, 99, 0n], // 0.01 cent rounds down
    [1n, 50, 1n], // 0.5 rounds half up
    [1n, 49, 1n],
    [1n, 51, 0n],
    [333n, 50, 167n], // 166.5 -> 167
    [999n, 1, 989n], // 989.01
    [101n, 99, 1n], // 1.01
    [-333n, 50, -166n], // -166.5 half up is toward +inf
  ])('%s cents at %s%% private -> %s', (cents, p, want) => {
    expect(workShareCents(cents, p)).toBe(want);
  });
});

describe('financial year', () => {
  it('splits at 30 Jun / 1 Jul', () => {
    expect(fyStartYear('2026-06-30')).toBe(2025);
    expect(fyStartYear('2026-07-01')).toBe(2026);
    expect(fyLabel(2025)).toBe('2025-26');
    expect(fyLabel(2099)).toBe('2099-00');
  });
});

describe('foldTotals', () => {
  const line = (documentId: string, cents: bigint, p: number | null, source: 'user' | 'supplier' = 'user') => ({
    documentId, label: 'D5', itemId: 'tools', privateUsePercent: p, source, amountCents: cents, currency: 'AUD',
  });
  it('never sums a foreign currency', () => {
    const t = foldTotals('2025-26', [{ ...line('a', 9999n, null), currency: 'USD' }], 0);
    expect(t.totalCents).toBe(0n);
    expect(t.toReview).toEqual({ receiptCount: 0, amountCents: 0n, foreignCurrencyCount: 1 });
  });
  it('rounds per line, then sums; supplier lines go to review', () => {
    const t = foldTotals('2025-26', [line('a', 1n, 50), line('a', 1n, 50), line('b', 100n, null), line('c', 500n, 0, 'supplier')], 12);
    expect(t.totalCents).toBe(102n); // 1 + 1 + 100, not halfUp(2 * 0.5) = 1
    expect(t.items).toEqual([{ label: 'D5', itemId: 'tools', receiptCount: 2, workCents: 102n, receiptRefs: [] }]);
    expect(t.toReview).toEqual({ receiptCount: 1, amountCents: 500n, foreignCurrencyCount: 0 });
    expect(t.workKilometres).toBe(12);
  });
});
