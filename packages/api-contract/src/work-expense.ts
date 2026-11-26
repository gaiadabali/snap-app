import { formatAud, splitLinesCents, splitReceipt, splitRestCents, type ReceiptSplit } from './receipt-split';

/**
 * Filing a receipt as a work expense (or another tax deduction), shared by the web review
 * screen and the phone/PWA one. docs/DEDUCTIONS.md has the model; in short:
 *
 * A receipt is a work expense when a PERSON files it in a category of their personal space
 * that carries an ATO label and a Free Tax Returns item (`taxLabel` + `engineRowId`): the
 * seeded "Work …" categories, Donations, Tax help, Income protection, or any category given a
 * tax label. The label is the deduction type. The category's private-use share, when it has
 * one, is taken off before anything is sent. The whole receipt counts, GST included, less any
 * lines a person filed in a category of their own (a work item on a supermarket docket):
 * those count in their own category (`receipt-split.ts`).
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

/** The fields of a line this module reads (`DocumentLine` has them all). */
export interface WorkLineLike {
  lineNumber: number;
  amount: string;
  gstFree: boolean;
  /** The category the line is filed in on its own, or null/absent (it goes with the receipt). */
  categoryId?: string | null;
}

/**
 * Where a receipt stands for the tax return, in one sentence or two: what the review screens
 * show on the Tax return card. `categorySource` is the document's (`user` or `supplier`).
 *
 * With lines marked as work (filed in a category of their own), it says what they come to,
 * GST included, by the same rule the server sends (`splitReceipt`), and what happens to the
 * rest of the receipt. A line is only ever filed on its own by a person, so marked lines count
 * without the receipt's category being confirmed.
 */
export function workExpenseStatus(doc: {
  taxLabel: string | null;
  engineRowId: string;
  categorySource: 'user' | 'supplier' | null;
  issueDate: string;
  currency: string;
  reviewStatus?: string;
  /** The rest only needs these when lines are marked. */
  category?: string;
  categoryId?: string | null;
  payableAmount?: string | null;
  taxAmount?: string | null;
  lines?: readonly WorkLineLike[];
}): { kind: 'none' | 'counted' | 'to_confirm' | 'not_counted'; text: string } {
  const marked = (doc.lines ?? []).filter((l) => l.categoryId);
  const receiptIsTax = Boolean(doc.taxLabel && doc.engineRowId && doc.engineRowId !== 'unassigned');
  if (!receiptIsTax && marked.length === 0) {
    return { kind: 'none', text: 'Not a tax deduction. To send it to Free Tax Returns, choose a work category or mark the work lines.' };
  }
  if (doc.reviewStatus === 'rejected') return { kind: 'not_counted', text: 'Rejected, so it isn’t added to your deductions.' };
  const year = financialYearOf(doc.issueDate);
  if (!year) return { kind: 'not_counted', text: 'Has no date, so it can’t be placed in a financial year. Add the date on the receipt.' };
  if (doc.currency !== 'AUD') {
    return { kind: 'not_counted', text: 'Not in Australian dollars, so it isn’t added to your deductions.' };
  }

  if (marked.length === 0) {
    if (doc.categorySource !== 'user') {
      return {
        kind: 'to_confirm',
        text: `Filed like your last receipt from this shop. Confirm the category to include it in your ${year} deductions.`,
      };
    }
    return { kind: 'counted', text: `Included in your ${year} deductions for Free Tax Returns.` };
  }

  const split = workLinesSplit(doc);
  if (split.totalCents <= 0n) {
    return { kind: 'not_counted', text: 'Has no total, so the marked lines can’t be added. Add the total on the receipt.' };
  }
  const linesCents = splitLinesCents(split);
  const restCents = splitRestCents(split);
  const n = marked.length;
  const lines = `${n} work line${n === 1 ? '' : 's'} (${formatAud(linesCents)}, GST included)`;
  const notes = [
    split.capped ? 'The marked lines add up to more than the total, so they count as the total.' : null,
    split.ignoredLineNumbers.length > 0 ? 'A discount line marked on its own isn’t counted; mark it with the item it came off.' : null,
  ].filter(Boolean);
  const tail = notes.length > 0 ? ` ${notes.join(' ')}` : '';

  if (!receiptIsTax) {
    return {
      kind: 'counted',
      text: `${lines} included in your ${year} deductions for Free Tax Returns. The rest of the receipt stays out.${tail}`,
    };
  }
  if (restCents <= 0n) return { kind: 'counted', text: `${lines} included in your ${year} deductions for Free Tax Returns.${tail}` };
  if (doc.categorySource !== 'user') {
    return {
      kind: 'to_confirm',
      text: `${lines} included in your ${year} deductions. Confirm the category to include the rest (${formatAud(restCents)}) too.${tail}`,
    };
  }
  return {
    kind: 'counted',
    text: `Included in your ${year} deductions for Free Tax Returns: ${lines}, and the rest (${formatAud(restCents)}) as ${doc.category ?? 'the receipt’s category'}.${tail}`,
  };
}

/**
 * The receipt split by its lines, with `overrides` (line number to category id, or null to
 * put it back with the receipt) applied on top of what is saved: the running "marked for
 * work" total while a person picks lines, by the same rule the server sends (`splitReceipt`).
 */
export function workLinesSplit(
  doc: { payableAmount?: string | null; taxAmount?: string | null; categoryId?: string | null; lines?: readonly WorkLineLike[] },
  overrides: Readonly<Record<number, string | null>> = {},
): ReceiptSplit {
  return splitReceipt({
    payable: doc.payableAmount ?? null,
    taxAmount: doc.taxAmount ?? null,
    categoryId: doc.categoryId ?? null,
    lines: (doc.lines ?? []).map((l) => ({
      lineNumber: l.lineNumber,
      amount: l.amount,
      gstFree: l.gstFree,
      categoryId: l.lineNumber in overrides ? (overrides[l.lineNumber] ?? null) : (l.categoryId ?? null),
    })),
  });
}
