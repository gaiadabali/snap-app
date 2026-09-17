import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing.
 *
 * WHY SCRYPT AND NOT ARGON2ID. `api_clients.key_hash` says argon2id, and
 * argon2id is the better primitive. It is also a native dependency, and adding
 * one here would rewrite `pnpm-lock.yaml` while another session has uncommitted
 * changes in that file. scrypt is memory-hard, is in OWASP's accepted list, and
 * ships inside Node — no dependency, no lockfile, no native build on the
 * deploy host.
 *
 * The stored string is SELF-DESCRIBING (`scrypt$N$r$p$salt$hash`), so the cost
 * parameters travel with each hash. Raising them later does not invalidate
 * existing passwords: an old hash still verifies against its own parameters,
 * and `needsRehash` says when to re-store it at the new cost on the next
 * successful sign-in. A scheme without that field forces either a flag day or a
 * silent downgrade.
 */

// `promisify` picks the 4-argument overload's callback but loses the options
// parameter from the resulting type, so it is restated here.
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * OWASP's scrypt guidance is N=2^17, r=8, p=1 — about 128MB per hash.
 *
 * That is per CONCURRENT hash, and it is a denial-of-service surface as much as
 * a security parameter: an unauthenticated endpoint that allocates 128MB per
 * request is a way to exhaust a small server. N=2^15 (32MB) with r=8 is the
 * next rung down and is still far beyond what a GPU attacker handles cheaply.
 * Paired with the rate limiter on the sign-in route rather than relied on
 * alone.
 */
const N = 1 << 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Node's default is 32MB and N=2^15 needs more than that; be explicit. */
const MAX_MEMORY = 256 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Why 10 and not 8.
 *
 * There is no password reset in this build (see migration 0025), so a
 * compromised account cannot be recovered by its owner. NIST 800-63B asks for 8
 * and for no composition rules; the length is raised one notch and the
 * composition rules are still omitted, because "at least one symbol" pushes
 * people toward `Password1!` and a longer minimum does not.
 */
export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string') return 'password must be text';
  // Count CODE POINTS, not UTF-16 units: an emoji is one character to the
  // person who typed it and two to `String.length`.
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  // A cap, because scrypt hashes whatever it is given and a megabyte of input
  // is a free way to make the server work hard.
  if (password.length > 512) return 'password must be at most 512 characters';
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(normalise(password), salt, KEY_LENGTH, {
    N, r: R, p: P, maxmem: MAX_MEMORY,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * Constant-time verification.
 *
 * Returns false for a malformed or absent hash rather than throwing, so the
 * caller has exactly one shape of failure to handle and cannot accidentally
 * distinguish "no account" from "wrong password" by catching one and not the
 * other.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) {
    return false;
  }
  let expected: Buffer;
  try {
    expected = Buffer.from(hashB64, 'base64');
    const derived = await scryptAsync(normalise(password), Buffer.from(saltB64, 'base64'),
      expected.length, { ...cost, maxmem: MAX_MEMORY });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when `stored` was made with weaker parameters than we now use. */
export function needsRehash(stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P;
}

/**
 * Unicode normalisation, so the same typed password verifies on every device.
 *
 * `é` can be one code point or two, and iOS and Android keyboards do not always
 * agree. Without NFKC a password set on one phone can fail on another, which
 * presents as "wrong password" with no way to recover — and in this build there
 * is no reset to recover WITH.
 */
function normalise(password: string): string {
  return password.normalize('NFKC');
}

/**
 * A hash to compare against when no account exists.
 *
 * Sign-in must take the same time whether or not the address is known. Without
 * this the "no such user" path returns immediately and the "wrong password"
 * path spends 32MB of scrypt, and the difference is measurable from outside —
 * an account-enumeration oracle of exactly the kind `magic-link/request` is
 * already written to avoid.
 *
 * Computed once at module load from a random secret nobody holds, so it can
 * never accidentally verify.
 */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString('base64'));
  return dummy;
}
