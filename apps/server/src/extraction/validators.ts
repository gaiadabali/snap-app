import { money } from '@snap/db';

import type {
  ComplianceFailure,
  Extraction,
  Finding,
  ValidatedExtraction,
} from './types.js';

/**
 * Deterministic checks over a model's output.
 *
 * This is the most valuable code in the extraction pipeline, and the cheapest.
 * A vision model is good at reading a docket and bad at arithmetic, dates and
 * rules; all three are decidable in code. Testing the provider showed exactly
 * this: it read a $266.91 total off a creased, glare-covered thermal receipt
 * perfectly, and then rendered `06/09/26` as the year **2006** — a twenty-year
 * error that would have filed the receipt outside every reporting period and
 * silently dropped it from the BAS.
 *
 * So nothing here asks the model to be right. It checks:
 *
 *   1. Arithmetic — GST is exactly 1/11 of the taxable amount, and the lines
 *      add up to the total.
 *   2. Dates — inside a window a business record can plausibly occupy.
 *   3. The ABN checksum — the same modulus-89 algorithm the database enforces.
 *   4. The ATO's tax-invoice elements, including the two thresholds.
 *
 * Every threshold below carries its source. When the ATO moves one, there is a
 * single line to change and a test that fails until it is changed.
 */

/* ── ATO thresholds ────────────────────────────────────────────────────────
   A supplier must give a tax invoice for a taxable sale of $82.50 or more
   (including GST) on request; below that a GST credit needs only a record of
   the purchase. At $1,000 or more the invoice must also show the buyer's
   identity or ABN. */
export const TAX_INVOICE_THRESHOLD = '82.50';
export const BUYER_ABN_THRESHOLD = '1000.00';

/** Tolerance for a rounding line, in dollars. */
const ROUNDING_TOLERANCE = 0.05;

/**
 * Fields whose confidence decides whether a human must look.
 *
 * The amount and the date are here because they are what the model gets wrong
 * and what the money depends on; the supplier is here because it decides the
 * category and therefore the deduction.
 */
const CRITICAL_FIELDS = ['payableAmount', 'issueDate', 'supplierName'] as const;

/** Below this, a field is not trusted without a human. */
const CONFIDENCE_FLOOR = 0.85;

/** ABN modulus-89 checksum — identical to the database's generated column. */
export function abnIsValid(abn: string | null | undefined): boolean {
  if (!abn) return false;
  const digits = abn.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = digits
    .split('')
    .map(Number)
    .reduce((acc, n, i) => acc + (i === 0 ? n - 1 : n) * weights[i]!, 0);
  return sum % 89 === 0;
}

/**
 * Is this a date a business record could carry?
 *
 * Deliberately not "is it a valid date": `2006-09-26` is perfectly valid and
 * still wrong. Records must be kept five years, so anything older than seven
 * is far more likely a misread two-digit year than a genuine old receipt, and
 * a future date cannot be a receipt for something already bought.
 */
export function dateProblem(
  iso: string | null,
  now = new Date(),
): { code: string; message: string; fix: string } | null {
  if (!iso) {
    return {
      code: 'date_missing',
      message: 'No date could be read from the document.',
      fix: 'Enter the date printed on the receipt.',
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return {
      code: 'date_malformed',
      message: `“${iso}” is not a calendar date.`,
      fix: 'Enter the date as it appears on the receipt.',
    };
  }
  // Round-trip through Date to reject 2026-13-45, which matches the pattern
  // but is not a day that exists.
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    return {
      code: 'date_malformed',
      message: `“${iso}” is not a calendar date.`,
      fix: 'Enter the date as it appears on the receipt.',
    };
  }

  // Compared as STRINGS, not as instants. These are date-only values, and
  // parsing them into a moment drags a timezone into the comparison: a docket
  // dated tomorrow in UTC is today in Sydney, and the check flickered on that
  // difference. ISO dates sort lexicographically, so string comparison is both
  // correct and timezone-free.
  const asIso = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  // Tomorrow, not today: a device clock an hour ahead of the shop's till must
  // not turn every evening purchase into an error.
  const tomorrow = asIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (iso > tomorrow) {
    return {
      code: 'date_future',
      message: `${iso} is in the future.`,
      fix: 'Check the year and the day/month order on the receipt.',
    };
  }
  const sevenYearsAgo = asIso(new Date(now.getFullYear() - 7, now.getMonth(), now.getDate()));
  if (iso < sevenYearsAgo) {
    return {
      code: 'date_implausible',
      message: `${iso} is more than seven years ago, which is outside the retention period.`,
      // The exact failure the provider produced on a two-digit year.
      fix: 'A two-digit year is easily misread — check whether this is 20xx.',
    };
  }
  return null;
}

/**
 * Could this date have been read in the wrong order?
 *
 * Australian receipts print DD/MM; American software prints MM/DD. When both
 * numbers are 12 or less, the printed string is genuinely ambiguous and no
 * amount of prompting resolves it — testing a model on a docket printed
 * `06/09/26` produced `2006-09-26` on one run and `2026-06-09` on another,
 * having been told twice that Australian dates are day-first.
 *
 * A plausibility window cannot catch this: 9 June 2026 is a perfectly
 * ordinary date. But it is the WRONG QUARTER, which is the wrong BAS, so the
 * document cannot be accepted silently. The only honest answer is to ask the
 * person who has the receipt in their hand.
 *
 * Returns the alternative reading when one exists, so the UI can offer it as a
 * single tap rather than making someone retype the date.
 */
export function ambiguousDateOrder(iso: string | null): { alternative: string } | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split('-');
  const m = Number(month);
  const d = Number(day);
  // Both readings must be a real day of a real month. The 13th onwards is
  // unambiguous, which is most of the month.
  if (m < 1 || m > 12 || d < 1 || d > 12 || m === d) return null;
  return { alternative: `${year}-${day}-${month}` };
}

/**
 * The BAS quarter an ISO date falls in, as `YYYY-Qn`.
 *
 * Australian quarters run Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun. Only the
 * calendar grouping matters here: two dates in the same quarter produce the
 * same return, so an ambiguity between them changes nothing anyone reports.
 */
export function quarterOf(iso: string): string {
  const [year, month] = iso.split('-');
  return `${year}-Q${Math.floor((Number(month) - 1) / 3) + 1}`;
}

/** GST inside a GST-inclusive amount: exactly 1/11. */
export function expectedGst(inclusive: string, gstFree: string = '0'): string {
  return money.gstFromInclusive(money.subtract(money.money(inclusive), money.money(gstFree)));
}

const num = (v: string | null | undefined): number => (v == null ? 0 : Number(v));

/**
 * How far the line items are from the total — under either printing convention.
 *
 * Australian documents balance in two different ways, and both are ordinary:
 *
 *   **Retail receipt** — line amounts are GST-INCLUSIVE, as printed on the
 *   docket, so they sum to the payable total.
 *   **Commercial tax invoice** — line amounts are EX-GST, with the GST shown
 *   once at the bottom, so they sum to the total *minus* the GST.
 *
 * Checking only the first reported every commercial invoice as broken. A
 * 40-line invoice read perfectly was flagged as "short" by precisely its own
 * GST — a warning that would have appeared on essentially every supplier
 * invoice, which is the fastest way to teach a reviewer to ignore warnings.
 *
 * So the document balances if EITHER reading works, and the gap reported is
 * the smaller of the two: whichever convention the document is using, that is
 * the one a human should be shown.
 *
 * Returns a signed number — positive means the lines are short of the total.
 */
export function linesGap(
  lineSum: number,
  payable: string | null,
  gst: string | null,
): number {
  const inclusive = num(payable) - lineSum;
  // Only meaningful when the document states its GST. With no GST stated
  // there is one reading, and it is the inclusive one.
  if (gst == null) return inclusive;
  const exclusive = num(payable) - num(gst) - lineSum;
  return Math.abs(exclusive) < Math.abs(inclusive) ? exclusive : inclusive;
}

/** Money as a person reads it. Findings are shown to users, not to logs. */
const aud = (v: string | null | undefined): string =>
  `$${num(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Runs every check and decides what happens to the document.
 *
 * Pure: same extraction in, same verdict out. That is what makes the pipeline
 * replayable — a better model in six months can be re-run over stored images
 * and its output compared against today's, which is impossible if validation
 * depends on wall-clock state.
 */
export function validate(extraction: Extraction, now = new Date()): ValidatedExtraction {
  const findings: Finding[] = [];
  const failures: ComplianceFailure[] = [];

  const payable = extraction.payableAmount.value;
  const gst = extraction.taxAmount.value;
  const abn = extraction.supplierAbn.value;

  /* ── 1. Legibility ─────────────────────────────────────────────────── */
  if (!extraction.notes.legible) {
    findings.push({
      code: 'illegible',
      severity: 'error',
      field: 'image',
      message: 'The model could not read the document reliably.',
      fix: 'Photograph it again in better light, with all four corners in frame.',
    });
  }
  for (const issue of extraction.notes.imageIssues) {
    findings.push({
      code: 'image_issue',
      severity: 'warning',
      field: 'image',
      message: issue,
    });
  }

  /* ── 2. The total ──────────────────────────────────────────────────── */
  if (payable == null) {
    findings.push({
      code: 'total_missing',
      severity: 'error',
      field: 'payableAmount',
      message: 'No total could be read.',
      fix: 'Enter the total printed on the receipt.',
    });
  } else if (num(payable) <= 0) {
    findings.push({
      code: 'total_not_positive',
      severity: 'error',
      field: 'payableAmount',
      message: `A total of ${payable} cannot be right.`,
      fix: 'Enter the total printed on the receipt.',
    });
  }

  /* ── 3. GST arithmetic ─────────────────────────────────────────────── */
  if (payable != null && gst != null && num(payable) > 0) {
    const gstFreePortion = extraction.lines
      .filter((l) => l.gstFree.value === true)
      .reduce((acc, l) => acc + num(l.amount.value), 0);

    const expected = expectedGst(payable, gstFreePortion.toFixed(4));
    const drift = Math.abs(num(gst) - num(expected));
    // A cent of drift is rounding on the till. More than that means either the
    // GST was misread or part of the sale is GST-free and unlabelled.
    if (drift > 0.011) {
      findings.push({
        code: 'gst_arithmetic',
        severity: 'warning',
        field: 'taxAmount',
        message: `GST reads ${aud(gst)}, but 1/11 of the taxable amount is ${aud(expected)}.`,
        fix: 'Check whether some items are GST-free, such as fresh food.',
      });
    }
  }

  if (gst == null && payable != null && num(payable) >= Number(TAX_INVOICE_THRESHOLD)) {
    // A tax invoice must show the GST, or a statement that the total includes it.
    failures.push('no_gst_amount_shown');
    findings.push({
      code: 'gst_missing',
      severity: 'warning',
      field: 'taxAmount',
      message: 'No GST amount or GST-inclusive statement was found.',
      fix: 'A tax invoice must show the GST, or say the total includes GST.',
    });
  }

  /* ── 4. Do the lines add up? ───────────────────────────────────────── */
  if (extraction.lines.length > 0 && payable != null) {
    const lineSum = extraction.lines.reduce((acc, l) => acc + num(l.amount.value), 0);
    const difference = linesGap(lineSum, payable, gst);
    if (Math.abs(difference) > ROUNDING_TOLERANCE) {
      findings.push({
        code: 'lines_do_not_balance',
        severity: 'warning',
        field: 'lines',
        message: `The lines add to ${aud(lineSum.toFixed(2))}, which is ${aud(
          Math.abs(difference).toFixed(2),
        )} ${difference > 0 ? 'short of' : 'over'} the ${aud(payable)} total.`,
        fix:
          difference > 0
            ? 'A line was probably missed. Check the image against the list.'
            : 'A line was probably read twice.',
      });
    }
  }

  /* ── 5. The date ───────────────────────────────────────────────────── */
  const dateIssue = dateProblem(extraction.issueDate.value, now);
  if (dateIssue) {
    findings.push({
      code: dateIssue.code,
      // An unreadable date is recoverable; an implausible one is a silent
      // reporting error, so both stop the document rather than warn.
      severity: 'error',
      field: 'issueDate',
      message: dateIssue.message,
      fix: dateIssue.fix,
    });
  }

  /* ── 5a. Day/month ambiguity ───────────────────────────────────────── */
  if (!dateIssue) {
    const ambiguous = ambiguousDateOrder(extraction.issueDate.value);
    // Only worth asking about when the answer CHANGES something. Both numbers
    // are 12 or less on roughly two receipts in five, and stopping that many
    // documents to confirm a date would train people to tap through the
    // warning without reading it — which costs more than it saves. If both
    // readings fall in the same BAS quarter, no report differs, so it passes.
    if (ambiguous && quarterOf(extraction.issueDate.value!) !== quarterOf(ambiguous.alternative)) {
      findings.push({
        code: 'date_order_ambiguous',
        // A warning, not an error: the date read may well be right. But it
        // cannot be accepted without a human, because the alternative reading
        // falls in a different quarter and therefore a different BAS.
        severity: 'warning',
        field: 'issueDate',
        message: `${extraction.issueDate.value} could also be ${ambiguous.alternative} — the day and month are both 12 or less.`,
        fix: 'Check the order on the receipt. Australian receipts print day/month.',
      });
    }
  }

  /* ── 6. Currency ───────────────────────────────────────────────────── */
  const currency = extraction.currency.value;
  if (currency && currency.toUpperCase() !== 'AUD') {
    findings.push({
      code: 'foreign_currency',
      severity: 'warning',
      field: 'currency',
      message: `This document is in ${currency}.`,
      fix: 'GST does not apply to a foreign purchase; check how it should be recorded.',
    });
  }

  /* ── 7. The tax-invoice elements ───────────────────────────────────── */
  const belowThreshold =
    payable != null && money.compare(money.money(payable), money.money(TAX_INVOICE_THRESHOLD)) < 0;
  const overBuyerThreshold =
    payable != null &&
    money.compare(money.money(payable), money.money(BUYER_ABN_THRESHOLD)) >= 0;

  if (!abn) {
    failures.push('supplier_abn_missing');
    findings.push({
      code: 'supplier_abn_missing',
      severity: belowThreshold ? 'note' : 'warning',
      field: 'supplierAbn',
      message: 'The document shows no supplier ABN.',
      fix: 'Add it from the docket, or ask the supplier for a compliant tax invoice.',
    });
  } else if (!abnIsValid(abn)) {
    failures.push('supplier_abn_invalid');
    findings.push({
      code: 'supplier_abn_invalid',
      severity: 'warning',
      field: 'supplierAbn',
      message: `The ABN ${abn} fails the modulus-89 checksum, so at least one digit was misread.`,
      fix: 'Re-read the digits from the receipt.',
    });
  }

  if (overBuyerThreshold && extraction.buyerIdentified.value !== true) {
    failures.push('buyer_abn_required_over_1000');
    findings.push({
      code: 'buyer_abn_required_over_1000',
      severity: 'warning',
      field: 'buyerIdentified',
      message: `At ${aud(payable)} the invoice must also show your identity or ABN.`,
      fix: 'Ask the supplier to reissue it showing your business name or ABN.',
    });
  }

  if (extraction.saysTaxInvoice.value !== true) {
    failures.push('not_marked_tax_invoice');
    findings.push({
      code: 'not_marked_tax_invoice',
      severity: belowThreshold ? 'note' : 'warning',
      field: 'saysTaxInvoice',
      message: 'The words “tax invoice” do not appear on the document.',
      fix: 'Request a tax invoice from the supplier.',
    });
  }

  const isTaxInvoice = failures.length === 0;

  /* ── 8. Confidence ─────────────────────────────────────────────────── */
  const criticalConfidences = CRITICAL_FIELDS.map((f) => extraction[f].confidence);
  const confidenceOverall = Math.min(...criticalConfidences, 1);
  for (const field of CRITICAL_FIELDS) {
    const c = extraction[field].confidence;
    if (c < CONFIDENCE_FLOOR) {
      findings.push({
        code: 'low_confidence',
        severity: 'warning',
        field,
        message: `The model was only ${Math.round(c * 100)}% confident of this.`,
        fix: 'Check it against the image.',
      });
    }
  }

  /* ── 9. The verdict ────────────────────────────────────────────────── */
  const hasError = findings.some((f) => f.severity === 'error');
  const hasWarning = findings.some((f) => f.severity === 'warning');

  return {
    extraction,
    findings,
    complianceFailures: failures,
    isTaxInvoice,
    belowTaxInvoiceThreshold: belowThreshold,
    gstAtRisk: isTaxInvoice ? null : (gst ?? null),
    // Anything a person should look at means a person looks at it. Auto-accept
    // is reserved for documents where nothing at all was flagged.
    reviewStatus: hasError || hasWarning ? 'needs_review' : 'auto_accepted',
    confidenceOverall,
  };
}
