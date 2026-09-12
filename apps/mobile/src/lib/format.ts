/**
 * Display formatting. Pure string maths — no React Native, no theme.
 *
 * Kept out of `src/theme` deliberately: that module imports `react-native` for
 * `Platform`, which drags a Flow-typed entry point into anything that touches
 * it, including tests. Formatting is arithmetic and belongs where it can be
 * unit-tested directly.
 */

/**
 * Format cents-exact decimal strings for display.
 *
 * Takes the wire format (a decimal STRING, never a number) and renders it. The
 * string is split on the decimal point and grouped textually — it is never
 * parsed to a float, because 0.1 + 0.2 is not 0.3 and a receipt app that
 * rounds is worthless.
 */
export function formatAud(value: string | null | undefined, opts?: { cents?: boolean }): string {
  if (value == null) return '—';
  const negative = value.trimStart().startsWith('-');
  const [wholeRaw = '0', fracRaw = ''] = value.replace('-', '').split('.');

  // ROUND to the cent, never truncate. A 4dp value like "1.7450" is $1.75, and
  // showing $1.74 makes a displayed subtotal + GST disagree with the displayed
  // total — the kind of one-cent mismatch that gets an invoice queried.
  const scaled = BigInt(wholeRaw) * 10000n + BigInt((fracRaw + '0000').slice(0, 4) || '0');

  if (opts?.cents === false) {
    // Round to the DOLLAR, not truncate: $999.60 is nearer $1,000 than $999.
    const dollars = (scaled + 5000n) / 10000n;
    return `${negative ? '-' : ''}$${group(dollars)}`;
  }

  const cents = (scaled + 50n) / 100n; // half up
  const frac = (cents % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${group(cents / 100n)}.${frac}`;
}

function group(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "2026-09-07" -> "7 Sep" */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]}`;
}

/** 51824753556 -> 51 824 753 556, the way the ATO prints it. */
export function formatAbn(abn: string | null | undefined): string {
  if (!abn) return 'Not shown';
  const d = abn.replace(/\D/g, '');
  if (d.length !== 11) return abn;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
}
