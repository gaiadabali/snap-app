import type { Addr } from '@snap/mail-engine';

/**
 * Pure text helpers for the mail screens: address parsing for the compose form and
 * linkifying a plain-text body. Nothing here touches HTML; plain text is rendered by
 * React, which escapes it, and links are built as elements, never as markup.
 */

const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]{2,}$/;
export const isEmailAddress = (value: string): boolean => value.length <= 254 && EMAIL.test(value);

/** Splits on commas, semicolons and new lines that are not inside double quotes or angle brackets. */
function splitList(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let angle = false;
  for (const ch of input) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '<') angle = true;
    else if (!quoted && ch === '>') angle = false;
    if (!quoted && !angle && (ch === ',' || ch === ';' || ch === '\n')) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

/**
 * "Maria <maria@example.com>, dev@example.org" -> addresses. Anything that is not an
 * address comes back in `invalid` so the form can name it.
 */
export function parseAddresses(input: string): { ok: Addr[]; invalid: string[] } {
  const ok: Addr[] = [];
  const invalid: string[] = [];
  for (const item of splitList(input)) {
    const angled = /^(.*)<([^<>]*)>\s*$/.exec(item);
    if (angled) {
      const email = (angled[2] ?? '').trim();
      const name = (angled[1] ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
      if (isEmailAddress(email)) ok.push(name ? { name, email } : { email });
      else invalid.push(item);
    } else if (isEmailAddress(item)) {
      ok.push({ email: item });
    } else {
      invalid.push(item);
    }
  }
  return { ok, invalid };
}

/** The inverse, for filling the compose form from a draft. */
export function formatAddresses(list: Addr[] | undefined): string {
  return (list ?? []).map((a) => (a.name ? `${a.name.replace(/[<>",;]/g, '')} <${a.email}>` : a.email)).join(', ');
}

export type TextPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const URL_AT = /(https?:\/\/[^\s<>"']+)/g;
const TRAILING = /[.,;:!?)\]}]+$/;

/**
 * Splits plain text into text and http(s) links. Only http and https are linked, so a
 * `javascript:` or `data:` string in a message stays inert text.
 */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_AT)) {
    const start = match.index ?? 0;
    let url = match[0];
    const tail = TRAILING.exec(url)?.[0] ?? '';
    if (tail) url = url.slice(0, url.length - tail.length);
    if (url.length <= 'https://'.length) continue;
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) });
    parts.push({ kind: 'link', text: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

const QUOTE_DATE = /^(On |Date: )(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/gm;

/**
 * The engine writes the date of a quoted message as an ISO timestamp ("On 2026-11-20T02:00:00.000Z,
 * Maria wrote:", "Date: ..." in a forward). People write "Fri, 20 Nov 2026, 1:00 pm". Only those two
 * line starts are touched, so a timestamp the sender typed elsewhere in the body is left alone.
 * Delete this once the engine formats the date itself.
 */
export function prettifyQuotedDates(text: string, format: (iso: string) => string): string {
  return text.replace(QUOTE_DATE, (whole, lead: string, iso: string) => {
    const nice = format(iso);
    return nice ? `${lead}${nice}` : whole;
  });
}

/** A banner call-to-action link from the server is shown only when it is plain https. */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
