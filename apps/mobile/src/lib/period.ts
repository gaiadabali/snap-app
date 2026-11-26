import { startOfTaxYear, taxYearName } from './analytics';

/** The periods a receipt list or export can be cut by, and their date ranges. */
export type Period = 'all' | 'month' | 'lastMonth' | 'quarter' | 'year';

export const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: '12 months' },
  { key: 'all', label: 'All' },
];

/**
 * The period cards with "Year" named for the tax year, for the export screen:
 * "2026-27 financial year" where the tax year starts in July, "2026 year"
 * where it is the calendar year. Pair it with `periodRange(..., startMonth)`.
 */
export function taxYearPeriods(
  taxYearStartMonth: number,
  now = new Date(),
): Array<{ key: Period; label: string }> {
  const name = taxYearName(now, taxYearStartMonth);
  const label = taxYearStartMonth === 1 ? `${name} year` : `${name} financial year`;
  return PERIODS.map((x) => (x.key === 'year' ? { ...x, label } : x));
}

/**
 * Inclusive [from, to] for a period, as ISO dates.
 *
 * `taxYearStartMonth` (1-12, from the server's tax rule set) makes "year" the
 * tax year to date: 1 July for Australia, 1 January for Indonesia. Without it
 * "year" stays the rolling twelve months, which the receipts list still uses.
 */
export function periodRange(
  period: Period,
  now = new Date(),
  taxYearStartMonth?: number,
): { from: string; to: string } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const end = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  switch (period) {
    case 'month':
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: end };
    case 'lastMonth':
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'quarter':
      return {
        from: iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)),
        to: end,
      };
    case 'year':
      return {
        from: iso(
          taxYearStartMonth
            ? startOfTaxYear(now, taxYearStartMonth)
            : new Date(now.getFullYear(), now.getMonth() - 11, 1),
        ),
        to: end,
      };
    default:
      return { from: '0000-01-01', to: '9999-12-31' };
  }
}
