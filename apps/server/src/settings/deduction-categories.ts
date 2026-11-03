import { ATO_LABELS, ITEM_IDS, type AtoLabel } from '@snap/api-contract/deduction-bundle';

/**
 * The tax mapping a category can carry (docs/DEDUCTIONS.md).
 *
 * A category maps to an ATO label (`ato_deduction_code`) and a Free Tax
 * Returns item id (`engine_row_id`) from the deduction bundle spec. This is the
 * ONE place the server decides which pairs exist: the seeder, the custom
 * category endpoints and the tests all read it. The migration
 * `0042_deduction_categories.sql` backfills the same rows into existing
 * personal workspaces; `deduction-categories.test.ts` runs that SQL and
 * compares it with `PERSONAL_DEDUCTION_CATEGORIES`.
 */

export type DeductionCategorySeed = {
  name: string;
  label: AtoLabel;
  itemId: string;
  /** Rental categories start switched off: most workspaces have no rental. */
  active: boolean;
};

const work = (name: string, label: AtoLabel, itemId: string): DeductionCategorySeed => ({
  name,
  label,
  itemId,
  active: true,
});
const rental = (name: string, itemId: string): DeductionCategorySeed => ({
  name,
  label: 'RENTAL',
  itemId,
  active: false,
});

/** Work and rental categories every personal workspace starts with. */
export const PERSONAL_DEDUCTION_CATEGORIES: readonly DeductionCategorySeed[] = [
  work('Work car: fuel', 'D1', 'fuelReceiptTotal'),
  work('Work car: servicing', 'D1', 'serviceCost1'),
  work('Work car: registration', 'D1', 'rego'),
  work('Work travel', 'D2', 'otherTravel'),
  work('Work parking and tolls', 'D2', 'tollsTotal'),
  work('Work clothing and uniforms', 'D3', 'uniforms'),
  work('Work laundry and dry cleaning', 'D3', 'laundromat'),
  work('Study for work', 'D4', 'fees'),
  work('Work tools and equipment', 'D5', 'tools'),
  work('Work phone and internet', 'D5', 'phoneDevices'),
  work('Work software and subscriptions', 'D5', 'software'),
  work('Union and professional fees', 'D5', 'union'),
  work('Home office equipment (under $300 each)', 'D5', 'homeoffice'),
  work('Donations', 'D9', 'd9'),
  work('Tax help and tax agent', 'D10', 'lastReturnFee'),
  work('Income protection insurance', 'D12', 'd12'),
  rental('Rental: repairs and maintenance', 'repairs'),
  rental('Rental: council rates and water', 'councilRates'),
  rental('Rental: landlord insurance', 'landlordInsurance'),
  rental('Rental: agent fees', 'mgmtFees'),
  rental('Rental: loan interest', 'loanInterest'),
];

/**
 * The item a category gets when a user picks a label for it, with no way (yet)
 * to pick an item. Seeded categories keep their specific item unless the label
 * is changed.
 */
export const DEFAULT_ITEM_FOR_LABEL: Readonly<Record<AtoLabel, string>> = {
  D1: 'otherMaint1',
  D2: 'otherTravel',
  D3: 'uniforms',
  D4: 'other',
  D5: 'otherequip',
  D9: 'd9',
  D10: 'bookkeeping',
  D12: 'd12',
  D14: 'd14',
  RENTAL: 'repairs',
};

export function isAtoLabel(value: unknown): value is AtoLabel {
  return typeof value === 'string' && (ATO_LABELS as readonly string[]).includes(value);
}

/** True when `itemId` is one of FTR's item ids for `label`. */
export function isValidMapping(label: string, itemId: string): boolean {
  return isAtoLabel(label) && (ITEM_IDS[label] as readonly string[]).includes(itemId);
}

/** The item a freshly labelled category gets. Throws if the table above is wrong. */
export function defaultItemFor(label: AtoLabel): string {
  const itemId = DEFAULT_ITEM_FOR_LABEL[label];
  if (!isValidMapping(label, itemId)) {
    throw new Error(`Default item ${itemId} is not an item of ${label}.`);
  }
  return itemId;
}
