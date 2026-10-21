/**
 * Display formatting. Pure string maths — no React Native, no theme.
 *
 * Kept out of `src/theme` deliberately: that module imports `react-native` for
 * `Platform`, which drags a Flow-typed entry point into anything that touches
 * it, including tests. Formatting is arithmetic and belongs where it can be
 * unit-tested directly.
 */

/**
 * How each currency we show is written. A small table instead of `Intl`:
 * Hermes on Android ships patchy Intl data, and a receipt app cannot have the
 * symbol or grouping depend on which phone it runs on.
 *
 * `decimals` is what is SHOWN, not what the server stores (always 4dp). Rupiah
 * has no cents in practice, so it rounds to the whole rupiah.
 */
type CurrencyStyle = { symbol: string; decimals: 0 | 2; group: string; point: string; space: boolean };

const STYLES: Record<string, CurrencyStyle> = {
  AUD: { symbol: '$', decimals: 2, group: ',', point: '.', space: false },
  IDR: { symbol: 'Rp', decimals: 0, group: '.', point: ',', space: true },
};

/** A code we have no style for is shown as its code, never under a wrong symbol. */
function styleFor(currency: string | null | undefined): CurrencyStyle {
  const code = (currency || 'AUD').toUpperCase();
  return STYLES[code] ?? { symbol: code, decimals: 2, group: ',', point: '.', space: true };
}

/** What an amount input shows before the number: `$`, `Rp`, else the ISO code. */
export function currencySymbol(currency: string | null | undefined): string {
  return styleFor(currency).symbol;
}

/** Decimal places an amount input should prefill: 2 for AUD, 0 for rupiah. */
export function currencyDecimals(currency: string | null | undefined): 0 | 2 {
  return styleFor(currency).decimals;
}

/**
 * Format cents-exact decimal strings for display.
 *
 * Takes the wire format (a decimal STRING, never a number) and renders it. The
 * string is split on the decimal point and grouped textually — it is never
 * parsed to a float, because 0.1 + 0.2 is not 0.3 and a receipt app that
 * rounds is worthless.
 */
export function formatMoney(
  value: string | null | undefined,
  currency: string | null | undefined,
  opts?: { cents?: boolean },
): string {
  if (value == null) return '—';
  const st = styleFor(currency);
  const negative = value.trimStart().startsWith('-');
  const [wholeRaw = '0', fracRaw = ''] = value.replace('-', '').split('.');
  const lead = `${negative ? '-' : ''}${st.symbol}${st.space ? ' ' : ''}`;

  // ROUND to the cent, never truncate. A 4dp value like "1.7450" is $1.75, and
  // showing $1.74 makes a displayed subtotal + GST disagree with the displayed
  // total — the kind of one-cent mismatch that gets an invoice queried.
  const scaled = BigInt(wholeRaw) * 10000n + BigInt((fracRaw + '0000').slice(0, 4) || '0');

  if (opts?.cents === false || st.decimals === 0) {
    // Round to the whole unit, not truncate: $999.60 is nearer $1,000 than $999.
    const units = (scaled + 5000n) / 10000n;
    return `${lead}${group(units, st.group)}`;
  }

  const cents = (scaled + 50n) / 100n; // half up
  const frac = (cents % 100n).toString().padStart(2, '0');
  return `${lead}${group(cents / 100n, st.group)}${st.point}${frac}`;
}

/**
 * Australian dollars, for the amounts that are AUD by product decision
 * (SnapApp's own credit and plan prices). Never for a workspace's books: those
 * go through `formatMoney` with the record's or workspace's currency.
 */
export function formatAud(value: string | null | undefined, opts?: { cents?: boolean }): string {
  return formatMoney(value, 'AUD', opts);
}

function group(n: bigint, sep: string): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);
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
