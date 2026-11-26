/**
 * Which year's rule set a date belongs to, and how the Australian years fit
 * together.
 */

import { describe, expect, it } from 'vitest';

import type { TaxRules } from './contract.js';
import { AU_2025 } from './rules/au-2025.js';
import { AU_2026 } from './rules/au-2026.js';
import { AU_2027 } from './rules/au-2027.js';
import { ID_2026 } from './rules/id-2026.js';
import { inspectRules } from './verify.js';
import { currentRules, familiesOf, familyOf, inspectFamily, rulesForDate } from './years.js';

const HELD = [AU_2025, AU_2026, AU_2027, ID_2026];
const AU = familyOf(HELD, 'au-2026');

describe('the Australian family', () => {
  it('is three years, oldest first, each passing verification', () => {
    expect(AU.map((r) => r.id)).toEqual(['au-2025', 'au-2026', 'au-2027']);
    for (const r of AU) expect(inspectRules(r)).toEqual([]);
  });

  it('fits together: no overlap, no gap, distinct ids and versions', () => {
    expect(inspectFamily(AU)).toEqual([]);
  });

  it('is found from any member id, and never includes Indonesia', () => {
    expect(familyOf(HELD, 'au-2025').map((r) => r.id)).toEqual(['au-2025', 'au-2026', 'au-2027']);
    expect(familyOf(HELD, 'id-2026').map((r) => r.id)).toEqual(['id-2026']);
  });

  it('refuses an id that is not held, rather than guessing a country', () => {
    expect(() => familyOf(HELD, 'au-2019')).toThrow(/au-2019/);
  });

  /* History is immutable and each year is a copy of au-2026 with one number
     changed. Everything the receipt reader, statement imports and the ledger
     read must therefore be identical across the years — the server resolves
     a reader rule set before a document's date is known (the worker reads the
     capture date first), which is only safe while this holds. If a future
     year genuinely changes one of these, this test is where that decision
     gets made, deliberately. */
  it('differs between years only in id, version, year, window, income-tax scale and sources', () => {
    const yearless = (r: TaxRules) => {
      const { id, version, taxYear, effectiveFrom, effectiveTo, incomeTax, sources, ...rest } = r;
      void id; void version; void taxYear; void effectiveFrom; void effectiveTo; void sources;
      const { brackets, ...incomeRest } = incomeTax;
      void brackets;
      return { ...rest, incomeTax: incomeRest };
    };
    expect(yearless(AU_2025)).toEqual(yearless(AU_2026));
    expect(yearless(AU_2027)).toEqual(yearless(AU_2026));
  });

  it('changes only the second resident rate: 16%, then 15%, then 14%', () => {
    const second = (r: TaxRules) => r.incomeTax.brackets[0]!.rate;
    expect(AU.map(second)).toEqual([
      { n: 16, d: 100 },
      { n: 15, d: 100 },
      { n: 14, d: 100 },
    ]);
    const rest = (r: TaxRules) => r.incomeTax.brackets.slice(1);
    expect(rest(AU_2025)).toEqual(rest(AU_2026));
    expect(rest(AU_2027)).toEqual(rest(AU_2026));
    expect(AU.map((r) => r.incomeTax.brackets[0]!.upTo)).toEqual([26_800, 26_800, 26_800]);
  });
});

describe('rulesForDate — the year a document belongs to', () => {
  const at = (date: string) => {
    const r = rulesForDate(AU, date);
    return `${r.rules.id}/${r.match}`;
  };

  it('older than every held year: the earliest held year, and says so', () => {
    expect(at('2025-06-30')).toBe('au-2025/earliest_held');
    expect(at('2019-01-01')).toBe('au-2025/earliest_held');
  });

  it('1 July 2025 to 30 June 2026: au-2025', () => {
    expect(at('2025-07-01')).toBe('au-2025/exact');
    expect(at('2026-03-15')).toBe('au-2025/exact');
    expect(at('2026-06-30')).toBe('au-2025/exact');
  });

  it('1 July 2026 to 30 June 2027: au-2026', () => {
    expect(at('2026-07-01')).toBe('au-2026/exact');
    expect(at('2027-06-30')).toBe('au-2026/exact');
  });

  it('from 1 July 2027: au-2027', () => {
    expect(at('2027-07-01')).toBe('au-2027/exact');
    expect(at('2028-06-30')).toBe('au-2027/exact');
  });

  it('after every held year: the latest held year, and says so', () => {
    expect(at('2028-07-01')).toBe('au-2027/latest_held');
    expect(at('2030-01-01')).toBe('au-2027/latest_held');
  });

  it('carries the version of the year it chose, so a result can be replayed', () => {
    const r = rulesForDate(AU, '2026-03-15');
    expect(r.rules.version).toBe('2025.1.0');
    expect(r.onDate).toBe('2026-03-15');
  });

  it('a one-year family answers with that year for every date (Indonesia today)', () => {
    const id = familyOf(HELD, 'id-2026');
    expect(rulesForDate(id, '2026-06-01')).toMatchObject({ match: 'exact' });
    expect(rulesForDate(id, '2025-06-01').rules.id).toBe('id-2026');
    expect(rulesForDate(id, '2027-06-01').rules.id).toBe('id-2026');
  });

  it('refuses a mixed family rather than crossing countries', () => {
    expect(() => rulesForDate([AU_2026, ID_2026], '2026-08-01')).toThrow(/more than one family/);
  });

  it('refuses something that is not a date', () => {
    expect(() => rulesForDate(AU, '15/03/2026')).toThrow(/not a date/);
    expect(() => rulesForDate([], '2026-03-15')).toThrow(/no rule sets/);
  });

  it('does not depend on the order the family is given in', () => {
    expect(rulesForDate([AU_2027, AU_2025, AU_2026], '2026-03-15').rules.id).toBe('au-2025');
  });
});

describe('currentRules — one choice per country', () => {
  it('shows one Australia, the year covering the date, then Indonesia', () => {
    expect(currentRules(HELD, '2026-11-26').map((r) => r.id)).toEqual(['au-2026', 'id-2026']);
    expect(currentRules(HELD, '2026-03-15').map((r) => r.id)).toEqual(['au-2025', 'id-2026']);
    expect(currentRules(HELD, '2027-07-01').map((r) => r.id)).toEqual(['au-2027', 'id-2026']);
  });

  it('groups families in first-appearance order', () => {
    expect([...familiesOf(HELD).keys()]).toEqual(['AU:personal', 'ID:personal']);
  });
});

describe('inspectFamily refuses years that do not fit together', () => {
  const shift = (r: TaxRules, over: Partial<TaxRules>): TaxRules => ({ ...r, ...over });

  it('an overlap', () => {
    const bad = shift(AU_2027, { effectiveFrom: '2027-06-01' });
    expect(inspectFamily([AU_2026, bad]).map((p) => p.message).join()).toMatch(/overlaps au-2026/);
  });

  it('a gap', () => {
    const bad = shift(AU_2027, { effectiveFrom: '2027-08-01' });
    expect(inspectFamily([AU_2026, bad]).map((p) => p.message).join()).toMatch(/gap/);
  });

  it('an open-ended year that is not the newest', () => {
    const bad = shift(AU_2026, { effectiveTo: null });
    expect(inspectFamily([bad, AU_2027]).map((p) => p.message).join()).toMatch(/open-ended/);
  });

  it('two years sharing a version, so a stamp could not say which', () => {
    const bad = shift(AU_2027, { version: AU_2026.version });
    expect(inspectFamily([AU_2026, bad]).map((p) => p.message).join()).toMatch(/more than one year/);
  });

  it('two countries in one family', () => {
    expect(inspectFamily([AU_2026, ID_2026]).map((p) => p.message).join()).toMatch(/one country/);
  });
});
