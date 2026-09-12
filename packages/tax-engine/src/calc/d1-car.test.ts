import { describe, expect, it } from 'vitest';
import { FY2026 } from '../rates/fy2026';
import { centsPerKm, declineByDate, declineInValue, fuelEstimate, loanInterestEstimate, logbookClaim } from './d1-car';

// Golden values hand-computed from reference/FORMULAS.md §D1.
describe('D1 cents-per-km', () => {
  it('caps at 5,000 km: 7,200 km → $4,400.00', () =>
    expect(centsPerKm(7_200, FY2026)).toBeCloseTo(4_400.0, 2));
  it('under cap: 3,000 km → $2,640.00', () =>
    expect(centsPerKm(3_000, FY2026)).toBeCloseTo(2_640.0, 2));
  it('zero km → 0', () => expect(centsPerKm(0, FY2026)).toBe(0));
});

describe('D1 decline in value (prime cost, valuation capped)', () => {
  it('caps valuation: $90,000 car → $8,709.25/yr', () =>
    expect(declineInValue(90_000, FY2026)).toBeCloseTo(8_709.25, 2));
  it('exactly at cap: $69,674 → $8,709.25/yr', () =>
    expect(declineInValue(69_674, FY2026)).toBeCloseTo(8_709.25, 2));
  it('under cap: $40,000 car → $5,000.00/yr', () =>
    expect(declineInValue(40_000, FY2026)).toBeCloseTo(5_000.0, 2));
  it('zero cost → 0', () => expect(declineInValue(0, FY2026)).toBe(0));
});

describe('D1 date-aware decline (declineByDate)', () => {
  it('no date → full prime-cost decline (backward-compatible)', () =>
    expect(declineByDate(40_000, '', FY2026)).toBeCloseTo(5_000.0, 2));
  it('owned beyond the 8-year effective life → 0', () =>
    expect(declineByDate(40_000, '2015-01-01', FY2026)).toBe(0));
  it('within the 8 years but bought before this FY → full year', () =>
    expect(declineByDate(40_000, '2019-01-01', FY2026)).toBeCloseTo(5_000.0, 2));
  it('purchased mid-FY (1 Jan 2026) → pro-rated to part of the year', () => {
    const v = declineByDate(40_000, '2026-01-01', FY2026);
    expect(v).toBeGreaterThan(2_000);
    expect(v).toBeLessThan(3_000); // ~5000 × 181/365
  });
});

describe('D1 logbook claim: (itemised + decline) × business-use%', () => {
  it('(12,000 + 5,000) × (18k/24k = 0.75) = $12,750.00', () =>
    expect(
      logbookClaim({ itemisedTotal: 12_000, carCost: 40_000, workKm: 18_000, totalKm: 24_000 }, FY2026),
    ).toBeCloseTo(12_750.0, 2));
  it('100% business use when workKm equals totalKm', () =>
    expect(
      logbookClaim({ itemisedTotal: 1_000, carCost: 0, workKm: 10_000, totalKm: 10_000 }, FY2026),
    ).toBeCloseTo(1_000.0, 2));
  it('business-use% clamps to 100% when workKm exceeds totalKm', () =>
    expect(
      logbookClaim({ itemisedTotal: 1_000, carCost: 0, workKm: 12_000, totalKm: 10_000 }, FY2026),
    ).toBeCloseTo(1_000.0, 2));
  it('totalKm of 0 yields 0 (percentage undefined → no claim)', () =>
    expect(
      logbookClaim({ itemisedTotal: 1_000, carCost: 40_000, workKm: 0, totalKm: 0 }, FY2026),
    ).toBe(0));
});

describe('D1 fuel estimate: totalKm / perXKm × litres × $/L', () => {
  it('20,000 km at 10 L per 100 km, $2.00/L → $4,000.00', () =>
    expect(fuelEstimate({ totalKm: 20_000, perXKm: 100, litres: 10, avgPricePerLitre: 2 })).toBeCloseTo(4_000.0, 2));
  it('perXKm of 0 yields 0 (avoids division by zero)', () =>
    expect(fuelEstimate({ totalKm: 20_000, perXKm: 0, litres: 10, avgPricePerLitre: 2 })).toBe(0));
});

describe('D1 loan interest estimate: ((repayment × /yr × yrs + balloon) − borrowed) ÷ yrs', () => {
  it('$800/mo × 12 × 5y + $10,000 balloon − $40,000 borrowed = $18,000 ÷ 5 = $3,600/yr', () =>
    expect(
      loanInterestEstimate({ repayment: 800, paymentsPerYear: 12, years: 5, balloon: 10_000, amountBorrowed: 40_000 }),
    ).toBeCloseTo(3_600.0, 2));
  it('never negative (repayments below principal → 0)', () =>
    expect(
      loanInterestEstimate({ repayment: 100, paymentsPerYear: 12, years: 2, balloon: 0, amountBorrowed: 40_000 }),
    ).toBe(0));
  it('zero years yields 0 (avoids division by zero)', () =>
    expect(
      loanInterestEstimate({ repayment: 800, paymentsPerYear: 12, years: 0, balloon: 0, amountBorrowed: 0 }),
    ).toBe(0));
});
