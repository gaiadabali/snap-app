// D9 Donations · D10 Tax affairs · D12 Income protection · D14 Super.
// Formulas from reference/FORMULAS.md §"D9 Donations · D10 Tax costs · D12 IPP · D14 Super":
// all four labels are simple sums. Pure functions, no RateSet needed; empty input → 0.

const sum = (values: readonly number[]): number => values.reduce((acc, n) => acc + n, 0);

/** ATO bucket-donation rule: up to $10 of DGR donations claimable without receipts. */
export const RECEIPTLESS_D9_FLOOR = 10;

export interface DonationRow {
  amount: number;
  /** Tither profile only: whether the DGR checkbox for this row is ticked. */
  dgrConfirmed?: boolean;
}

export interface D9Options {
  /** When true, apply the Tither profile's DGR gate. */
  requireDgr?: boolean;
  /**
   * Flat dollar amount claimable without receipts (ATO "bucket donation" rule:
   * up to $10 of unreceipted DGR donations). Added on top of the itemised rows
   * and NOT subject to the DGR gate. Defaults to 0 so existing callers/tests
   * are unaffected.
   */
  receiptlessFloor?: number;
}

/**
 * D9 gifts & donations: Σ amounts (+ the optional receiptless floor).
 * DGR gate (reference/calc.js lines 2845–2853): the Tither worksheet only adds a row's
 * amount when its DGR checkbox is checked (`confirmed`); an unchecked or absent checkbox
 * contributes 0 and is shown as "Not DGR". So with `requireDgr`, only rows where
 * `dgrConfirmed === true` count — a missing flag is treated as unconfirmed.
 */
export function d9Donations(rows: readonly DonationRow[], options?: D9Options): number {
  const gated = options?.requireDgr === true;
  const floor = options?.receiptlessFloor ?? 0;
  return floor + rows.reduce((acc, row) => (gated && row.dgrConfirmed !== true ? acc : acc + row.amount), 0);
}

/** D10 cost of managing tax affairs: Σ rows (default row labels are a UI concern). */
export function d10TaxAffairs(rows: readonly number[]): number {
  return sum(rows);
}

/** D12 income protection premiums: Σ rows. */
export function d12IncomeProtection(rows: readonly number[]): number {
  return sum(rows);
}

/** D14 personal super contributions: Σ amounts (fund name / member number are metadata). */
export function d14Super(contributions: readonly number[]): number {
  return sum(contributions);
}
