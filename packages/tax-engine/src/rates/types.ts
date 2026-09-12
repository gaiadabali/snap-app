export interface MealBreakdown {
  breakfast: number;
  lunch: number;
  dinner: number;
  incidentals: number;
}

export interface RateSet {
  /** Financial year, e.g. '2025-26' */
  fy: string;
  /** ATO determination the meal/travel rates come from, e.g. 'TD 2025/4' */
  determination: string;
  centsPerKmRate: number;
  centsPerKmCapKm: number;
  carCostLimit: number;
  carEffectiveLifeYears: number;
  mealDailyLimit: number;
  mealDailyLimitHigh: number;
  mealHighIncomeThreshold: number;
  mealBreakdown: MealBreakdown;
  homeLaundryPerWeek: number;
  homeOfficeElectricityPerHour: number;
  homeOfficeFixedRatePerHour: number;
  overtimeMealNoReceiptMax: number;
  capitalWorksRate: number;
  /** Actual days in this financial year: 365, or 366 when the FY spans a 29 Feb.
   * Drives depreciation proration (stakeholder ruling 2026-07-03: real days,
   * never 365.25). */
  daysInFy: number;
}
