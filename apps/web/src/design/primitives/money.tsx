'use client';

// A client component only so it can read the workspace currency from context;
// it still renders on the server like any other.
import { createContext, useContext, type ReactNode } from 'react';

import { cx } from './cx';

const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

/**
 * Renders a decimal money STRING.
 *
 * It never accepts a number and never parses one. `@snap/api-contract` is
 * explicit that a JSON float cannot hold 110.10 exactly and a BAS out by a cent
 * is wrong, so formatting here is string surgery only — group the integer part,
 * take two decimal places, done. The moment this calls parseFloat, the contract
 * that keeps the books right has been broken on the client.
 */
/**
 * How each currency is written, where it differs from the AUD default.
 *
 * Indonesia inverts the separators against Australia and has no sub-unit at
 * all: `Rp 1.234.567`, not `$1,234,567.89`. Rendering a rupiah figure with a
 * dollar sign and two decimals is not a cosmetic slip — it is the same class of
 * error as `docs/INDONESIA.md` §7.1, where reading `15.000` under the wrong
 * convention silently means fifteen instead of fifteen thousand.
 *
 * A currency this table does not know is written by `Intl` in en-AU
 * (`EUR 5.50`, `USD 5.50`: there `$` means AUD), never under the AUD symbol.
 */
const CURRENCY_FORMATS: Record<
  string,
  { symbol: string; decimals: number; group: string; decimal: string; space: boolean }
> = {
  AUD: { symbol: '$', decimals: 2, group: ',', decimal: '.', space: false },
  IDR: { symbol: 'Rp', decimals: 0, group: '.', decimal: ',', space: true },
};

/**
 * The currency a `<Money>` with no `currency` prop is shown in: the active
 * workspace's `baseCurrency`, provided once by the panel shell. Outside a
 * workspace (marketing, admin) there is no provider and it stays AUD, which is
 * also what SnapApp's own prices are in — those pass `currency="AUD"` anyway.
 */
const CurrencyContext = createContext('AUD');

export function WorkspaceCurrency({ currency, children }: { currency: string; children: ReactNode }) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}

export function Money({
  amount,
  currency: given,
  className,
}: {
  amount: string;
  /** A document's own currency, or `AUD` for SnapApp's prices. Omitted: the workspace's. */
  currency?: string | null;
  className?: string;
}) {
  const fallback = useContext(CurrencyContext);
  const currency = given || fallback;
  const trimmed = amount.trim();
  const fmt = CURRENCY_FORMATS[currency.toUpperCase()];
  if (!fmt) {
    return (
      <span className={cx('tabular', className)} title={currency + ' ' + amount}>
        {otherCurrency(trimmed, currency)}
      </span>
    );
  }
  const negative = trimmed.startsWith('-');
  const digits = negative ? trimmed.slice(1) : trimmed;
  const parts = digits.split('.');
  const whole = parts[0] ?? '0';
  const grouped = whole.replace(THOUSANDS, fmt.group);

  // A currency with no sub-unit prints none. Rp 1.110.000,00 is not a price
  // anyone in Indonesia has ever seen written down.
  const fraction =
    fmt.decimals === 0
      ? ''
      : fmt.decimal + (parts[1] ?? '').slice(0, fmt.decimals).padEnd(fmt.decimals, '0');

  return (
    <span className={cx('tabular', className)} title={currency + ' ' + amount}>
      {negative ? '−' : ''}
      {fmt.symbol}
      {fmt.space ? ' ' : ''}
      {grouped}
      {fraction}
    </span>
  );
}

/**
 * A currency outside the table. `Intl` formats the decimal STRING as given (an
 * exact decimal, not a float, in current engines). A code `Intl` rejects is
 * shown as itself: `XYZ 5.50`.
 */
function otherCurrency(amount: string, code: string): string {
  try {
    // A string is an exact decimal to Intl; the cast is only for older lib typings.
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: code }).format(amount as unknown as number);
  } catch {
    return `${code} ${amount}`;
  }
}
