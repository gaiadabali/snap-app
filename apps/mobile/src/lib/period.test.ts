import { describe, expect, it } from 'vitest';

import { periodRange, taxYearPeriods } from './period';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

/**
 * The export screen's "Year" is the tax year, because people export receipts
 * for their tax return. The start month is the server's, from the rule set.
 */
describe('periodRange("year") with a tax year start month', () => {
  it('AU on 2026-11-26 starts 2026-07-01', () => {
    expect(periodRange('year', at(2026, 11, 26), 7).from).toBe('2026-07-01');
  });
  it('AU on 2026-06-30 starts 2025-07-01', () => {
    expect(periodRange('year', at(2026, 6, 30), 7).from).toBe('2025-07-01');
  });
  it('AU on 2026-07-01 starts 2026-07-01', () => {
    expect(periodRange('year', at(2026, 7, 1), 7).from).toBe('2026-07-01');
  });
  it('ID starts 2026-01-01', () => {
    expect(periodRange('year', at(2026, 11, 26), 1).from).toBe('2026-01-01');
  });
  it('without a start month it stays the rolling twelve months (receipts list)', () => {
    expect(periodRange('year', at(2026, 11, 26)).from).toBe('2025-12-01');
  });
  it('other periods are unaffected', () => {
    expect(periodRange('quarter', at(2026, 11, 26), 7).from).toBe('2026-10-01');
  });
});

describe('taxYearPeriods', () => {
  const label = (m: number) => taxYearPeriods(m, at(2026, 11, 26)).find((p) => p.key === 'year')!.label;
  it('names the Australian year', () => expect(label(7)).toBe('2026-27 financial year'));
  it('names the calendar year', () => expect(label(1)).toBe('2026 year'));
});
