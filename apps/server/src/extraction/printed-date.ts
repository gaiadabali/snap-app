import type { Extraction } from './types.js';

/**
 * The document's date as the COUNTRY reads it, not as the model guessed.
 *
 * The model returns `issueDate` already converted to ISO, which hid its own
 * mistakes: a Brisbane hotel folio printed `10-08-19` and came back as
 * 2019-10-08 — month-first, in an Australian workspace, the wrong BAS quarter
 * — and nothing downstream could tell, because the printed text was gone.
 * The prompt already said "DAY/MONTH/YEAR"; prompting lowers that rate, it
 * does not remove it.
 *
 * So the model also returns `issueDatePrinted`, the characters as printed, and
 * this decides a numeric date in code:
 *
 *  - one part above 12 can only be the day: `26/07/2019` is 26 July, and
 *    `7/26/2019` (a US-printed docket) is 26 July too — the printed evidence
 *    beats the country default;
 *  - both 12 or under is exactly the case the country's `dateOrder` exists
 *    for, so it decides, never the model.
 *
 * Anything else — a month name, a missing year, text that is not a date — is
 * left to the model's reading: it handles those well, and inventing a parser
 * for every printed format is how a second bug gets written.
 */

export type DateOrder = 'day_first' | 'month_first';

/** `D/M/Y`-shaped: two small numbers and a year, separated by / . - or space. */
const NUMERIC_DATE = /^\s*(\d{1,2})\s*[/.\-\s]\s*(\d{1,2})\s*[/.\-\s]\s*(\d{4}|\d{2})\b/;

/**
 * The ISO date a printed numeric date means under `order`, or null if the text
 * is not a numeric date or names an impossible day.
 */
export function isoFromPrinted(printed: string, order: DateOrder): string | null {
  const m = NUMERIC_DATE.exec(printed);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  // A two-digit year is in the 2000s — the same rule the prompt states.
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);

  let day: number;
  let month: number;
  if (a > 12 && b <= 12) [day, month] = [a, b];
  else if (b > 12 && a <= 12) [day, month] = [b, a];
  else if (a <= 12 && b <= 12) [day, month] = order === 'day_first' ? [a, b] : [b, a];
  else return null;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Re-derives `issueDate` from `issueDatePrinted` when the printed text is a
 * numeric date, and says so in `notes.warnings` when that overrode the model.
 * Returns the extraction unchanged when there is nothing printed to decide on.
 */
export function reconcileIssueDate(extraction: Extraction, order: DateOrder): Extraction {
  const printed = extraction.issueDatePrinted?.value;
  if (!printed) return extraction;
  const decided = isoFromPrinted(printed, order);
  if (!decided || decided === extraction.issueDate.value) return extraction;

  return {
    ...extraction,
    issueDate: { value: decided, confidence: extraction.issueDate.confidence },
    notes: {
      ...extraction.notes,
      warnings: [
        ...extraction.notes.warnings,
        `Date printed as "${printed.trim()}" read as ${decided} (${order === 'day_first' ? 'day' : 'month'} first); ` +
          `the model had ${extraction.issueDate.value ?? 'no date'}.`,
      ],
    },
  };
}
