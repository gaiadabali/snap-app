import { createHash } from 'node:crypto';

/**
 * A port of YourTal's `services/voucher/internal/code/code.go`: 16 Crockford
 * Base32 symbols plus a mod-37 check symbol (which may also be one of
 * `* ~ $ = U`, and only in the last position). YourTal stores the SHA-256 of
 * the canonical (unhyphenated, upper-case) code, so that is what this returns.
 *
 * Never log a code or its parse input.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECK_ALPHABET = `${ALPHABET}*~$=U`;
const PAYLOAD_LENGTH = 16;
const LENGTH = PAYLOAD_LENGTH + 1;

export type VoucherCodeError = 'malformed' | 'check_failed';

/** Go's `Normalise`: trim, upper-case, drop `-` and space, fold I/L to 1 and O to 0. */
function normalise(input: string): string {
  let out = '';
  for (const ch of input.trim().toUpperCase()) {
    if (ch === '-' || ch === ' ') continue;
    out += ch === 'I' || ch === 'L' ? '1' : ch === 'O' ? '0' : ch;
  }
  return out;
}

function checkSymbol(payload: string): string {
  let remainder = 0;
  for (const ch of payload) remainder = (remainder * 32 + ALPHABET.indexOf(ch)) % 37;
  return CHECK_ALPHABET[remainder]!;
}

export function parseVoucherCode(input: string): { canonical: string; sha256: string } | { error: VoucherCodeError } {
  // Go works on bytes; JS case mapping can turn one non-ASCII character into
  // ASCII (the sharp s becomes SS), so anything non-ASCII is refused up front.
  for (let i = 0; i < input.length; i++) if (input.charCodeAt(i) > 0x7f) return { error: 'malformed' };
  const canonical = normalise(input);
  if (canonical.length !== LENGTH) return { error: 'malformed' };
  const payload = canonical.slice(0, PAYLOAD_LENGTH);
  for (const ch of payload) if (!ALPHABET.includes(ch)) return { error: 'malformed' };
  const check = canonical[PAYLOAD_LENGTH]!;
  if (!CHECK_ALPHABET.includes(check)) return { error: 'malformed' };
  if (check !== checkSymbol(payload)) return { error: 'check_failed' };
  return { canonical, sha256: createHash('sha256').update(canonical, 'utf8').digest('hex') };
}

/** Display form: groups of four, hyphen-separated. */
export function formatVoucherCode(canonical: string): string {
  return canonical.match(/.{1,4}/g)?.join('-') ?? '';
}
