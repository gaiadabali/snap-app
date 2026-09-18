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

/**
 * A rate as an exact fraction — numerator over denominator.
 *
 * Structurally identical to `Rational` in `@snap/tax-rules/src/contract.ts`,
 * declared locally rather than imported: `test/boundaries.test.ts` scans this
 * exact file for any import from outside this package, so a real
 * `ConsumptionTaxSpec.inclusiveFraction` from an installed rule set is passed
 * in as a plain `{ n, d }` value — TypeScript matches it structurally, no
 * import required.
 */
export interface Rational {
  n: number;
  d: number;
}

function checkRational(rate: Rational | null | undefined, fn: string): asserts rate is Rational {
  if (
    rate == null ||
    typeof rate.n !== 'number' ||
    typeof rate.d !== 'number' ||
    !Number.isFinite(rate.n) ||
    !Number.isFinite(rate.d) ||
    rate.n < 0 ||
    rate.d <= 0
  ) {
    throw new Error(
      `${fn} requires a tax rate from an installed tax rule set (for example ` +
        `ConsumptionTaxSpec.inclusiveFraction from @snap/tax-rules) — there is deliberately no ` +
        'default. packages/tax-rules/README.md: "No rule set installed -> every calculation ' +
        'throws." A silently assumed 1/11 for a jurisdiction that is not Australia is exactly ' +
        'the failure that rule exists to prevent.',
    );
  }
}

/**
 * amount x rate, exactly, rounded half away from zero to the Money type's
 * native 4dp scale.
 *
 * The generic primitive `gstFromInclusive` and Indonesia's DPP Nilai Lain
 * base (`ConsumptionTaxSpec.baseFraction`, docs/INDONESIA.md §2.3) both need:
 * an exact rational multiply, not a float, and not a rate compiled into this
 * file. `rate` always comes from the caller's installed tax rule set.
 */
export function applyFraction(amount: string, rate: Rational): string {
  checkRational(rate, 'applyFraction');
  const u = toUnits(amount);
  const neg = u < 0n;
  const abs = neg ? -u : u;
  const n = BigInt(rate.n);
  const d = BigInt(rate.d);
  // Half away from zero: (abs*n*2 + d) / (d*2) — the same technique this file
  // has always used for 1/11, generalised to an arbitrary exact fraction.
  const rounded = (abs * n * 2n + d) / (d * 2n);
  return fromUnits(neg ? -rounded : rounded);
}

/**
 * Tax inside a tax-INCLUSIVE amount, rounded half up.
 *
 * `rate` is `inclusiveFraction` from the taxpayer's installed tax rule set —
 * exactly 1/11 for Australian GST, 11/111 for Indonesian PPN under DPP Nilai
 * Lain (docs/INDONESIA.md §2.2-§2.3). It is never hardcoded here: this
 * function used to compute `(abs * 2 + 11) / 22` unconditionally, which is
 * the defect `docs/STATEMENTS.md` §12 ticket S2 and `docs/INDONESIA.md` §7.4
 * record as live in production for every Indonesian document. There is no
 * default parameter and no `?? 1/11` — a caller with no rule set installed
 * must resolve one (`TaxRulesRegistry.requireFor`, which itself throws) before
 * calling this, and passing nothing here throws too rather than silently
 * assuming Australia.
 */
export function gstFromInclusive(inclusive: string, rate: Rational): string {
  checkRational(rate, 'gstFromInclusive');
  return applyFraction(inclusive, rate);
}

export function isZero(a: string): boolean {
  return toUnits(a) === 0n;
}

export const ZERO = '0.0000';
