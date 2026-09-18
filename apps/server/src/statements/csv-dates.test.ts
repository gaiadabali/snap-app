import type { TaxRules } from '@snap/tax-rules';
import { describe, expect, it } from 'vitest';

import { parseStatementDate } from './csv-dates.js';

/**
 * A minimal `TaxRules`-shaped object carrying only the two fields
 * `parseStatementDate` actually reads: `documentRules.dateOrder` (the
 * primary reading) and `periods` (the tie-breaker `periodKey` needs, via
 * `extraction/validators.ts`). Built here rather than pulled from a real
 * installed rule set so this suite controls both axes independently —
 * `@snap/tax-rules`'s shipped `ID_2026` currently reports
 * `consumptionTaxPeriod: 'none'` for its personal scope, which collapses
 * `periodKey` to one bucket per YEAR and would make every same-year
 * ambiguity resolve silently — the opposite of what needs testing here.
 */
function fakeRules(dateOrder: 'day_first' | 'month_first', quarterly: boolean): TaxRules {
  return {
    documentRules: { dateOrder },
    periods: quarterly
      ? { consumptionTaxPeriod: 'quarterly', taxYearStartMonth: 7, annualReturnName: 'Test annual' }
      : { consumptionTaxPeriod: 'monthly', taxYearStartMonth: 1, annualReturnName: 'Test annual' },
  } as unknown as TaxRules;
}

const AU_LIKE = fakeRules('day_first', true); // quarterly, FY starts July
const MONTHLY_DAY_FIRST = fakeRules('day_first', false); // monthly period — every ambiguous pair differs

describe('parseStatementDate', () => {
  it('accepts ISO dates unambiguously, regardless of dateOrder', () => {
    const result = parseStatementDate('2026-03-04', AU_LIKE);
    expect(result).toEqual({ ok: true, iso: '2026-03-04' });
  });

  it('accepts a numeric date where one component is over 12 — unambiguous by construction', () => {
    // 25 cannot be a month under any dateOrder, so this is not a guess.
    const result = parseStatementDate('25/12/2026', AU_LIKE);
    expect(result).toEqual({ ok: true, iso: '2026-12-25' });
  });

  it('applies the installed dateOrder for a genuinely ambiguous date', () => {
    // "08/09/2026" lands in the same FY27-Q1 quarter whichever way it is
    // read (9 Aug or 8 Sep, both Jul-Sep), so this isolates dateOrder's
    // effect from the tie-breaker refusal tested separately below.
    const dayFirst = parseStatementDate('08/09/2026', AU_LIKE);
    expect(dayFirst).toEqual({ ok: true, iso: '2026-09-08' });

    const monthFirst = parseStatementDate('08/09/2026', fakeRules('month_first', true));
    expect(monthFirst).toEqual({ ok: true, iso: '2026-08-09' });
  });

  it('resolves an ambiguous date silently when both readings land in the same reporting period', () => {
    // day_first: 8 Sep 2026 (FY27-Q1). Swapped: 9 Aug 2026 — also FY27-Q1.
    const result = parseStatementDate('08/09/2026', AU_LIKE);
    expect(result).toEqual({ ok: true, iso: '2026-09-08' });
  });

  /* ── The ticket's Done-when (2): refuse rather than guess ──────────────── */

  it('refuses an ambiguous date when the two readings fall in different reporting periods', () => {
    // Monthly periods: day_first reads 3 April; swapped reads 4 March — a
    // different month, so a different filing period either way.
    const result = parseStatementDate('03/04/2026', MONTHLY_DAY_FIRST);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/2026-04-03/);
    expect(result.reason).toMatch(/2026-03-04/);
    expect(result.reason).toMatch(/different reporting periods/);
  });

  it('refuses text that is not a recognised date format', () => {
    const result = parseStatementDate('yesterday', AU_LIKE);
    expect(result.ok).toBe(false);
  });

  it('refuses a numeric string that is not a real calendar date under either order', () => {
    const result = parseStatementDate('31/02/2026', AU_LIKE); // no such day in any month order here
    expect(result.ok).toBe(false);
  });

  it('expands a 2-digit year as 20xx', () => {
    const result = parseStatementDate('25/12/26', AU_LIKE);
    expect(result).toEqual({ ok: true, iso: '2026-12-25' });
  });
});
