import { describe, expect, it } from 'vitest';

import { detectRecurring, totalsByCurrency } from './analytics';
import type { DocumentView } from './index';

const doc = (supplierName: string, currency: string, payableAmount: string, issueDate: string) =>
  ({ supplierName, currency, payableAmount, issueDate, category: 'Bills' }) as DocumentView;

describe('totalsByCurrency', () => {
  it('one total per currency, only inside the window', () => {
    const docs = [
      doc('A', 'IDR', '70900', '2026-11-02'),
      doc('B', 'IDR', '20', '2026-11-03'),
      doc('C', 'USD', '5.50', '2026-11-04'),
      doc('D', 'IDR', '5000', '2020-01-01'),
    ];
    expect(totalsByCurrency(docs, '2026-11-01', '2026-11-30')).toEqual([
      { currency: 'IDR', total: '70920.0000', count: 2 },
      { currency: 'USD', total: '5.5000', count: 1 },
    ]);
    expect(totalsByCurrency([], '2026-11-01')).toEqual([]);
  });
});

describe('detectRecurring', () => {
  it('never averages one merchant across two currencies, and tags each with its own', () => {
    const now = new Date(2026, 10, 15);
    const months = ['2026-08-05', '2026-09-05', '2026-10-05'];
    const docs = [
      ...months.map((d) => doc('Netflix', 'AUD', '18.99', d)),
      ...months.map((d) => doc('Netflix', 'IDR', '186000', d)),
    ];
    const found = detectRecurring(docs, now);
    expect(found.map((r) => [r.currency, r.typicalAmount])).toEqual([
      ['IDR', '186000.0000'],
      ['AUD', '18.9900'],
    ]);
  });
});
