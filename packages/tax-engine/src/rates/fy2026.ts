// Every ATO constant in the product lives HERE and only here.
// Source: reference/FORMULAS.md (client spreadsheet) — tax-agent sign-off pending (plan Task 0.1).
// Annual update procedure: add rates/fy20XX.ts each June, never edit history (plan: Post-launch).
import type { RateSet } from './types';

export const FY2026: RateSet = {
  fy: '2025-26',
  determination: 'TD 2025/4',
  centsPerKmRate: 0.88,            // $/km
  centsPerKmCapKm: 5_000,          // km, by law
  carCostLimit: 69_674,            // $ valuation cap
  carEffectiveLifeYears: 8,        // prime-cost decline
  mealDailyLimit: 165.0,           // $/day, income < threshold
  mealDailyLimitHigh: 201.35,      // $/day, income ≥ threshold
  mealHighIncomeThreshold: 148_250,
  mealBreakdown: { breakfast: 34.75, lunch: 39.1, dinner: 66.65, incidentals: 24.5 },
  homeLaundryPerWeek: 3.0,
  homeOfficeElectricityPerHour: 0.7,
  homeOfficeFixedRatePerHour: 0.67,
  overtimeMealNoReceiptMax: 38.65, // spreadsheet value — NOT 37.65
  capitalWorksRate: 0.025,
  daysInFy: 365, // 1 Jul 2025 – 30 Jun 2026 contains no 29 Feb; a leap FY (e.g. 2027-28) sets 366
} as const;

/** The rate set the app currently computes with. */
export const CURRENT_RATES: RateSet = FY2026;
