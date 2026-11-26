/**
 * Golden tests for the Australian personal rule set, 2025–26.
 *
 * Expected figures are worked by hand from the resident table in the
 * Treasury Laws Amendment (Cost of Living Tax Cuts) Act 2024 (16% / 30% / 37% /
 * 45% at $45,000 / $135,000 / $190,000, above the $18,200 tax-free threshold),
 * not read back from the implementation.
 */

import { describe, expect, it } from 'vitest';

import { incomeTax, periodOf, taxFromInclusive } from './interpreter.js';
import { TaxRulesRegistry, rulesIdFor } from './registry.js';
import { AU_2025 } from './rules/au-2025.js';
import { inspectRules, rulesCoverDate } from './verify.js';

const n = (s: string) => Number(s);

describe('au-2025, the rule set itself', () => {
  it('passes verification with no problems', () => {
    expect(inspectRules(AU_2025)).toEqual([]);
  });

  it('is the id rulesIdFor gives Australia for 2025, at version 2025.1.0', () => {
    expect(rulesIdFor('AU', '2025')).toBe(AU_2025.id);
    expect(AU_2025.version).toBe('2025.1.0');
    expect(AU_2025.taxYear).toBe('2025-26');
  });

  it('is personal: GST is a cost, there is no BAS, and nothing claims a credit', () => {
    expect(AU_2025.scope).toBe('personal');
    expect(AU_2025.consumptionTax.recoverable).toBe(false);
    expect(AU_2025.periods.consumptionTaxPeriod).toBe('none');
    expect(AU_2025.taxCodes.every((c) => c.claimsCredit === false)).toBe(true);
  });

  it('installs through the registry', async () => {
    const registry = new TaxRulesRegistry({ builtin: [AU_2025] });
    await registry.install('au-2025');
    expect(registry.requireFor('personal', '2026-03-15').id).toBe('au-2025');
  });
});

describe('au-2025, the financial year boundary', () => {
  it('covers 1 July 2025 to 30 June 2026 and nothing either side', () => {
    expect(rulesCoverDate(AU_2025, '2025-06-30')).toBe(false);
    expect(rulesCoverDate(AU_2025, '2025-07-01')).toBe(true);
    expect(rulesCoverDate(AU_2025, '2026-06-30')).toBe(true);
    expect(rulesCoverDate(AU_2025, '2026-07-01')).toBe(false);
  });

  it('names the year it ends in, the ATO income year', () => {
    expect(periodOf(AU_2025, '2025-07-01')).toBe('2026');
    expect(periodOf(AU_2025, '2026-06-30')).toBe('2026');
  });
});

describe('au-2025, GST is unchanged: exactly 1/11', () => {
  it('takes $10 out of $110 and stamps the 2025–26 rule set', () => {
    const r = taxFromInclusive(AU_2025, '110.00');
    expect(n(r.taxAmount)).toBe(10);
    expect(n(r.netAmount)).toBe(100);
    expect(r.rulesId).toBe('au-2025');
    expect(r.rulesVersion).toBe('2025.1.0');
  });
});

describe('au-2025, income tax: the 2025–26 resident scale (16%)', () => {
  const single = { married: false, dependants: 0 };
  const tax = (gross: string) => n(incomeTax(AU_2025, { grossIncome: gross, status: single }).taxPayable);

  it('charges nothing up to the $18,200 tax-free threshold', () => {
    expect(tax('18200')).toBe(0);
  });

  it('charges 16c per dollar just above the threshold', () => {
    expect(tax('18300')).toBe(16);
  });

  it('matches the worked figures at each band edge', () => {
    expect(tax('45000')).toBe(4_288); // 26,800 x 16%
    expect(tax('135000')).toBe(31_288); // 4,288 + 90,000 x 30%
    expect(tax('190000')).toBe(51_638); // 31,288 + 55,000 x 37%
    expect(tax('200000')).toBe(56_138); // 51,638 + 10,000 x 45%
  });

  it('stamps the result with the rule set it was computed under', () => {
    const r = incomeTax(AU_2025, { grossIncome: '60000', status: single });
    expect(r.rulesId).toBe('au-2025');
    expect(r.rulesVersion).toBe('2025.1.0');
  });
});
