import { describe, expect, it } from 'vitest';
import { FY2026 } from './fy2026';

// Golden values from reference/FORMULAS.md (client spreadsheet source of truth).
describe('FY2025-26 rate set (TD 2025/4)', () => {
  it('is labeled for the right FY and determination', () => {
    expect(FY2026.fy).toBe('2025-26');
    expect(FY2026.determination).toBe('TD 2025/4');
  });

  it('cents-per-km: $0.88/km capped at 5,000 km', () => {
    expect(FY2026.centsPerKmRate).toBe(0.88);
    expect(FY2026.centsPerKmCapKm).toBe(5_000);
  });

  it('car depreciation: $69,674 valuation cap over 8 years → max $8,709.25/yr', () => {
    expect(FY2026.carCostLimit).toBe(69_674);
    expect(FY2026.carEffectiveLifeYears).toBe(8);
    expect(FY2026.carCostLimit / FY2026.carEffectiveLifeYears).toBeCloseTo(8_709.25, 2);
  });

  it('meals: $165/day under $148,250 income, $201.35/day at or above', () => {
    expect(FY2026.mealDailyLimit).toBe(165.0);
    expect(FY2026.mealDailyLimitHigh).toBe(201.35);
    expect(FY2026.mealHighIncomeThreshold).toBe(148_250);
  });

  it('meal breakdown sums exactly to the daily limit', () => {
    const b = FY2026.mealBreakdown;
    expect(b.breakfast).toBe(34.75);
    expect(b.lunch).toBe(39.1);
    expect(b.dinner).toBe(66.65);
    expect(b.incidentals).toBe(24.5);
    expect(b.breakfast + b.lunch + b.dinner + b.incidentals).toBeCloseTo(FY2026.mealDailyLimit, 2);
  });

  it('laundry $3/wk, home office $0.70/hr electricity and $0.67/hr fixed rate', () => {
    expect(FY2026.homeLaundryPerWeek).toBe(3.0);
    expect(FY2026.homeOfficeElectricityPerHour).toBe(0.7);
    expect(FY2026.homeOfficeFixedRatePerHour).toBe(0.67);
  });

  it('overtime meal receiptless cap is $38.65 — the spreadsheet value, never 37.65', () => {
    expect(FY2026.overtimeMealNoReceiptMax).toBe(38.65);
  });

  it('capital works 2.5%/yr', () => {
    expect(FY2026.capitalWorksRate).toBe(0.025);
  });

  it('FY2025-26 has 365 days (1 Jul 2025 – 30 Jun 2026 contains no 29 Feb)', () => {
    expect(FY2026.daysInFy).toBe(365);
  });
});
