// Types mirror the vanilla-JS prototype's occupation config shapes:
//   reference/data.js — OCCUPATIONS / COMMON_MIDPOINT / OCCUPATION_GROUPS / item arrays
//   reference/calc.js — PROFILES (lines 1239-1386), D1_CONTEXT (1388-1403),
//                       D4_INTRO (1405-1420), mountProfile defaults (1434-1442),
//                       DEFAULT_ROWS (line 2910).
// Pure data types — no React/Next imports (enforced by lint:boundaries).

/** ATO deduction labels the prototype's cheat sheet knows (calc.js line 1452). */
export type AtoLabel =
  | 'D1' | 'D2' | 'D3' | 'D4' | 'D5'
  | 'D9' | 'D10' | 'D12' | 'D14' | 'RENTAL';

/** A single worksheet row as declared in reference/data.js. */
export interface WorksheetItem {
  id: string;
  label: string;
  /** Inline help text (e.g. the loan-interest row in CAR_RUNNING). */
  help?: string;
  /** UI action hook, e.g. 'loancalc' opens the loan-interest calculator. */
  action?: string;
}

/** Tradie D5 two-level "break it down" category (data.js TRADIE_D5_CATS). */
export interface EquipmentBreakdownCategory {
  id: string;
  label: string;
  items: readonly string[];
}

export type VehicleMethod = 'Logbook' | 'Cents per km';

/** D2 accordion body layout variants (calc.js line 1458). Profiles with
 * d2: 'none' (retail, tech) simply omit their D2 category. */
export type D2Variant =
  | 'full' | 'transit' | 'business' | 'tradiedetailed'
  | 'forklift' | 'nurse' | 'tolls';

/** Keys into D1_CONTEXT (calc.js lines 1388-1403). */
export type D1ContextKey =
  | 'localCar' | 'tradieCar' | 'minerCar' | 'carerCar' | 'officeCar'
  | 'awardCar' | 'whitecollarCar' | 'soleCar' | 'nurseCar' | 'teacherCar'
  | 'salesCar' | 'retailCar' | 'techCar' | 'apprenticeCar';

/** Keys into D4_INTRO (calc.js lines 1405-1420). */
export type D4IntroKey =
  | 'licences' | 'tickets' | 'mining' | 'carer' | 'office' | 'award'
  | 'whitecollar' | 'sole' | 'nurse' | 'teacher' | 'salesrep' | 'retail'
  | 'tech' | 'apprentice';

/** Which slot of the prototype's WS config an item array fills (calc.js ws.*). */
export type ItemSetRole =
  | 'carRunning' | 'carWash' | 'carImprovements'
  | 'clothing' | 'travelLaundry' | 'equipment' | 'operating';

export interface ItemSet {
  role: ItemSetRole;
  /** Section title override (calc.js ws.carWashTitle / carImpTitle / laundryTitle / equipTitle). */
  title?: string;
  /** Section subtitle override (calc.js ws.laundrySub). */
  subtitle?: string;
  items: readonly WorksheetItem[];
}

/** One ATO category as declared per-profile in calc.js PROFILES.
 * Categories the prototype renders identically for every profile
 * (the fixed D9-D14 accordion) are not repeated here — see cheatRows. */
export interface CategoryConfig {
  label: AtoLabel;
  /** Accordion subtitle: calc.js d1Sub / d2Sub / d3Sub / d4Sub. */
  subtitle?: string;
  /** Accordion title override (calc.js d2Title). */
  title?: string;
  /** D2 only: body layout variant (calc.js cfg.d2). */
  d2Variant?: D2Variant;
  /** D1 only: help-box key (calc.js cfg.d1Context, '' = none). */
  contextKey?: D1ContextKey;
  /** D4 only: intro-text key (calc.js cfg.d4Intro, null = none). */
  introKey?: D4IntroKey;
  /** D3 only: category blocked entirely (calc.js d3: 'blocked' — IT profile). */
  blocked?: boolean;
  /** D3 only: HTML notice shown for a blocked category (calc.js d3Notice, verbatim). */
  blockedNotice?: string;
  /** Item arrays that fill this category's sections (calc.js cfg.ws). */
  itemSets?: readonly ItemSet[];
  /** Two-level D5 breakdown (tradie only; calc.js ws.d5cats / data.js TRADIE_D5_CATS). */
  equipmentBreakdown?: readonly EquipmentBreakdownCategory[];
}

/** Benchmarks from data.js OCCUPATIONS + COMMON_MIDPOINT.
 * The prototype publishes `common` as a display string ('$33,000' or
 * '$40,000 – $55,000'); single published values are stored here as [v, v]. */
export interface Benchmarks {
  /** null = "no fixed maximum" (rental, tither). */
  max: number | null;
  common: [number, number];
  /** Numeric midpoint for the common-claim progress bar (data.js COMMON_MIDPOINT). */
  midpoint: number;
  /** Occupation note shown alongside the benchmark (data.js OCCUPATIONS note). */
  note?: string;
}

export interface OccupationProfile {
  id: string;
  /** Display name (data.js OCCUPATIONS name). */
  label: string;
  /** Primary picker group label (data.js OCCUPATION_GROUPS).
   * null = profile exists in calc.js but is not reachable from the picker (apprentice). */
  group: string | null;
  /** Marked as the initially-active occupation in data.js OCCUPATIONS (truckie_long). */
  active?: boolean;
  /** Green intro banner text shown when the worksheet loads (calc.js cfg.lead). */
  lead: string;
  categories: readonly CategoryConfig[];
  /** null = occupation has no benchmark row in data.js OCCUPATIONS (apprentice only). */
  benchmarks: Benchmarks | null;
  /** Overtime-meal engine gating — calc.js lines 1441-1442 (OT_OCCS whitelist).
   * NOTE: retail & apprentice declare otRate/otMealsNote in their ws config but
   * are NOT in OT_OCCS, so mountProfile forces otMeals = false; mirrored here.
   * The $ rate itself lives in rates/fy2026.overtimeMealNoReceiptMax — data.js
   * OT_MEAL_RATE and OT_MEAL_RATE_LOCAL are both $38.65 (aligned globally). */
  overtimeMealEligible: boolean;
  /** calc.js ws.otMealsNote — kept even where eligibility is forced off. */
  overtimeMealNote?: string;
  /** false where the prototype disables the D5 home-office section
   * (salesrep declares ws.homeOffice:false; rental & tither have no D5 at all). */
  homeOfficeEnabled: boolean;
  /** 'electricity' = $0.70/hr (ATO.HOME_OFFICE_RATE — the calc.js default at
   * lines 2306 & 2759); 'fixed' = $0.67/hr fixed-rate method (sole trader only,
   * ATO.HOME_OFFICE_FIXED). */
  homeOfficeRate: 'electricity' | 'fixed';
  homeOfficeTitle?: string;    // calc.js ws.hoTitle
  homeOfficeSubtitle?: string; // calc.js ws.hoSub
  homeOfficeLabel?: string;    // calc.js ws.hoLabel
  /** calc.js ws.defaultVehMethod ('Logbook' is the engine default at line 1437;
   * unused by the custom rental/tither layouts but kept for fidelity). */
  defaultVehicleMethod: VehicleMethod;
  vehicleMethodNote?: string;  // calc.js ws.vehMethodNote
  /** Promo banner key (sole trader: 'ptyltd', calc.js line 1322). */
  banner?: string;
  /** Non-standard worksheet layouts (calc.js cfg.custom). */
  custom?: 'rental' | 'tither';
  /** Cheat-sheet rows this profile shows: calc.js cfg.rows, else DEFAULT_ROWS
   * (line 2910) minus D2 when d2 === 'none' (line 1479). */
  cheatRows: readonly AtoLabel[];
}

/** One entry of the grouped occupation dropdown (data.js OCCUPATION_GROUPS). */
export interface OccupationGroup {
  label: string;
  icon: string;
  /** Profile ids; '--' is a spacer placeholder kept verbatim from data.js.
   * FIFO/DIDO groups map onto the same base profiles (no dedicated worksheet). */
  ids: readonly string[];
}
