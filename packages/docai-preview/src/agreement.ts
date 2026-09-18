/**
 * The one comparator for "does a device reading agree with another read of the
 * same field" — shared so there is exactly one set of these rules rather than
 * two that can drift.
 *
 * Originally lived only in `apps/mobile/src/lib/provisional.ts`, where it
 * compares the on-device PREVIEW against the SERVER's document
 * (`docs/ON-DEVICE.md` §7.1). OD-12 needs the identical semantics on the
 * server, comparing a device LAYOUT's preview fields against the model's own
 * EXTRACTION, before either has been through a human's eyes. Money is
 * compared numerically (`36.20` and `36.2000` are the same amount), a name
 * case- and space-insensitively (the recogniser returns what is printed,
 * `KALINDA GROCERS`; the model normalises to `Kalinda Grocers`), an ABN by its
 * digits, and `'0.0000'` / `''` are treated as "nothing found" rather than a
 * real zero — an unset money column serialises to `'0.0000'`, and reading that
 * as a real zero turns "no GST found" into "GST is zero", a different and more
 * expensive claim on a tax record.
 *
 * `provisional.ts` re-exports everything here rather than restating it, and
 * `apps/server`'s agreement-finding code imports it directly — see
 * `apps/server/src/extraction/agreement.ts` and
 * `apps/server/src/documents/device-agreement.ts`.
 */

/** The field paths a device preview can produce, mapped to what the other side calls them. */
export const PREVIEW_FIELDS = {
  'header.supplier': 'supplierName',
  'header.supplier_abn': 'supplierAbn',
  'header.issue_date': 'issueDate',
  'header.payable_amount': 'payableAmount',
  'header.tax_amount': 'taxAmount',
} as const;

export type PreviewPath = keyof typeof PREVIEW_FIELDS;

/**
 * Is a value a real answer, or the absence of one?
 *
 * `'0.0000'` is what an unset money column serialises to, and an empty or
 * whitespace-only string is what an abstained field renders as. Both mean "no
 * reading here", never "a reading of zero".
 */
export function meaningful(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (text === '') return false;
  if (/^0+(\.0+)?$/.test(text)) return false;
  return true;
}

/**
 * Are these the same reading, allowing for how each side spells it?
 *
 * Callers are responsible for handing this already-comparable forms — in
 * particular, a date must already be ISO on both sides (the mobile structurer
 * computes that before calling in; the server normalises with
 * `toIsoDate` from `structure.ts` before calling in). This function does not
 * parse dates itself, so that there is exactly one date parser in the
 * workspace, not one per caller.
 */
export function sameValue(path: PreviewPath, a: string, b: string): boolean {
  if (path === 'header.payable_amount' || path === 'header.tax_amount') {
    const na = Number(a.replace(/[$,\s]/g, ''));
    const nb = Number(b.replace(/[$,\s]/g, ''));
    if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 0.005;
  }
  if (path === 'header.supplier_abn') {
    return a.replace(/\D/g, '') === b.replace(/\D/g, '');
  }
  return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Trims and applies `meaningful()`; `null` for "nothing to compare". */
export function normalisedOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '' || !meaningful(text)) return null;
  return text;
}
