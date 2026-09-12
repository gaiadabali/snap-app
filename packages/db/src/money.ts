import type { Money } from './types';

/**
 * Exact decimal arithmetic on money strings, via scaled BigInt.
 *
 * No dependency, no floats. `money_amount` is NUMERIC(19,4), so everything is
 * scaled by 10^4 into a BigInt, operated on exactly, then rendered back.
 *
 * This exists so the ledger's sum-zero invariant can be checked *before* hitting
 * the database — the deferred constraint trigger is the backstop, not the first
 * line of defence. A user should get "these splits don't balance" in the UI, not
 * a 500 from a failed COMMIT.
 */

const SCALE = 4;
const FACTOR = 10n ** BigInt(SCALE);

/** Parse a decimal string into scaled BigInt units. Throws on junk. */
function toUnits(value: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal amount: ${JSON.stringify(value)}`);
  const [, sign, whole, frac = ''] = m;
  if (frac.length > SCALE) {
    throw new Error(`more than ${SCALE} decimal places: ${value}`);
  }
  const padded = frac.padEnd(SCALE, '0');
  const units = BigInt(whole) * FACTOR + BigInt(padded || '0');
  return sign === '-' ? -units : units;
}

function fromUnits(units: bigint): Money {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${frac}` as Money;
}

/** Construct a Money from a string or integer-valued number. */
export function money(value: string | number): Money {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`not a finite amount: ${value}`);
    // Only whole numbers are safe to accept from a float; anything with a
    // fractional part should arrive as a string so no rounding has happened yet.
    if (!Number.isInteger(value)) {
      throw new Error(
        `refusing to build Money from a fractional number (${value}) — pass a string instead`,
      );
    }
    return fromUnits(BigInt(value) * FACTOR);
  }
  return fromUnits(toUnits(value));
}

export const ZERO: Money = money(0);

export function add(...values: Money[]): Money {
  return fromUnits(values.reduce((acc, v) => acc + toUnits(v), 0n));
}

export function subtract(a: Money, b: Money): Money {
  return fromUnits(toUnits(a) - toUnits(b));
}

export function negate(a: Money): Money {
  return fromUnits(-toUnits(a));
}

/** -1, 0 or 1. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  const d = toUnits(a) - toUnits(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

export function isZero(a: Money): boolean {
  return toUnits(a) === 0n;
}

/** Sum of splits must be exactly zero — the ledger invariant, checked client-side. */
export function balances(amounts: Money[]): boolean {
  return isZero(add(...amounts));
}

/**
 * Australian GST on a GST-inclusive amount: exactly 1/11, rounded half-up to
 * the cent. Used to sanity-check extracted totals before they reach the ledger.
 */
export function gstFromInclusive(inclusive: Money): Money {
  const units = toUnits(inclusive);
  // Round half away from zero: (|u| * 2 + 11) / 22, sign restored.
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const rounded = (abs * 2n + 11n) / 22n;
  return fromUnits(negative ? -rounded : rounded);
}

/** For display only. Never feed the result back into arithmetic. */
export function formatAud(value: Money): string {
  const units = toUnits(value);
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const cents = abs / 100n;
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${frac}`;
}
