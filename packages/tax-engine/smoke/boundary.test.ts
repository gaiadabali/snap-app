/**
 * Package-boundary check.
 *
 * The 186-test suite proves the engine's internals survived the move. It does
 * NOT prove what extraction actually risks: that a *consumer* can resolve
 * `@snap/tax-engine` by name and reach the public surface. This file imports by
 * package name only — never by relative path — so it fails if the workspace
 * link, the `exports` map, or `src/index.ts` is wrong.
 *
 * It also pins every ATO constant the rate docs name. Those numbers are the
 * crown jewel; if a copy or a merge ever mangles one, this fails loudly.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRENT_FY,
  CURRENT_RATES,
  KNOWN_FYS,
  PROFILES,
  carClaim,
  computeWorksheet,
  declineByDate,
  formatFy,
  ratesFor,
  type CarInput,
  type WorksheetInputs,
} from '@snap/tax-engine';

const r = CURRENT_RATES;

describe('package boundary', () => {
  it('resolves @snap/tax-engine by name and exposes the public surface', () => {
    expect(typeof computeWorksheet).toBe('function');
    expect(typeof carClaim).toBe('function');
    expect(typeof declineByDate).toBe('function');
    expect(typeof ratesFor).toBe('function');
    expect(typeof formatFy).toBe('function');
    expect(r).toBeDefined();
    expect(PROFILES).toBeDefined();
  });
});

describe('ATO constants — FY2025-26, TD 2025/4', () => {
  it.each([
    ['fy', r.fy, '2025-26'],
    ['determination', r.determination, 'TD 2025/4'],
    ['centsPerKmRate', r.centsPerKmRate, 0.88],
    ['centsPerKmCapKm', r.centsPerKmCapKm, 5000],
    ['carCostLimit', r.carCostLimit, 69674],
    ['carEffectiveLifeYears', r.carEffectiveLifeYears, 8],
    ['mealDailyLimit', r.mealDailyLimit, 165.0],
    ['mealDailyLimitHigh', r.mealDailyLimitHigh, 201.35],
    ['mealHighIncomeThreshold', r.mealHighIncomeThreshold, 148250],
    ['homeLaundryPerWeek', r.homeLaundryPerWeek, 3.0],
    ['homeOfficeElectricityPerHour', r.homeOfficeElectricityPerHour, 0.7],
    ['homeOfficeFixedRatePerHour', r.homeOfficeFixedRatePerHour, 0.67],
    // The rate docs are emphatic: "spreadsheet value, never 37.65".
    ['overtimeMealNoReceiptMax', r.overtimeMealNoReceiptMax, 38.65],
    ['capitalWorksRate', r.capitalWorksRate, 0.025],
    ['daysInFy', r.daysInFy, 365],
  ])('%s = %s', (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });
});

describe('derived invariants that catch silent rate drift', () => {
  it('carCostLimit / effectiveLife = $8,709.25 per year', () => {
    expect(r.carCostLimit / r.carEffectiveLifeYears).toBe(8709.25);
  });

  it('mealBreakdown sums exactly to mealDailyLimit', () => {
    const b = r.mealBreakdown;
    const sum = b.breakfast + b.lunch + b.dinner + b.incidentals;
    expect(Number(sum.toFixed(2))).toBe(r.mealDailyLimit);
  });
});

describe('FY registry', () => {
  // Fiscal years are keyed by END year as an int: FY2026 = 1 Jul 2025 - 30 Jun 2026.
  // The RateSet's own `fy` is the display label, so the two are compared via formatFy.
  it('CURRENT_FY is the end-year int, and formats to the rate set label', () => {
    expect(CURRENT_FY).toBe(2026);
    expect(formatFy(CURRENT_FY)).toBe(r.fy);
  });

  it('ratesFor(CURRENT_FY) returns the same determination', () => {
    expect(ratesFor(CURRENT_FY).determination).toBe(r.determination);
  });

  it('KNOWN_FYS includes the current FY', () => {
    expect(KNOWN_FYS).toContain(CURRENT_FY);
  });

  // A not-yet-published future year must fall back to the latest rates rather
  // than returning undefined — the app would otherwise break every 1 July.
  it('falls back to the latest known rates for a future FY', () => {
    expect(ratesFor(CURRENT_FY + 3).determination).toBe(r.determination);
  });
});

describe('occupation profiles', () => {
  it('registers 19 profiles', () => {
    expect(Object.keys(PROFILES)).toHaveLength(19);
  });

  it('truckie_long is overtime-meal eligible and declares cheat rows', () => {
    const p = PROFILES.truckie_long;
    expect(p).toBeDefined();
    expect(p!.overtimeMealEligible).toBe(true);
    expect(p!.cheatRows.length).toBeGreaterThan(0);
  });
});

describe('computation through the public surface', () => {
  it('caps cents-per-km at 5,000 km — a $4,400 ceiling', () => {
    const car: CarInput = { method: 'Cents per km', km: 6000 };
    expect(carClaim(car, r)).toBe(4400);
  });

  it('does not cap below the limit (1,000 km = $880)', () => {
    const car: CarInput = { method: 'Cents per km', km: 1000 };
    expect(carClaim(car, r)).toBe(880);
  });

  it('valuation-caps decline: an $80k car claims $8,709.25, not $10,000', () => {
    expect(declineByDate(80000, '', r)).toBe(8709.25);
  });

  it('claims nothing for a car older than its effective life', () => {
    expect(declineByDate(80000, '2010-01-01', r)).toBe(0);
  });

  it('computes a worksheet with every cheat row present', () => {
    const truckie = PROFILES.truckie_long!;
    const inputs: WorksheetInputs = {
      d1: { cars: [{ method: 'Cents per km', km: 6000 }] },
    };
    const sheet = computeWorksheet(truckie, inputs, r);

    expect(sheet.byLabel.D1).toBe(4400);
    expect(sheet.grandTotal).toBeGreaterThanOrEqual(4400);
    for (const label of truckie.cheatRows) {
      expect(sheet.byLabel).toHaveProperty(label);
    }
  });

  // An empty worksheet is NOT zero: every profile claims the $10 receiptless
  // bucket-donation floor at D9. The tither flow is the documented exception —
  // its own $10 seed row already represents that floor, so adding it again
  // would double-count. Worth pinning: it is the kind of rule a rewrite loses.
  it('applies the $10 receiptless D9 floor to an otherwise empty worksheet', () => {
    const sheet = computeWorksheet(PROFILES.truckie_long!, {}, r);
    expect(Number.isFinite(sheet.grandTotal)).toBe(true);
    expect(sheet.byLabel.D9).toBe(10);
    expect(sheet.grandTotal).toBe(10);
  });

  it('exempts the tither flow from the D9 floor (no double-count)', () => {
    const sheet = computeWorksheet(PROFILES.tither!, {}, r);
    expect(sheet.byLabel.D9).toBe(0);
    expect(sheet.grandTotal).toBe(0);
  });
});
