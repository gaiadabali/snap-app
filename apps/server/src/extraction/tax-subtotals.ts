import { money } from '@snap/db';
import type { ConsumptionTaxSpec } from '@snap/tax-rules';

/**
 * Per-category tax subtotals — Peppol BG-23, and the one capability no
 * competitor at any price offers.
 *
 * `docs/MONETISATION.md` §2: a market scan on 12 September 2026 found that
 * Hubdoc has no line items at all, Dext bills them as extra credits and is not
 * AU-tax-native, and neither myDeductions nor Ozly splits tax by category. Nor
 * do the commercial receipt parsers everyone builds on — Textract
 * `AnalyzeExpense`, Google's Expense Parser and Azure's prebuilt-receipt all
 * return a single header tax figure. It is not a feature gap; it is not in the
 * API they are all calling.
 *
 * One supermarket docket for site lunch mixes GST-free fresh food with taxable
 * packaged goods, and only part of it is claimable. This is the code that says
 * which part.
 *
 * ── Why this file had to exist ──────────────────────────────────────────────
 *
 * `document_tax_subtotals` has been in the schema since migration 0004 and was
 * **never written by anything**. The consequence was worse than an empty table:
 * `transactions.repo.ts` falls back to header totals when there are no
 * subtotals, and that fallback REFUSES a document carrying more than one tax
 * treatment — `ambiguous_tax_categories`, because guessing an allocation there
 * would be recomputing what the validators own.
 *
 * So the mixed docket that is the entire wedge could not be posted to the
 * ledger at all. The capability was in the schema, on the marketing site, and
 * absent from the product.
 *
 * ── Exact arithmetic, not floats ────────────────────────────────────────────
 *
 * `docs/PLAN.md` principle 4: money is a decimal string end to end and never
 * parsed to a float, because a BAS out by a cent is wrong. Everything here goes
 * through `@snap/db`'s scaled-BigInt `money`. The code this replaces summed
 * GST-free lines with `reduce((a, l) => a + Number(l.amount), 0)` — float
 * arithmetic on exactly the figure the wedge depends on.
 */

/** Peppol BT-118. `S` standard-rated, `Z` zero-rated (GST-free). */
export type TaxCategoryCode = 'S' | 'Z';

export type TaxSubtotal = {
  /** BT-118 */
  categoryCode: TaxCategoryCode;
  /** BT-119, as `NUMERIC(6,4)` renders it: `10.0000` / `0.0000`. */
  rate: string;
  /**
   * BT-116 — the taxable base the DOCUMENT states for this category, GST
   * excluded.
   *
   * NOT necessarily `inclusiveAmount - taxAmount`. Under Indonesia's DPP
   * Nilai Lain (docs/INDONESIA.md §2.3) a faktur pajak prints a base that is
   * 11/12 of the net amount, so `taxable + tax != inclusive` by construction.
   * This is `net x consumptionTax.baseFraction` — equal to `net` wherever
   * `baseFraction` is 1/1 (Australia, and any jurisdiction with no such
   * adjustment), and NOT equal to it under DPP Nilai Lain.
   */
  taxableAmount: string;
  /** BT-117 */
  taxAmount: string;
  /**
   * What this category costs AS PRINTED on the docket — net plus its GST.
   *
   * Sent rather than derived on the client, deliberately.
   * `docs/DESIGN-HANDOFF.md` §3: "Any design that implies client-side
   * arithmetic is undeliverable." The review screen must be able to show
   * "$24.50 taxable, $11.70 GST-free" without adding two numbers itself.
   */
  inclusiveAmount: string;
};

export type SubtotalLine = {
  /** GST-INCLUSIVE line total, as printed. */
  amount: string | null;
  gstFree: boolean;
};

const RATE_STANDARD = '10.0000';
const RATE_ZERO = '0.0000';

/** A cent of drift is rounding on the till; more means the lines are not this document. */
const RECONCILE_TOLERANCE = money.money('0.01');

/**
 * How far the printed GST may sit from one eleventh of the taxable lines.
 *
 * Two cents rather than one: a till rounds each line and then the total, so a
 * long docket legitimately drifts further than a short one. Wider than this and
 * the lines and the printed GST are describing different documents.
 */
const GST_TOLERANCE = money.money('0.02');

function isRational(r: unknown): r is { n: number; d: number } {
  return (
    typeof r === 'object' &&
    r !== null &&
    Number.isFinite((r as { n: unknown }).n) &&
    Number.isFinite((r as { d: unknown }).d) &&
    (r as { d: number }).d > 0
  );
}

/**
 * Refuse rather than guess when no rule set was supplied.
 *
 * The exact failure `packages/tax-rules/README.md` names: "No rule set
 * installed -> every calculation throws. There is deliberately no fallback."
 * Silently falling back to Australia's 1/11 and 1/1 here would misstate the
 * taxable base on every Indonesian document that reaches this function —
 * `docs/INDONESIA.md` §2.3 is the whole reason this parameter exists.
 */
function requireConsumptionTax(
  consumptionTax: Pick<ConsumptionTaxSpec, 'inclusiveFraction' | 'baseFraction'> | null | undefined,
): asserts consumptionTax is Pick<ConsumptionTaxSpec, 'inclusiveFraction' | 'baseFraction'> {
  if (
    !consumptionTax ||
    !isRational(consumptionTax.inclusiveFraction) ||
    !isRational(consumptionTax.baseFraction)
  ) {
    throw new Error(
      'taxSubtotalsFromLines requires the installed tax rule set\'s inclusiveFraction and ' +
        'baseFraction (ConsumptionTaxSpec from @snap/tax-rules) — there is deliberately no ' +
        'default. Indonesia\'s DPP Nilai Lain means "taxable + tax = inclusive" does not hold ' +
        '(docs/INDONESIA.md §2.3), so guessing a rule set here would silently misstate a ' +
        "PPN-bearing document's taxable base.",
    );
  }
}

function sumInclusive(lines: SubtotalLine[], gstFree: boolean) {
  return money.add(
    ...lines
      .filter((l) => l.gstFree === gstFree && l.amount != null)
      .map((l) => money.money(l.amount as string)),
  );
}

/**
 * Derive the per-category split from a document's lines.
 *
 * Returns `[]` rather than a guess whenever the split cannot be stated
 * honestly. That is the whole discipline of this file: an empty result leaves
 * `transactions.repo.ts` on its existing, conservative fallback, whereas a
 * fabricated allocation would post a wrong GST claim to a real ledger.
 *
 * @param printedTaxAmount The document's own `tax_amount` — what the paper
 *   says. Preferred over `inclusive / 11` because the printed figure is the
 *   fact, and a till that rounds differently is still the source of truth for
 *   what was charged. Computed only when the document prints no GST at all.
 * @param payableAmount When given, the lines must reconcile to it within a
 *   cent or nothing is emitted.
 * @param consumptionTax The taxpayer's installed tax rule set —
 *   `inclusiveFraction` and `baseFraction` from `ConsumptionTaxSpec`
 *   (`@snap/tax-rules`). Required, with no default: `docs/INDONESIA.md` §2.3
 *   found that Indonesian PPN under DPP Nilai Lain breaks the identity
 *   `taxable + tax == inclusive` that this file used to assume when deriving
 *   `taxableAmount` by subtraction, and `inclusiveFraction` is 11/111 for
 *   Indonesia, not the 1/11 this file used to hardcode via
 *   `money.gstFromInclusive`. A caller with no rule set resolved must resolve
 *   one (`TaxRulesRegistry.requireFor`) before calling this — there is
 *   deliberately no fallback, per `packages/tax-rules/README.md`.
 */
export function taxSubtotalsFromLines(
  lines: SubtotalLine[],
  printedTaxAmount: string | null | undefined,
  payableAmount: string | null | undefined,
  consumptionTax: Pick<ConsumptionTaxSpec, 'inclusiveFraction' | 'baseFraction'>,
): TaxSubtotal[] {
  requireConsumptionTax(consumptionTax);
  const usable = lines.filter((l) => l.amount != null);
  if (usable.length === 0) return [];

  const taxableInclusive = sumInclusive(usable, false);
  const freeInclusive = sumInclusive(usable, true);
  const total = money.add(taxableInclusive, freeInclusive);

  // The lines must BE this document. Without this a receipt whose lines were
  // partially read would produce a confident split of the wrong money.
  if (payableAmount != null && payableAmount !== '') {
    const gap = money.subtract(total, money.money(payableAmount));
    const drift = money.compare(gap, money.ZERO) < 0 ? money.negate(gap) : gap;
    if (money.compare(drift, RECONCILE_TOLERANCE) > 0) return [];
  }

  // GST belongs entirely to the standard-rated portion. Taking the printed
  // figure and attributing all of it to `S` is what makes the subtotals re-add
  // to the payable exactly — deriving each category's tax independently would
  // leave a cent floating on a rounded till.
  const gst =
    printedTaxAmount != null && printedTaxAmount !== ''
      ? money.money(printedTaxAmount)
      : money.gstFromInclusive(taxableInclusive, consumptionTax.inclusiveFraction);

  // The printed GST and the lines' own GST-free flags must agree, or we do not
  // know which of them is wrong and cannot state a split either way.
  //
  // Found on a demo fixture whose lines marked $63.15 taxable while its printed
  // GST was $3.87 — one eleventh of $42.60, not of $63.15. Attributing the
  // printed figure to `S` regardless still re-adds to the payable, so nothing
  // looks broken, and the screen would confidently show a taxable portion whose
  // GST is not a tenth of it. `validators.ts` already raises `gst_arithmetic`
  // for exactly this disagreement; the honest response here is to show no split
  // rather than a split we cannot support (D16).
  const impliedGst = money.gstFromInclusive(taxableInclusive, consumptionTax.inclusiveFraction);
  const gstGap = money.subtract(gst, impliedGst);
  const gstDrift = money.compare(gstGap, money.ZERO) < 0 ? money.negate(gstGap) : gstGap;
  if (money.compare(gstDrift, GST_TOLERANCE) > 0) return [];

  const out: TaxSubtotal[] = [];
  if (money.compare(taxableInclusive, money.ZERO) !== 0) {
    // NOT `taxableInclusive - gst`. That identity is false by construction
    // under DPP Nilai Lain (docs/INDONESIA.md §2.3): a faktur pajak prints a
    // DPP that is 11/12 of the net amount, not the net amount itself, so the
    // document's own taxable base has to be derived via baseFraction. Where
    // baseFraction is 1/1 (Australia, and every jurisdiction with no such
    // adjustment) this is exactly `taxableInclusive - gst`, unchanged.
    const netAmount = money.subtract(taxableInclusive, gst);
    const documentBase = money.applyFraction(netAmount, consumptionTax.baseFraction);
    out.push({
      categoryCode: 'S',
      rate: RATE_STANDARD,
      taxableAmount: documentBase,
      taxAmount: gst,
      inclusiveAmount: taxableInclusive,
    });
  }
  if (money.compare(freeInclusive, money.ZERO) !== 0) {
    out.push({
      categoryCode: 'Z',
      rate: RATE_ZERO,
      // GST-free: net and inclusive are the same number, which is the point.
      taxableAmount: freeInclusive,
      taxAmount: money.ZERO,
      inclusiveAmount: freeInclusive,
    });
  }
  return out;
}

/** Does this document carry more than one tax treatment? The wedge case. */
export function isMixed(subtotals: TaxSubtotal[]): boolean {
  return subtotals.length > 1;
}

/** GST-free portion, exactly — replaces a float `reduce` in the wire serialiser. */
export function gstFreeAmount(subtotals: TaxSubtotal[]): string | null {
  const zero = subtotals.find((s) => s.categoryCode === 'Z');
  return zero ? zero.taxableAmount : null;
}
