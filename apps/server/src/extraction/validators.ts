import { money } from '@snap/db';
import { formatLocalAmount, periodOf, taxFromInclusive, type TaxRules } from '@snap/tax-rules';

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
 * still wrong. A future date cannot be a receipt for something already bought,
 * and a date far outside the retention period is far more likely a misread
 * two-digit year than a genuine old receipt.
 *
 * `maxAgeYears` is the jurisdiction's, not a constant: Australia keeps records
 * five years and this allows seven, but Indonesia requires TEN (UU KUP Pasal
 * 28(11)), so an eight-year-old Indonesian docket is one the taxpayer is still
 * legally required to hold. Refusing it would be the software contradicting
 * the law. docs/INDONESIA.md §6.2.
 */
export function dateProblem(
  iso: string | null,
  now = new Date(),
  maxAgeYears = 7,
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
  const floor = asIso(new Date(now.getFullYear() - maxAgeYears, now.getMonth(), now.getDate()));
  if (iso < floor) {
    return {
      code: 'date_implausible',
      message: `${iso} is more than ${maxAgeYears} years ago, which is outside the retention period.`,
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

/**
 * The reporting period an ISO date falls in, for the day/month tie-breaker.
 *
 * The question this answers is narrow and worth stating: *would the two
 * readings of an ambiguous date be reported in different periods?* If not, no
 * figure anyone files differs, and interrupting the user costs more than it
 * saves — the reasoning already recorded for `quarterOf`.
 *
 * With no rule set this IS `quarterOf`, unchanged. With one, the period comes
 * from the jurisdiction, and the consequence is real: under monthly periods
 * every ambiguous pair lands in a different period, so the check fires far more
 * often than it does in Australia. docs/INDONESIA.md §6.1.
 */
export function periodKey(iso: string, rules?: TaxRules | null): string {
  if (!rules) return quarterOf(iso);
  return periodOf(rules, iso);
}

/**
 * The jurisdiction-dependent half of validation.
 *
 * `validate()` was written when there was one country, so every value below was
 * a constant in this file. `docs/INDONESIA.md` §8 inventoried them; this is
 * where they stop being constants.
 *
 * **Null rules means Australia, and that is not a silent fallback.** It is the
 * documented state of every workspace created before migration 0026 and of the
 * Australian product, which does not use rule sets at all — `@snap/tax-engine`
 * is its engine. The distinction that matters: a workspace that HAS chosen
 * Indonesia never reaches this branch, because `worker.ts` resolves its rule
 * set and passes it. Australia is the answer to "no country was ever chosen",
 * not to "the country could not be loaded" — that case throws upstream.
 */
type Jurisdiction = {
  /** Tax inside a tax-inclusive total, applied by `taxFromInclusive`. */
  taxOf: (inclusive: string) => string;
  /** What the tax is called on local paper. */
  taxName: string;
  /** What the taxpayer id is called. */
  taxIdName: string;
  /** False when this jurisdiction gives no arithmetic check on the tax id. */
  taxIdCheckable: boolean;
  /** Expected currency code. */
  currency: string;
  /** Format an amount the way a person here reads it. */
  format: (v: string | null | undefined) => string;
  /** Words that mark the formal tax invoice, e.g. `FAKTUR PAJAK`. */
  taxInvoiceTokens: string[];
  /**
   * False when a photograph cannot establish validity at all.
   *
   * Indonesia: a faktur pajak is valid only once DJP has cleared it and the
   * seller has uploaded it by the 20th of the following month, and neither
   * fact is on the paper (`docs/INDONESIA.md` §4.2). Asserting a verdict from
   * the image would be inventing one.
   */
  validityDecidable: boolean;
  /** Tax-invoice / buyer-id thresholds, where the jurisdiction has them. */
  taxInvoiceThreshold: string | null;
  buyerIdThreshold: string | null;
  /** How old a document can plausibly be. */
  plausibleAgeYears: number;
  /** Reconciliation tolerance, in this currency's own units. */
  rounding: number;
  /** Drift above which a stated tax figure disagrees with the arithmetic. */
  taxDrift: number;
  /** Taxes that print like the main one and are NOT it. */
  otherTaxes: { code: string; name: string; tokens: string[]; why: string }[];
  /** One sentence telling the user which way dates are printed here. */
  dateOrderHint: string;
};

/** Australia, exactly as this file has always behaved. */
const AUSTRALIA: Jurisdiction = {
  taxOf: (inclusive) => money.gstFromInclusive(money.money(inclusive)),
  taxName: 'GST',
  taxIdName: 'ABN',
  taxIdCheckable: true,
  currency: 'AUD',
  format: (v) =>
    `$${(v == null ? 0 : Number(v)).toLocaleString('en-AU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
  taxInvoiceTokens: ['TAX INVOICE'],
  validityDecidable: true,
  taxInvoiceThreshold: TAX_INVOICE_THRESHOLD,
  buyerIdThreshold: BUYER_ABN_THRESHOLD,
  plausibleAgeYears: 7,
  rounding: ROUNDING_TOLERANCE,
  taxDrift: 0.011,
  otherTaxes: [],
  dateOrderHint: 'Australian receipts print day/month.',
};

/** Build the jurisdiction from an installed rule set. */
export function jurisdictionOf(rules: TaxRules | null | undefined): Jurisdiction {
  if (!rules) return AUSTRALIA;
  const ct = rules.consumptionTax;
  const cur = rules.currency;
  // Five till increments, as `@snap/tax-rules` defines it — 5 cents in
  // Australia, Rp 500 in Indonesia. A literal 0.05 here was the §7.2 defect.
  const tolerance = (cur.tillRounding * 5) / 10 ** cur.minorUnits;
  return {
    taxOf: (inclusive) => taxFromInclusive(rules, inclusive).taxAmount,
    taxName: ct.name,
    taxIdName: rules.taxId.name,
    taxIdCheckable: rules.taxId.checksum !== null,
    currency: cur.code,
    format: (v) => formatLocalAmount(v == null ? '0' : String(v), cur),
    taxInvoiceTokens: rules.documentRules.taxInvoiceTokens,
    validityDecidable: rules.documentRules.validityDecidableFromDocument,
    // Indonesia has no retail-receipt threshold: a cash-register slip is a
    // valid faktur pajak at any amount, and none of them is creditable anyway.
    taxInvoiceThreshold: null,
    buyerIdThreshold: null,
    plausibleAgeYears: rules.documentRules.plausibleAgeYears,
    rounding: tolerance,
    taxDrift: tolerance,
    otherTaxes: rules.otherTaxes.map((t) => ({
      code: t.code,
      name: t.name,
      tokens: t.documentTokens,
      why: t.confusableWith,
    })),
    dateOrderHint:
      rules.documentRules.dateOrder === 'day_first'
        ? `${rules.countryName} prints day/month.`
        : `${rules.countryName} prints month/day.`,
  };
}

/**
 * Tax inside a tax-inclusive amount, less any exempt portion.
 *
 * Australia: exactly 1/11. Indonesia: 11/111, because the 12% statutory rate
 * applies to a base of 11/12 (`docs/INDONESIA.md` §2.2). The divisor is the
 * jurisdiction, which is why it is no longer written here.
 */
export function expectedGst(
  inclusive: string,
  gstFree: string = '0',
  rules?: TaxRules | null,
): string {
  const j = jurisdictionOf(rules);
  return j.taxOf(money.subtract(money.money(inclusive), money.money(gstFree)));
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

/**
 * Money as a person reads it. Findings are shown to users, not to logs.
 *
 * Kept as the Australian formatter for callers outside `validate()`. Inside it,
 * the jurisdiction's own formatter is used — `$1,110,000.00` for a rupiah
 * figure is not a cosmetic slip, it is the wrong currency's convention on a
 * number the user has to check against paper.
 */
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
export function validate(
  extraction: Extraction,
  now = new Date(),
  rules?: TaxRules | null,
): ValidatedExtraction {
  const findings: Finding[] = [];
  const failures: ComplianceFailure[] = [];

  // Everything jurisdiction-dependent comes from here. With no rule set this
  // is Australia, byte-for-byte as before — which is what keeps every existing
  // test in this file meaningful rather than merely passing.
  const j = jurisdictionOf(rules);
  const fmt = j.format;

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

    const expected = expectedGst(payable, gstFreePortion.toFixed(4), rules);
    const drift = Math.abs(num(gst) - num(expected));
    // A cent of drift is rounding on the till. More than that means either the
    // tax was misread or part of the sale is exempt and unlabelled.
    if (drift > j.taxDrift) {
      // Before blaming the arithmetic, say whether a DIFFERENT tax could be
      // what was read. On an Indonesian restaurant bill the 10% line is PB1, a
      // regional tax that is not PPN and is never recoverable — and 10% of a
      // subtotal sits close enough to 11% to look like a rounding complaint
      // rather than the category error it is (docs/INDONESIA.md §5).
      const confusable = j.otherTaxes[0];
      findings.push({
        code: 'gst_arithmetic',
        severity: 'warning',
        field: 'taxAmount',
        message:
          `${j.taxName} reads ${fmt(gst)}, but the taxable amount implies ${fmt(expected)}.` +
          (confusable ? ` This may be ${confusable.name} rather than ${j.taxName}.` : ''),
        fix: confusable
          ? `${confusable.why} Check which tax the line is, and whether some items are exempt.`
          : `Check whether some items are ${j.taxName}-free, such as fresh food.`,
      });
    }
  }

  // Only where the jurisdiction actually sets a threshold. Indonesia does not:
  // a cash-register slip is a valid faktur pajak at any amount, so demanding a
  // tax line above some figure would be inventing a rule.
  if (
    gst == null &&
    payable != null &&
    j.taxInvoiceThreshold != null &&
    num(payable) >= Number(j.taxInvoiceThreshold)
  ) {
    // A tax invoice must show the tax, or a statement that the total includes it.
    failures.push('no_gst_amount_shown');
    findings.push({
      code: 'gst_missing',
      severity: 'warning',
      field: 'taxAmount',
      message: `No ${j.taxName} amount or ${j.taxName}-inclusive statement was found.`,
      fix: `A tax invoice must show the ${j.taxName}, or say the total includes it.`,
    });
  }

  /* ── 4. Do the lines add up? ───────────────────────────────────────── */
  if (extraction.lines.length > 0 && payable != null) {
    const lineSum = extraction.lines.reduce((acc, l) => acc + num(l.amount.value), 0);
    const difference = linesGap(lineSum, payable, gst);
    if (Math.abs(difference) > j.rounding) {
      findings.push({
        code: 'lines_do_not_balance',
        severity: 'warning',
        field: 'lines',
        message: `The lines add to ${fmt(lineSum.toFixed(2))}, which is ${fmt(
          Math.abs(difference).toFixed(2),
        )} ${difference > 0 ? 'short of' : 'over'} the ${fmt(payable)} total.`,
        fix:
          difference > 0
            ? 'A line was probably missed. Check the image against the list.'
            : 'A line was probably read twice.',
      });
    }
  }

  /* ── 5. The date ───────────────────────────────────────────────────── */
  const dateIssue = dateProblem(extraction.issueDate.value, now, j.plausibleAgeYears);
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
    // The tie-breaker is the REPORTING PERIOD, and its length is the
    // jurisdiction's. Australia reports GST quarterly, so two readings often
    // land in the same quarter and nothing differs. Indonesia's personal
    // taxpayer has no consumption-tax return at all, so the tax YEAR is the
    // grain — and an ambiguous pair inside one year changes nothing either.
    // docs/INDONESIA.md §6.1.
    if (ambiguous && periodKey(extraction.issueDate.value!, rules) !== periodKey(ambiguous.alternative, rules)) {
      findings.push({
        code: 'date_order_ambiguous',
        // A warning, not an error: the date read may well be right. But it
        // cannot be accepted without a human, because the alternative reading
        // falls in a different quarter and therefore a different BAS.
        severity: 'warning',
        field: 'issueDate',
        message: `${extraction.issueDate.value} could also be ${ambiguous.alternative} — the day and month are both 12 or less.`,
        fix: `Check the order on the receipt. ${j.dateOrderHint}`,
      });
    }
  }

  /* ── 6. Currency ───────────────────────────────────────────────────── */
  const currency = extraction.currency.value;
  if (currency && currency.toUpperCase() !== j.currency) {
    findings.push({
      code: 'foreign_currency',
      severity: 'warning',
      field: 'currency',
      message: `This document is in ${currency}, not ${j.currency}.`,
      fix: `${j.taxName} does not apply to a foreign purchase; check how it should be recorded.`,
    });
  }

  /* ── 7. The tax-invoice elements ───────────────────────────────────── */
  const belowThreshold =
    j.taxInvoiceThreshold != null &&
    payable != null &&
    money.compare(money.money(payable), money.money(j.taxInvoiceThreshold)) < 0;
  const overBuyerThreshold =
    j.buyerIdThreshold != null &&
    payable != null &&
    money.compare(money.money(payable), money.money(j.buyerIdThreshold)) >= 0;

  if (!abn) {
    failures.push('supplier_abn_missing');
    findings.push({
      code: 'supplier_abn_missing',
      severity: belowThreshold ? 'note' : 'warning',
      field: 'supplierAbn',
      message: `The document shows no supplier ${j.taxIdName}.`,
      fix: `Add it from the docket, or ask the supplier for a compliant tax invoice.`,
    });
  } else if (j.taxIdCheckable && !abnIsValid(abn)) {
    // Only where the jurisdiction GIVES us an arithmetic check. An Indonesian
    // individual's NPWP is their NIK, which carries no checksum at all
    // (docs/INDONESIA.md §3.2) — running the ABN algorithm over it would
    // reject valid numbers, and reporting "valid" would imply a check that
    // never happened. Saying nothing is the only honest option.
    failures.push('supplier_abn_invalid');
    findings.push({
      code: 'supplier_abn_invalid',
      severity: 'warning',
      field: 'supplierAbn',
      message: `The ${j.taxIdName} ${abn} fails the modulus-89 checksum, so at least one digit was misread.`,
      fix: 'Re-read the digits from the receipt.',
    });
  }

  if (overBuyerThreshold && extraction.buyerIdentified.value !== true) {
    failures.push('buyer_abn_required_over_1000');
    findings.push({
      code: 'buyer_abn_required_over_1000',
      severity: 'warning',
      field: 'buyerIdentified',
      message: `At ${fmt(payable)} the invoice must also show your identity or ${j.taxIdName}.`,
      fix: `Ask the supplier to reissue it showing your business name or ${j.taxIdName}.`,
    });
  }

  if (extraction.saysTaxInvoice.value !== true) {
    failures.push('not_marked_tax_invoice');
    findings.push({
      code: 'not_marked_tax_invoice',
      severity: belowThreshold ? 'note' : 'warning',
      field: 'saysTaxInvoice',
      message: `The words “${j.taxInvoiceTokens[0]?.toLowerCase() ?? 'tax invoice'}” do not appear on the document.`,
      fix: 'Request a tax invoice from the supplier.',
    });
  }

  /**
   * Whether this document supports a tax claim.
   *
   * `false` rather than `true` wherever the jurisdiction says validity is not
   * decidable from the paper at all. Indonesia is exactly that case: a faktur
   * pajak is valid only once DJP has cleared it through Coretax and the seller
   * has uploaded it by the 20th of the following month, and neither fact is
   * printed on the document (docs/INDONESIA.md §4.2). A clean read of an
   * Indonesian receipt is not evidence of a valid faktur pajak, and claiming
   * otherwise is the one error here that costs a user money years later.
   */
  const isTaxInvoice = j.validityDecidable && failures.length === 0;

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
