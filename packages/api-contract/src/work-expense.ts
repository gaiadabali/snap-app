/**
 * Filing a receipt as a work expense (or another tax deduction), shared by the web review
 * screen and the phone/PWA one. docs/DEDUCTIONS.md has the model; in short:
 *
 * A receipt is a work expense when a PERSON files it in a category of their personal space
 * that carries an ATO label and a Free Tax Returns item (`taxLabel` + `engineRowId`): the
 * seeded "Work …" categories, Donations, Tax help, Income protection, or any category given a
 * tax label. The label is the deduction type. The category's private-use share, when it has
 * one, is taken off before anything is sent. The whole receipt counts, GST included.
 */

/**
 * The ATO's own names for the return labels SnapApp sends (individual tax return, deductions
 * section). Only labels whose meaning in the bundle matches the ATO's are listed: the bundle's
 * D12 and D14 follow Free Tax Returns' worksheet (income protection, personal super), which is
 * not how the ATO numbers those labels, so no label is printed for them.
 */
export const ATO_LABEL_TITLES: Readonly<Record<string, string>> = {
  D1: 'Work-related car expenses',
  D2: 'Work-related travel expenses',
  D3: 'Work-related clothing, laundry and dry-cleaning expenses',
  D4: 'Work-related self-education expenses',
  D5: 'Other work-related expenses',
  D9: 'Gifts or donations',
  D10: 'Cost of managing tax affairs',
};

/** The fields of a category this module reads (`CategorySetting` has them all). */
export interface TaxCategoryLike {
  id: string;
  name: string;
  taxLabel: string | null;
  engineRowId: string | null;
  privateUsePercent: number | null;
  active: boolean;
}

/** True when a receipt filed here goes to Free Tax Returns: the category has a label AND an item. */
export function isTaxCategory(c: Pick<TaxCategoryLike, 'taxLabel' | 'engineRowId'>): boolean {
  return Boolean(c.taxLabel && c.engineRowId);
}

/** One line under a tax category's name, e.g. "D5 · Other work-related expenses · 40% private use taken off". */
export function taxCategoryHint(c: Pick<TaxCategoryLike, 'taxLabel' | 'engineRowId' | 'privateUsePercent'>): string | null {
  if (!isTaxCategory(c)) return null;
  const label = c.taxLabel!;
  const parts =
    label === 'RENTAL'
      ? ['Rental property']
      : ATO_LABEL_TITLES[label]
        ? [`${label} · ${ATO_LABEL_TITLES[label]}`]
        : ['Tax deduction'];
  if (c.privateUsePercent && c.privateUsePercent > 0) parts.push(`${c.privateUsePercent}% private use taken off`);
  return parts.join(' · ');
}

/**
 * The categories a receipt can be filed in, split for the picker: everyday spending, then the
 * ones that go to the tax return. Switched-off categories are left out, except the receipt's
 * current one, so the picker can always show where it is.
 */
export function pickerGroups<T extends TaxCategoryLike>(
  categories: readonly T[],
  currentId: string | null,
): { everyday: T[]; tax: T[] } {
  const offered = categories.filter((c) => c.active || c.id === currentId);
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  return {
    everyday: offered.filter((c) => !isTaxCategory(c)).sort(byName),
    tax: offered.filter(isTaxCategory).sort((a, b) => labelOrder(a.taxLabel) - labelOrder(b.taxLabel) || byName(a, b)),
  };
}

const ORDER = ['D1', 'D2', 'D3', 'D4', 'D5', 'D9', 'D10', 'D12', 'D14', 'RENTAL'];
const labelOrder = (label: string | null): number => {
  const i = ORDER.indexOf(label ?? '');
  return i < 0 ? ORDER.length : i;
};

/** The Australian financial year (1 Jul to 30 Jun) a receipt dated `isoDate` falls in, like `2025-26`; null for no date. */
export function financialYearOf(isoDate: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(isoDate ?? '');
  if (!m) return null;
  const start = Number(m[2]) >= 7 ? Number(m[1]) : Number(m[1]) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Where a receipt stands for the tax return, in one sentence: what the review screens show
 * next to the category. `categorySource` is the document's (`user` or `supplier`).
 */
export function workExpenseStatus(doc: {
  taxLabel: string | null;
  engineRowId: string;
  categorySource: 'user' | 'supplier' | null;
  issueDate: string;
  currency: string;
  reviewStatus?: string;
}): { kind: 'none' | 'counted' | 'to_confirm' | 'not_counted'; text: string } {
  if (!doc.taxLabel || !doc.engineRowId || doc.engineRowId === 'unassigned') {
    return { kind: 'none', text: 'Not a tax deduction. To send it to Free Tax Returns, choose a work category.' };
  }
  if (doc.reviewStatus === 'rejected') return { kind: 'not_counted', text: 'Rejected, so it isn’t added to your deductions.' };
  const year = financialYearOf(doc.issueDate);
  if (!year) return { kind: 'not_counted', text: 'Has no date, so it can’t be placed in a financial year. Add the date on the receipt.' };
  if (doc.currency !== 'AUD') {
    return { kind: 'not_counted', text: 'Not in Australian dollars, so it isn’t added to your deductions.' };
  }
  if (doc.categorySource !== 'user') {
    return {
      kind: 'to_confirm',
      text: `Filed like your last receipt from this shop. Confirm the category to include it in your ${year} deductions.`,
    };
  }
  return { kind: 'counted', text: `Included in your ${year} deductions for Free Tax Returns.` };
}
