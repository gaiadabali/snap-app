/**
 * Deduction totals: the pure part (rounding contract, financial year, folding).
 * The query that feeds it is in `deductions.repo.ts`.
 */

/**
 * CROSS-APP ROUNDING CONTRACT (group plan decision D-1), shared with Free Tax
 * Returns' bundle importer. The 4.4 bundle carries these WORK-SHARE amounts
 * (this function applied per receipt line) and omits privateUsePercent, so
 * FTR's totals equal the ones computed here.
 *
 * The work share of ONE line is `halfUp(amountCents × (100 − p), 100)` in
 * integer cents, p = the category's private-use percent (null or 0 = no
 * private use). Apply it per line and then sum; never to a sum, and never with
 * floats. "Half up" means a half cent rounds towards +infinity.
 */
export function workShareCents(amountCents: bigint, privateUsePercent: number | null): bigint {
  const p = BigInt(privateUsePercent ?? 0);
  const n = amountCents * (100n - p) + 50n;
  // BigInt division truncates towards zero; floor it so negative lines (a refund) are half-up too.
  return n / 100n - (n % 100n < 0n ? 1n : 0n);
}

/** Australian financial year (1 Jul to 30 Jun) as its start year: 30 Jun 2026 is 2025, 1 Jul 2026 is 2026. */
export function fyStartYear(isoDate: string): number {
  const y = Number(isoDate.slice(0, 4));
  return Number(isoDate.slice(5, 7)) >= 7 ? y : y - 1;
}

/** `2025` -> `2025-26`, the bundle's `financialYear` form. */
export const fyLabel = (startYear: number): string =>
  `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;

/** One receipt line (or a line-less receipt, once) after category resolution. */
export interface DeductionSourceLine {
  documentId: string;
  label: string;
  itemId: string;
  privateUsePercent: number | null;
  source: 'user' | 'supplier';
  /** The amount as printed (GST included), whole cents. */
  amountCents: bigint;
  /** ISO code of the document; only AUD is ever summed. */
  currency: string;
}

export interface DeductionItemTotal {
  label: string;
  itemId: string;
  receiptCount: number;
  /** Work share in cents, summed per line. */
  workCents: bigint;
}

export interface DeductionTotals {
  financialYear: string;
  /** Only receipts a person confirmed (`category_source = 'user'`). */
  items: DeductionItemTotal[];
  totalCents: bigint;
  /** Supplier-filed receipts, not counted above, waiting for a person to confirm. */
  toReview: {
    receiptCount: number;
    amountCents: bigint;
    /** Categorised receipts in a foreign currency: counted only, never summed. */
    foreignCurrencyCount: number;
  };
  /** Work-related trips in the year, whole km (the sum is rounded half up, not each trip). */
  workKilometres: number;
}

export function foldTotals(
  financialYear: string,
  lines: DeductionSourceLine[],
  workKilometres: number,
): DeductionTotals {
  const byItem = new Map<string, DeductionItemTotal & { docs: Set<string> }>();
  const reviewDocs = new Set<string>();
  const foreignDocs = new Set<string>();
  let reviewCents = 0n;
  let totalCents = 0n;
  for (const l of lines) {
    if (l.currency !== 'AUD') {
      foreignDocs.add(l.documentId);
      continue;
    }
    if (l.source !== 'user') {
      reviewDocs.add(l.documentId);
      reviewCents += l.amountCents;
      continue;
    }
    const key = `${l.label}\u0000${l.itemId}`;
    const e = byItem.get(key) ?? { label: l.label, itemId: l.itemId, receiptCount: 0, workCents: 0n, docs: new Set() };
    const w = workShareCents(l.amountCents, l.privateUsePercent);
    e.workCents += w;
    totalCents += w;
    e.docs.add(l.documentId);
    byItem.set(key, e);
  }
  const items = [...byItem.values()]
    .map(({ docs, ...rest }) => ({ ...rest, receiptCount: docs.size }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.itemId.localeCompare(b.itemId));
  return {
    financialYear,
    items,
    totalCents,
    toReview: { receiptCount: reviewDocs.size, amountCents: reviewCents,
      foreignCurrencyCount: foreignDocs.size },
    workKilometres,
  };
}
