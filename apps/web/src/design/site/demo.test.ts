import { describe, expect, it } from 'vitest';

import {
  BUDGET,
  CATEGORIES,
  DOCKET,
  GOALS,
  GOALS_TOTAL,
  HOUSEHOLD_SCANS,
  SPENDING,
} from './demo';

/**
 * The worked example has to reconcile. A balanced-books claim sitting above
 * arithmetic that does not balance is the worst possible own goal, so the
 * sums are asserted here in integer cents rather than trusted to the comments.
 */
function cents(amount: string): bigint {
  const [whole = '0', frac = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
}

const sum = (xs: readonly string[]) => xs.reduce((a, x) => a + cents(x), 0n);

describe('the demo docket', () => {
  it('splits into its two subtotals', () => {
    expect(sum(DOCKET.lines.filter((l) => !l.taxable).map((l) => l.amount))).toBe(cents(DOCKET.gstFree));
    expect(sum(DOCKET.lines.filter((l) => l.taxable).map((l) => l.amount))).toBe(cents(DOCKET.taxable));
    expect(cents(DOCKET.gstFree) + cents(DOCKET.taxable)).toBe(cents(DOCKET.total));
  });

  it('carries exactly one eleventh of the taxable lines as GST', () => {
    expect(cents(DOCKET.taxable) % 11n).toBe(0n);
    expect(cents(DOCKET.taxable) / 11n).toBe(cents(DOCKET.gst));
  });

  it('states the total-only reading and its over-claim correctly', () => {
    // 3220 / 11 = 292.7…, which rounds to 293.
    const totalOnly = (cents(DOCKET.total) * 10n + 55n) / 110n;
    expect(totalOnly).toBe(cents(DOCKET.totalOnlyGst));
    expect(cents(DOCKET.totalOnlyGst) - cents(DOCKET.gst)).toBe(cents(DOCKET.overClaim));
  });
});

describe('the demo month', () => {
  it('adds its categories up to the month total', () => {
    expect(sum(CATEGORIES.map((c) => c.spent))).toBe(cents(SPENDING.total));
    expect(sum(SPENDING.weeks.map((w) => w.amount))).toBe(cents(SPENDING.total));
    expect(cents(BUDGET.spent)).toBe(cents(SPENDING.total));
  });

  it('adds its budgets up, and what is left is budget minus spent', () => {
    expect(sum(CATEGORIES.map((c) => c.budget))).toBe(cents(BUDGET.total));
    expect(cents(BUDGET.total) - cents(BUDGET.spent)).toBe(cents(BUDGET.left));
  });

  it('says what is left in each category, and how much is used', () => {
    for (const c of CATEGORIES) {
      expect(cents(c.budget) - cents(c.spent), c.name).toBe(cents(c.left));
      expect(Math.round(Number(cents(c.spent) * 100n) / Number(cents(c.budget))), c.name).toBe(c.used);
    }
  });

  it('works out the daily allowance to the cent', () => {
    const left = cents(BUDGET.left);
    expect((left * 10n / 13n + 5n) / 10n).toBe(cents(BUDGET.perDay));
  });

  it('draws shares that add to a whole', () => {
    expect(CATEGORIES.reduce((a, c) => a + c.share, 0)).toBe(100);
  });

  it('splits the month’s receipts between the household', () => {
    expect(HOUSEHOLD_SCANS.reduce((a, p) => a + p.scans, 0)).toBe(SPENDING.receipts);
  });

  it('adds its goals up', () => {
    expect(sum(GOALS.map((g) => g.saved))).toBe(cents(GOALS_TOTAL.saved));
    expect(sum(GOALS.map((g) => g.target))).toBe(cents(GOALS_TOTAL.target));
  });
});
