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
 * A rate as an exact fraction — numerator over denominator.
 *
 * Structurally identical to `Rational` in `@snap/tax-rules/src/contract.ts`.
 * Declared locally rather than imported, to stay in step with the mobile-side
 * copy in `packages/api-contract/src/money.ts` (which cannot import anything
 * from outside its own package — see that file's comment). A real
 * `ConsumptionTaxSpec.inclusiveFraction` or `.baseFraction` from
 * `@snap/tax-rules` satisfies this structurally; no import is required to
 * pass one in.
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
        `ConsumptionTaxSpec.inclusiveFraction or .baseFraction from @snap/tax-rules) — there is ` +
        'deliberately no default. packages/tax-rules/README.md: "No rule set installed -> every ' +
        'calculation throws." A silently assumed 1/11 for a jurisdiction that is not Australia is ' +
        'exactly the failure that rule exists to prevent.',
    );
  }
}

/**
 * amount x rate, exactly, rounded half away from zero to 4dp — this module's
 * native scale, matching `money_amount NUMERIC(19,4)`.
 *
 * The general primitive behind `gstFromInclusive`, and behind deriving the
 * DPP Nilai Lain base an Indonesian faktur prints (`ConsumptionTaxSpec
 * .baseFraction`, docs/INDONESIA.md §2.3): `taxable + tax == inclusive` does
 * NOT hold there, so a caller must apply `baseFraction` to the net amount
 * rather than assume the identity. `rate` always comes from the caller's
 * installed tax rule set — never a constant in this file.
 */
export function applyFraction(amount: Money, rate: Rational): Money {
  checkRational(rate, 'applyFraction');
  const units = toUnits(amount);
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const n = BigInt(rate.n);
  const d = BigInt(rate.d);
  // Half away from zero: (abs*n*2 + d) / (d*2) — the same technique this
  // function has always used for 1/11, generalised to an arbitrary fraction.
  const rounded = (abs * n * 2n + d) / (d * 2n);
  return fromUnits(negative ? -rounded : rounded);
}

/**
 * Tax inside a GST/PPN-inclusive amount, rounded half-up. Used to sanity-check
 * extracted totals before they reach the ledger.
 *
 * `rate` is `inclusiveFraction` from the taxpayer's installed tax rule set —
 * 1/11 for Australian GST, 11/111 for Indonesian PPN under DPP Nilai Lain.
 * This function used to compute `(abs * 2 + 11) / 22` unconditionally; that
 * hardcoded 1/11 is the live defect `docs/STATEMENTS.md` §12 ticket S2 and
 * `docs/INDONESIA.md` §7.4 record for every Indonesian document. There is no
 * default parameter and no `?? 1/11` here: a caller with no rule set
 * installed must resolve one first (`TaxRulesRegistry.requireFor`, which
 * itself throws `NoRulesInstalled`), and omitting the rate here throws too,
 * rather than silently computing under Australian law.
 */
export function gstFromInclusive(inclusive: Money, rate: Rational): Money {
  checkRational(rate, 'gstFromInclusive');
  return applyFraction(inclusive, rate);
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
