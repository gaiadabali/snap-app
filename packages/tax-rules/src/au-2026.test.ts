/**
 * Golden tests for the Australian personal rule set.
 *
 * Every expected figure is worked by hand from the law, not read back from the
 * implementation: GST is exactly one eleventh of a GST-inclusive price, and the
 * income-tax figures are the published "tax on this income" column of the
 * 2026–27 resident scale.
 */

import { describe, expect, it } from 'vitest';

import {
  checkStatedTax,
  checkTaxId,
  confusableTaxes,
  consumptionTaxPaid,
  datePlausible,
  incomeTax,
  periodOf,
  taxFromInclusive,
  taxOnSale,
} from './interpreter.js';
import { formatLocalAmount, parseLocalAmount } from './money.js';
import { TaxRulesRegistry, rulesIdFor } from './registry.js';
import { AU_2026 } from './rules/au-2026.js';
import { ID_2026 } from './rules/id-2026.js';
import { inspectRules, rulesCoverDate } from './verify.js';

const AUD = AU_2026.currency;
const n = (s: string) => Number(s);

describe('the rule set itself', () => {
  it('passes verification with no problems', () => {
    expect(inspectRules(AU_2026)).toEqual([]);
  });

  it('is the id rulesIdFor gives Australia for 2026', () => {
    expect(rulesIdFor('AU', '2026')).toBe(AU_2026.id);
  });

  it('is personal: GST is a cost, there is no BAS, and nothing claims a credit', () => {
    expect(AU_2026.scope).toBe('personal');
    expect(AU_2026.consumptionTax.recoverable).toBe(false);
    expect(AU_2026.periods.consumptionTaxPeriod).toBe('none');
    expect(AU_2026.taxCodes.every((c) => c.claimsCredit === false)).toBe(true);
  });

  it('runs in AUD with the July financial year', () => {
    expect(AUD.code).toBe('AUD');
    expect(AUD.minorUnits).toBe(2);
    expect(AU_2026.periods.taxYearStartMonth).toBe(7);
  });

  it('classifies every ledger code, so a spending report never guesses', () => {
    const byCode = Object.fromEntries(AU_2026.taxCodes.map((c) => [c.code, c.treatment]));
    expect(byCode).toEqual({ GST: 'standard', FRE: 'exempt', INP: 'exempt', 'N-T': 'out_of_scope' });
  });

  it('installs through the registry next to Indonesia, one at a time', async () => {
    const registry = new TaxRulesRegistry({ builtin: [AU_2026, ID_2026] });
    expect(registry.builtinIds()).toEqual(['au-2026', 'id-2026']);
    await registry.install('au-2026');
    expect(registry.require().country).toBe('AU');
    await registry.install('id-2026');
    expect(registry.require().country).toBe('ID');
  });
});

describe('the financial year boundary — 30 June / 1 July', () => {
  it('covers 1 July 2026 to 30 June 2027 and nothing either side', () => {
    expect(rulesCoverDate(AU_2026, '2026-06-30')).toBe(false);
    expect(rulesCoverDate(AU_2026, '2026-07-01')).toBe(true);
    expect(rulesCoverDate(AU_2026, '2027-06-30')).toBe(true);
    expect(rulesCoverDate(AU_2026, '2027-07-01')).toBe(false);
  });

  it('refuses a date outside the year through requireFor, rather than applying 2026–27 law', async () => {
    const registry = new TaxRulesRegistry({ builtin: [AU_2026] });
    await registry.install('au-2026');
    expect(registry.requireFor('personal', '2027-06-30').id).toBe('au-2026');
    expect(() => registry.requireFor('personal', '2027-07-01')).toThrow(/does not include 2027-07-01/);
  });

  it('puts 30 June and 1 July in different financial years', () => {
    // With no consumption-tax period, periodOf is the financial year, named
    // for the year it ends in — the ATO's "income year".
    expect(periodOf(AU_2026, '2026-06-30')).toBe('2026');
    expect(periodOf(AU_2026, '2026-07-01')).toBe('2027');
    expect(periodOf(AU_2026, '2027-06-30')).toBe('2027');
    expect(periodOf(AU_2026, '2027-07-01')).toBe('2028');
  });
});

describe('GST — exactly 1/11 of a GST-inclusive price', () => {
  it('takes $10 out of $110, and the parts add back up', () => {
    const r = taxFromInclusive(AU_2026, '110.00');
    expect(n(r.taxAmount)).toBe(10);
    expect(n(r.netAmount)).toBe(100);
    // baseFraction 1/1: the document base IS the net, unlike Indonesia.
    expect(r.documentBase).toBe(r.netAmount);
    expect(r.recoverable).toBe(false);
    expect(r.rulesId).toBe('au-2026');
  });

  it('rounds a non-terminating eleventh to the cent', () => {
    // 266.91 / 11 = 24.2645… -> $24.26
    expect(n(taxFromInclusive(AU_2026, '266.91').taxAmount)).toBe(24.26);
    // 100 / 11 = 9.0909… -> $9.09
    expect(n(taxFromInclusive(AU_2026, '100.00').taxAmount)).toBe(9.09);
  });

  it('adds 10% to an ex-GST price', () => {
    expect(n(taxOnSale(AU_2026, '250.00').taxAmount)).toBe(25);
  });

  it('accepts a stated GST within 5 cents and flags one further out', () => {
    expect(checkStatedTax(AU_2026, '110.00', '10.00').withinTolerance).toBe(true);
    expect(checkStatedTax(AU_2026, '110.00', '10.05').withinTolerance).toBe(true);
    expect(checkStatedTax(AU_2026, '110.00', '10.06').withinTolerance).toBe(false);
    // An Indonesian 11/111 reading of the same docket is far outside.
    expect(checkStatedTax(AU_2026, '110.00', '10.90').withinTolerance).toBe(false);
  });

  it('leaves GST-free lines out of the GST paid', () => {
    // $55 taxable (GST $5) + $20 of fresh fruit (GST-free).
    const r = consumptionTaxPaid(AU_2026, [
      { inclusiveAmount: '55.00' },
      { inclusiveAmount: '20.00', exempt: true },
    ]);
    expect(n(r.grossSpend)).toBe(75);
    expect(n(r.taxPaid)).toBe(5);
    expect(n(r.exemptSpend)).toBe(20);
    expect(n(r.otherTaxPaid)).toBe(0);
    expect(r.disclosure).toMatch(/GST you paid/);
    expect(r.disclosure).toMatch(/not a claim/);
  });

  it('has no second tax that could pass for GST', () => {
    expect(confusableTaxes(AU_2026, ['TAX 10%', 'PB1', 'GST'])).toEqual([]);
  });
});

describe('money as printed in Australia', () => {
  it('reads a comma as thousands and a point as cents', () => {
    expect(n(parseLocalAmount('$1,234.56', AUD))).toBe(1234.56);
    expect(n(parseLocalAmount('15.00', AUD))).toBe(15);
  });

  it('prints the same way', () => {
    expect(formatLocalAmount('1234.5', AUD)).toMatch(/1,234\.50/);
  });
});

describe('the ABN', () => {
  it('passes a real ABN on its checksum', () => {
    expect(checkTaxId(AU_2026, '51 824 753 556')).toMatchObject({ ok: true, confidence: 'checksum' });
  });

  it('catches one misread digit', () => {
    expect(checkTaxId(AU_2026, '51 824 753 557')).toMatchObject({ ok: false, confidence: 'checksum' });
  });
});

describe('dates', () => {
  it('keeps seven years plausible against a five-year obligation', () => {
    expect(datePlausible(AU_2026, '2019-12-01', '2026-11-26').ok).toBe(true);
    expect(datePlausible(AU_2026, '2019-11-25', '2026-11-26').ok).toBe(false);
  });
});

describe('income tax — the published 2026–27 resident scale', () => {
  const single = { married: false, dependants: 0 };
  const tax = (gross: string) => n(incomeTax(AU_2026, { grossIncome: gross, status: single }).taxPayable);

  it('charges nothing up to the $18,200 tax-free threshold', () => {
    expect(tax('18200')).toBe(0);
  });

  it('matches the published figures at each band edge', () => {
    expect(tax('45000')).toBe(4_020); // 26,800 x 15%
    expect(tax('135000')).toBe(31_020); // 4,020 + 90,000 x 30%
    expect(tax('190000')).toBe(51_370); // 31,020 + 55,000 x 37%
    expect(tax('200000')).toBe(55_870); // 51,370 + 10,000 x 45%
  });

  it('charges 15c per dollar just above the threshold', () => {
    expect(tax('18300')).toBe(15);
  });
});
