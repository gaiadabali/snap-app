/**
 * The refusals.
 *
 * README: *test the refusal, not the permission.* Every guard below is
 * asserted by making it fire, because a guard that has only ever been observed
 * letting good input through has not been observed at all.
 *
 * The specific failure this suite exists to prevent: an Indonesian user
 * silently getting Australian tax rules. That produces plausible numbers under
 * the wrong law, and nothing about a running system looks different when it is
 * wrong.
 */

import { describe, expect, it } from 'vitest';

import type { TaxRules } from './contract.js';
import {
  NoRulesInstalled,
  RulesScopeMismatch,
  TaxRulesRegistry,
  rulesIdFor,
} from './registry.js';
import { ID_2026 } from './rules/id-2026.js';
import { RulesRejected, assertRules, inspectRules, rulesCoverDate } from './verify.js';

/** A structurally valid second rules, so "replace" has something to replace with. */
const FIXTURE: TaxRules = {
  ...ID_2026,
  id: 'xx-2026',
  country: 'XX',
  countryName: 'Testland',
  version: '2026.9.9',
};

/** Deep clone so a mutation in one test cannot leak into another. */
const clone = (p: TaxRules): TaxRules => structuredClone(p);

const problemPaths = (p: unknown) => inspectRules(p).map((x) => x.path);

describe('rules verification refuses', () => {
  it('a rule set whose three statements of the PPN rate disagree', () => {
    // The cross-check that makes declaring inclusiveFraction worthwhile:
    // 12/100 x 11/12 implies 11/111, so 1/11 is a contradiction.
    const bad = clone(ID_2026);
    bad.consumptionTax.inclusiveFraction = { n: 1, d: 11 };
    expect(problemPaths(bad)).toContain('consumptionTax.inclusiveFraction');
    expect(inspectRules(bad)[0]!.message).toMatch(/One of the three is wrong/);
  });

  it('a personal rules that marks consumption tax recoverable', () => {
    const bad = clone(ID_2026);
    bad.consumptionTax.recoverable = true;
    const paths = problemPaths(bad);
    expect(paths).toContain('consumptionTax.recoverable');
  });

  it('a tax code claiming credit the rules says does not exist', () => {
    const bad = clone(ID_2026);
    bad.taxCodes[0]!.claimsCredit = true;
    expect(problemPaths(bad)).toContain('taxCodes[0].claimsCredit');
  });

  it('a filing period for a tax the taxpayer cannot recover', () => {
    // A rule set saying "not recoverable" and "files monthly" describes two
    // different taxpayers. This is the exact mistake that would turn a
    // spending analytic into an imaginary SPT Masa PPN.
    const bad = clone(ID_2026);
    bad.periods.consumptionTaxPeriod = 'monthly';
    expect(problemPaths(bad)).toContain('periods.consumptionTaxPeriod');
  });

  it('brackets that are not ascending', () => {
    const bad = clone(ID_2026);
    bad.incomeTax.brackets[1]!.upTo = 10_000_000; // below bracket 0's 60m
    expect(problemPaths(bad)).toContain('incomeTax.brackets[1].upTo');
  });

  it('a bracket table whose top band is bounded, which would leave top income untaxed', () => {
    const bad = clone(ID_2026);
    bad.incomeTax.brackets[bad.incomeTax.brackets.length - 1]!.upTo = 9_000_000_000;
    expect(problemPaths(bad)).toContain('incomeTax.brackets');
  });

  it('an unbounded band that is not the last one', () => {
    const bad = clone(ID_2026);
    bad.incomeTax.brackets[0]!.upTo = null;
    expect(problemPaths(bad)).toContain('incomeTax.brackets[0].upTo');
  });

  it('a deduction whose monthly and annual caps disagree', () => {
    const bad = clone(ID_2026);
    bad.incomeTax.standardDeductions[0]!.monthlyCap = 600_000; // x12 = 7.2m, not 6m
    expect(problemPaths(bad)).toContain('incomeTax.standardDeductions[0]');
  });

  it('identical thousands and decimal separators, which make amounts unreadable', () => {
    const bad = clone(ID_2026);
    bad.currency.decimalSeparator = '.';
    expect(problemPaths(bad)).toContain('currency');
  });

  it('a retention period longer than the reader will accept', () => {
    // plausibleAgeYears below retentionYears means refusing documents the
    // taxpayer is still legally required to hold.
    const bad = clone(ID_2026);
    bad.documentRules.plausibleAgeYears = 5; // retention is 10
    expect(problemPaths(bad)).toContain('documentRules.plausibleAgeYears');
  });

  it('a checksum algorithm the interpreter does not implement', () => {
    const bad = clone(ID_2026);
    // @ts-expect-error deliberately invalid, which is the point
    bad.taxId.checksum = 'mod97';
    expect(problemPaths(bad)).toContain('taxId.checksum');
  });

  it('checksumUnverified set when there is no checksum at all', () => {
    const bad = clone(ID_2026);
    bad.taxId.checksumUnverified = true; // checksum is null
    expect(problemPaths(bad)).toContain('taxId.checksumUnverified');
  });

  it('a deemed-profit regime that states one rate', () => {
    const bad = clone(ID_2026);
    bad.incomeTax.alternativeRegimes[1]!.rate = { n: 50, d: 100 };
    expect(problemPaths(bad)).toContain('incomeTax.alternativeRegimes[1].rate');
  });

  it('a rule set with no sources, because a rate must be traceable to a law', () => {
    const bad = clone(ID_2026);
    bad.sources = [];
    expect(problemPaths(bad)).toContain('sources');
  });

  it('a rule set with no version, because results could not be replayed', () => {
    const bad = clone(ID_2026);
    // @ts-expect-error deliberately invalid
    delete bad.version;
    expect(problemPaths(bad)).toContain('version');
  });

  it('a duplicate tax code', () => {
    const bad = clone(ID_2026);
    bad.taxCodes.push({ ...bad.taxCodes[0]! });
    expect(problemPaths(bad)).toContain(`taxCodes[${bad.taxCodes.length - 1}].code`);
  });

  it('reports EVERY problem, not just the first', () => {
    // A rule set author fixing one field per reinstall is how a rate typo survives.
    const bad = clone(ID_2026);
    bad.sources = [];
    bad.taxCodes[0]!.claimsCredit = true;
    bad.currency.decimalSeparator = '.';
    expect(inspectRules(bad).length).toBeGreaterThanOrEqual(3);
  });

  it('non-objects, without throwing on the way', () => {
    expect(inspectRules(null)).toHaveLength(1);
    expect(inspectRules('a rule set')).toHaveLength(1);
    expect(inspectRules(42)).toHaveLength(1);
  });

  it('throws RulesRejected from assertRules, carrying the problems', () => {
    const bad = clone(ID_2026);
    bad.sources = [];
    expect(() => assertRules(bad)).toThrow(RulesRejected);
    try {
      assertRules(bad);
    } catch (e) {
      expect((e as RulesRejected).problems.some((p) => p.path === 'sources')).toBe(true);
      expect((e as RulesRejected).message).toMatch(/id-2026/);
    }
  });

  it('accepts the shipped rules', () => {
    expect(() => assertRules(ID_2026)).not.toThrow();
  });
});

describe('effective dates', () => {
  it('covers a date inside its window and not one before it', () => {
    expect(rulesCoverDate(ID_2026, '2026-06-01')).toBe(true);
    expect(rulesCoverDate(ID_2026, '2025-12-31')).toBe(false);
  });

  it('expires the shipped rules at the end of its tax year', () => {
    // A rule set compiled into a binary with an open window would keep applying
    // 2026 PTKP in 2028 and look healthy doing it — the same staleness the
    // workspace boundary test bans @snap/tax-engine from clients to avoid.
    expect(ID_2026.effectiveTo).toBe('2026-12-31');
    expect(rulesCoverDate(ID_2026, '2026-12-31')).toBe(true);
    expect(rulesCoverDate(ID_2026, '2027-01-01')).toBe(false);
  });

  it('refuses a date it does not cover rather than guessing', async () => {
    const r = new TaxRulesRegistry({ builtin: [ID_2026] });
    await r.install('id-2026');
    // The year turns and the app must not silently keep computing.
    expect(() => r.requireFor('personal', '2027-01-02')).toThrow(RulesRejected);
  });
});

describe('the registry holds exactly one engine', () => {
  it('refuses every calculation when nothing is installed', () => {
    // No fallback, by design. An Indonesian user must never silently get
    // Australian rules.
    const r = new TaxRulesRegistry({ builtin: [ID_2026] });
    expect(r.current()).toBeNull();
    expect(() => r.require('the PPN split')).toThrow(NoRulesInstalled);
    expect(() => r.require('the PPN split')).toThrow(/the PPN split/);
  });

  it('installs a built-in rules without a network', async () => {
    const r = new TaxRulesRegistry({ builtin: [ID_2026] });
    const installed = await r.install('id-2026');
    expect(installed.origin).toBe('builtin');
    expect(r.require().id).toBe('id-2026');
  });

  it('replaces rather than accumulates when the country changes', async () => {
    const r = new TaxRulesRegistry({ builtin: [ID_2026, FIXTURE] });
    await r.install('id-2026');
    await r.install('xx-2026');
    // One at a time: the previous rule set is gone, not shadowed.
    expect(r.require().id).toBe('xx-2026');
    expect(r.current()!.rules.country).toBe('XX');
  });

  it('leaves the previous rules active when an install fails', async () => {
    // Atomicity. A failed switch must not leave the app with no engine.
    const r = new TaxRulesRegistry({
      builtin: [ID_2026],
      fetchRules: async () => ({ id: 'zz-2026', country: 'ZZ' }), // missing everything
    });
    await r.install('id-2026');
    await expect(r.install('zz-2026')).rejects.toThrow(RulesRejected);
    expect(r.require().id).toBe('id-2026');
  });

  it('refuses a fetched rules that identifies as something else', async () => {
    const r = new TaxRulesRegistry({
      builtin: [],
      fetchRules: async () => ID_2026, // asked for xx-2026, served id-2026
    });
    await expect(r.install('xx-2026')).rejects.toThrow(RulesRejected);
    expect(r.current()).toBeNull();
  });

  it('refuses to fetch at all when no fetcher is configured', async () => {
    const r = new TaxRulesRegistry({ builtin: [ID_2026] });
    await expect(r.install('xx-2026')).rejects.toThrow(NoRulesInstalled);
    expect(r.current()).toBeNull();
  });

  it('rejects a broken built-in rules at construction, not at install', () => {
    // A broken rule set compiled into the binary should fail the build's tests
    // loudly, rather than wait for a user to switch country.
    const bad = clone(ID_2026);
    bad.sources = [];
    expect(() => new TaxRulesRegistry({ builtin: [bad] })).toThrow(RulesRejected);
  });

  it('uninstalls to no engine, and says so rather than guessing', async () => {
    const r = new TaxRulesRegistry({ builtin: [ID_2026] });
    await r.install('id-2026');
    r.uninstall();
    expect(r.current()).toBeNull();
    expect(() => r.require()).toThrow(NoRulesInstalled);
  });
});

describe('requireFor guards scope and date', () => {
  it('refuses a business rules for a personal workspace', async () => {
    const business = clone(ID_2026);
    business.id = 'id-2027';
    business.scope = 'business';
    business.consumptionTax.recoverable = true;
    business.periods.consumptionTaxPeriod = 'monthly';
    business.taxCodes[0]!.claimsCredit = true;

    const r = new TaxRulesRegistry({ builtin: [business] });
    await r.install('id-2027');
    expect(() => r.requireFor('personal', '2026-06-01')).toThrow(RulesScopeMismatch);
  });

  it('refuses a structurally perfect rules for the wrong year', async () => {
    // The quiet failure: correct shape, superseded law, plausible number.
    const r = new TaxRulesRegistry({ builtin: [ID_2026] });
    await r.install('id-2026');
    expect(() => r.requireFor('personal', '2024-06-01')).toThrow(RulesRejected);
    expect(() => r.requireFor('personal', '2026-06-01')).not.toThrow();
  });

  it('records when and how the rules arrived', async () => {
    const r = new TaxRulesRegistry({
      builtin: [ID_2026],
      now: () => new Date('2026-09-17T03:00:00Z'),
    });
    const installed = await r.install('id-2026');
    expect(installed.installedAt).toBe('2026-09-17T03:00:00.000Z');
    expect(installed.origin).toBe('builtin');
  });
});

describe('rulesIdFor', () => {
  it('builds the candidate id for a country and year', () => {
    expect(rulesIdFor('ID', '2026')).toBe('id-2026');
    expect(rulesIdFor('au', '2026')).toBe('au-2026');
  });

  it('refuses malformed input rather than producing a plausible id', () => {
    expect(() => rulesIdFor('IDN', '2026')).toThrow();
    expect(() => rulesIdFor('ID', '26')).toThrow();
  });
});
