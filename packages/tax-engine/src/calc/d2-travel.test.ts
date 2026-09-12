import { describe, expect, it } from 'vitest';
import { FY2026 } from '../rates/fy2026';
import type { RateSet } from '../rates/types';
import { accommodation, accommodationTotal, mealsFortnight, rowSum, tolls } from './d2-travel';

// Golden values hand-computed from reference/FORMULAS.md §D2.
// High-income per-meal caps mirror reference/calc.js getMealCaps(): breakdown × (201.35/165).

/** One day of the 14-day meal loop. */
const day = (b: number, l = 0, d = 0, i = 0) => ({ breakfast: b, lunch: l, dinner: d, incidentals: i });

describe('D2 accommodation: nights × ratePerNight', () => {
  it('12 nights × $150 → $1,800.00', () =>
    expect(accommodation({ nights: 12, ratePerNight: 150 })).toBeCloseTo(1_800.0, 2));
  it('zero nights → 0', () => expect(accommodation({ nights: 0, ratePerNight: 150 })).toBe(0));
});

describe('D2 accommodation with receipts: total passes through', () => {
  it('$2,345.60 of receipts → $2,345.60', () =>
    expect(accommodationTotal(2_345.6)).toBeCloseTo(2_345.6, 2));
  it('zero → 0', () => expect(accommodationTotal(0)).toBe(0));
});

describe('D2 meals fortnight: clamped days × numberOfFortnights', () => {
  it('under all caps: 14 days × (20+30+50+10 = 110) = 1,540 × 2 fortnights = $3,080.00', () =>
    expect(
      mealsFortnight(
        { days: Array.from({ length: 14 }, () => day(20, 30, 50, 10)), daysWorked: 14, numberOfFortnights: 2 },
        FY2026,
      ),
    ).toBeCloseTo(3_080.0, 2));

  it('per-meal clamp: breakfast entered $50 → capped at $34.75', () =>
    expect(mealsFortnight({ days: [day(50)], daysWorked: 14, numberOfFortnights: 1 }, FY2026)).toBeCloseTo(34.75, 2));

  it('all four meals over their caps: 34.75+39.10+66.65+24.50 = $165.00 (caps sum to the daily limit)', () =>
    expect(
      mealsFortnight({ days: [day(100, 100, 100, 100)], daysWorked: 14, numberOfFortnights: 1 }, FY2026),
    ).toBeCloseTo(165.0, 2));

  it('per-day clamp binds when a rate set allows per-meal caps above the daily limit: 4 × 100 = 400 → $165.00', () => {
    const loose: RateSet = {
      ...FY2026,
      mealBreakdown: { breakfast: 100, lunch: 100, dinner: 100, incidentals: 100 },
    };
    expect(
      mealsFortnight({ days: [day(100, 100, 100, 100)], daysWorked: 14, numberOfFortnights: 1 }, loose),
    ).toBeCloseTo(165.0, 2);
  });

  it('high income: breakfast $50 → capped at 34.75 × 201.35/165 = $42.41', () =>
    expect(
      mealsFortnight({ days: [day(50)], daysWorked: 14, numberOfFortnights: 1, highIncome: true }, FY2026),
    ).toBeCloseTo(42.41, 2));

  it('high income, all meals over caps: 42.41+47.71+81.33+29.90 = $201.35 (scaled caps sum to the high limit)', () =>
    expect(
      mealsFortnight(
        { days: [day(100, 100, 100, 100)], daysWorked: 14, numberOfFortnights: 1, highIncome: true },
        FY2026,
      ),
    ).toBeCloseTo(201.35, 2));

  it('daysWorked cap binds: 14 days × 110 = 1,540 > 5 days × 165 = 825 → $825.00', () =>
    expect(
      mealsFortnight(
        { days: Array.from({ length: 14 }, () => day(20, 30, 50, 10)), daysWorked: 5, numberOfFortnights: 1 },
        FY2026,
      ),
    ).toBeCloseTo(825.0, 2));

  it('numberOfFortnights multiplies: one day of 110 × 26 fortnights = $2,860.00', () =>
    expect(
      mealsFortnight({ days: [day(20, 30, 50, 10)], daysWorked: 14, numberOfFortnights: 26 }, FY2026),
    ).toBeCloseTo(2_860.0, 2));

  it('only the first 14 days count: 15 days × $10 breakfast → $140.00', () =>
    expect(
      mealsFortnight({ days: Array.from({ length: 15 }, () => day(10)), daysWorked: 14, numberOfFortnights: 1 }, FY2026),
    ).toBeCloseTo(140.0, 2));

  it('empty days → 0', () =>
    expect(mealsFortnight({ days: [], daysWorked: 14, numberOfFortnights: 1 }, FY2026)).toBe(0));

  it('zero fortnights → 0', () =>
    expect(mealsFortnight({ days: [day(20, 30, 50, 10)], daysWorked: 14, numberOfFortnights: 0 }, FY2026)).toBe(0));
});

describe('D2 meals perTripExtras: trip supplies + incidentals ride along per trip', () => {
  it('added to the per-trip total, then annualised: (110 meals + 50 extras) × 2 = $320.00', () =>
    expect(
      mealsFortnight(
        { days: [day(20, 30, 50, 10)], daysWorked: 14, numberOfFortnights: 2, perTripExtras: 50 },
        FY2026,
      ),
    ).toBeCloseTo(320.0, 2));

  it('extras are NOT subject to the meal daily cap: 165 capped meals + 500 extras = $665.00', () =>
    expect(
      mealsFortnight(
        { days: [day(100, 100, 100, 100)], daysWorked: 14, numberOfFortnights: 1, perTripExtras: 500 },
        FY2026,
      ),
    ).toBeCloseTo(665.0, 2));

  it('extras multiply by trips even with no meals: 40 extras × 3 trips = $120.00', () =>
    expect(
      mealsFortnight({ days: [], daysWorked: 0, numberOfFortnights: 3, perTripExtras: 40 }, FY2026),
    ).toBeCloseTo(120.0, 2));

  it('omitted perTripExtras defaults to 0 (back-compat): 110 × 1 = $110.00', () =>
    expect(
      mealsFortnight({ days: [day(20, 30, 50, 10)], daysWorked: 14, numberOfFortnights: 1 }, FY2026),
    ).toBeCloseTo(110.0, 2));
});

describe('D2 tolls: (tollToWork + tollHome) × roundTrips', () => {
  it('($4.80 + $6.20) × 220 round trips → $2,420.00', () =>
    expect(tolls({ tollToWork: 4.8, tollHome: 6.2, roundTrips: 220 })).toBeCloseTo(2_420.0, 2));
  it('zero round trips → 0', () =>
    expect(tolls({ tollToWork: 4.8, tollHome: 6.2, roundTrips: 0 })).toBe(0));
});

describe('D2 rowSum: Σ rows (parking / other add-row tables)', () => {
  it('[12.50, 30, 7.50] → $50.00', () => expect(rowSum([12.5, 30, 7.5])).toBeCloseTo(50.0, 2));
  it('empty rows → 0', () => expect(rowSum([])).toBe(0));
});
