/**
 * Exact decimal arithmetic on money strings, scaled to 4dp via BigInt.
 *
 * DUPLICATED ON PURPOSE. The canonical implementation is
 * `packages/db/src/money.ts`, but the mobile app must not depend on `@snap/db`
 * — that package carries the `pg` driver and the tenant-isolation helpers, and
 * the boundary is enforced by `test/boundaries.test.ts`. Sharing it would mean
 * a third package for forty lines of arithmetic.
 *
 * Keep the two in step. Both must agree that money is a decimal STRING and
 * never a float: a JSON number cannot hold 110.10 exactly, and an invoice out
 * by a cent is an invoice that gets queried.
 */

const SCALE = 4;
const FACTOR = 10n ** BigInt(SCALE);

function toUnits(value: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal amount: ${JSON.stringify(value)}`);
  const [, sign, whole, frac = ''] = m;
  const units = BigInt(whole) * FACTOR + BigInt((frac + '0000').slice(0, SCALE) || '0');
  return sign === '-' ? -units : units;
}

function fromUnits(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  return `${neg ? '-' : ''}${abs / FACTOR}.${(abs % FACTOR).toString().padStart(SCALE, '0')}`;
}

export function add(...values: string[]): string {
  return fromUnits(values.reduce((a, v) => a + toUnits(v), 0n));
}

export function subtract(a: string, b: string): string {
  return fromUnits(toUnits(a) - toUnits(b));
}

/** amount × quantity. Quantity may carry up to 3 decimals (e.g. 12.5 hours). */
export function multiply(amount: string, qty: number): string {
  const q = BigInt(Math.round(qty * 1000));
  return fromUnits((toUnits(amount) * q) / 1000n);
}

/**
 * GST on a SALE: 10% added to the ex-GST price, rounded half up.
 *
 * The inverse of a purchase receipt, where GST is 1/11 of the GST-inclusive
 * total. Mixing the two up is the classic bug in Australian billing software,
 * so the two directions are separate named functions rather than one helper
 * with a flag.
 */
export function gstOnSale(exGst: string): string {
  const u = toUnits(exGst);
  const neg = u < 0n;
  const abs = neg ? -u : u;
  // 10%, then rounded to the CENT rather than to 4dp: this figure is billed and
  // remitted, so a sub-cent remainder has nowhere to go. $17.45 -> $1.75.
  const tenth = (abs * 2n + 10n) / 20n;          // abs / 10, half away from zero
  const cents = ((tenth + 50n) / 100n) * 100n;   // snap to the cent, half up
  return fromUnits(neg ? -cents : cents);
}

/** GST inside a GST-INCLUSIVE amount: exactly 1/11, rounded half up. */
export function gstFromInclusive(inclusive: string): string {
  const u = toUnits(inclusive);
  const neg = u < 0n;
  const abs = neg ? -u : u;
  const rounded = (abs * 2n + 11n) / 22n;
  return fromUnits(neg ? -rounded : rounded);
}

export function isZero(a: string): boolean {
  return toUnits(a) === 0n;
}

export const ZERO = '0.0000';
