import { describe, expect, it } from 'vitest';

import type { DocumentView, Workspace } from '@/api/types';
import {
  analyticsSummary,
  buckets,
  byCategory,
  divide,
  personalSummary,
  series,
  startOfTaxYear,
  taxYearName,
  topMerchants,
  total,
} from './analytics';

/**
 * The aggregation behind the tracker and the charts.
 *
 * Every fault this file guards against is silent: a month boundary off by one
 * still renders a chart, a part-month compared against a whole one still shows
 * a percentage, and a personal figure that quietly includes business spending
 * still adds up. None of it looks broken on screen — which is why it is tested
 * here rather than eyeballed there.
 *
 * `now` is injected everywhere so the suite does not change behaviour on the
 * first of the month.
 */

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const NOW = new Date(2026, 8, 10); // 10 September 2026, a Thursday.

function doc(over: Partial<DocumentView> & { issueDate: string; payableAmount: string }): DocumentView {
  return {
    id: Math.random().toString(36).slice(2),
    supplierName: 'Woolworths Metro',
    supplierAbn: null,
    supplierAbnValid: false,
    currency: 'AUD',
    version: 1,
    taxExclusiveAmount: '0.0000',
    taxAmount: '0.0000',
    gstFreeAmount: null,
    // These analytics never read the per-category split; an empty array is the
    // honest default for a fixture that asserts nothing about tax treatment.
    taxSubtotals: [],
    isTaxInvoice: false,
    docType: 'receipt',
    category: 'Groceries',
    engineRowId: 'personal',
    categoryId: null,
    categorySource: null,
    taxLabel: null,
    reviewStatus: 'auto_accepted',
    confidenceOverall: 0.97,
    note: null,
    complianceFailures: [],
    gstAtRisk: null,
    belowTaxInvoiceThreshold: false,
    workspace: 'personal',
    workspaceId: 'ws_test',
    capturedByName: 'Kate Marsh',
    visibility: 'shared',
    lines: [],
    linesBalance: true,
    findings: [],
    imageUrl: null,
    imageCapturedAt: null,
    // One page minimum, per contract §3.1 — these aggregation tests never
    // look at it, but `DocumentView` guarantees at least one entry and a
    // fixture that used `[]` would be lying about a case that cannot occur.
    // Empty string mirrors `imageUrl: null` above: no real photo behind this
    // test fixture, same falsy convention `receipt.tsx` already relies on.
    pages: [{ pageNumber: 1, imageUrl: '', source: 'capture' }],
    ...over,
  };
}

const ws = (w: Workspace) => ({ workspace: w });

describe('exact money over collections', () => {
  it('totals without float drift', () => {
    expect(total([doc({ issueDate: '2026-09-01', payableAmount: '0.10' }), doc({ issueDate: '2026-09-02', payableAmount: '0.20' })])).toBe('0.3000');
  });

  it('divides to the cent and never below it', () => {
    expect(divide('100.00', 3)).toBe('33.3300');
    expect(divide('10.00', 4)).toBe('2.5000');
  });

  it('treats a division by zero days as zero rather than infinity', () => {
    expect(divide('100.00', 0)).toBe('0.0000');
  });
});

describe('buckets', () => {
  it('draws a year as twelve months ending with the current one', () => {
    const b = buckets('year', NOW);
    expect(b).toHaveLength(12);
    expect(b[0]!.label).toBe('Oct');
    expect(b[11]!.label).toBe('Sep');
    expect(b[11]!.partial).toBe(true);
  });

  it('marks only the bucket in progress as partial', () => {
    expect(buckets('year', NOW).filter((b) => b.partial)).toHaveLength(1);
  });

  it('draws a month in weeks, covering every day of it', () => {
    const b = buckets('month', NOW);
    expect(b[0]!.from).toBe('2026-09-01');
    expect(b[b.length - 1]!.to).toBe('2026-09-30');
  });

  it('marks the week containing today, not the last week', () => {
    const b = buckets('month', NOW);
    expect(b.findIndex((x) => x.partial)).toBe(1); // the 8th–14th
  });
});

describe('series', () => {
  it('puts each document in exactly one bucket', () => {
    const docs = [
      doc({ issueDate: '2026-09-03', payableAmount: '10.00' }),
      doc({ issueDate: '2026-09-09', payableAmount: '20.00' }),
      doc({ issueDate: '2026-08-15', payableAmount: '99.00' }), // outside the month
    ];
    const s = series(docs, 'month', NOW);
    expect(s[0]!.value).toBe('10.0000');
    expect(s[1]!.value).toBe('20.0000');
    expect(s.reduce((a, p) => a + Number(p.value), 0)).toBe(30);
  });
});

describe('categories and merchants', () => {
  const docs = [
    doc({ issueDate: '2026-09-01', payableAmount: '100.00', category: 'Groceries' }),
    doc({ issueDate: '2026-09-02', payableAmount: '50.00', category: 'Groceries' }),
    doc({ issueDate: '2026-09-02', payableAmount: '80.00', category: 'Fuel', supplierName: 'Ampol' }),
  ];

  it('ranks categories by spend', () => {
    const c = byCategory(docs);
    expect(c[0]).toMatchObject({ category: 'Groceries', spent: '150.0000' });
    expect(c[1]).toMatchObject({ category: 'Fuel', spent: '80.0000' });
  });

  it('reports budget usage as a fraction, over 1 when over budget', () => {
    const c = byCategory(docs, [{ category: 'Groceries', monthly: '100.00' }]);
    expect(c[0]!.used).toBeCloseTo(1.5);
    expect(c[1]!.used).toBeNull();
  });

  it('keeps a budgeted category with no spend, rather than hiding it', () => {
    const c = byCategory(docs, [{ category: 'Health', monthly: '200.00' }]);
    expect(c.find((x) => x.category === 'Health')).toMatchObject({ spent: '0.0000', used: 0 });
  });

  it('groups merchants and counts visits', () => {
    expect(topMerchants(docs)[0]).toMatchObject({ name: 'Woolworths Metro', total: '150.0000', count: 2 });
  });
});

describe('personal summary', () => {
  const budgets = [
    { category: 'Groceries', monthly: '900.00' },
    { category: 'Fuel', monthly: '300.00' },
  ];
  const docs = [
    doc({ issueDate: '2026-09-02', payableAmount: '200.00' }),
    doc({ issueDate: '2026-09-08', payableAmount: '100.00' }),
    // Business spending must never reach a personal figure.
    doc({ issueDate: '2026-09-05', payableAmount: '5000.00', ...ws('business') }),
    // Last month, before and after the same day-of-month.
    doc({ issueDate: '2026-08-04', payableAmount: '400.00' }),
    doc({ issueDate: '2026-08-25', payableAmount: '999.00' }),
  ];
  const s = personalSummary(docs, budgets, '1200.00', NOW);

  it('counts only personal spending in the current month', () => {
    expect(s.spentThisMonth).toBe('300.0000');
    expect(s.receiptCount).toBe(2);
  });

  it('leaves what the budget leaves', () => {
    expect(s.remaining).toBe('900.0000');
  });

  it('spreads the remainder over the days left, today included', () => {
    // 10 Sep of 30: 21 days left including today. 900 / 21 = 42.85.
    expect(s.daysLeftInMonth).toBe(21);
    expect(s.safeToSpendPerDay).toBe('42.8500');
  });

  it('offers nothing per day once the budget is gone, rather than a negative', () => {
    const over = personalSummary(docs, budgets, '250.00', NOW);
    expect(over.remaining).toBe('-50.0000');
    expect(over.safeToSpendPerDay).toBe('0.0000');
  });

  it('compares against the same day last month, not the whole of it', () => {
    // $400 by 10 August. The $999 on the 25th has not happened yet, in pace terms.
    expect(s.lastMonthToDate).toBe('400.0000');
  });
});

describe('analytics summary', () => {
  const docs = [
    doc({ issueDate: '2026-09-04', payableAmount: '110.00', ...ws('business'), isTaxInvoice: true, taxAmount: '10.00' }),
    doc({ issueDate: '2026-09-06', payableAmount: '55.00', ...ws('business'), isTaxInvoice: false, taxAmount: '5.00' }),
    doc({ issueDate: '2026-08-06', payableAmount: '200.00', ...ws('business'), isTaxInvoice: true, taxAmount: '18.18' }),
    doc({ issueDate: '2026-09-06', payableAmount: '900.00' }), // personal — must not appear
  ];

  it('scopes to one workspace', () => {
    expect(analyticsSummary(docs, 'business', 'month', [], NOW).total).toBe('165.0000');
    expect(analyticsSummary(docs, 'personal', 'month', [], NOW).total).toBe('900.0000');
  });

  it('compares this period against the one immediately before it', () => {
    const a = analyticsSummary(docs, 'business', 'month', [], NOW);
    expect(a.previousTotal).toBe('200.0000');
    expect(a.changePct).toBeCloseTo(-0.175);
  });

  it('stops the previous period at the same day, not at its end', () => {
    // The 6th counts on 10 September; the 28th has not happened yet in pace
    // terms. Including it would report a fall while spending is actually up.
    const withLate = [
      ...docs,
      doc({ issueDate: '2026-08-28', payableAmount: '5000.00', ...ws('business') }),
    ];
    const a = analyticsSummary(withLate, 'business', 'month', [], NOW);
    expect(a.previousTotal).toBe('200.0000');
  });

  it('splits GST into claimable and at risk, business only', () => {
    const a = analyticsSummary(docs, 'business', 'month', [], NOW);
    expect(a.gstClaimable).toBe('10.0000');
    expect(a.gstAtRisk).toBe('5.0000');
    expect(analyticsSummary(docs, 'personal', 'month', [], NOW).gstClaimable).toBeNull();
  });

  it('names the largest single document in the period', () => {
    expect(analyticsSummary(docs, 'business', 'month', [], NOW).largest).toMatchObject({
      amount: '110.00',
    });
  });

  it('offers no comparison when the previous window predates the data', () => {
    // One year of receipts cannot be compared against the year before it.
    const a = analyticsSummary(docs, 'business', 'year', [], NOW);
    expect(a.total).toBe('365.0000');
    expect(a.changePct).toBeNull();
  });

  it('has no change to report when there is no history', () => {
    const only = [doc({ issueDate: '2026-09-04', payableAmount: '10.00', ...ws('business') })];
    expect(analyticsSummary(only, 'business', 'month', [], NOW).changePct).toBeNull();
  });
});

/**
 * "Year" is the workspace's TAX year to date, not the calendar year and not a
 * rolling twelve months: 1 July for Australia (taxYearStartMonth 7), 1 January
 * for Indonesia (1). The month comes from the rule set, so nothing here is a
 * country check.
 */
describe('tax-year ranges', () => {
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

  it('starts the Australian year on 1 July of the year that contains today', () => {
    expect(iso(startOfTaxYear(at(2026, 11, 26), 7))).toBe('2026-07-01');
    expect(iso(startOfTaxYear(at(2026, 6, 30), 7))).toBe('2025-07-01');
    expect(iso(startOfTaxYear(at(2026, 7, 1), 7))).toBe('2026-07-01');
  });

  it('starts the Indonesian year on 1 January', () => {
    expect(iso(startOfTaxYear(at(2026, 11, 26), 1))).toBe('2026-01-01');
    expect(iso(startOfTaxYear(at(2026, 1, 1), 1))).toBe('2026-01-01');
  });

  it('names the year the way the country does', () => {
    expect(taxYearName(at(2026, 11, 26), 7)).toBe('2026-27');
    expect(taxYearName(at(2026, 6, 30), 7)).toBe('2025-26');
    expect(taxYearName(at(2026, 11, 26), 1)).toBe('2026');
  });

  it('draws the Australian year as July to the current month, the last bar partial', () => {
    const b = buckets('year', at(2026, 11, 26), 7);
    expect(b.map((x) => x.label)).toEqual(['Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
    expect(b[0]!.from).toBe('2026-07-01');
    expect(b[4]!.to).toBe('2026-11-30');
    expect(b.filter((x) => x.partial)).toHaveLength(1);
    expect(b[4]!.partial).toBe(true);
  });

  it('on 30 June the year is all twelve months, ending in June', () => {
    const b = buckets('year', at(2026, 6, 30), 7);
    expect(b).toHaveLength(12);
    expect(b[0]!.from).toBe('2025-07-01');
    expect(b[11]!.label).toBe('Jun');
  });

  it('on 1 July a new year has begun: one month, the first of the new year', () => {
    const b = buckets('year', at(2026, 7, 1), 7);
    expect(b).toHaveLength(1);
    expect(b[0]!.from).toBe('2026-07-01');
  });

  it('draws the Indonesian year as January to the current month', () => {
    const b = buckets('year', at(2026, 11, 26), 1);
    expect(b).toHaveLength(11);
    expect(b[0]!.from).toBe('2026-01-01');
  });

  it('keeps the rolling twelve months when no start month is given', () => {
    expect(buckets('year', at(2026, 11, 26))).toHaveLength(12);
    expect(analyticsSummary([], 'personal', 'year', [], at(2026, 11, 26)).rangeLabel).toBe('Last 12 months');
  });

  it('labels the year', () => {
    const au = analyticsSummary([], 'personal', 'year', [], at(2026, 11, 26), 7);
    expect(au.rangeLabel).toBe('2026-27 financial year to date');
    expect(au.taxYearStartMonth).toBe(7);
    expect(analyticsSummary([], 'personal', 'year', [], at(2026, 11, 26), 1).rangeLabel).toBe('2026 year to date');
    expect(analyticsSummary([], 'personal', 'year', [], at(2026, 6, 30), 7).rangeLabel).toBe('2025-26 financial year to date');
  });

  it('leaves month and quarter alone', () => {
    expect(analyticsSummary([], 'personal', 'month', [], at(2026, 11, 26), 7).rangeLabel).toBe('This month');
    expect(analyticsSummary([], 'personal', 'quarter', [], at(2026, 11, 26), 7).rangeLabel).toBe('Last 3 months');
    expect(buckets('quarter', at(2026, 11, 26), 7)).toEqual(buckets('quarter', at(2026, 11, 26)));
  });

  describe('the comparison is the previous tax year to the same day', () => {
    const now = at(2026, 11, 26);
    const ws = { workspace: 'personal' as Workspace };
    const docs = [
      // The previous year's history reaches back far enough to compare against.
      doc({ issueDate: '2025-06-10', payableAmount: '1.00', ...ws }),
      doc({ issueDate: '2025-07-01', payableAmount: '100.00', ...ws }), // first day of last FY
      doc({ issueDate: '2025-11-26', payableAmount: '50.00', ...ws }), // same day last FY: counted
      doc({ issueDate: '2025-11-27', payableAmount: '999.00', ...ws }), // after the same day: not counted
      doc({ issueDate: '2025-06-30', payableAmount: '888.00', ...ws }), // the FY before that: not counted
      doc({ issueDate: '2026-07-01', payableAmount: '300.00', ...ws }),
      doc({ issueDate: '2026-06-30', payableAmount: '777.00', ...ws }), // last FY, outside this one
    ];

    it('totals this financial year to date and last one to the same day', () => {
      const a = analyticsSummary(docs, 'personal', 'year', [], now, 7);
      expect(a.total).toBe('300.0000');
      // 100 + 50: 2025-07-01..2025-11-26 only.
      expect(a.previousTotal).toBe('150.0000');
      expect(a.changePct).toBeCloseTo(1, 5);
    });

    it('does not count last financial year in this one (calendar-year bug)', () => {
      // The 30 June 2026 receipt belongs to FY 2025-26, not to 2026-27 and not
      // to a calendar 2026 either way round.
      const a = analyticsSummary(docs, 'personal', 'year', [], now, 7);
      expect(a.largest?.amount).toBe('300.00');
    });
  });
});
