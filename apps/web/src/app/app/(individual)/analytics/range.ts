import type { AnalyticsRange } from '@snap/api-contract';
import { startOfTaxYear } from '@snap/api-contract/analytics';

/**
 * The selected range as calendar dates, for the consumption-tax read.
 *
 * "Year" is the workspace's TAX year to date, from `taxYearStartMonth`: 1 July
 * for an Australian workspace (7), 1 January for an Indonesian one (1). The
 * month is the one the server used for the Total card
 * (`AnalyticsSummary.taxYearStartMonth`, from the rule set's
 * `periods.taxYearStartMonth`), so this card and that one cover the same days.
 * When the server did not send one (an older server) it stays the calendar
 * year, which is what this page always did.
 *
 * Month and quarter are calendar-based: an Australian quarter coincides with a
 * calendar quarter.
 */
export function rangeDates(
  range: AnalyticsRange,
  taxYearStartMonth: number | undefined,
  today = new Date(),
): { from: string; to: string } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const y = today.getFullYear();
  const m = today.getMonth();
  const start =
    range === 'month'
      ? new Date(y, m, 1)
      : range === 'quarter'
        ? new Date(y, Math.floor(m / 3) * 3, 1)
        : startOfTaxYear(today, taxYearStartMonth ?? 1);
  return { from: iso(start), to: iso(today) };
}
