/**
 * Guards against an open redirect in every place this app takes a "come back
 * here after signing in" path from the outside: a query string, a form field,
 * a cookie set during the OAuth dance. All three are attacker-influenceable —
 * a phishing link can set `?returnTo=` to anything — so none of them may be
 * handed to a redirect without being checked first.
 *
 * The check resolves the candidate against a fixed placeholder origin using
 * the platform's own URL parser and requires the result to land back on that
 * SAME origin. That is deliberately stronger than a hand-rolled string check:
 * the WHATWG URL algorithm already knows every trick that turns an
 * apparently-relative path into a different host — a leading `//`
 * (protocol-relative), a leading backslash (treated as `/` for special
 * schemes like http), and embedded control characters (stripped before
 * parsing, which is exactly how `"/\t/evil.com"` becomes `"//evil.com"`) —
 * so re-deriving each of those rules by hand would only recreate a strictly
 * worse copy of it and risk missing the next one.
 */

const PLACEHOLDER_ORIGIN = 'http://internal.invalid';

/** True only for a same-origin, relative path — safe to redirect to. */
export function isSafeReturnPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (path.length === 0) return false;
  if (!path.startsWith('/')) return false;
  // Belt-and-braces ahead of the URL parse below: a raw control character
  // (tab, newline, CR, ...) in the input is the classic way to smuggle a
  // protocol-relative host past a naive `startsWith('//')` check, and it is
  // cheap to refuse outright rather than rely solely on the parser having
  // normalised it away correctly.
  if (/[\x00-\x1f]/.test(path)) return false;

  try {
    const resolved = new URL(path, PLACEHOLDER_ORIGIN);
    return resolved.origin === PLACEHOLDER_ORIGIN && resolved.protocol === 'http:';
  } catch {
    return false;
  }
}

/** The path itself if it is safe, otherwise `fallback`. Never throws. */
export function safeReturnPath(path: string | null | undefined, fallback: string): string {
  return isSafeReturnPath(path) ? path : fallback;
}
