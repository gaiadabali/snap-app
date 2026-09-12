// D3 — Work-related clothing & laundry. Formulas from reference/FORMULAS.md §D3.
// Pure functions: the engine assumes inputs already sanitised (non-negative numbers)
// by the Zod boundary at the UI.
// NOTE: Category blocking (e.g. the IT profile blocks D3 entirely — casualwear is
// not deductible) is handled at the profile/config layer, not in this module.
import type { RateSet } from '../rates/types';

export interface ClothingItemRow {
  qty: number;
  costPerItem: number;
}

/** Clothing items: Σ(qty × cost per item). */
export function clothingItems(rows: ClothingItemRow[]): number {
  return rows.reduce((sum, row) => sum + row.qty * row.costPerItem, 0);
}

/** Home laundry: weeks worked × flat weekly rate ($3/week). */
export function homeLaundry(weeksWorked: number, rates: RateSet): number {
  return weeksWorked * rates.homeLaundryPerWeek;
}

export interface TravelLaundryRow {
  qty: number;
  costPerUse: number;
}

/** Travel laundry (e.g. laundromat uses on the road): Σ(qty × cost per use). */
export function travelLaundry(rows: TravelLaundryRow[]): number {
  return rows.reduce((sum, row) => sum + row.qty * row.costPerUse, 0);
}
