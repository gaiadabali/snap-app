/**
 * The page's money arithmetic, in whole numbers.
 *
 * `credit-packs.ts` owns every price. This file turns its constants into the
 * integer units the page actually draws — tenths of a cent for the per-scan
 * rate, whole cents for totals — so no figure on /pricing is typed by hand and
 * no running total is ever a float (docs/WEB.md §3.2).
 *
 * The one float touch is `Math.round(x * 1000)` on a constant that is already a
 * short decimal (0.037 → 37). It is rounded straight back to an integer, the
 * same boundary `packPrice` crosses with `toFixed`.
 *
 * Pure and import-safe from both server and client components.
 */
import {
  CREDIT_PRICE_AUD,
  MODEL_COST_AUD,
  PRICE_MULTIPLE,
  RETAINED_PER_CREDIT_AUD,
} from './credit-packs';

/** One scan, in tenths of a cent. */
export const PRICE_TENTHS = Math.round(CREDIT_PRICE_AUD * 1000);

/** What the model costs us per scan, in tenths of a cent. */
export const MODEL_TENTHS = Math.round(MODEL_COST_AUD * 1000);

/** What we must keep per scan before GST and the card fee, in tenths of a cent. */
export const RETAINED_TENTHS = Math.round(RETAINED_PER_CREDIT_AUD * 1000);

/** The owner's multiple, for copy. */
export { PRICE_MULTIPLE };

/** 37 → "3.7". Tenths of a cent as a plain decimal string. */
export function tenthsLabel(tenths: number): string {
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** "3.7" — the headline rate, in cents. */
export const CENTS_PER_SCAN = tenthsLabel(PRICE_TENTHS);

/** The cost of `scans` scans in whole cents, rounded half up. */
export function scansCostCents(scans: number): number {
  const n = Math.max(0, Math.trunc(scans));
  return Math.floor((n * PRICE_TENTHS + 5) / 10);
}

/** 984 → "9.84". Whole cents as a decimal string for `aud()`. */
export function centsToAmount(cents: number): string {
  const c = Math.max(0, Math.trunc(cents));
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}
