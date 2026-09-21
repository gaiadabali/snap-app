/**
 * Exact arithmetic for rule set calculations.
 *
 * DUPLICATED ON PURPOSE, for the same reason `packages/api-contract/src/money.ts`
 * duplicates `packages/db/src/money.ts`: a rule set must be readable by the mobile
 * app, and pulling `@snap/db` across that boundary would drag the `pg` driver
 * with it. `test/boundaries.test.ts` enforces the rule.
 *
 * What is NOT duplicated is the tax arithmetic. `gstFromInclusive` lives in
 * those modules with `1/11` compiled into it — that constant is the
 * jurisdiction, and the whole point of a rule set is that it stops being a
 * constant. Here the rate arrives as a `Rational` and the maths is exact
 * BigInt, so `11/111` stays `11/111` until the single rounding step at the end.
 *
 * Money is a decimal STRING throughout, never a float. A BAS out by a cent is
 * wrong, and an SPT out by a rupiah is wrong in a currency where a rupiah is
 * the smallest unit there is.
 */

import type { CurrencySpec, Rational } from './contract.js';

/** Internal working scale. Wider than any currency so rounding happens once. */
const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);

/* ── Rationals ─────────────────────────────────────────────────────────────── */

export function rational(n: number, d: number): Rational {
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    throw new Error(`rational must be integral: ${n}/${d}`);
  }
  if (d <= 0) throw new Error(`rational denominator must be positive: ${n}/${d}`);
  return { n, d };
}

/** a x b, unreduced — exact, since both are integer pairs. */
export function multiplyRational(a: Rational, b: Rational): Rational {
  return { n: a.n * b.n, d: a.d * b.d };
}

/** a / (1 + a). Turns an ex-tax rate into the fraction inside an inclusive total. */
export function inclusiveOf(rate: Rational): Rational {
  // a/b / (1 + a/b) = a / (a + b)
  return { n: rate.n, d: rate.n + rate.d };
}

/** Do two rationals denote the same value? `2/4` equals `1/2`. */
export function rationalsEqual(a: Rational, b: Rational): boolean {
  return BigInt(a.n) * BigInt(b.d) === BigInt(b.n) * BigInt(a.d);
}

export function rationalToString(r: Rational): string {
  return `${r.n}/${r.d}`;
}

/* ── Decimal strings ───────────────────────────────────────────────────────── */

function toUnits(value: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal amount: ${JSON.stringify(value)}`);
  const [, sign, whole, frac = ''] = m;
  const units = BigInt(whole) * FACTOR + BigInt((frac + '000000').slice(0, SCALE) || '0');
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

export function compare(a: string, b: string): number {
  const x = toUnits(a);
  const y = toUnits(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * How far a document's lines sit from its total, as a signed decimal string.
 *
 * This is the pre-posting gap check the ledger runs before it writes — the
 * same rule as the numeric `linesGap` in `apps/server/src/extraction/
 * validators.ts`, but counted in BigInt rather than IEEE doubles. It matters
 * because the check sits directly on a tolerance boundary: a payable of 2.02
 * against 2.00 of lines is exactly 0.02 short, and a float accumulation lands
 * a few quadrillionths past or short of that line, so the verdict can flip on
 * drift rather than on the paper. A gap check that gates what may be posted
 * must count the way the ledger counts.
 *
 * Positive means the lines are short of the total. When the document states
 * its tax, the lines may be tax-inclusive or tax-exclusive; the gap reported
 * is the smaller of the two readings, whichever convention the paper uses.
 */
export function linesGap(lineSum: string, payable: string | null, gst: string | null): string {
  const sum = toUnits(lineSum);
  const total = toUnits(payable ?? ZERO);
  const inclusive = total - sum;
  // Only meaningful when the document states its tax. With no tax stated
  // there is one reading, and it is the inclusive one.
  if (gst == null) return fromUnits(inclusive);
  const exclusive = total - toUnits(gst) - sum;
  return fromUnits(
    (exclusive < 0n ? -exclusive : exclusive) < (inclusive < 0n ? -inclusive : inclusive)
      ? exclusive
      : inclusive,
  );
}

export function isNegative(a: string): boolean {
  return toUnits(a) < 0n;
}

export const ZERO = '0.000000';

/**
 * amount x rational, rounded half away from zero to the currency's minor unit.
 *
 * Half AWAY from zero rather than half up, so a credit note and the invoice it
 * reverses round to the same magnitude. Half up makes `-0.5` round to `0` and
 * `0.5` round to `1`, and a refund that does not reverse its own sale is a
 * defect that surfaces months later in a reconciliation.
 */
export function applyRate(amount: string, rate: Rational, currency: CurrencySpec): string {
  const units = toUnits(amount);
  const neg = units < 0n;
  const abs = neg ? -units : units;

  // Exact: multiply first, divide once, at full working scale.
  const scaled = (abs * BigInt(rate.n)) / BigInt(rate.d);
  const rounded = roundUnits(scaled, currency.minorUnits);
  return fromUnits(neg ? -rounded : rounded);
}

/** Round a non-negative unit count to `minorUnits` decimal places, half up. */
function roundUnits(abs: bigint, minorUnits: number): bigint {
  const drop = SCALE - minorUnits;
  if (drop <= 0) return abs;
  const step = 10n ** BigInt(drop);
  return ((abs + step / 2n) / step) * step;
}

/**
 * Round a decimal string to the currency's own precision, half away from zero.
 *
 * IDR has `minorUnits: 0`, so this is what stops a rupiah figure carrying
 * fractions that cannot exist.
 */
export function roundToCurrency(amount: string, currency: CurrencySpec): string {
  const units = toUnits(amount);
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const rounded = roundUnits(abs, currency.minorUnits);
  return fromUnits(neg ? -rounded : rounded);
}

/**
 * The reconciliation tolerance for a currency, as a decimal string.
 *
 * `docs/INDONESIA.md` §7.2: `ROUNDING_TOLERANCE = 0.05` in `validators.ts` is a
 * literal dollar amount, and five rupiah is not five cents. The tolerance that
 * generalises is "a few of whatever the till rounds to" — five increments of
 * `tillRounding`, which is 5 cents in Australia and Rp 500 in Indonesia.
 */
export function reconcileTolerance(currency: CurrencySpec): string {
  const increments = 5n;
  const step = BigInt(currency.tillRounding) * 10n ** BigInt(SCALE - currency.minorUnits);
  return fromUnits(step * increments);
}

/* ── Reading local paper ───────────────────────────────────────────────────── */

/**
 * Parse an amount as printed in this jurisdiction into a decimal string.
 *
 * **This function exists because of a live thousand-fold bug.**
 * `docs/INDONESIA.md` §7.1: rupiah prints `15.000` for fifteen thousand, and
 * the existing `toUnits()` regex accepts that as `15.0000` without complaint —
 * verified by running it. It passes every downstream check, because the tax
 * arithmetic stays internally consistent whatever the magnitude.
 *
 * So separators are not guessed. The currency says which is which, and anything
 * that does not fit the declared convention is REFUSED rather than coerced.
 * Fail closed: a number we cannot read is not a number we may assume.
 */
export function parseLocalAmount(printed: string, currency: CurrencySpec): string {
  const cleaned = printed
    .trim()
    .replace(new RegExp(`^\\s*${escapeRe(currency.symbol)}\\s*`, 'i'), '')
    .replace(/\s/g, '');
  if (cleaned === '') throw new Error('empty amount');

  const neg = /^-/.test(cleaned) || /^\(.*\)$/.test(cleaned);
  const body = cleaned.replace(/^[-(]/, '').replace(/\)$/, '');

  const thou = escapeRe(currency.thousandsSeparator);
  const dec = escapeRe(currency.decimalSeparator);

  // Groups after the first thousands separator must be exactly three digits.
  // This is what distinguishes `1.234.567` (grouped) from `15.000` read under
  // the WRONG convention, and from a genuine decimal `15.0`.
  const grouped = new RegExp(`^\\d{1,3}(?:${thou}\\d{3})+(?:${dec}\\d+)?$`);
  const plain = new RegExp(`^\\d+(?:${dec}\\d+)?$`);

  let normalised: string;
  if (grouped.test(body)) {
    normalised = body.split(currency.thousandsSeparator).join('');
  } else if (plain.test(body)) {
    normalised = body;
  } else {
    throw new Error(
      `"${printed}" is not a ${currency.code} amount ` +
        `(expected ${currency.thousandsSeparator} for thousands, ` +
        `${currency.decimalSeparator} for decimals)`,
    );
  }

  normalised = normalised.split(currency.decimalSeparator).join('.');

  // A currency with no minor units must not carry a decimal part at all.
  // Rp 15,50 is not a price; it is a misread of a different convention.
  if (currency.minorUnits === 0 && normalised.includes('.')) {
    throw new Error(`${currency.code} has no sub-unit, but "${printed}" carries a decimal part`);
  }
  const fracDigits = normalised.split('.')[1]?.length ?? 0;
  if (fracDigits > currency.minorUnits) {
    throw new Error(
      `"${printed}" has ${fracDigits} decimal places; ${currency.code} has ${currency.minorUnits}`,
    );
  }

  return fromUnits(neg ? -toUnits(normalised) : toUnits(normalised));
}

/** Money as a person in this jurisdiction reads it. */
export function formatLocalAmount(amount: string, currency: CurrencySpec): string {
  const n = Number(amount);
  const body = n.toLocaleString(currency.locale, {
    minimumFractionDigits: currency.minorUnits,
    maximumFractionDigits: currency.minorUnits,
  });
  return `${currency.symbol}${currency.symbol.length > 1 ? ' ' : ''}${body}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
