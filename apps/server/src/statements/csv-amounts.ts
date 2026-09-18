/**
 * Turning one CSV cell into an exact `Money` value.
 *
 * `docs/STATEMENTS.md` §5.6 names the hazard directly: "encoding (non-UTF-8
 * exports, BOMs, semicolon delimiters from locales where the comma is the
 * decimal mark)". The decimal/thousands separators are a JURISDICTION fact —
 * `docs/INDONESIA.md` §7.1 traced a real thousand-fold error to exactly this
 * (`15.000` meaning fifteen thousand in Indonesia, fifteen under an
 * AU-shaped regex) — so they come from the installed `TaxRules.currency`,
 * never a constant here (D-S1).
 *
 * Arithmetic itself goes through `@snap/db`'s `money` module: scaled-BigInt,
 * no floats, the same module `transaction_splits` balancing already trusts.
 * This file's only job is turning "Rp 1.234.567,89" or "(45.00)" into the
 * plain decimal string that module accepts.
 */
import { money as moneyNs, type Money } from '@snap/db';

export interface AmountFormat {
  thousandsSeparator: string;
  decimalSeparator: string;
}

/** Escapes a single character for use inside a RegExp character class. */
function escapeForRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses one printed amount into `Money`, or `null` when the cell is blank
 * or not a recognisable number — the caller decides whether a blank cell is
 * expected (an unused debit/credit column on this row) or a refusal.
 *
 * Accounting negatives — `(45.00)` — are recognised because several bank and
 * card exports print them that way; a bare trailing/leading minus sign is
 * recognised too.
 */
export function parseAmount(raw: string, format: AmountFormat): Money | null {
  let s = raw.trim();
  if (s === '') return null;

  let negative = false;
  const parenMatch = /^\((.*)\)$/.exec(s);
  if (parenMatch) {
    negative = true;
    s = parenMatch[1]!.trim();
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }

  // Strip anything that is not a digit or one of the two separators — this
  // is what removes a currency symbol ("Rp", "$") or stray spaces used as a
  // thousands grouping, without assuming which symbol a given export uses.
  const keep = new Set([format.thousandsSeparator, format.decimalSeparator]);
  s = Array.from(s)
    .filter((ch) => /\d/.test(ch) || keep.has(ch))
    .join('');
  if (s === '') return null;

  const thousandsRe = new RegExp(escapeForRegex(format.thousandsSeparator), 'g');
  const withoutThousands = s.replace(thousandsRe, '');
  const decimalRe = new RegExp(escapeForRegex(format.decimalSeparator));
  const normalised = withoutThousands.replace(decimalRe, '.');

  if (!/^\d+(\.\d+)?$/.test(normalised)) return null;

  try {
    const value = moneyNs.money(normalised);
    return negative ? moneyNs.money(`-${value}`) : value;
  } catch {
    return null;
  }
}
