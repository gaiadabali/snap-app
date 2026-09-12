// D4 — Work-related self-education expenses. Formulas from reference/FORMULAS.md §D4.
// Behavioural oracle: reference/calc.js calcD4 — a course block is greyed/locked
// until a Course Name is typed; locked blocks contribute $0 to the D4 total.
// Pure functions: inputs already sanitised (non-negative numbers) by the Zod
// boundary at the UI.
import type { RateSet } from '../rates/types';

export interface CourseBlock {
  /** Course name — empty/whitespace means the block is locked and claims $0. */
  courseName: string;
  /** Itemised outlays: fees, materials, exams, stationery, device decline, other. */
  items: number[];
  /** Total study-from-home hours (hrs/week × weeks + additional). */
  homeOfficeHours: number;
}

/** One course's claim: locked (no name) → 0, else Σ(items) + hours × $/hr. */
export function courseBlockTotal(block: CourseBlock, rates: RateSet): number {
  if (block.courseName.trim() === '') return 0;
  const itemised = block.items.reduce((sum, item) => sum + item, 0);
  return itemised + block.homeOfficeHours * rates.homeOfficeElectricityPerHour;
}

/** D4 total: sum of every course block's claim. */
export function d4Total(blocks: CourseBlock[], rates: RateSet): number {
  return blocks.reduce((sum, block) => sum + courseBlockTotal(block, rates), 0);
}
