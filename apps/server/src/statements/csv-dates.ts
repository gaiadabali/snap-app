/**
 * Parsing a CSV statement's date column under the installed rule set — not a
 * constant in this file.
 *
 * `docs/STATEMENTS.md` §12 T5, "Done when" (2): "a CSV whose date column
 * parses validly under both day-first and month-first readings is resolved
 * by the installed rule set's `dateOrder` ... and the `PeriodSpec`
 * tie-breaker ... — not by a constant in the CSV reader — and is refused
 * pending an explicit user choice where those cannot settle it."
 *
 * `ambiguousDateOrder` and `periodKey` are reused from
 * `extraction/validators.ts` rather than re-implemented: they are the same
 * question ("could this date have been read in the wrong order, and does the
 * answer actually change which filing period it lands in") that the receipt
 * path already answers, and a second implementation is a second place for
 * the two to drift. Nothing in `extraction/` is modified to get this —
 * both functions are already exported and pure.
 */
import type { TaxRules } from '@snap/tax-rules';

import { ambiguousDateOrder, periodKey } from '../extraction/validators.js';

export type ParsedStatementDate =
  | { ok: true; iso: string }
  | { ok: false; reason: string };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function expandYear(raw: string): number | null {
  if (raw.length === 4) return Number(raw);
  if (raw.length === 2) {
    const n = Number(raw);
    if (!Number.isInteger(n)) return null;
    // A statement is never dated before 2000 in practice, and treating a
    // 2-digit year as 19xx would misdate every row of a real export by a
    // century — refusing outright would be worse than this documented
    // assumption for the only case that actually occurs.
    return 2000 + n;
  }
  return null;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Parses one printed date against the tenant's installed `TaxRules`.
 *
 * Two shapes are accepted:
 *  - ISO, `YYYY-MM-DD` (or `YYYY/MM/DD`) — unambiguous, the year leads.
 *  - Numeric with `/`, `-` or `.` separators and the year LAST, `D?D?[sep]
 *    M?M?[sep]YYYY|YY` — the shape almost every AU and ID banking export
 *    actually uses. Month-name formats ("12 Jan 2026") are not handled here;
 *    see the T5 report for why that is a stated limitation rather than a
 *    silent gap.
 *
 * When both readings of the second shape are valid calendar dates (both
 * components are 1..12), `rules.documentRules.dateOrder` decides which one
 * is primary. If the ALTERNATE reading would land in a different reporting
 * period (`periodKey`, itself driven by `rules.periods`), the ambiguity is
 * not cosmetic — it could change which BAS/PPN period this transaction is
 * attributed to — so this refuses rather than guessing.
 */
export function parseStatementDate(raw: string, rules: TaxRules): ParsedStatementDate {
  const s = raw.trim();

  const iso = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(s);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (!isValidCalendarDate(year, month, day)) {
      return { ok: false, reason: `"${raw}" is not a real calendar date.` };
    }
    return { ok: true, iso: `${iso[1]}-${pad2(month)}-${pad2(day)}` };
  }

  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (!numeric) {
    return { ok: false, reason: `"${raw}" is not a recognised date format.` };
  }
  const a = Number(numeric[1]);
  const b = Number(numeric[2]);
  const year = expandYear(numeric[3]!);
  if (year === null) {
    return { ok: false, reason: `"${raw}" has an unrecognised year.` };
  }

  const aIsDay = rules.documentRules.dateOrder === 'day_first';
  const primaryDay = aIsDay ? a : b;
  const primaryMonth = aIsDay ? b : a;

  // If only one of the two orderings is even a real date, there is nothing
  // ambiguous about it — a component over 12 can only be a day.
  const primaryValid = isValidCalendarDate(year, primaryMonth, primaryDay);
  const swappedValid = isValidCalendarDate(year, primaryDay, primaryMonth);

  if (primaryValid && !swappedValid) {
    return { ok: true, iso: `${year}-${pad2(primaryMonth)}-${pad2(primaryDay)}` };
  }
  if (!primaryValid && swappedValid) {
    return { ok: true, iso: `${year}-${pad2(primaryDay)}-${pad2(primaryMonth)}` };
  }
  if (!primaryValid && !swappedValid) {
    return { ok: false, reason: `"${raw}" is not a real calendar date under either day/month order.` };
  }

  // Both orderings are real dates — genuinely ambiguous on the page. Resolve
  // via the installed rule set's dateOrder, then check whether the
  // alternative reading would actually matter for reporting.
  const primaryIso = `${year}-${pad2(primaryMonth)}-${pad2(primaryDay)}`;
  const ambiguous = ambiguousDateOrder(primaryIso);
  if (!ambiguous) {
    // ambiguousDateOrder disagrees that this is ambiguous (e.g. day === month)
    // — accept the rule-set reading, nothing to settle.
    return { ok: true, iso: primaryIso };
  }
  if (periodKey(primaryIso, rules) === periodKey(ambiguous.alternative, rules)) {
    // Both readings fall in the same reporting period — no figure anyone
    // files differs, so the rule-set reading stands without asking.
    return { ok: true, iso: primaryIso };
  }
  return {
    ok: false,
    reason:
      `"${raw}" could be ${primaryIso} or ${ambiguous.alternative} — both are real dates, ` +
      `both are 12 or less, and they fall in different reporting periods. ` +
      `The installed rule set's day/month order alone cannot settle this one; it needs a ` +
      `person who can see the original file to say which it is.`,
  };
}
