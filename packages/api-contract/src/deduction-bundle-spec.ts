/**
 * Deduction bundle v1: shared constants, item catalogue and pure helpers.
 *
 * BYTE-IDENTICAL IN BOTH REPOS. This file is copied verbatim between
 * SnapApp (`packages/api-contract/src/deduction-bundle-spec.ts`) and Free Tax
 * Returns (`src/lib/import/deduction-bundle-spec.ts`). Each repo's test pins the
 * SHA-256 of the shared fixtures and of this file's twin through the fixture
 * manifest, so change this file in both repos or in neither. It has no imports,
 * so it is safe on a device and on the server.
 *
 * The item catalogue is a snapshot of FTR's worksheet (`src/engine/profiles/*`
 * and `src/components/worksheet/use-worksheet-store.ts`). Each repo's tests
 * check it against that repo's own engine copy, so a renamed or added worksheet
 * item fails a test instead of silently breaking an import.
 */

export const BUNDLE_SCHEMA_VERSION = 1;

/** ATO labels FTR's worksheet models (engine `AtoLabel`). D6, D7, D8, D11 and D13 are not modelled. */
export const ATO_LABELS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14', 'RENTAL'] as const;
export type AtoLabel = (typeof ATO_LABELS)[number];

/** FTR's worksheet profile ids (PROFILES keys in src/engine/profiles/index.ts) minus 'sole': FTR is scoped to employee deductions and rentals only (founder decision 0.5), so v1 refuses the sole-trader profile. */
export const OCCUPATION_IDS = [
  'truckie_long', 'truckie_local', 'tradie', 'miner', 'factory', 'forklift', 'equipop', 'carer',
  'award', 'whitecollar', 'rental', 'tither', 'nurse', 'teacher', 'salesrep', 'retail', 'tech',
  'apprentice',
] as const;
export type OccupationId = (typeof OCCUPATION_IDS)[number];

/**
 * FTR item ids per ATO label. What an id names, by label:
 * - D1: a car item id (running costs, wash and accessories, improvements) or
 *   `fuelReceiptTotal`. The importer files it on a car.
 * - D2: a D2 year-total field of the worksheet.
 * - D3: a clothing or laundry item id. The importer files it as quantity 1 at the amount.
 * - D4: a course cost field (one course block per line).
 * - D5: an equipment CATEGORY id (the `D5Cat.id` prefix of the positional item ids such
 *   as `ppewear_3`, which differ per occupation and so cannot be exchanged), or
 *   `phoneDevices` / `otTotal`. The importer files category lines on an
 *   "Add another Other" row named by the description.
 * - D9, D12, D14: the worksheet state key (`d9`, `d12`, `d14`), one row per line.
 * - D10: a tax-affairs row id (`TAX_COST_ROWS` in shared-items.ts).
 * - RENTAL: an operating-expense item id (`RENTAL_OPERATING_ITEMS`).
 */
export const ITEM_IDS = {
  D1: [
    'rego', 'carInsurance', 'carLoanInterest', 'tyres', 'batteries', 'wiperBlades',
    'lightsFittings', 'repairsPartsDIY1', 'repairsPartsDIY2', 'repairsPartsLabour1',
    'repairsPartsLabour2', 'serviceCost1', 'serviceCost2', 'towing', 'insuranceExcess', 'oil',
    'coolant', 'brakeFluid', 'transmissionFluid', 'powerSteeringFluid', 'wiperFluid',
    'fuelAdditives', 'oilFilters', 'fuelFilters', 'airFilters', 'otherMaint1', 'otherMaint2',
    'seatCovers', 'dashCovers', 'steeringCovers', 'fullCarCovers', 'sunShades', 'floorMats',
    'windGuard', 'tinting', 'roadsideAssist', 'autoCarWash', 'shampoo', 'waxPolish',
    'interiorCleaners', 'tyreShine', 'windowCleaner', 'rags', 'pressureCleaner', 'vacuum',
    'dustbuster', 'hose', 'hoseFittings', 'sprinkler', 'deodorisers', 'sponges', 'buckets',
    'vacuumBags', 'cockpitProtector', 'dishLiquidWiper', 'sanitaryWipes', 'polishingBuffer',
    'tritonFrontGuard', 'deodoriserPlugins', 'deodoriserSpray', 'deodoriserTrees', 'washOther1',
    'washOther2', 'washOther3', 'uteWash', 'storageTubs', 'antibacSeatCovers', 'disinfectantSpray',
    'wetWipes', 'spillDetailing', 'commercialWash', 'vacuuming', 'paintProtection', 'phoneCradle',
    'newTray', 'spotlights', 'bullBar', 'towBall', 'paintJob', 'toolCanopy', 'ladderRacks',
    'shelving', 'dualBattery', 'towBar', 'fuelReceiptTotal',
  ],
  D2: [
    'accomTotal', 'mealsTotal', 'tollsTotal', 'parking', 'otherTravel',
  ],
  D3: [
    'boots', 'bootCleaner', 'dubbin', 'polish', 'polishBrush', 'bootRags', 'bootLaces',
    'bootInsertsGels', 'bootInsertsOrthotics', 'bootInsertsOdor', 'odorSpray', 'odorPowder',
    'socksThick', 'socksWaterResist', 'hiVis', 'workShorts', 'workPants', 'workShirts',
    'workUndershirts', 'workSinglets', 'tailor', 'dryClean', 'hiVisShirt', 'logoJacket',
    'antiSlipSocks', 'riggingGloves', 'uvSunnies', 'hiVisHat', 'canvasTrousers', 'hardHat',
    'kneePads', 'respirator', 'frShirts', 'frTrousers', 'miningBoots', 'riggerGloves',
    'glassesClear', 'glassesTinted', 'hatAccessories', 'headlamp', 'safetyBoots', 'overalls',
    'thermals', 'earProtection', 'goggles', 'nonSlipShoes', 'logoScrubs', 'protectiveAprons',
    'sunHat', 'logoShirt', 'logoBlazer', 'logoBlouse', 'logoEmbroidery', 'screenPrint',
    'brandedUniform', 'safetyGear', 'nursingShoes', 'shoeInsertsGels', 'shoeInsertsOrthotics',
    'shoeInsertsOdor', 'uniforms', 'workDress', 'sunscreen', 'smocks', 'labCoats', 'tradeClothing',
    'brandedPolo', 'logoShirts', 'logoApron', 'logoCap', 'chefUniform', 'steelCaps',
    'rubberGloves', 'bootInserts', 'workSocks', 'safetyGlasses', 'earmuffs', 'washMachine',
    'dryer', 'washPowder', 'fabricSoftener', 'stainRemover', 'laundromat', 'degreaser',
    'campWasher', 'greaseDetergent', 'antibacWash', 'antibacSoftener',
  ],
  D4: [
    'fees', 'materials', 'exam', 'stationery', 'laptop', 'other',
  ],
  D5: [
    'pdapp', 'pdacc', 'ppewear', 'ppewet', 'ppesun', 'ppeinjury', 'ppeother', 'truckmaint',
    'tools', 'otherequip', 'licences', 'stationery', 'union', 'consumables', 'engagement',
    'checks', 'homeoffice', 'tech', 'fees', 'software', 'hardware', 'operating', 'premises',
    'medtools', 'reference', 'classroom', 'resources', 'devices', 'marketing', 'phoneDevices',
    'otTotal',
  ],
  D9: [
    'd9',
  ],
  D10: [
    'lastReturnFee', 'otherYears', 'bookkeeping', 'taxAdminTravel',
  ],
  D12: [
    'd12',
  ],
  D14: [
    'd14',
  ],
  RENTAL: [
    'advertising', 'bodyCorp', 'councilRates', 'water', 'mgmtFees', 'landlordInsurance',
    'loanInterest', 'repairs', 'pestControl', 'legalAccounting',
  ],
} as const;

export const MAX_LINES = 500;
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_RECEIPT_REFS_PER_LINE = 20;
export const MAX_RECEIPT_COUNT = 10_000;
export const MAX_WORK_KILOMETRES = 200_000;
export const MAX_APP_VERSION_LENGTH = 32;
/** Serialized size ceiling, in UTF-8 bytes, that an importer enforces before parsing. */
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

/** Positive AUD decimal string, e.g. `123.45`. Two decimals, no sign, no separators, up to 9 integer digits. */
export const AMOUNT_PATTERN = /^(?:0\.(?:0[1-9]|[1-9]\d)|[1-9]\d{0,8}\.\d{2})$/;
/** Financial year `YYYY-YY`; see {@link isFinancialYear} for the full rule. */
export const FINANCIAL_YEAR_PATTERN = /^(20\d{2})-(\d{2})$/;
/** UTC instant, `Z` suffix only, optional milliseconds. */
export const GENERATED_AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;
/** Lowercase hex SHA-256 of a receipt's original file bytes. */
export const RECEIPT_REF_PATTERN = /^[0-9a-f]{64}$/;
/** Free text, 1 to 200 UTF-16 units (MAX_DESCRIPTION_LENGTH), no control characters. */
export const DESCRIPTION_PATTERN = /^[^\u0000-\u001f\u007f]{1,200}$/;
export const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** `2025-26` is valid (1 July 2025 to 30 June 2026); `2025-27` and `2025/26` are not. Covers 2000-01 to 2099-00. */
export function isFinancialYear(value: string): boolean {
  const m = FINANCIAL_YEAR_PATTERN.exec(value);
  if (!m) return false;
  return Number(m[2]) === (Number(m[1]) + 1) % 100;
}

/** A real calendar instant in the `GENERATED_AT_PATTERN` shape (rejects `2026-02-30` and hour 24). */
export function isUtcTimestamp(value: string): boolean {
  const m = GENERATED_AT_PATTERN.exec(value);
  if (!m) return false;
  const [y, mo, dd, h, mi, s] = m.slice(1, 7).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, dd, h, mi, s));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo - 1 &&
    t.getUTCDate() === dd &&
    h <= 23 &&
    mi <= 59 &&
    s <= 59
  );
}
