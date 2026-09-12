// D2 — Work-related travel expenses. Formulas from reference/FORMULAS.md §D2.
// Pure functions: the engine assumes inputs already sanitised (non-negative numbers)
// by the Zod boundary at the UI; division-by-zero cases return 0 by design.
import type { RateSet } from '../rates/types';

export interface AccommodationInput {
  nights: number;
  ratePerNight: number;
}

/** Accommodation estimate: nights × ratePerNight. */
export function accommodation(input: AccommodationInput): number {
  return input.nights * input.ratePerNight;
}

/**
 * Accommodation with receipts: the UI passes the receipted total straight through.
 * Modelled as a separate function (rather than an options object) so callers can't
 * accidentally mix the estimate and receipt paths.
 */
export function accommodationTotal(total: number): number {
  return total;
}

/** One day of the 14-day meal loop. Incidentals are optional (default 0). */
export interface MealDayInput {
  breakfast: number;
  lunch: number;
  dinner: number;
  incidentals?: number;
}

export interface MealsFortnightInput {
  /** Up to 14 days of meal spending; entries beyond 14 are ignored. */
  days: MealDayInput[];
  /** Days actually worked in the fortnight — caps the fortnight total. */
  daysWorked: number;
  /** Trips (14-day loops) taken in the year. */
  numberOfFortnights: number;
  /** Income ≥ rates.mealHighIncomeThreshold → the higher daily limit applies. */
  highIncome?: boolean;
  /**
   * Per-trip extras that are NOT subject to the meal daily cap: trip supplies
   * bought on departure day + extra incidentals (water, energy drinks, supply
   * runs). Added to the per-trip total AFTER the meal clamp, then multiplied by
   * numberOfFortnights — reference/calc.js lines 2645–2652 (fn += extras; fn × trips).
   */
  perTripExtras?: number;
}

/** Round to cents, matching reference/calc.js cap rounding. */
function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Meals over a typical 14-day trip, annualised.
 * Per FORMULAS.md §D2: each meal is clamped to its per-meal cap, each day to the
 * applicable daily limit, and the fortnight total to daysWorked × dailyLimit;
 * the result is then multiplied by numberOfFortnights.
 *
 * High-income ambiguity (FORMULAS.md only lists per-meal caps for the $165 limit):
 * reference/calc.js getMealCaps() (lines 2488–2493) scales the TD 2025/4 per-meal
 * breakdown by dailyLimit / 165 and rounds each cap to cents — mirrored here using
 * rates.mealDailyLimit as the base so the behaviour survives rate updates.
 */
export function mealsFortnight(input: MealsFortnightInput, rates: RateSet): number {
  if (rates.mealDailyLimit <= 0) return 0;
  const dailyLimit = input.highIncome ? rates.mealDailyLimitHigh : rates.mealDailyLimit;
  const factor = dailyLimit / rates.mealDailyLimit;
  const caps = {
    breakfast: toCents(rates.mealBreakdown.breakfast * factor),
    lunch: toCents(rates.mealBreakdown.lunch * factor),
    dinner: toCents(rates.mealBreakdown.dinner * factor),
    incidentals: toCents(rates.mealBreakdown.incidentals * factor),
  };
  let fortnightTotal = 0;
  for (const day of input.days.slice(0, 14)) {
    const dayTotal =
      Math.min(day.breakfast, caps.breakfast) +
      Math.min(day.lunch, caps.lunch) +
      Math.min(day.dinner, caps.dinner) +
      Math.min(day.incidentals ?? 0, caps.incidentals);
    fortnightTotal += Math.min(dayTotal, dailyLimit);
  }
  fortnightTotal = Math.min(fortnightTotal, input.daysWorked * dailyLimit);
  // Trip supplies + extra incidentals ride along per trip (uncapped), then annualise.
  fortnightTotal += input.perTripExtras ?? 0;
  return fortnightTotal * input.numberOfFortnights;
}

export interface TollsInput {
  tollToWork: number;
  tollHome: number;
  roundTrips: number;
}

/** Tolls estimate: (tollToWork + tollHome) × roundTrips. */
export function tolls(input: TollsInput): number {
  return (input.tollToWork + input.tollHome) * input.roundTrips;
}

/** Σ rows — parking and other add-row tables. */
export function rowSum(rows: number[]): number {
  return rows.reduce((sum, row) => sum + row, 0);
}
