// Fiscal-year rate registry. Each June a new rates/fy20XX.ts is added and
// registered here — never edit history. Fiscal years are keyed by their END
// year as an integer (FY2026 = 1 Jul 2025 – 30 Jun 2026 = key 2026), matching
// the fy2026.ts module naming and RateSet.fy label '2025-26'.
import type { RateSet } from './types';
import { FY2026 } from './fy2026';

/** The current (latest) fiscal year the app defaults to, as an end-year int. */
export const CURRENT_FY = 2026;

/** End-year int → RateSet. Add one entry per new fiscal year. */
export const RATES_BY_FY: Readonly<Record<number, RateSet>> = {
  2026: FY2026,
};

/** Every fiscal year we hold rates for, newest first. */
export const KNOWN_FYS: readonly number[] = Object.keys(RATES_BY_FY)
  .map(Number)
  .sort((a, b) => b - a);

/**
 * Rates for a fiscal year (end-year int). Exact match if known; otherwise the
 * newest known year that is not after the request (so a not-yet-added future
 * year falls back to the latest published rates), clamped to the earliest known
 * year for anything older than our history.
 */
export function ratesFor(fy: number): RateSet {
  const exact = RATES_BY_FY[fy];
  if (exact) return exact;
  const atOrBefore = KNOWN_FYS.filter((y) => y <= fy);
  const pick = atOrBefore.length ? Math.max(...atOrBefore) : Math.min(...KNOWN_FYS);
  return RATES_BY_FY[pick];
}

/** Format an end-year int for display: 2026 → '2025-26'. */
export function formatFy(fy: number): string {
  return `${fy - 1}-${String(fy).slice(2)}`;
}
