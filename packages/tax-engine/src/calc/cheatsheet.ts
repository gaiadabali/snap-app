// Cheat-sheet aggregation: composes the per-category calc modules under the
// profile's gating rules and emits exactly the labels the profile's cheat
// sheet shows (calc.js cfg.rows → OccupationProfile.cheatRows).
import type { AtoLabel, OccupationProfile } from '../profiles/types';
import type { RateSet } from '../rates/types';
import { centsPerKm, declineInValue, logbookClaim, type LogbookInput } from './d1-car';
import {
  accommodation,
  accommodationTotal,
  mealsFortnight,
  rowSum,
  tolls,
  type AccommodationInput,
  type MealsFortnightInput,
  type TollsInput,
} from './d2-travel';
import { clothingItems, homeLaundry, travelLaundry, type ClothingItemRow, type TravelLaundryRow } from './d3-clothing';
import { d4Total, type CourseBlock } from './d4-selfeducation';
import { homeOffice, overtimeMeals, phoneClaim, type OvertimeMealsInput, type PhoneClaimInput } from './d5-other';
import { capitalWorks } from './depreciation';
import { d10TaxAffairs, d12IncomeProtection, d14Super, d9Donations, RECEIPTLESS_D9_FLOOR, type DonationRow } from './d9-d14';

export type CarInput =
  | { method: 'Cents per km'; km: number }
  | { method: 'Logbook'; logbook: LogbookInput };

export interface D2Inputs {
  accommodation?: AccommodationInput;
  /** Receipted / year total — when present it overrides the nights × rate estimate. */
  accommodationReceiptTotal?: number;
  meals?: MealsFortnightInput;
  /** Year total for meals — overrides the 14-day meal loop when present. */
  mealsTotal?: number;
  tolls?: TollsInput;
  /** Year total for tolls — overrides the each-way × trips estimate when present. */
  tollsTotal?: number;
  otherRows?: number[];
}

export interface D3Inputs {
  items?: ClothingItemRow[];
  laundryWeeksWorked?: number;
  travelRows?: TravelLaundryRow[];
}

export interface D5Inputs {
  overtimeMeals?: OvertimeMealsInput;
  phone?: PhoneClaimInput;
  /** Home internet — same work-use estimator as the phone bill (calc.js net_out). */
  internet?: PhoneClaimInput;
  homeOfficeHours?: number;
  equipmentRows?: number[];
}

export interface RentalInputs {
  operatingRows: number[];
  /** Original structural build cost — capital works claims 2.5%/yr of it. */
  buildCost: number;
  /** Plant & equipment depreciation, manual annual figure (calc.js rent_plant). */
  plantDecline: number;
}

export interface WorksheetInputs {
  d1?: { cars: CarInput[] };
  d2?: D2Inputs;
  d3?: D3Inputs;
  d4?: { blocks: CourseBlock[] };
  d5?: D5Inputs;
  d9?: { rows: DonationRow[] };
  d10?: { rows: number[] };
  d12?: { rows: number[] };
  d14?: { contributions: number[] };
  rental?: RentalInputs;
}

export interface CheatSheet {
  byLabel: Partial<Record<AtoLabel, number>>;
  grandTotal: number;
}

/** Single-car claim: dispatches cents-per-km vs logbook. Exposed for the D1 per-car summary. */
export function carClaim(car: CarInput, rates: RateSet): number {
  return car.method === 'Cents per km' ? centsPerKm(car.km, rates) : logbookClaim(car.logbook, rates);
}

/** Per-car split for the tax-return summary: the claimable expenses vs decline
 * (both already × business-use %), which sum to the car total. */
export interface CarBreakdown {
  method: 'Logbook' | 'Cents per km';
  businessUsePct: number;
  expensesClaim: number;
  declineClaim: number;
  kmClaim: number;
  total: number;
}

export function carBreakdown(car: CarInput, rates: RateSet): CarBreakdown {
  if (car.method === 'Cents per km') {
    const total = centsPerKm(car.km, rates);
    return { method: 'Cents per km', businessUsePct: 0, expensesClaim: 0, declineClaim: 0, kmClaim: total, total };
  }
  const biz = car.logbook.totalKm > 0 ? Math.min(car.logbook.workKm / car.logbook.totalKm, 1) : 0;
  const expensesClaim = car.logbook.itemisedTotal * biz;
  const declineClaim = (car.logbook.decline ?? declineInValue(car.logbook.carCost, rates)) * biz;
  return { method: 'Logbook', businessUsePct: biz * 100, expensesClaim, declineClaim, kmClaim: 0, total: expensesClaim + declineClaim };
}

/** D2 sub-totals for the return summary (accommodation / meals / tolls / other). */
export interface D2Breakdown {
  accommodation: number;
  meals: number;
  tolls: number;
  other: number;
}

export function d2Breakdown(d2: D2Inputs | undefined, rates: RateSet): D2Breakdown {
  if (!d2) return { accommodation: 0, meals: 0, tolls: 0, other: 0 };
  const acc =
    d2.accommodationReceiptTotal !== undefined
      ? accommodationTotal(d2.accommodationReceiptTotal)
      : d2.accommodation
        ? accommodation(d2.accommodation)
        : 0;
  return {
    accommodation: acc,
    meals: d2.mealsTotal !== undefined ? d2.mealsTotal : d2.meals ? mealsFortnight(d2.meals, rates) : 0,
    tolls: d2.tollsTotal !== undefined ? d2.tollsTotal : d2.tolls ? tolls(d2.tolls) : 0,
    other: rowSum(d2.otherRows ?? []),
  };
}

function d1Total(inputs: WorksheetInputs, rates: RateSet): number {
  return (inputs.d1?.cars ?? []).reduce((sum, car) => sum + carClaim(car, rates), 0);
}

function d2Total(inputs: WorksheetInputs, rates: RateSet): number {
  const b = d2Breakdown(inputs.d2, rates);
  return b.accommodation + b.meals + b.tolls + b.other;
}

function d3Total(profile: OccupationProfile, inputs: WorksheetInputs, rates: RateSet): number {
  const b = d3Breakdown(profile, inputs, rates);
  return b.clothing + b.laundry;
}

/** D3 split for the return summary / breakdown cards: clothing vs laundry. */
export interface D3Breakdown {
  clothing: number;
  laundry: number;
}

export function d3Breakdown(profile: OccupationProfile, inputs: WorksheetInputs, rates: RateSet): D3Breakdown {
  // Blocked category (IT profile) contributes nothing even if inputs are passed.
  if (profile.categories.some((c) => c.label === 'D3' && c.blocked)) return { clothing: 0, laundry: 0 };
  const d3 = inputs.d3;
  if (!d3) return { clothing: 0, laundry: 0 };
  return {
    clothing: clothingItems(d3.items ?? []),
    laundry: homeLaundry(d3.laundryWeeksWorked ?? 0, rates) + travelLaundry(d3.travelRows ?? []),
  };
}

/** Per-line D5 sub-totals (profile gating applied). Exposed for the D5 breakdown cards. */
export interface D5Breakdown {
  phone: number;
  internet: number;
  overtime: number;
  homeOffice: number;
  equipment: number;
}

export function d5Breakdown(profile: OccupationProfile, inputs: WorksheetInputs, rates: RateSet): D5Breakdown {
  const d5 = inputs.d5;
  const zero: D5Breakdown = { phone: 0, internet: 0, overtime: 0, homeOffice: 0, equipment: 0 };
  if (!d5) return zero;
  return {
    phone: d5.phone ? phoneClaim(d5.phone) : 0,
    internet: d5.internet ? phoneClaim(d5.internet) : 0,
    overtime: profile.overtimeMealEligible && d5.overtimeMeals ? overtimeMeals(d5.overtimeMeals, rates) : 0,
    homeOffice:
      profile.homeOfficeEnabled && d5.homeOfficeHours
        ? homeOffice({ hours: d5.homeOfficeHours, rateKind: profile.homeOfficeRate }, rates)
        : 0,
    equipment: rowSum(d5.equipmentRows ?? []),
  };
}

function d5Total(profile: OccupationProfile, inputs: WorksheetInputs, rates: RateSet): number {
  const b = d5Breakdown(profile, inputs, rates);
  return b.phone + b.internet + b.overtime + b.homeOffice + b.equipment;
}

function rentalTotal(inputs: WorksheetInputs, rates: RateSet): number {
  const r = inputs.rental;
  if (!r) return 0;
  return rowSum(r.operatingRows) + capitalWorks(r.buildCost, rates) + r.plantDecline;
}

export function computeWorksheet(profile: OccupationProfile, inputs: WorksheetInputs, rates: RateSet): CheatSheet {
  const compute: Record<AtoLabel, () => number> = {
    D1: () => d1Total(inputs, rates),
    D2: () => d2Total(inputs, rates),
    D3: () => d3Total(profile, inputs, rates),
    D4: () => d4Total(inputs.d4?.blocks ?? [], rates),
    D5: () => d5Total(profile, inputs, rates),
    // Everyone claims the $10 receiptless bucket-donation floor except the
    // tither flow, whose own $10 seed row already represents it.
    D9: () =>
      d9Donations(inputs.d9?.rows ?? [], {
        requireDgr: profile.custom === 'tither',
        receiptlessFloor: profile.custom === 'tither' ? 0 : RECEIPTLESS_D9_FLOOR,
      }),
    D10: () => d10TaxAffairs(inputs.d10?.rows ?? []),
    D12: () => d12IncomeProtection(inputs.d12?.rows ?? []),
    D14: () => d14Super(inputs.d14?.contributions ?? []),
    RENTAL: () => rentalTotal(inputs, rates),
  };

  const byLabel: Partial<Record<AtoLabel, number>> = {};
  let grandTotal = 0;
  for (const label of profile.cheatRows) {
    const value = compute[label]();
    byLabel[label] = value;
    grandTotal += value;
  }
  return { byLabel, grandTotal };
}
