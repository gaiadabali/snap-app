// Depreciation / capital works.
// Proration ruling (stakeholder, 2026-07-03): divide by the ACTUAL number of
// days in the financial year — rates.daysInFy (365, or 366 when the FY spans
// a 29 Feb). This supersedes both the prototype's 365.25 (calc.js L2538) and
// the earlier flat-365 spec. Clamping semantics still mirror calc.js
// L2533–2540: days floor at 0 and cap at one full year (never spills into the
// next FY). Capital works: flat 2.5%/yr of build cost (calc.js L2831–2832).
// Pure functions: division-by-zero cases return 0 by design.
import type { RateSet } from '../rates/types';

export interface AssetDeclineInput {
  /** Purchase cost of the depreciating asset. */
  cost: number;
  /** ATO effective life in years (prime-cost method). */
  effectiveLifeYears: number;
  /** Days held from purchase to 30 June, clamped to [0, rates.daysInFy]. */
  daysHeld: number;
}

/** Prime-cost decline prorated for a mid-FY purchase: (cost ÷ life) × (daysHeld ÷ daysInFy). */
export function assetDeclineProrated(input: AssetDeclineInput, rates: RateSet): number {
  if (input.effectiveLifeYears <= 0 || rates.daysInFy <= 0) return 0;
  const days = Math.min(Math.max(input.daysHeld, 0), rates.daysInFy);
  return (input.cost / input.effectiveLifeYears) * (days / rates.daysInFy);
}

/** Capital works (Division 43): structural build cost × 2.5%/yr flat. */
export function capitalWorks(cost: number, rates: RateSet): number {
  return cost * rates.capitalWorksRate;
}
