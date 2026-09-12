import { describe, expect, it } from 'vitest';
import { FY2026 } from '../rates/fy2026';
import type { RateSet } from '../rates/types';
import { assetDeclineProrated, capitalWorks } from './depreciation';

// Stakeholder ruling 2026-07-03: proration divides by the ACTUAL number of
// days in the financial year (rates.daysInFy — 365, or 366 when the FY
// contains a 29 Feb). Not the prototype's 365.25, not a flat 365.
const LEAP_FY: RateSet = { ...FY2026, fy: '2027-28', daysInFy: 366 };

describe('assetDeclineProrated: (cost ÷ life) × (daysHeld ÷ daysInFy)', () => {
  it('full year (365/365) equals cost ÷ life: $8,000 over 4 yrs → $2,000.00', () =>
    expect(assetDeclineProrated({ cost: 8_000, effectiveLifeYears: 4, daysHeld: 365 }, FY2026)).toBeCloseTo(2_000.0, 2));

  it('partial year golden: $2,920 / 4 yrs / 73 days → 730 × 73/365 = $146.00', () =>
    expect(assetDeclineProrated({ cost: 2_920, effectiveLifeYears: 4, daysHeld: 73 }, FY2026)).toBeCloseTo(146.0, 2));

  it('leap FY divides by 366: $3,660 / 1 yr / 183 days → $1,830.00', () =>
    expect(assetDeclineProrated({ cost: 3_660, effectiveLifeYears: 1, daysHeld: 183 }, LEAP_FY)).toBeCloseTo(1_830.0, 2));

  it('leap FY full year (366/366) equals cost ÷ life', () =>
    expect(assetDeclineProrated({ cost: 3_660, effectiveLifeYears: 1, daysHeld: 366 }, LEAP_FY)).toBeCloseTo(3_660.0, 2));

  it('daysHeld above daysInFy clamps to one full year (400 days in a 365-day FY)', () =>
    expect(assetDeclineProrated({ cost: 8_000, effectiveLifeYears: 4, daysHeld: 400 }, FY2026)).toBeCloseTo(2_000.0, 2));

  it('366 days held in a NON-leap FY clamps to 365/365 (no over-claim)', () =>
    expect(assetDeclineProrated({ cost: 8_000, effectiveLifeYears: 4, daysHeld: 366 }, FY2026)).toBeCloseTo(2_000.0, 2));

  it('negative daysHeld floors to 0', () =>
    expect(assetDeclineProrated({ cost: 8_000, effectiveLifeYears: 4, daysHeld: -10 }, FY2026)).toBe(0));

  it('zero effective life → 0', () =>
    expect(assetDeclineProrated({ cost: 8_000, effectiveLifeYears: 0, daysHeld: 365 }, FY2026)).toBe(0));

  it('zero cost → 0', () =>
    expect(assetDeclineProrated({ cost: 0, effectiveLifeYears: 4, daysHeld: 365 }, FY2026)).toBe(0));

  it('zero daysHeld → 0', () =>
    expect(assetDeclineProrated({ cost: 8_000, effectiveLifeYears: 4, daysHeld: 0 }, FY2026)).toBe(0));
});

describe('capitalWorks: cost × 2.5%', () => {
  it('$400,000 build cost → $10,000.00/yr', () =>
    expect(capitalWorks(400_000, FY2026)).toBeCloseTo(10_000.0, 2));
  it('zero cost → 0', () => expect(capitalWorks(0, FY2026)).toBe(0));
});
