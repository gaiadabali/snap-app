/**
 * What a tax rule set IS.
 *
 * A rule set is **data, never code**. Everything here is JSON-serialisable, and
 * that is a deliberate constraint rather than a stylistic one:
 *
 *  1. **App Store guideline 2.5.2 prohibits downloading executable code.** An
 *     app that fetches JavaScript and evaluates it is rejected. A rule set is a
 *     rate table and a set of rule declarations; the evaluator that reads it
 *     ships inside the binary. That is the difference between "updates its tax
 *     rules over the air" and "gets pulled from the store".
 *  2. **Data can be verified; code cannot, cheaply.** `verify.ts` can check a
 *     rule set's shape, its digest and its version before anything reads it. There
 *     is no equivalent for a downloaded function.
 *  3. **Data can be replayed.** README principle 2 — extraction is a versioned,
 *     replayable function. A result computed under `id-2026.1` must be
 *     re-derivable under `id-2026.1` in three years. Pinning a rule set version is
 *     possible; pinning the behaviour of arbitrary downloaded code is not.
 *
 * The consequence to keep in mind when extending this file: **if a jurisdiction
 * needs a rule this contract cannot express, the answer is to widen the
 * contract and the interpreter, not to smuggle behaviour into a rule set.** A rule set
 * that needs its own logic is a rule set that has become code.
 */

/* ── Rationals ──────────────────────────────────────────────────────────────
   Rates are rationals, not decimals, and that is load-bearing.

   Indonesian PPN inside a tax-inclusive total is exactly 11/111. Australian
   GST is exactly 1/11. Neither terminates in decimal, so a rule set that declared
   `0.0990990991` would be declaring a rounding error and every consumer would
   inherit it. A numerator and a denominator are exact, and `money.ts` does the
   arithmetic in BigInt so they stay exact all the way to the final rounding
   step. */
export interface Rational {
  /** Numerator. Must be finite and integral. */
  n: number;
  /** Denominator. Must be a positive integer — never zero. */
  d: number;
}

/* ── Currency ─────────────────────────────────────────────────────────────── */

/**
 * How this jurisdiction's money is shaped, read and printed.
 *
 * `minorUnits` is the one that catches people. AUD has 2 (cents); IDR has
 * **0** — rupiah has no subdivision in practice and tills round to the whole
 * unit, often to the nearest 100. Every tolerance and every rounding step in
 * `interpreter.ts` is expressed in minor units for this reason, because
 * `docs/INDONESIA.md` §7.2 found the existing tolerances written as literal
 * dollar amounts: five rupiah is not five cents, it is about a two-hundredth
 * of it.
 */
export interface CurrencySpec {
  /** ISO 4217, e.g. `IDR`, `AUD`. */
  code: string;
  /** Symbol as printed, e.g. `Rp`, `$`. */
  symbol: string;
  /** BCP 47 tag for `toLocaleString`, e.g. `id-ID`, `en-AU`. */
  locale: string;
  /** Decimal places the currency actually has. IDR is 0, AUD is 2. */
  minorUnits: number;
  /**
   * Thousands and decimal separators **as printed on local paper**.
   *
   * Indonesia inverts them against Australia: `Rp 1.234.567,89`. This is not
   * cosmetic — `docs/INDONESIA.md` §7.1 traced a silent thousand-fold error
   * from exactly this, because `15.000` (fifteen thousand on an Indonesian
   * docket) parses as fifteen under a regex written for `15.000` meaning
   * fifteen. The parser needs to be told which convention it is reading.
   */
  thousandsSeparator: string;
  decimalSeparator: string;
  /**
   * Smallest increment a till actually rounds to, in minor units. AUD is 1
   * (one cent). IDR is commonly 100 (one hundred rupiah). Drives the
   * reconciliation tolerance rather than any calculation.
   */
  tillRounding: number;
}

/* ── Consumption tax (GST / PPN / VAT) ─────────────────────────────────────── */

/**
 * The consumption tax, and the one structural surprise Indonesia carries.
 *
 * Australia: a 10% rate on an ex-tax price, so tax inside an inclusive total is
 * 1/11, and `taxable + tax == inclusive` always.
 *
 * Indonesia since PMK 131/2024: a **12% statutory rate applied to a base of
 * 11/12 of the price** (*DPP Nilai Lain*), giving an 11% effective rate. The
 * faktur prints the reduced base and the 12% rate, which means
 * `taxable + tax != inclusive` **by construction** — verified in
 * `docs/INDONESIA.md` §2.3. A rule set therefore has to declare the base fraction
 * separately from the rate, because deriving one from the other is exactly the
 * assumption that breaks.
 */
export interface ConsumptionTaxSpec {
  /** What it is called on local paper: `PPN`, `GST`. */
  name: string;
  /** Tokens that identify this tax on a document, for the reader. */
  documentTokens: string[];
  /** The rate as legislated. Indonesia 12/100; Australia 10/100. */
  statutoryRate: Rational;
  /**
   * The fraction of the price the statutory rate is applied to.
   *
   * Indonesia: 11/12 (DPP Nilai Lain). Australia: 1/1 — the rate applies to
   * the whole ex-tax price. `1/1` is not a placeholder; it is the honest
   * statement that Australia has no equivalent adjustment.
   */
  baseFraction: Rational;
  /**
   * Tax contained in a tax-INCLUSIVE total. Declared, not derived.
   *
   * Derivable as `statutoryRate x baseFraction / (1 + statutoryRate x
   * baseFraction)`, and `contract.test.ts` asserts that it agrees. It is stated
   * anyway because it is the number every consumer actually uses, and a rule set
   * whose two statements of the same fact disagree should fail verification
   * rather than silently pick one. That is the "make the agreement checkable"
   * rule from the README applied to rule set data.
   */
  inclusiveFraction: Rational;
  /**
   * Can the taxpayer this rule set serves recover this tax?
   *
   * **False for every personal rule set**, and the reason matters. In Australia a
   * GST credit requires being registered for GST, which a personal taxpayer
   * generally is not. In Indonesia input VAT is creditable only by a PKP, and
   * `docs/INDONESIA.md` §4.3 records that PPN on a retail docket is not
   * creditable *even by a PKP*.
   *
   * When false, consumption tax is an ANALYTIC — "you paid this much PPN" —
   * and never a claim, a credit or a return line. `interpreter.ts` enforces
   * the distinction; it does not leave it to the caller to remember.
   */
  recoverable: boolean;
  /** Supplies that carry no consumption tax, for the per-line split. */
  exemptCategories: ExemptCategory[];
}

/** A class of supply that carries no consumption tax, with its legal basis. */
export interface ExemptCategory {
  /** Stable key, e.g. `basic_necessities`. */
  code: string;
  /** Shown to a person. */
  label: string;
  /** The instrument that grants it, e.g. `PP 49/2022`. */
  authority: string;
  /** Words on a docket that suggest this category. Hints, never proof. */
  hints: string[];
}

/* ── Taxes that are NOT the consumption tax ────────────────────────────────── */

/**
 * Other taxes that print on a receipt and must not be mistaken for the
 * consumption tax.
 *
 * This exists because of Indonesia and would be an empty array for Australia.
 * `docs/INDONESIA.md` §5: restaurant, hotel, parking and entertainment
 * consumption carries **PBJT (PB1)**, a regional tax of up to 10%, collected by
 * the local government, printed one line from where PPN would print, at a rate
 * a reader recognises. It is not PPN, it is never creditable, and a validator
 * told "tax is 11/111 of the inclusive total" will find that 10% of the subtotal
 * passes on small amounts.
 *
 * Australia has no second 10% tax on a docket, which is exactly why the
 * existing reader has no concept for this and would bank it as recoverable.
 */
export interface OtherTaxSpec {
  code: string;
  /** `PB1`, `PBJT`. */
  name: string;
  documentTokens: string[];
  /** The ceiling; the actual rate is set locally, so this is not a check. */
  maxRate: Rational;
  /** Who levies it — `regional` means the rate varies by locality. */
  levy: 'national' | 'regional';
  recoverable: boolean;
  authority: string;
  /** Why it is easy to confuse. Shown to a reviewer, not just logged. */
  confusableWith: string;
}

/* ── Income tax ────────────────────────────────────────────────────────────── */

/**
 * One band of a progressive scale.
 *
 * `upTo` is the top of the band in MAJOR units (whole rupiah, whole dollars),
 * as an integer, or `null` for the final unbounded band. Bands are cumulative
 * and must be sorted ascending; `verify.ts` refuses a rule set whose bands are not.
 */
export interface TaxBracket {
  upTo: number | null;
  rate: Rational;
}

/**
 * A deduction applied before the taxable amount is found.
 *
 * Expressed as a rate on a base with an optional cap, because that covers what
 * personal regimes actually do — Indonesia's *biaya jabatan* is 5% of gross
 * capped at Rp 500,000/month and Rp 6,000,000/year — without needing a rule set to
 * express arbitrary logic. A regime needing more than this needs a contract
 * change, by design.
 */
export interface StandardDeduction {
  code: string;
  label: string;
  /** Fraction of the base. */
  rate: Rational;
  /** Cap in major units per year, or null for uncapped. */
  annualCap: number | null;
  /** Cap in major units per month, or null. */
  monthlyCap: number | null;
  /** Which income this applies to. */
  appliesTo: 'employment' | 'business' | 'all';
  authority: string;
}

/**
 * A tax-free allowance that varies by household status.
 *
 * Indonesia's **PTKP** is the case this is shaped for: a base amount for a
 * single taxpayer, an addition for being married, and an addition per
 * dependant up to a statutory maximum. Australia's tax-free threshold is the
 * degenerate case — a base with no additions.
 */
export interface PersonalAllowance {
  code: string;
  label: string;
  /** Major units per year for a single taxpayer with no dependants. */
  base: number;
  /** Added when married. Indonesia: 4,500,000. */
  marriedAddition: number;
  /** Added per dependant. Indonesia: 4,500,000. */
  dependantAddition: number;
  /** Most dependants that can be counted. Indonesia: 3. */
  maxDependants: number;
  /**
   * Added when a spouse's income is combined onto one return. Indonesia's
   * K/I statuses. Null where the concept does not exist.
   */
  combinedSpouseAddition: number | null;
  authority: string;
}

/**
 * An alternative regime a taxpayer may elect instead of the ordinary scale.
 *
 * Indonesia has two that matter for an individual and neither is expressible as
 * a bracket table:
 *
 *  - **PP 23** — 0.5% final tax on gross turnover, with the first Rp 500m of
 *    annual turnover exempt. *Final* means no deductions at all, which is the
 *    finding in `docs/INDONESIA.md` §1 that reshaped this whole engine.
 *  - **NPPN** — deemed net profit: net income is a published percentage of
 *    turnover, varying by occupation and region (PER-17/PJ/2015). An electing
 *    taxpayer must notify DJP by the end of March.
 */
export interface AlternativeRegime {
  code: string;
  label: string;
  kind: 'final_on_turnover' | 'deemed_profit';
  /** For `final_on_turnover`: the rate applied to turnover. */
  rate: Rational | null;
  /** Turnover below which no tax arises under this regime, major units. */
  exemptTurnover: number;
  /** Turnover ceiling above which the regime is unavailable, major units. */
  turnoverCeiling: number | null;
  /** True when electing it removes expense deductions entirely. */
  deductionsAllowed: boolean;
  /** Who may elect it. */
  eligibleTaxpayers: string[];
  /** Plain-language election deadline, for the UI to surface. */
  electionDeadline: string | null;
  authority: string;
}

/* ── Identity ──────────────────────────────────────────────────────────────── */

/**
 * How this jurisdiction identifies a taxpayer, and how strongly it can be
 * checked from a photograph.
 *
 * `checksum` is the honest field. Australia's ABN carries a modulus-89 check
 * that catches a single misread digit arithmetically, which is why
 * `abn_is_valid()` can back a generated column. Indonesia's 16-digit NPWP for
 * an individual **is the NIK, which has no checksum at all** — see
 * `docs/INDONESIA.md` §3.2. A rule set must be able to say "there is no checksum
 * here", because the alternative is a reader that implies a validation it never
 * performed.
 */
export interface TaxIdSpec {
  /** `NPWP`, `ABN`. */
  name: string;
  documentTokens: string[];
  /** Accepted digit lengths, e.g. `[16]` or `[11]`. */
  lengths: number[];
  /** `null` means: this jurisdiction gives us no arithmetic check. */
  checksum: 'abn_mod89' | 'luhn10' | null;
  /**
   * Set when `checksum` is non-null but the algorithm is not confirmed well
   * enough to gate on. `docs/INDONESIA.md` §10.1 — the best source for the
   * legacy 15-digit NPWP check digit says "apparently Luhn", which is not
   * evidence enough to refuse a document on.
   */
  checksumUnverified: boolean;
  /** Human description of the format, shown in a fix hint. */
  format: string;
}

/* ── Documents and periods ─────────────────────────────────────────────────── */

/**
 * The rules that decide whether a document supports anything, and for how long
 * it has to be kept.
 */
export interface DocumentRules {
  /** Words that mark a document as the jurisdiction's formal tax invoice. */
  taxInvoiceTokens: string[];
  /**
   * Whether a photograph alone can establish that a document is valid.
   *
   * **False for Indonesia**, and this is structural rather than a limitation of
   * the reader: `docs/INDONESIA.md` §4.2 records that a faktur pajak is valid
   * only once DJP has cleared it through Coretax and the seller has uploaded it
   * by the 20th of the following month. Neither fact is on the paper. A rule set
   * that sets this false is telling the app not to claim a verdict it cannot
   * reach.
   */
  validityDecidableFromDocument: boolean;
  /** Years a taxpayer must keep the record. Australia 5, Indonesia 10. */
  retentionYears: number;
  /**
   * How old a document can be before the reader should call the date a misread
   * rather than a genuinely old receipt.
   *
   * Derived from `retentionYears` in spirit but declared separately, because
   * `validators.ts` uses 7 against a 5-year obligation — a deliberate margin,
   * not `retentionYears` itself.
   */
  plausibleAgeYears: number;
  /** Day-first (AU, ID) or month-first. Drives the ambiguity check. */
  dateOrder: 'day_first' | 'month_first';
  /** Month abbreviations as printed locally. `Mei`, `Agu`, `Okt`, `Des`. */
  monthAbbreviations: string[];
}

/**
 * The reporting period, and the day/month tie-breaker that rides on it.
 *
 * `docs/INDONESIA.md` §6.1: Australia reports GST quarterly, Indonesia reports
 * PPN monthly. That is not only a reporting difference. `validators.ts` uses
 * the period as the tie-breaker for an ambiguous `06/09/26` — it stays silent
 * when both readings land in the same period, on the stated reasoning that
 * stopping 40% of documents teaches people to tap through warnings. Under
 * monthly periods *every* ambiguous pair lands in a different period, so the
 * same code interrupts far more often. Declaring the period in the rule set makes
 * that consequence visible instead of emergent.
 */
export interface PeriodSpec {
  /** Consumption-tax reporting frequency. */
  consumptionTaxPeriod: 'monthly' | 'quarterly' | 'annual' | 'none';
  /** First month of the tax year, 1–12. Australia 7, Indonesia 1. */
  taxYearStartMonth: number;
  /** What the annual return is called locally. */
  annualReturnName: string;
}

/* ── Ledger ────────────────────────────────────────────────────────────────── */

/**
 * A tax code as it lands on a ledger split.
 *
 * Mirrors the `tax_codes` table (migration 0005) so a rule set can seed it. The
 * Australian rows carry BAS labels; an Indonesian rule set carries its own, and
 * `reportLabels` is deliberately untyped beyond `string[]` because a label set
 * is jurisdiction data, not a shared enum.
 */
export interface PackTaxCode {
  code: string;
  name: string;
  /** Percentage as printed, e.g. 11 or 0. For display and for `tax_codes.rate`. */
  ratePercent: number;
  /** Labels on a purchase, e.g. `['G11','1B']` for Australia. */
  purchaseLabels: string[];
  /** Labels on a sale. */
  saleLabels: string[];
  /**
   * Whether this code represents tax the taxpayer can recover.
   *
   * For a personal rule set every code is false, and `verify.ts` asserts that
   * against `consumptionTax.recoverable` rather than trusting the rule set author
   * to keep two places in step.
   */
  claimsCredit: boolean;
  /** Why this code exists, in a sentence. Shown in the category picker. */
  note: string;
}

/* ── The rules ──────────────────────────────────────────────────────────────── */

/** Who the rule set is written for. Rule sets are not interchangeable across these. */
export type TaxpayerScope = 'personal' | 'business';

/**
 * A complete tax rule set.
 *
 * Exactly one is active at a time (`registry.ts`). Installing another replaces
 * it — there is no merge, no fallback and no inheritance between rule sets, because
 * a half-applied jurisdiction is worse than a refused one.
 */
export interface TaxRules {
  /** Stable identifier, `<country>-<year>`, e.g. `id-2026`. */
  id: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string;
  /** Country name as a person would pick it in settings. */
  countryName: string;
  /**
   * Rule set version, incremented whenever any number in it changes.
   *
   * **Stored alongside every result computed from it.** README principle 2:
   * a calculation that cannot be re-derived is not replayable, and a rule set that
   * can be swapped underneath stored history is exactly how that guarantee is
   * lost. `interpreter.ts` stamps this into every result it returns.
   */
  version: string;
  /** Tax year this rules states the law for, e.g. `2026`. */
  taxYear: string;
  /** Date from which the rules's contents are correct, ISO. */
  effectiveFrom: string;
  /** Date after which it must not be used, ISO, or null while current. */
  effectiveTo: string | null;
  scope: TaxpayerScope;

  currency: CurrencySpec;
  consumptionTax: ConsumptionTaxSpec;
  otherTaxes: OtherTaxSpec[];

  incomeTax: {
    brackets: TaxBracket[];
    allowance: PersonalAllowance;
    standardDeductions: StandardDeduction[];
    alternativeRegimes: AlternativeRegime[];
    /** Withholding the taxpayer sees but does not compute. Informational. */
    withholdingNote: string | null;
  };

  taxId: TaxIdSpec;
  documentRules: DocumentRules;
  periods: PeriodSpec;
  taxCodes: PackTaxCode[];

  /**
   * Every authority this rule set encodes, so a number can be traced to a law.
   *
   * Not decoration. `docs/INDONESIA.md` §10 lists seven things that could not
   * be confirmed well enough to build on; when one of them resolves, this list
   * is what says which rule set fields have to move.
   */
  sources: { claim: string; authority: string; url: string }[];
}
