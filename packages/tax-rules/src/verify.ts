/**
 * Refuse a rule set rather than half-apply one.
 *
 * README principle 4: *fail closed. An unreadable expiry, a missing database in
 * CI, a local KMS in production: refuse. Never treat "unknown" as "fine".*
 *
 * A rule set is downloaded, so this is the boundary where untrusted data becomes
 * something the app computes tax with. Everything here returns a reason rather
 * than a boolean, because "this rule set is invalid" is not actionable and
 * "`incomeTax.brackets[2]` is not ascending" is.
 *
 * The rule that shapes the whole file: **there is no partial acceptance.** A
 * rule set with one bad bracket is not a rule set with four good ones — it is refused,
 * and the app keeps running on whatever was already installed, or on nothing.
 * A jurisdiction applied halfway is worse than a jurisdiction refused, because
 * nothing about a running system looks different when it is wrong.
 */

import type { PackTaxCode, Rational, TaxBracket, TaxRules } from './contract.js';
import { inclusiveOf, multiplyRational, rationalToString, rationalsEqual } from './money.js';

export interface RulesProblem {
  /** Dotted path into the rules, e.g. `incomeTax.brackets[2].upTo`. */
  path: string;
  message: string;
}

export class RulesRejected extends Error {
  readonly problems: RulesProblem[];
  constructor(rulesId: string, problems: RulesProblem[]) {
    super(
      `tax rules ${JSON.stringify(rulesId)} refused (${problems.length} problem${
        problems.length === 1 ? '' : 's'
      }):\n` + problems.map((p) => `  ${p.path}: ${p.message}`).join('\n'),
    );
    this.name = 'RulesRejected';
    this.problems = problems;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Check a rule set completely and return every problem found.
 *
 * Every problem, not the first — a rule set author fixing one field at a time
 * through five reinstalls is how a rate typo survives to production.
 */
export function inspectRules(rules: unknown): RulesProblem[] {
  const p: RulesProblem[] = [];
  if (typeof rules !== 'object' || rules === null) {
    return [{ path: '', message: 'a rule set must be an object' }];
  }
  const k = rules as Partial<TaxRules>;

  /* ── Identity ─────────────────────────────────────────────────────────── */
  if (!k.id || typeof k.id !== 'string') {
    p.push({ path: 'id', message: 'required, non-empty string' });
  }
  if (!k.country || !/^[A-Z]{2}$/.test(k.country)) {
    p.push({ path: 'country', message: 'required, ISO 3166-1 alpha-2 uppercase' });
  }
  if (!k.countryName) p.push({ path: 'countryName', message: 'required' });
  if (!k.version || typeof k.version !== 'string') {
    // Load-bearing for replay: a result stores this, so a rule set without a
    // version produces history that cannot be re-derived.
    p.push({
      path: 'version',
      message: 'required — results store it so they can be replayed (README principle 2)',
    });
  }
  if (!k.taxYear) p.push({ path: 'taxYear', message: 'required' });
  if (!k.effectiveFrom || !ISO_DATE.test(k.effectiveFrom)) {
    p.push({ path: 'effectiveFrom', message: 'required, YYYY-MM-DD' });
  }
  if (k.effectiveTo != null && !ISO_DATE.test(k.effectiveTo)) {
    p.push({ path: 'effectiveTo', message: 'must be YYYY-MM-DD or null' });
  }
  if (k.effectiveFrom && k.effectiveTo && k.effectiveFrom > k.effectiveTo) {
    p.push({ path: 'effectiveTo', message: 'must not precede effectiveFrom' });
  }
  if (k.scope !== 'personal' && k.scope !== 'business') {
    p.push({ path: 'scope', message: "must be 'personal' or 'business'" });
  }
  if (k.id && k.country && !k.id.startsWith(`${k.country.toLowerCase()}-`)) {
    p.push({ path: 'id', message: `must start with "${k.country.toLowerCase()}-"` });
  }

  /* ── Currency ─────────────────────────────────────────────────────────── */
  const c = k.currency;
  if (!c) {
    p.push({ path: 'currency', message: 'required' });
  } else {
    if (!/^[A-Z]{3}$/.test(c.code ?? '')) {
      p.push({ path: 'currency.code', message: 'ISO 4217, three uppercase letters' });
    }
    if (!c.symbol) p.push({ path: 'currency.symbol', message: 'required' });
    if (!c.locale) p.push({ path: 'currency.locale', message: 'required' });
    if (!Number.isInteger(c.minorUnits) || c.minorUnits < 0 || c.minorUnits > 4) {
      p.push({ path: 'currency.minorUnits', message: 'integer 0..4' });
    }
    if (!c.thousandsSeparator || !c.decimalSeparator) {
      p.push({ path: 'currency', message: 'thousandsSeparator and decimalSeparator required' });
    } else if (c.thousandsSeparator === c.decimalSeparator) {
      // The §7.1 bug in one line: if these are equal, no parser can tell a
      // grouped number from a decimal one.
      p.push({
        path: 'currency',
        message: 'thousandsSeparator and decimalSeparator must differ, or amounts are ambiguous',
      });
    }
    if (!Number.isInteger(c.tillRounding) || c.tillRounding < 1) {
      p.push({ path: 'currency.tillRounding', message: 'positive integer, in minor units' });
    }
  }

  /* ── Consumption tax, and the agreement between its three statements ──── */
  const ct = k.consumptionTax;
  if (!ct) {
    p.push({ path: 'consumptionTax', message: 'required' });
  } else {
    if (!ct.name) p.push({ path: 'consumptionTax.name', message: 'required' });
    p.push(...checkRational(ct.statutoryRate, 'consumptionTax.statutoryRate'));
    p.push(...checkRational(ct.baseFraction, 'consumptionTax.baseFraction'));
    p.push(...checkRational(ct.inclusiveFraction, 'consumptionTax.inclusiveFraction'));

    if (
      isRational(ct.statutoryRate) &&
      isRational(ct.baseFraction) &&
      isRational(ct.inclusiveFraction)
    ) {
      // The whole reason inclusiveFraction is declared rather than derived:
      // two statements of one fact, checked against each other. Indonesia:
      // 12/100 x 11/12 = 11/100, and 11/100 inclusive is 11/111.
      const effective = multiplyRational(ct.statutoryRate, ct.baseFraction);
      const expected = inclusiveOf(effective);
      if (!rationalsEqual(expected, ct.inclusiveFraction)) {
        p.push({
          path: 'consumptionTax.inclusiveFraction',
          message:
            `states ${rationalToString(ct.inclusiveFraction)}, but statutoryRate x ` +
            `baseFraction = ${rationalToString(effective)} implies ` +
            `${rationalToString(expected)}. One of the three is wrong.`,
        });
      }
    }
    if (typeof ct.recoverable !== 'boolean') {
      p.push({ path: 'consumptionTax.recoverable', message: 'required boolean' });
    }
    // A personal taxpayer does not recover consumption tax in either
    // jurisdiction this contract was written against. Asserted rather than
    // assumed, because getting it wrong turns an analytic into a claim.
    if (k.scope === 'personal' && ct.recoverable === true) {
      p.push({
        path: 'consumptionTax.recoverable',
        message:
          'a personal rules must not mark consumption tax recoverable — recovery ' +
          'requires registration (GST) or PKP status (PPN)',
      });
    }
    if (!Array.isArray(ct.exemptCategories)) {
      p.push({ path: 'consumptionTax.exemptCategories', message: 'required array' });
    }
  }

  /* ── Other taxes ──────────────────────────────────────────────────────── */
  if (!Array.isArray(k.otherTaxes)) {
    p.push({ path: 'otherTaxes', message: 'required array (empty is fine)' });
  } else {
    k.otherTaxes.forEach((t, i) => {
      if (!t.code) p.push({ path: `otherTaxes[${i}].code`, message: 'required' });
      p.push(...checkRational(t.maxRate, `otherTaxes[${i}].maxRate`));
      if (t.levy !== 'national' && t.levy !== 'regional') {
        p.push({ path: `otherTaxes[${i}].levy`, message: "'national' or 'regional'" });
      }
      if (!t.confusableWith) {
        // The field exists to be shown to a reviewer. An empty one is a tax
        // the app knows is confusable and will not say why.
        p.push({
          path: `otherTaxes[${i}].confusableWith`,
          message: 'required — a non-recoverable tax that prints like the main one must explain itself',
        });
      }
    });
  }

  /* ── Income tax ───────────────────────────────────────────────────────── */
  const it = k.incomeTax;
  if (!it) {
    p.push({ path: 'incomeTax', message: 'required' });
  } else {
    p.push(...checkBrackets(it.brackets));

    const a = it.allowance;
    if (!a) {
      p.push({ path: 'incomeTax.allowance', message: 'required' });
    } else {
      for (const f of ['base', 'marriedAddition', 'dependantAddition'] as const) {
        if (!Number.isFinite(a[f]) || a[f] < 0) {
          p.push({ path: `incomeTax.allowance.${f}`, message: 'non-negative number' });
        }
      }
      if (!Number.isInteger(a.maxDependants) || a.maxDependants < 0) {
        p.push({ path: 'incomeTax.allowance.maxDependants', message: 'non-negative integer' });
      }
      if (!a.authority) {
        p.push({ path: 'incomeTax.allowance.authority', message: 'required — a number needs a law' });
      }
    }

    if (!Array.isArray(it.standardDeductions)) {
      p.push({ path: 'incomeTax.standardDeductions', message: 'required array' });
    } else {
      it.standardDeductions.forEach((d, i) => {
        p.push(...checkRational(d.rate, `incomeTax.standardDeductions[${i}].rate`));
        if (d.annualCap != null && d.monthlyCap != null && d.monthlyCap * 12 !== d.annualCap) {
          // Indonesia's biaya jabatan states both, and 500,000 x 12 is exactly
          // 6,000,000. A rule set where they disagree is a rule set whose cap depends
          // on which field the caller happened to read.
          p.push({
            path: `incomeTax.standardDeductions[${i}]`,
            message: `monthlyCap x 12 (${d.monthlyCap * 12}) does not equal annualCap (${d.annualCap})`,
          });
        }
        if (!d.authority) {
          p.push({ path: `incomeTax.standardDeductions[${i}].authority`, message: 'required' });
        }
      });
    }

    if (!Array.isArray(it.alternativeRegimes)) {
      p.push({ path: 'incomeTax.alternativeRegimes', message: 'required array' });
    } else {
      it.alternativeRegimes.forEach((r, i) => {
        const at = `incomeTax.alternativeRegimes[${i}]`;
        if (r.kind === 'final_on_turnover') {
          if (!isRational(r.rate)) {
            p.push({ path: `${at}.rate`, message: 'a final-on-turnover regime must state its rate' });
          } else {
            p.push(...checkRational(r.rate, `${at}.rate`));
          }
        } else if (r.kind === 'deemed_profit') {
          // NPPN's percentage is per-occupation and per-region. A single rate
          // here would be a fiction, so null is the correct value and a
          // non-null one is the error.
          if (r.rate != null) {
            p.push({
              path: `${at}.rate`,
              message: 'a deemed-profit regime varies by occupation and region; rate must be null',
            });
          }
        } else {
          p.push({ path: `${at}.kind`, message: "'final_on_turnover' or 'deemed_profit'" });
        }
        if (!r.authority) p.push({ path: `${at}.authority`, message: 'required' });
      });
    }
  }

  /* ── Tax id ───────────────────────────────────────────────────────────── */
  const t = k.taxId;
  if (!t) {
    p.push({ path: 'taxId', message: 'required' });
  } else {
    if (!t.name) p.push({ path: 'taxId.name', message: 'required' });
    if (!Array.isArray(t.lengths) || t.lengths.length === 0) {
      p.push({ path: 'taxId.lengths', message: 'at least one accepted digit length' });
    }
    const known = ['abn_mod89', 'luhn10'];
    if (t.checksum != null && !known.includes(t.checksum)) {
      // A rule set naming an algorithm the interpreter does not implement would
      // otherwise silently perform no check at all.
      p.push({
        path: 'taxId.checksum',
        message: `unknown algorithm ${JSON.stringify(t.checksum)}; the interpreter implements ${known.join(', ')}`,
      });
    }
    if (t.checksum == null && t.checksumUnverified === true) {
      p.push({
        path: 'taxId.checksumUnverified',
        message: 'meaningless without a checksum — set checksum, or leave this false',
      });
    }
    if (!t.format) {
      p.push({ path: 'taxId.format', message: 'required — it is shown to a person as a fix hint' });
    }
  }

  /* ── Documents ────────────────────────────────────────────────────────── */
  const d = k.documentRules;
  if (!d) {
    p.push({ path: 'documentRules', message: 'required' });
  } else {
    if (typeof d.validityDecidableFromDocument !== 'boolean') {
      p.push({ path: 'documentRules.validityDecidableFromDocument', message: 'required boolean' });
    }
    if (!Number.isInteger(d.retentionYears) || d.retentionYears < 1) {
      p.push({ path: 'documentRules.retentionYears', message: 'positive integer' });
    }
    if (!Number.isInteger(d.plausibleAgeYears) || d.plausibleAgeYears < 1) {
      p.push({ path: 'documentRules.plausibleAgeYears', message: 'positive integer' });
    }
    if (
      Number.isInteger(d.retentionYears) &&
      Number.isInteger(d.plausibleAgeYears) &&
      d.plausibleAgeYears < d.retentionYears
    ) {
      // Rejecting a document the taxpayer is still legally required to hold.
      p.push({
        path: 'documentRules.plausibleAgeYears',
        message:
          `${d.plausibleAgeYears} is less than retentionYears ${d.retentionYears} — the reader ` +
          'would refuse documents the taxpayer must still keep',
      });
    }
    if (d.dateOrder !== 'day_first' && d.dateOrder !== 'month_first') {
      p.push({ path: 'documentRules.dateOrder', message: "'day_first' or 'month_first'" });
    }
    if (!Array.isArray(d.monthAbbreviations) || d.monthAbbreviations.length !== 12) {
      p.push({ path: 'documentRules.monthAbbreviations', message: 'exactly 12 entries' });
    }
  }

  /* ── Periods ──────────────────────────────────────────────────────────── */
  const pr = k.periods;
  if (!pr) {
    p.push({ path: 'periods', message: 'required' });
  } else {
    const periods = ['monthly', 'quarterly', 'annual', 'none'];
    if (!periods.includes(pr.consumptionTaxPeriod)) {
      p.push({ path: 'periods.consumptionTaxPeriod', message: periods.join(' | ') });
    }
    if (!Number.isInteger(pr.taxYearStartMonth) || pr.taxYearStartMonth < 1 || pr.taxYearStartMonth > 12) {
      p.push({ path: 'periods.taxYearStartMonth', message: 'integer 1..12' });
    }
    if (!pr.annualReturnName) {
      p.push({ path: 'periods.annualReturnName', message: 'required' });
    }
    // A rule set that says the tax is not recoverable but also says there is a
    // filing period for it is describing two different taxpayers.
    if (ct && ct.recoverable === false && pr.consumptionTaxPeriod !== 'none') {
      p.push({
        path: 'periods.consumptionTaxPeriod',
        message:
          `must be 'none' when consumptionTax.recoverable is false — a taxpayer who cannot ` +
          `recover the tax does not file a return for it`,
      });
    }
  }

  /* ── Tax codes ────────────────────────────────────────────────────────── */
  if (!Array.isArray(k.taxCodes) || k.taxCodes.length === 0) {
    p.push({ path: 'taxCodes', message: 'at least one tax code' });
  } else {
    const seen = new Set<string>();
    k.taxCodes.forEach((tc: PackTaxCode, i) => {
      if (!tc.code) p.push({ path: `taxCodes[${i}].code`, message: 'required' });
      else if (seen.has(tc.code)) {
        p.push({ path: `taxCodes[${i}].code`, message: `duplicate code ${JSON.stringify(tc.code)}` });
      } else seen.add(tc.code);
      if (!tc.name) p.push({ path: `taxCodes[${i}].name`, message: 'required' });
      if (!Number.isFinite(tc.ratePercent) || tc.ratePercent < 0) {
        p.push({ path: `taxCodes[${i}].ratePercent`, message: 'non-negative number' });
      }
      if (!tc.note) {
        p.push({ path: `taxCodes[${i}].note`, message: 'required — it is shown in the category picker' });
      }
      // The cross-check that keeps five rows in step with one flag.
      if (tc.claimsCredit === true && ct && ct.recoverable === false) {
        p.push({
          path: `taxCodes[${i}].claimsCredit`,
          message:
            `cannot claim credit when consumptionTax.recoverable is false ` +
            `(code ${JSON.stringify(tc.code)})`,
        });
      }
    });
  }

  /* ── Sources ──────────────────────────────────────────────────────────── */
  if (!Array.isArray(k.sources) || k.sources.length === 0) {
    p.push({
      path: 'sources',
      message: 'required — every rate in a rule set must be traceable to an instrument',
    });
  } else {
    k.sources.forEach((s, i) => {
      if (!s.claim) p.push({ path: `sources[${i}].claim`, message: 'required' });
      if (!s.authority) p.push({ path: `sources[${i}].authority`, message: 'required' });
      if (!s.url) p.push({ path: `sources[${i}].url`, message: 'required' });
    });
  }

  return p;
}

/** Narrow unknown data to a rule set, or throw with every reason. */
export function assertRules(rules: unknown): TaxRules {
  const problems = inspectRules(rules);
  if (problems.length > 0) {
    const id =
      typeof rules === 'object' && rules !== null && typeof (rules as TaxRules).id === 'string'
        ? (rules as TaxRules).id
        : '<unidentified>';
    throw new RulesRejected(id, problems);
  }
  return rules as TaxRules;
}

/**
 * Is this rule set valid for this date?
 *
 * Separate from shape validation because a structurally perfect rule set for 2024
 * is still the wrong rule set to compute 2026 with, and the failure mode is a
 * quietly wrong number rather than a crash.
 */
export function rulesCoverDate(rules: TaxRules, iso: string): boolean {
  if (!ISO_DATE.test(iso)) throw new Error(`not a date: ${JSON.stringify(iso)}`);
  if (iso < rules.effectiveFrom) return false;
  if (rules.effectiveTo != null && iso > rules.effectiveTo) return false;
  return true;
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

function isRational(r: unknown): r is Rational {
  return (
    typeof r === 'object' &&
    r !== null &&
    Number.isInteger((r as Rational).n) &&
    Number.isInteger((r as Rational).d)
  );
}

function checkRational(r: unknown, path: string): RulesProblem[] {
  if (!isRational(r)) {
    return [{ path, message: 'must be {n: integer, d: integer}' }];
  }
  const out: RulesProblem[] = [];
  if (r.d <= 0) out.push({ path: `${path}.d`, message: 'must be a positive integer' });
  if (r.n < 0) out.push({ path: `${path}.n`, message: 'must not be negative' });
  return out;
}

function checkBrackets(brackets: TaxBracket[] | undefined): RulesProblem[] {
  const out: RulesProblem[] = [];
  if (!Array.isArray(brackets) || brackets.length === 0) {
    return [{ path: 'incomeTax.brackets', message: 'at least one bracket' }];
  }
  let previous = 0;
  brackets.forEach((b, i) => {
    out.push(...checkRational(b.rate, `incomeTax.brackets[${i}].rate`));
    if (b.upTo === null) {
      // Only the last band may be unbounded, or income above it falls through
      // two bands and is taxed by whichever the loop reached first.
      if (i !== brackets.length - 1) {
        out.push({
          path: `incomeTax.brackets[${i}].upTo`,
          message: 'only the final bracket may be unbounded',
        });
      }
      return;
    }
    if (!Number.isFinite(b.upTo) || b.upTo <= 0) {
      out.push({ path: `incomeTax.brackets[${i}].upTo`, message: 'positive number, or null' });
      return;
    }
    if (b.upTo <= previous) {
      out.push({
        path: `incomeTax.brackets[${i}].upTo`,
        message: `${b.upTo} does not exceed the previous bracket's ${previous}`,
      });
    }
    previous = b.upTo;
  });
  if (brackets[brackets.length - 1]!.upTo !== null) {
    out.push({
      path: 'incomeTax.brackets',
      message: 'the final bracket must be unbounded (upTo: null), or top incomes are untaxed',
    });
  }
  return out;
}
