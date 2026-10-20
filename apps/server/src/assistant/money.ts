/**
 * Money and percentages in text, as Australians write them (docs/ASSISTANT.md
 * §5). Shared by the money guard, the pre-tools and the knowledge loader, so
 * all three agree on what an amount is.
 *
 * Amounts are compared as integer MICRO-dollars (a bigint, keyed as a string),
 * never as floats: "$10", "$10.00" and "10 dollars" are the same key, "3.7c",
 * "3.7 cents" and "$0.037" are the same key, and no rounding ever decides
 * whether a figure is allowed.
 *
 * Recognised: "$1,000", "$82.50", "$ 5", "A$10", "AU$10", "AUD 10", "USD 10",
 * "$5k", "$2.5m", "$1 million", "1000 dollars", "10 bucks", "10 AUD",
 * "3.7 cents", "3.7c", "88c", and a dash range "$10–20" (both ends).
 */

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const MAG_TIGHT = String.raw`(?:k|K|m|M|bn)(?![A-Za-z])`;
const MAG_WORD = String.raw`(?:thousand|million|billion)\b`;
const PRE = String.raw`(?:\b(?:AUD|USD)\s?\$?\s?|(?<![A-Za-z])(?:AU|A|US)?\$\s?)`;

const RE_PRE = new RegExp(String.raw`${PRE}(${NUM})(?:(${MAG_TIGHT})|\s(${MAG_WORD}))?`, 'g');
const RE_POST = new RegExp(
  String.raw`(?<![\w.,$])(${NUM})(?:(${MAG_TIGHT})|\s?(${MAG_WORD}))?\s?(?:dollars?|bucks|AUD|USD)\b`,
  'gi',
);
const RE_CENTS = new RegExp(String.raw`(?<![\w.,$])(${NUM})(?:\s?cents?\b|c\b)`, 'g');
const RE_RANGE = new RegExp(String.raw`^\s?(?:–|—|-)\s?\$?\s?(${NUM})(?:(${MAG_TIGHT})|\s(${MAG_WORD}))?`);
const RE_PERCENT = new RegExp(String.raw`(?<![\w.,])(${NUM})\s?(?:%|per ?cent\b)`, 'gi');
const RE_BARE = new RegExp(String.raw`(?<![\w.,])(${NUM})(?![\w%]|[.,]\d)`, 'g');

const MAGNITUDE: Record<string, bigint> = {
  k: 1_000n,
  thousand: 1_000n,
  m: 1_000_000n,
  million: 1_000_000n,
  bn: 1_000_000_000n,
  billion: 1_000_000_000n,
};

/** "1,234.5" → 1234500000n micro-units. Returns null for anything else. */
export function microFromDecimal(num: string): bigint | null {
  const s = num.replace(/,/g, '').trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const frac = (m[2] ?? '').padEnd(6, '0').slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(frac || '0');
}

function scaled(num: string, mag: string | undefined): bigint | null {
  const v = microFromDecimal(num);
  if (v === null) return null;
  const k = mag ? (MAGNITUDE[mag.toLowerCase()] ?? 1n) : 1n;
  return v * k;
}

export type Amount = { micro: bigint; text: string; index: number };

/** Every money amount stated in `text`, in micro-dollars. */
export function findAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (a: number, b: number): boolean => taken.some(([x, y]) => a < y && b > x);
  const add = (index: number, len: number, micro: bigint | null, raw: string): boolean => {
    if (micro === null || overlaps(index, index + len)) return false;
    taken.push([index, index + len]);
    out.push({ micro, text: raw, index });
    return true;
  };

  for (const m of text.matchAll(RE_PRE)) {
    const index = m.index ?? 0;
    const mag = m[2] ?? m[3];
    if (!add(index, m[0].length, scaled(m[1] ?? '', mag), m[0])) continue;
    const end = index + m[0].length;
    const r = RE_RANGE.exec(text.slice(end));
    if (r) add(end, r[0].length, scaled(r[1] ?? '', r[2] ?? r[3] ?? mag), r[0]);
  }
  for (const m of text.matchAll(RE_POST)) {
    add(m.index ?? 0, m[0].length, scaled(m[1] ?? '', m[2] ?? m[3]), m[0]);
  }
  for (const m of text.matchAll(RE_CENTS)) {
    const v = microFromDecimal(m[1] ?? '');
    add(m.index ?? 0, m[0].length, v === null ? null : v / 100n, m[0]);
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Every percentage stated in `text`, as micro-units of the number ("10%" → 10000000n). */
export function findPercents(text: string): bigint[] {
  const out: bigint[] = [];
  for (const m of text.matchAll(RE_PERCENT)) {
    const v = microFromDecimal(m[1] ?? '');
    if (v !== null) out.push(v);
  }
  return out;
}

/** Plain numbers ("250", "1,000.50") in `text`, read as dollars, in micro-units. */
export function bareNumbers(text: string): bigint[] {
  const out: bigint[] = [];
  for (const m of text.matchAll(RE_BARE)) {
    const v = microFromDecimal(m[1] ?? '');
    if (v !== null) out.push(v);
  }
  return out;
}

/** True when a block of text states a figure in money (the knowledge pack drops those). */
export function mentionsMoney(s: string): boolean {
  return findAmounts(s).length > 0 || /\$\s?\d/.test(s) || /\bAUD\s?\d/i.test(s);
}

/** micro-dollars → "1234.50" (two places, for the tools). Sub-cent amounts keep their digits. */
export function microToDecimal(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${frac.padEnd(2, '0')}`;
}

/** micro-dollars → "$1,234.50" for display. */
export function formatAud(micro: bigint): string {
  const cents = (micro + 5_000n) / 10_000n;
  const whole = cents / 100n;
  const c = (cents % 100n).toString().padStart(2, '0');
  return `$${Number(whole).toLocaleString('en-AU')}.${c}`;
}

/** micro-dollars → "3.7 cents" (for amounts under a dollar). */
export function formatCents(micro: bigint): string {
  const tenThousandths = micro; // 1 cent = 10,000 micro
  const whole = tenThousandths / 10_000n;
  const frac = (tenThousandths % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''} cents`;
}

export const keyOf = (v: bigint): string => v.toString();
