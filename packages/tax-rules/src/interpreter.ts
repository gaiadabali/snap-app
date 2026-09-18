/**
 * The engine. The only code here that computes anything.
 *
 * Rule sets are data; this file is the fixed evaluator that reads them. That split
 * is what lets tax rules update over the air without shipping a build, and
 * without downloading executable code — see `contract.ts`.
 *
 * Two properties hold for every function below and are worth stating once:
 *
 *  - **Pure.** Same rule set and same inputs, same result. No clock, no locale, no
 *    ambient state. Where a date is needed it is a parameter. This is what
 *    makes a stored figure replayable.
 *  - **Stamped.** Every result carries `rulesId` and `rulesVersion`. A number
 *    without the version of the law it was computed under is a number nobody
 *    can check later, and this codebase has a rule about that.
 */

import type {
  ConsumptionTaxSpec,
  CurrencySpec,
  PersonalAllowance,
  Rational,
  TaxRules,
} from './contract.js';
import {
  ZERO,
  add,
  applyRate,
  compare,
  formatLocalAmount,
  multiplyRational,
  reconcileTolerance,
  roundToCurrency,
  subtract,
} from './money.js';

/** Carried by every result so a figure can be traced to the law it used. */
export interface RulesStamp {
  rulesId: string;
  rulesVersion: string;
  taxYear: string;
}

function stamp(rules: TaxRules): RulesStamp {
  return { rulesId: rules.id, rulesVersion: rules.version, taxYear: rules.taxYear };
}

/* ── Consumption tax ───────────────────────────────────────────────────────── */

export interface ConsumptionTaxResult extends RulesStamp {
  /** What the tax is called locally: `PPN`, `GST`. */
  name: string;
  /** Tax contained in the inclusive amount, as a decimal string. */
  taxAmount: string;
  /** The amount less the tax. NOT necessarily the base the document prints. */
  netAmount: string;
  /**
   * The base the DOCUMENT states, where the jurisdiction reduces it.
   *
   * Indonesia prints a DPP of 11/12 of the price and a 12% rate. So this is
   * NOT `inclusive - tax`, and the difference is the whole point:
   * `docs/INDONESIA.md` §2.3 verified that `taxable + tax != inclusive` under
   * DPP Nilai Lain. A caller writing the document's own figures into
   * `document_tax_subtotals` wants this; a caller computing what was spent
   * wants `netAmount`. Returning both is the only way neither is guessed.
   */
  documentBase: string;
  /**
   * False when the taxpayer cannot recover this tax.
   *
   * When false the figure is an ANALYTIC — what they paid — and must never be
   * presented as a credit, a claim or a return line.
   */
  recoverable: boolean;
}

/**
 * The tax inside a tax-inclusive total.
 *
 * Replaces `gstFromInclusive`, whose `1/11` was the jurisdiction hardcoded into
 * a constant. Here the fraction comes from the rule set: Australia 1/11, Indonesia
 * 11/111, Indonesian luxury 3/28.
 */
export function taxFromInclusive(rules: TaxRules, inclusive: string): ConsumptionTaxResult {
  const ct = rules.consumptionTax;
  const taxAmount = applyRate(inclusive, ct.inclusiveFraction, rules.currency);
  const netAmount = subtract(inclusive, taxAmount);

  // The document's stated base: net x baseFraction. Equal to netAmount wherever
  // baseFraction is 1/1, which is every jurisdiction that does not do what
  // PMK 131/2024 does.
  const documentBase = applyRate(netAmount, ct.baseFraction, rules.currency);

  return {
    ...stamp(rules),
    name: ct.name,
    taxAmount,
    netAmount,
    documentBase,
    recoverable: ct.recoverable,
  };
}

/** Consumption tax added to a tax-EXCLUSIVE price. The inverse of the above. */
export function taxOnSale(rules: TaxRules, exclusive: string): ConsumptionTaxResult {
  const ct = rules.consumptionTax;
  // Effective rate = statutory x base. Indonesia: 12/100 x 11/12 = 11/100.
  const effective = multiplyRational(ct.statutoryRate, ct.baseFraction);
  const taxAmount = applyRate(exclusive, effective, rules.currency);
  const documentBase = applyRate(exclusive, ct.baseFraction, rules.currency);

  return {
    ...stamp(rules),
    name: ct.name,
    taxAmount,
    netAmount: roundToCurrency(exclusive, rules.currency),
    documentBase,
    recoverable: ct.recoverable,
  };
}

/**
 * Does a stated tax figure agree with what the rule set says it should be?
 *
 * Returns the drift and whether it is tolerable, rather than a boolean, because
 * the caller shows a person the gap. Tolerance comes from the currency: five
 * till increments, which is 5 cents in Australia and Rp 500 in Indonesia —
 * `docs/INDONESIA.md` §7.2 found that literal being a dollar amount.
 */
export function checkStatedTax(
  rules: TaxRules,
  inclusive: string,
  statedTax: string,
): { expected: string; drift: string; withinTolerance: boolean; tolerance: string } {
  const { taxAmount: expected } = taxFromInclusive(rules, inclusive);
  const raw = subtract(statedTax, expected);
  const drift = compare(raw, ZERO) < 0 ? subtract(ZERO, raw) : raw;
  const tolerance = reconcileTolerance(rules.currency);
  return { expected, drift, withinTolerance: compare(drift, tolerance) <= 0, tolerance };
}

/**
 * Could this tax line be a DIFFERENT tax that merely looks like the main one?
 *
 * Exists entirely because of PB1. `docs/INDONESIA.md` §5: an Indonesian
 * restaurant bill prints a 10% regional tax one line from where PPN would
 * print, at a rate close enough to 11% that a loose check passes on small
 * amounts, and it is never recoverable. Australia has no second 10% tax on a
 * docket, so `otherTaxes` is empty there and this returns nothing.
 *
 * Returns candidates for a human, never a verdict. The rate is set by each
 * regency, so the app cannot assert which tax it is looking at — only that
 * there is more than one thing it could be.
 */
export function confusableTaxes(
  rules: TaxRules,
  tokensOnDocument: string[],
): { code: string; name: string; recoverable: boolean; why: string }[] {
  const seen = tokensOnDocument.map((t) => t.toUpperCase());
  return rules.otherTaxes
    .filter((t) => t.documentTokens.some((tok) => seen.includes(tok.toUpperCase())))
    .map((t) => ({
      code: t.code,
      name: t.name,
      recoverable: t.recoverable,
      why: t.confusableWith,
    }));
}

/* ── Income tax ────────────────────────────────────────────────────────────── */

/** Household status, which is what a personal allowance varies by. */
export interface HouseholdStatus {
  married: boolean;
  dependants: number;
  /** A spouse's income reported on this return. Indonesia's K/I statuses. */
  spouseIncomeCombined?: boolean;
}

/**
 * The tax-free allowance for a household.
 *
 * Indonesia's PTKP: 54,000,000 for a single taxpayer, +4,500,000 married,
 * +4,500,000 per dependant to a maximum of three. Dependants above the maximum
 * are silently capped rather than rejected — a taxpayer with four children has
 * four children, and the statutory limit is on what may be *counted*.
 */
export function personalAllowance(rules: TaxRules, status: HouseholdStatus): {
  amount: string;
  breakdown: { label: string; amount: string }[];
  code: string;
  dependantsCounted: number;
} {
  const a: PersonalAllowance = rules.incomeTax.allowance;
  const counted = Math.min(Math.max(0, Math.trunc(status.dependants)), a.maxDependants);

  const breakdown = [{ label: 'Base', amount: String(a.base) }];
  let total = String(a.base);

  if (status.married) {
    breakdown.push({ label: 'Married', amount: String(a.marriedAddition) });
    total = add(total, String(a.marriedAddition));
  }
  if (counted > 0) {
    const dep = String(a.dependantAddition * counted);
    breakdown.push({ label: `Dependants (${counted})`, amount: dep });
    total = add(total, dep);
  }
  if (status.spouseIncomeCombined && a.combinedSpouseAddition != null) {
    breakdown.push({ label: "Spouse's income combined", amount: String(a.combinedSpouseAddition) });
    total = add(total, String(a.combinedSpouseAddition));
  }

  return {
    code: a.code,
    amount: roundToCurrency(total, rules.currency),
    breakdown,
    dependantsCounted: counted,
  };
}

/**
 * The standard deduction against an income type, with its cap applied.
 *
 * Indonesia's biaya jabatan is 5% of gross capped at 6,000,000 a year. `months`
 * lets a part-year be computed against the monthly cap instead — a taxpayer
 * employed for four months is capped at 4 x 500,000, not at the annual figure.
 */
export function standardDeduction(
  rules: TaxRules,
  code: string,
  grossIncome: string,
  months = 12,
): { code: string; label: string; amount: string; capped: boolean } | null {
  const d = rules.incomeTax.standardDeductions.find((x) => x.code === code);
  if (!d) return null;

  const raw = applyRate(grossIncome, d.rate, rules.currency);

  let cap: string | null = null;
  if (months >= 12 && d.annualCap != null) {
    cap = String(d.annualCap);
  } else if (d.monthlyCap != null) {
    cap = String(d.monthlyCap * Math.max(0, Math.trunc(months)));
  } else if (d.annualCap != null) {
    cap = String(d.annualCap);
  }

  const capped = cap != null && compare(raw, cap) > 0;
  return {
    code: d.code,
    label: d.label,
    amount: capped ? roundToCurrency(cap!, rules.currency) : raw,
    capped,
  };
}

export interface BracketSlice {
  from: string;
  to: string | null;
  rate: Rational;
  taxableInBand: string;
  taxInBand: string;
}

export interface IncomeTaxResult extends RulesStamp {
  grossIncome: string;
  deductions: { code: string; label: string; amount: string }[];
  netIncome: string;
  allowance: string;
  /** Income actually taxed: net less allowance, floored at zero. */
  taxableIncome: string;
  taxPayable: string;
  slices: BracketSlice[];
  /** Tax over gross, as a percentage string to 2dp. For display only. */
  effectiveRatePercent: string;
  currency: CurrencySpec;
}

/**
 * Progressive income tax on the ordinary scale.
 *
 * Indonesia: gross, less biaya jabatan, less PTKP, through 5/15/25/30/35 at
 * 60m/250m/500m/5bn. The bands are cumulative — each slice is taxed at its own
 * rate, which is the part people get wrong by applying one rate to the whole
 * amount.
 *
 * `taxableIncome` floors at zero. Income below the allowance is not negative
 * income; it is no tax.
 */
export function incomeTax(
  rules: TaxRules,
  input: {
    grossIncome: string;
    status: HouseholdStatus;
    /** Deduction codes to apply, in order. */
    deductionCodes?: string[];
    /** Months of the year the income covers, for monthly-capped deductions. */
    months?: number;
  },
): IncomeTaxResult {
  const months = input.months ?? 12;

  const deductions: { code: string; label: string; amount: string }[] = [];
  let net = roundToCurrency(input.grossIncome, rules.currency);

  for (const code of input.deductionCodes ?? []) {
    const d = standardDeduction(rules, code, input.grossIncome, months);
    if (!d) continue;
    deductions.push({ code: d.code, label: d.label, amount: d.amount });
    net = subtract(net, d.amount);
  }
  if (compare(net, ZERO) < 0) net = ZERO;

  const allowance = personalAllowance(rules, input.status);
  let taxable = subtract(net, allowance.amount);
  if (compare(taxable, ZERO) < 0) taxable = ZERO;

  const { taxPayable, slices } = applyBrackets(rules, taxable);

  return {
    ...stamp(rules),
    grossIncome: roundToCurrency(input.grossIncome, rules.currency),
    deductions,
    netIncome: net,
    allowance: allowance.amount,
    taxableIncome: taxable,
    taxPayable,
    slices,
    effectiveRatePercent: percentOf(taxPayable, input.grossIncome),
    currency: rules.currency,
  };
}

/** Walk the bands, taxing each slice at its own rate. */
function applyBrackets(rules: TaxRules, taxable: string): { taxPayable: string; slices: BracketSlice[] } {
  const slices: BracketSlice[] = [];
  let tax = ZERO;
  let floor = 0;

  for (const b of rules.incomeTax.brackets) {
    const ceiling = b.upTo;
    const bandTop = ceiling === null ? null : String(ceiling);
    const floorStr = String(floor);

    // How much of `taxable` falls inside this band.
    const remaining = subtract(taxable, floorStr);
    if (compare(remaining, ZERO) <= 0) break;

    const bandWidth = ceiling === null ? remaining : subtract(String(ceiling), floorStr);
    const inBand = compare(remaining, bandWidth) < 0 ? remaining : bandWidth;
    const taxInBand = applyRate(inBand, b.rate, rules.currency);

    slices.push({
      from: floorStr,
      to: bandTop,
      rate: b.rate,
      taxableInBand: inBand,
      taxInBand,
    });
    tax = add(tax, taxInBand);

    if (ceiling === null) break;
    floor = ceiling;
  }

  return { taxPayable: roundToCurrency(tax, rules.currency), slices };
}

/* ── Alternative regimes ───────────────────────────────────────────────────── */

export interface AlternativeRegimeResult extends RulesStamp {
  code: string;
  label: string;
  eligible: boolean;
  /** Why not, when `eligible` is false. */
  ineligibleReason: string | null;
  taxPayable: string | null;
  /** True when electing this regime removes expense deductions entirely. */
  deductionsAllowed: boolean;
  /**
   * The sentence the UI should show a user on this regime.
   *
   * `docs/INDONESIA.md` §1: under PP 23 an expense has no tax effect at all.
   * A tracker that keeps offering to categorise deductions to such a user is
   * lying by implication, so the engine says it outright.
   */
  note: string;
  authority: string;
}

/**
 * Tax under an elected alternative regime.
 *
 * `deemedProfitPercent` is required for a deemed-profit regime and supplied per
 * taxpayer, because NPPN's percentage varies by occupation and region
 * (PER-17/PJ/2015) and no single number could live in the rule set.
 */
export function alternativeRegime(
  rules: TaxRules,
  code: string,
  input: { turnover: string; status?: HouseholdStatus; deemedProfitPercent?: number },
): AlternativeRegimeResult | null {
  const r = rules.incomeTax.alternativeRegimes.find((x) => x.code === code);
  if (!r) return null;

  const base = {
    ...stamp(rules),
    code: r.code,
    label: r.label,
    deductionsAllowed: r.deductionsAllowed,
    authority: r.authority,
  };

  if (r.turnoverCeiling != null && compare(input.turnover, String(r.turnoverCeiling)) > 0) {
    return {
      ...base,
      eligible: false,
      ineligibleReason:
        `Turnover exceeds the ${formatLocalAmount(String(r.turnoverCeiling), rules.currency)} ` +
        `ceiling for ${r.label}.`,
      taxPayable: null,
      note: `Turnover is above the ceiling, so ${r.label} is not available for this year.`,
    };
  }

  if (r.kind === 'final_on_turnover') {
    // The exempt slice comes off first. Indonesia: the first Rp 500m of annual
    // turnover bears no tax, and 0.5% applies only above it.
    let taxedTurnover = subtract(input.turnover, String(r.exemptTurnover));
    if (compare(taxedTurnover, ZERO) < 0) taxedTurnover = ZERO;
    const taxPayable = applyRate(taxedTurnover, r.rate!, rules.currency);

    return {
      ...base,
      eligible: true,
      ineligibleReason: null,
      taxPayable,
      note: r.deductionsAllowed
        ? `${r.label} is calculated on turnover.`
        : `${r.label} is a FINAL tax on turnover. Expenses do not reduce it — categorising ` +
          `receipts has no effect on what is owed. Records are still worth keeping for ` +
          `spending visibility and because they must be retained for ` +
          `${rules.documentRules.retentionYears} years.`,
    };
  }

  // Deemed profit: net income is a published percentage of turnover, then the
  // ordinary scale applies to that.
  if (input.deemedProfitPercent == null) {
    return {
      ...base,
      eligible: false,
      ineligibleReason:
        `${r.label} needs the published rate for this occupation and region, which varies ` +
        `and is not carried in the rules.`,
      taxPayable: null,
      note: `Supply the ${r.label} percentage for the taxpayer's occupation to compute this.`,
    };
  }

  const deemedNet = applyRate(
    input.turnover,
    { n: Math.round(input.deemedProfitPercent * 100), d: 10_000 },
    rules.currency,
  );
  const allowance = personalAllowance(rules, input.status ?? { married: false, dependants: 0 });
  let taxable = subtract(deemedNet, allowance.amount);
  if (compare(taxable, ZERO) < 0) taxable = ZERO;
  const { taxPayable } = applyBrackets(rules, taxable);

  return {
    ...base,
    eligible: true,
    ineligibleReason: null,
    taxPayable,
    note:
      `Net income is deemed to be ${input.deemedProfitPercent}% of turnover under ${r.label}; ` +
      `actual expenses are not deducted.` +
      (r.electionDeadline ? ` Election deadline: ${r.electionDeadline}.` : ''),
  };
}

/* ── The spending analytic ─────────────────────────────────────────────────── */

export interface ConsumptionTaxPaid extends RulesStamp {
  name: string;
  /** Total spent, tax inclusive. */
  grossSpend: string;
  /** Consumption tax contained in it. */
  taxPaid: string;
  /** Spend on exempt supplies, which carried no tax. */
  exemptSpend: string;
  /** Tax that was a DIFFERENT tax — PB1 and the like. Never recoverable. */
  otherTaxPaid: string;
  recoverable: boolean;
  /**
   * What this figure is, in one sentence, for the UI to print verbatim.
   *
   * Not decoration. When `recoverable` is false this figure is a spending
   * analytic, and a screen that shows it next to a "claim" affordance has
   * made a factual error about the user's tax position. The engine supplies
   * the wording so the surface cannot drift from the law.
   */
  disclosure: string;
}

/**
 * How much consumption tax a person paid over a set of documents.
 *
 * For a personal taxpayer this is a **spending analytic and nothing else** —
 * there is no credit, no claim and no return. `docs/INDONESIA.md` §4.3. The
 * result says so in `disclosure` rather than leaving the caller to remember.
 */
export function consumptionTaxPaid(
  rules: TaxRules,
  lines: { inclusiveAmount: string; exempt?: boolean; otherTaxAmount?: string }[],
): ConsumptionTaxPaid {
  const ct: ConsumptionTaxSpec = rules.consumptionTax;

  let gross = ZERO;
  let taxable = ZERO;
  let exempt = ZERO;
  let other = ZERO;

  for (const l of lines) {
    gross = add(gross, l.inclusiveAmount);
    if (l.exempt) exempt = add(exempt, l.inclusiveAmount);
    else taxable = add(taxable, l.inclusiveAmount);
    if (l.otherTaxAmount) other = add(other, l.otherTaxAmount);
  }

  const taxPaid = applyRate(taxable, ct.inclusiveFraction, rules.currency);

  return {
    ...stamp(rules),
    name: ct.name,
    grossSpend: roundToCurrency(gross, rules.currency),
    taxPaid,
    exemptSpend: roundToCurrency(exempt, rules.currency),
    otherTaxPaid: roundToCurrency(other, rules.currency),
    recoverable: ct.recoverable,
    // One source for the wording — see consumptionTaxDisclosure below.
    disclosure: consumptionTaxDisclosure(rules),
  };
}

/**
 * The sentence that says what a consumption-tax total IS.
 *
 * Exported separately so a caller that aggregates from its own ledger — rather
 * than from a list of lines — still gets the wording from the engine. Two
 * places writing this sentence is how a screen ends up offering to "claim"
 * a figure that cannot be claimed, and the law is what decides the wording,
 * not the surface.
 */
export function consumptionTaxDisclosure(rules: TaxRules): string {
  const ct = rules.consumptionTax;
  return ct.recoverable
    ? `${ct.name} you may be able to recover, subject to holding valid evidence for each purchase.`
    : `${ct.name} you paid. This is a record of spending, not a claim — it cannot be ` +
        `recovered or reported on a return, and no filing arises from it.`;
}

/* ── Document rules ────────────────────────────────────────────────────────── */

/**
 * Is this tax id well-formed, and how strongly do we actually know?
 *
 * `confidence` is the honest part. Australia's ABN carries a modulus-89 check,
 * so a bad digit is *detected*. An Indonesian individual's NPWP is their NIK,
 * which has no checksum, so the strongest available answer is "the right number
 * of digits" — `docs/INDONESIA.md` §3.2. A reader that reported both as
 * "valid" would be implying a check it never performed.
 */
export function checkTaxId(
  rules: TaxRules,
  value: string | null | undefined,
): { ok: boolean; confidence: 'checksum' | 'length_only' | 'unverified_checksum'; message: string } {
  const spec = rules.taxId;
  if (!value) {
    return { ok: false, confidence: 'length_only', message: `No ${spec.name} was found.` };
  }
  const digits = value.replace(/\D/g, '');

  if (!spec.lengths.includes(digits.length)) {
    return {
      ok: false,
      confidence: 'length_only',
      message: `A ${spec.name} has ${spec.lengths.join(' or ')} digits; this has ${digits.length}. ${spec.format}`,
    };
  }

  if (spec.checksum === null) {
    return {
      ok: true,
      confidence: 'length_only',
      // Says what was NOT checked, which is the useful half.
      message: `${digits.length} digits, as expected. ${spec.name} carries no checksum, so a misread digit cannot be detected here.`,
    };
  }

  const passes = spec.checksum === 'abn_mod89' ? abnMod89(digits) : luhn10(digits);
  if (!passes) {
    return {
      ok: false,
      confidence: spec.checksumUnverified ? 'unverified_checksum' : 'checksum',
      message: spec.checksumUnverified
        ? `This ${spec.name} fails a checksum whose algorithm is not fully confirmed, so treat the result as a hint.`
        : `This ${spec.name} fails its checksum, so at least one digit was misread.`,
    };
  }
  return {
    ok: true,
    confidence: spec.checksumUnverified ? 'unverified_checksum' : 'checksum',
    message: `${spec.name} passes its checksum.`,
  };
}

function abnMod89(digits: string): boolean {
  if (digits.length !== 11) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = digits
    .split('')
    .map(Number)
    .reduce((acc, n, i) => acc + (i === 0 ? n - 1 : n) * w[i]!, 0);
  return sum % 89 === 0;
}

function luhn10(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * The reporting period an ISO date falls in, as the rule set defines periods.
 *
 * Replaces `quarterOf`, which was Australian quarters compiled into a function.
 * This is also the day/month ambiguity tie-breaker, and the consequence is
 * worth knowing: under `monthly` periods every ambiguous pair lands in a
 * different period, so a reader using this to decide whether to interrupt will
 * interrupt far more often than under `quarterly`. `docs/INDONESIA.md` §6.1.
 */
export function periodOf(rules: TaxRules, iso: string): string {
  const [y, m] = iso.split('-');
  const year = Number(y);
  const month = Number(m);
  const start = rules.periods.taxYearStartMonth;

  switch (rules.periods.consumptionTaxPeriod) {
    case 'monthly':
      return `${y}-${m}`;
    case 'quarterly': {
      // Quarters run from the tax year's start month, not from January.
      const offset = (month - start + 12) % 12;
      const fyYear = month >= start ? year + 1 : year;
      return `${fyYear}-Q${Math.floor(offset / 3) + 1}`;
    }
    case 'annual':
    case 'none': {
      const fyYear = start === 1 ? year : month >= start ? year + 1 : year;
      return String(fyYear);
    }
  }
}

/** Is a document date plausible for this jurisdiction's retention rules? */
export function datePlausible(
  rules: TaxRules,
  iso: string,
  today: string,
): { ok: boolean; reason: string | null } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { ok: false, reason: `"${iso}" is not a calendar date.` };
  }
  if (iso > today) {
    return { ok: false, reason: `${iso} is in the future.` };
  }
  const [y, m, d] = today.split('-').map(Number);
  const floor = `${y! - rules.documentRules.plausibleAgeYears}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (iso < floor) {
    return {
      ok: false,
      reason:
        `${iso} is more than ${rules.documentRules.plausibleAgeYears} years ago. Records must be ` +
        `kept ${rules.documentRules.retentionYears} years here, so this is more likely a misread ` +
        `two-digit year.`,
    };
  }
  return { ok: true, reason: null };
}

/* ── Statements ────────────────────────────────────────────────────────────── */

/**
 * Whole calendar days from `fromIso` to `toIso` (both `YYYY-MM-DD`), signed —
 * negative when `toIso` is earlier. `Date.UTC` rather than string arithmetic:
 * a calendar-day count has to cross month and leap-year boundaries correctly,
 * which `datePlausible`'s style of splitting and comparing strings above does
 * not attempt because it never needs to. Deterministic and timezone-free
 * because both inputs are date-only and every conversion happens at UTC
 * midnight, never the process's local zone.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const toEpochDay = (iso: string): number => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d); // Date.UTC's month is 0-indexed; iso's is not.
  };
  return Math.round((toEpochDay(toIso) - toEpochDay(fromIso)) / 86_400_000);
}

/**
 * Did a statement line clear within the jurisdiction's ordinary posting-lag
 * window (`rules.statementRules.postingLagDays`)?
 *
 * `docs/STATEMENTS.md` §5.3.1 (Lane R, R5c): this is a LABEL on a match
 * candidate, read for display, never a filter — a candidate outside the
 * window is still shown, just not marked as ordinary. The window itself is
 * not a threshold this function invents; it is `S4`'s field, read here for
 * the first time. The caller decides what to do when no rule set is
 * installed at all (`reconciliation/matcher.ts`): this function requires a
 * `TaxRules`, so "no engine" is the caller's `null`, not a fallback baked in
 * here — the same discipline every other function in this file follows.
 */
export function withinPostingLag(rules: TaxRules, issued: string, posted: string): boolean {
  const gapDays = daysBetween(issued, posted);
  const { min, max } = rules.statementRules.postingLagDays;
  return gapDays >= min && gapDays <= max;
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

function percentOf(part: string, whole: string): string {
  const w = Number(whole);
  if (!Number.isFinite(w) || w === 0) return '0.00';
  return ((Number(part) / w) * 100).toFixed(2);
}
