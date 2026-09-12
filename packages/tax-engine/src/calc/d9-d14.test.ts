import { describe, expect, it } from 'vitest';
import { d9Donations, d10TaxAffairs, d12IncomeProtection, d14Super } from './d9-d14';

// Golden values hand-computed from reference/FORMULAS.md "D9 Donations . D10 Tax costs . D12 IPP . D14 Super".
// DGR gate behaviour mirrors reference/calc.js lines 2845-2853 (Tither worksheet):
// only rows whose DGR checkbox is confirmed add to totals.D9; unconfirmed rows contribute 0.
describe('D9 gifts & donations', () => {
  it('simple sum, no gate: 520 + 1,040 + 25.50 = $1,585.50', () =>
    expect(
      d9Donations([{ amount: 520 }, { amount: 1_040 }, { amount: 25.5 }]),
    ).toBeCloseTo(1_585.5, 2));

  it('gate off ignores dgrConfirmed flags: 100 + 200 = $300.00', () =>
    expect(
      d9Donations([
        { amount: 100, dgrConfirmed: false },
        { amount: 200, dgrConfirmed: true },
      ]),
    ).toBeCloseTo(300.0, 2));

  it('gate on excludes unconfirmed: 2,600 (confirmed) + 400 (unconfirmed) = $2,600.00', () =>
    expect(
      d9Donations(
        [
          { amount: 2_600, dgrConfirmed: true },
          { amount: 400, dgrConfirmed: false },
        ],
        { requireDgr: true },
      ),
    ).toBeCloseTo(2_600.0, 2));

  it('gate on treats missing dgrConfirmed as unconfirmed (calc.js: unchecked box adds 0): 50 + 75 confirmed-only = $75.00', () =>
    expect(
      d9Donations([{ amount: 50 }, { amount: 75, dgrConfirmed: true }], { requireDgr: true }),
    ).toBeCloseTo(75.0, 2));

  it('gate on with nothing confirmed -> 0', () =>
    expect(d9Donations([{ amount: 10 }, { amount: 990, dgrConfirmed: false }], { requireDgr: true })).toBe(0));

  it('empty array -> 0 (the prototype $10 default row is a UI concern, not engine)', () =>
    expect(d9Donations([])).toBe(0));
});

describe('D10 cost of managing tax affairs', () => {
  it('default four rows: 180 + 360 + 240 + 19.95 = $799.95', () =>
    expect(d10TaxAffairs([180, 360, 240, 19.95])).toBeCloseTo(799.95, 2));
  it('single row: 165 -> $165.00', () => expect(d10TaxAffairs([165])).toBeCloseTo(165.0, 2));
  it('zeros sum to 0', () => expect(d10TaxAffairs([0, 0, 0, 0])).toBe(0));
  it('empty array -> 0', () => expect(d10TaxAffairs([])).toBe(0));
});

describe('D12 personal superannuation (income protection premiums)', () => {
  it('monthly premiums 89.90 x 2 + 45.10 = $224.90', () =>
    expect(d12IncomeProtection([89.9, 89.9, 45.1])).toBeCloseTo(224.9, 2));
  it('empty array -> 0', () => expect(d12IncomeProtection([])).toBe(0));
});

describe('D14 personal super contributions (name/member number are metadata, not math)', () => {
  it('2,500 + 1,500 + 0 = $4,000.00', () => expect(d14Super([2_500, 1_500, 0])).toBeCloseTo(4_000.0, 2));
  it('empty array -> 0', () => expect(d14Super([])).toBe(0));
});
