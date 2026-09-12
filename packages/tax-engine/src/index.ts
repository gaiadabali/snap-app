// Public surface of the calculation engine. UI code imports from '@/engine'
// and never reaches into calc internals.
export { computeWorksheet, carClaim, carBreakdown, d2Breakdown, d3Breakdown, d5Breakdown } from './calc/cheatsheet';
export { declineByDate } from './calc/d1-car';
export type { CarBreakdown, CarInput, CheatSheet, D2Breakdown, D2Inputs, D3Breakdown, D3Inputs, D5Breakdown, D5Inputs, RentalInputs, WorksheetInputs } from './calc/cheatsheet';
// Exposed for the D2 per-trip preview (meal caps make the raw total non-obvious).
export { mealsFortnight } from './calc/d2-travel';
export type { MealsFortnightInput } from './calc/d2-travel';
// Per-course claim for the tax-return summary (D4).
export { d4Total } from './calc/d4-selfeducation';
export type { CourseBlock } from './calc/d4-selfeducation';
export { CURRENT_RATES, FY2026 } from './rates/fy2026';
export { CURRENT_FY, KNOWN_FYS, RATES_BY_FY, formatFy, ratesFor } from './rates/registry';
export type { RateSet } from './rates/types';
export { OCCUPATION_GROUPS, PROFILES, stateFromPostcode } from './profiles';
export { OCC_FLOW, occIndustries, occRoleAreas, occQ3Needed, occOccupations, occResolve } from './profiles';
export { TRADIE_D2_EQUIPMENT, TRADIE_D2_BEDDING, TRADIE_D2_CLOTHING } from './profiles';
export type { OccFlowLeaf, ItemSet, WorksheetItem } from './profiles';
export type { AtoLabel, Benchmarks, CategoryConfig, OccupationGroup, OccupationProfile } from './profiles/types';
