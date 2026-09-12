/**
 * Non-money formatting only.
 *
 * `<Money>` in `@/design/primitives` owns every dollar figure — nothing here
 * touches an amount. This is dates, percentages and small integers, which are
 * safe to format with ordinary JS numbers because they never carry a cent that
 * a BAS depends on.
 */

/** True for a bare `YYYY-MM-DD` with nothing else — a date, not a timestamp. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  // A bare date is parsed as UTC midnight so it never shifts a day depending
  // on the viewer's timezone; anything else (a full timestamp, whether
  // `T`-separated or the space-separated form Postgres's own driver can
  // return) is parsed as it stands.
  const d = new Date(DATE_ONLY.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatPercent(fraction: number | null | undefined, digits = 0): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** `0.94` confidence -> `"94%"`. Never used for money. */
export function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function reviewStatusLabel(status: string): string {
  switch (status) {
    case 'auto_accepted':
      return 'Auto-accepted';
    case 'needs_review':
      return 'Needs review';
    case 'reviewed':
      return 'Reviewed';
    case 'rejected':
      return 'Rejected';
    default:
      return status;
  }
}

export function titleCase(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
