/**
 * Golden tests for the Australian personal rule set, 2027–28.
 *
 * Expected figures are worked by hand from the resident table the Treasury
 * Laws Amendment (More Cost of Living Relief) Act 2025 sets for 2027–28 and
 * later years (14% / 30% / 37% / 45% at $45,000 / $135,000 / $190,000, above
 * the $18,200 tax-free threshold), not read back from the implementation.
 */

import { describe, expect, it } from 'vitest';

import { incomeTax, periodOf, taxFromInclusive } from './interpreter.js';
import { TaxRulesRegistry, rulesIdFor } from './registry.js';
import { AU_2027 } from './rules/au-2027.js';
import { inspectRules, rulesCoverDate } from './verify.js';

const n = (s: string) => Number(s);

describe('au-2027, the rule set itself', () => {
  it('passes verification with no problems', () => {
    expect(inspectRules(AU_2027)).toEqual([]);
  });

  it('is the id rulesIdFor gives Australia for 2027, at version 2027.1.0', () => {
    expect(rulesIdFor('AU', '2027')).toBe(AU_2027.id);
    expect(AU_2027.version).toBe('2027.1.0');
    expect(AU_2027.taxYear).toBe('2027-28');
  });

  it('is personal: GST is a cost, there is no BAS, and nothing claims a credit', () => {
    expect(AU_2027.scope).toBe('personal');
    expect(AU_2027.consumptionTax.recoverable).toBe(false);
    expect(AU_2027.periods.consumptionTaxPeriod).toBe('none');
    expect(AU_2027.taxCodes.every((c) => c.claimsCredit === false)).toBe(true);
  });

  it('installs through the registry, and the registry itself still refuses a date it does not cover', async () => {
    const registry = new TaxRulesRegistry({ builtin: [AU_2027] });
    await registry.install('au-2027');
    expect(registry.requireFor('personal', '2027-07-01').id).toBe('au-2027');
    // The fallback to the latest held year lives in years.ts, where the
    // answer says it is a fallback; requireFor stays strict.
    expect(() => registry.requireFor('personal', '2028-07-01')).toThrow(/does not include 2028-07-01/);
  });
});

describe('au-2027, the financial year boundary', () => {
  it('covers 1 July 2027 to 30 June 2028 and nothing either side', () => {
    expect(rulesCoverDate(AU_2027, '2027-06-30')).toBe(false);
    expect(rulesCoverDate(AU_2027, '2027-07-01')).toBe(true);
    expect(rulesCoverDate(AU_2027, '2028-06-30')).toBe(true);
    expect(rulesCoverDate(AU_2027, '2028-07-01')).toBe(false);
  });

  it('names the year it ends in, the ATO income year', () => {
    expect(periodOf(AU_2027, '2027-07-01')).toBe('2028');
    expect(periodOf(AU_2027, '2028-06-30')).toBe('2028');
  });
});

describe('au-2027, GST is unchanged: exactly 1/11', () => {
  it('takes $10 out of $110 and stamps the 2027–28 rule set', () => {
    const r = taxFromInclusive(AU_2027, '110.00');
    expect(n(r.taxAmount)).toBe(10);
    expect(r.rulesId).toBe('au-2027');
    expect(r.rulesVersion).toBe('2027.1.0');
  });
});

describe('au-2027, income tax: the 2027–28 resident scale (14%)', () => {
  const single = { married: false, dependants: 0 };
  const tax = (gross: string) => n(incomeTax(AU_2027, { grossIncome: gross, status: single }).taxPayable);

  it('charges nothing up to the $18,200 tax-free threshold', () => {
    expect(tax('18200')).toBe(0);
  });

  it('charges 14c per dollar just above the threshold', () => {
    expect(tax('18300')).toBe(14);
  });

  it('matches the worked figures at each band edge', () => {
    expect(tax('45000')).toBe(3_752); // 26,800 x 14%
    expect(tax('135000')).toBe(30_752); // 3,752 + 90,000 x 30%
    expect(tax('190000')).toBe(51_102); // 30,752 + 55,000 x 37%
    expect(tax('200000')).toBe(55_602); // 51,102 + 10,000 x 45%
  });
});
