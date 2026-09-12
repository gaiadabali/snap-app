// D1 — Work-related car expenses. Formulas from reference/FORMULAS.md §D1.
// Pure functions: the engine assumes inputs already sanitised (non-negative numbers)
// by the Zod boundary at the UI; division-by-zero cases return 0 by design.
import type { RateSet } from '../rates/types';

/** Cents-per-km method: min(km, cap) × rate. */
export function centsPerKm(km: number, rates: RateSet): number {
  return Math.min(km, rates.centsPerKmCapKm) * rates.centsPerKmRate;
}

/** Prime-cost decline in value: min(carCost, valuation cap) ÷ effective life. */
export function declineInValue(carCost: number, rates: RateSet): number {
  return Math.min(carCost, rates.carCostLimit) / rates.carEffectiveLifeYears;
}

/** FY end calendar year from a RateSet fy string ('2025-26' → 2026). */
function fyEndYear(rates: RateSet): number {
  const start = parseInt(rates.fy.slice(0, 4), 10);
  return Number.isFinite(start) ? start + 1 : NaN;
}

/** Date-aware decline (reference vehicleBlock decline_date):
 *  - no/invalid date → full prime-cost decline (unchanged behaviour);
 *  - owned beyond the effective life at FY end → 0 (can't claim past 8 years);
 *  - purchased during the FY → pro-rated by days held ÷ days in the FY. */
export function declineByDate(carCost: number, purchaseISO: string, rates: RateSet): number {
  const base = declineInValue(carCost, rates);
  if (!purchaseISO) return base;
  const purchased = Date.parse(`${purchaseISO}T00:00:00Z`);
  const endYear = fyEndYear(rates);
  if (!Number.isFinite(purchased) || !Number.isFinite(endYear)) return base;

  const DAY = 86_400_000;
  const fyStart = Date.UTC(endYear - 1, 6, 1); // 1 July
  const fyEnd = Date.UTC(endYear, 5, 30); // 30 June
  const life = rates.carEffectiveLifeYears;

  // Excluded once the car is older than its effective life at FY end.
  if (purchased < Date.UTC(endYear - life, 5, 30)) return 0;
  // Purchased during this FY → pro-rate by days held.
  if (purchased > fyStart && purchased <= fyEnd) {
    const daysHeld = Math.max(0, Math.min(Math.floor((fyEnd - purchased) / DAY) + 1, rates.daysInFy));
    return base * (daysHeld / rates.daysInFy);
  }
  return base;
}

export interface LogbookInput {
  /** Sum of itemised running costs (fuel, rego, insurance, …). */
  itemisedTotal: number;
  /** Purchase cost of the car (decline is derived, valuation-capped). */
  carCost: number;
  /** Precomputed decline (e.g. date-aware). Overrides carCost-derived decline. */
  decline?: number;
  workKm: number;
  totalKm: number;
}

/** Logbook method: (itemised expenses + decline in value) × business-use%. */
export function logbookClaim(input: LogbookInput, rates: RateSet): number {
  if (input.totalKm <= 0) return 0;
  const businessUse = Math.min(input.workKm / input.totalKm, 1);
  const decline = input.decline ?? declineInValue(input.carCost, rates);
  return (input.itemisedTotal + decline) * businessUse;
}

export interface FuelEstimateInput {
  totalKm: number;
  /** The car uses `litres` of fuel per this many km (e.g. 10 L per 100 km). */
  perXKm: number;
  litres: number;
  avgPricePerLitre: number;
}

/** Fuel estimate: totalKm ÷ perXKm × litres × $/L. */
export function fuelEstimate(input: FuelEstimateInput): number {
  if (input.perXKm <= 0) return 0;
  return (input.totalKm / input.perXKm) * input.litres * input.avgPricePerLitre;
}

export interface LoanInterestInput {
  repayment: number;
  paymentsPerYear: number;
  years: number;
  balloon: number;
  amountBorrowed: number;
}

/** Loan interest estimate: ((repayment × payments/yr × years + balloon) − borrowed) ÷ years, floored at 0. */
export function loanInterestEstimate(input: LoanInterestInput): number {
  if (input.years <= 0) return 0;
  const totalInterest = input.repayment * input.paymentsPerYear * input.years + input.balloon - input.amountBorrowed;
  return Math.max(totalInterest, 0) / input.years;
}
