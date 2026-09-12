// D5 — Other work-related expenses. Formulas from reference/FORMULAS.md §D5.
// Pure functions: the engine assumes inputs already sanitised (non-negative numbers)
// by the Zod boundary at the UI; division-by-zero cases return 0 by design.
import type { RateSet } from '../rates/types';

export interface OvertimeMealDaysInput {
  /** Overtime days per week (capped at 7). */
  otDaysPerWeek: number;
  /** Weeks at this job during the year (capped at 52). */
  weeksAtJob: number;
  fullWeeksOff: number;
  /** Sick + other individual days off (capped at 365). */
  sickOrOtherDaysOff: number;
  /** Count of public holidays ticked as not worked. */
  publicHolidaysTicked: number;
}

/** Overtime meal days: (weeksAtJob − fullWeeksOff) × otDays/wk − daysOff, floored at 0. */
export function overtimeMealDays(input: OvertimeMealDaysInput): number {
  const otPerWeek = Math.min(input.otDaysPerWeek, 7);
  const weeksWorked = Math.min(input.weeksAtJob, 52) - input.fullWeeksOff;
  const daysOff = Math.min(input.sickOrOtherDaysOff, 365) + input.publicHolidaysTicked;
  return Math.max(weeksWorked * otPerWeek - daysOff, 0);
}

export interface OvertimeMealsInput {
  days: number;
  avgCostPerMeal: number;
  /** With receipts the claim is the receipted total; without, avg cost caps at the no-receipt max. */
  hasReceipts: boolean;
  receiptsTotal: number;
}

/** Overtime meals: receiptsTotal if receipted, else days × min(avgCost, no-receipt max). */
export function overtimeMeals(input: OvertimeMealsInput, rates: RateSet): number {
  if (input.hasReceipts) return input.receiptsTotal;
  return input.days * Math.min(input.avgCostPerMeal, rates.overtimeMealNoReceiptMax);
}

export interface PhoneClaimInput {
  costPerMonth: number;
  months: number;
  /** Weekly work-use hours (work days + days off buckets combined). */
  workHours: number;
  /** Weekly total hours (work + private buckets combined). */
  allHours: number;
}

/** Phone: cost/mo × months × work-use% (workHours / allHours, clamped to 100%). */
export function phoneClaim(input: PhoneClaimInput): number {
  if (input.allHours <= 0) return 0;
  const workUse = Math.min(input.workHours / input.allHours, 1);
  return input.costPerMonth * input.months * workUse;
}

export interface HomeOfficeInput {
  hours: number;
  /** 'electricity' → $/h electricity-only rate; 'fixed' → ATO fixed rate. */
  rateKind: 'electricity' | 'fixed';
}

/** Home office: hours × rate per kind. */
export function homeOffice(input: HomeOfficeInput, rates: RateSet): number {
  const rate =
    input.rateKind === 'electricity' ? rates.homeOfficeElectricityPerHour : rates.homeOfficeFixedRatePerHour;
  return input.hours * rate;
}

/** Simple row sum (equipment, union fees, licences, …). Local by design: calc modules stay self-contained. */
export function rowSum(rows: number[]): number {
  return rows.reduce((sum, row) => sum + row, 0);
}
