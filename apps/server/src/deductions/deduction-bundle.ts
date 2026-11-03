import {
  ATO_LABELS,
  BUNDLE_SCHEMA_VERSION,
  ITEM_IDS,
  MAX_LINES,
  MAX_RECEIPT_COUNT,
  MAX_RECEIPT_REFS_PER_LINE,
  MAX_WORK_KILOMETRES,
  OCCUPATION_IDS,
  type AtoLabel,
  type DeductionBundle,
  type DeductionLine,
  type OccupationId,
} from '@snap/api-contract/deduction-bundle';

import { itemDescription } from './deduction-item-labels.js';
import type { DeductionTotals } from './deduction-totals.js';

/** Reported as `source.appVersion`. Keep in step with apps/server/package.json. */
export const BUNDLE_APP_VERSION = '0.1.0';

/** The largest amount the bundle format allows (999,999,999.99), in cents. */
const MAX_CENTS = 99_999_999_999n;

/** Whole cents -> the bundle's amount string, e.g. 12345n -> "123.45". Callers pass 1..MAX_CENTS. */
export function centsToAmount(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

/**
 * Totals -> deduction bundle v1.
 *
 * Amounts are the WORK-SHARE cents from `foldTotals` (group decision D-1b): private
 * use is already applied per receipt line, so `privateUsePercent` is omitted and
 * nothing is rounded again here. One line per (label, item).
 *
 * A line is left out when its work share is under one cent (FTR refuses zero and
 * negative amounts) or when (label, item) is not in FTR's catalogue (FTR would
 * refuse the whole file). A line cites at most 20 receipts (the smallest hashes
 * first, so the choice is stable); `receiptCount` and `amount` still cover all of them.
 */
export function buildDeductionBundle(
  totals: DeductionTotals,
  opts: { generatedAt: Date; occupation: string | null },
): DeductionBundle {
  const lines: DeductionLine[] = [];
  for (const it of totals.items) {
    const known =
      (ATO_LABELS as readonly string[]).includes(it.label) &&
      (ITEM_IDS[it.label as AtoLabel] as readonly string[]).includes(it.itemId);
    if (!known || it.workCents < 1n) continue;
    lines.push({
      label: it.label,
      itemId: it.itemId,
      description: itemDescription(it.label, it.itemId),
      amount: centsToAmount(it.workCents > MAX_CENTS ? MAX_CENTS : it.workCents),
      gstInclusive: true,
      receiptCount: Math.min(Math.max(it.receiptCount, it.receiptRefs.length), MAX_RECEIPT_COUNT),
      receiptRefs: it.receiptRefs.slice(0, MAX_RECEIPT_REFS_PER_LINE),
    } as DeductionLine);
  }
  const bundle: DeductionBundle = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    financialYear: totals.financialYear,
    generatedAt: opts.generatedAt.toISOString(),
    source: { app: 'snapapp', appVersion: BUNDLE_APP_VERSION },
    lines: lines.slice(0, MAX_LINES),
  };
  if (opts.occupation && (OCCUPATION_IDS as readonly string[]).includes(opts.occupation)) {
    bundle.occupation = opts.occupation as OccupationId;
  }
  if (totals.workKilometres > 0) {
    bundle.workKilometres = Math.min(totals.workKilometres, MAX_WORK_KILOMETRES);
  }
  return bundle;
}
