import { describe, expect, it } from 'vitest';

import type { DocumentView, Workspace } from '@/api/types';
import {
  analyticsSummary,
  buckets,
  byCategory,
  divide,
  personalSummary,
  series,
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
