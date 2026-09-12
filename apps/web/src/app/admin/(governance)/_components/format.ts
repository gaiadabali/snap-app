/**
 * Display-only formatting for the governance surface.
 *
 * Every figure here is an operator estimate (spend projections, storage,
 * durations) — not a ledger amount. `docs/WEB.md` §3.2's "never `parseFloat`,
 * never arithmetic in the browser" rule protects the accounting ledger, which
 * this surface never touches; these helpers run server-side in RSCs, and the
 * one place a real dollar amount reaches `<Money>` it arrives as a decimal
 * string produced here, not parsed from one.
 */

/** A JS number of dollars to the decimal STRING `<Money>` expects. */
export function usd(amount: number): string {
  return amount.toFixed(2);
}

export function pct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function compactNumber(n: number): string {
  return n.toLocaleString('en-AU');
}

export function bytesToHuman(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function secondsToHuman(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3_600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}

export function relativeTime(iso: string, nowIso = '2026-09-12T09:00:00+10:00'): string {
  const diffMs = new Date(nowIso).getTime() - new Date(iso).getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let label: string;
  if (mins < 60) label = `${mins}m`;
  else if (hours < 48) label = `${hours}h`;
  else label = `${days}d`;
  return future ? `in ${label}` : `${label} ago`;
}
