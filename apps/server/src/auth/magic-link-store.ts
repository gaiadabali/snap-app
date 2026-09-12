/**
 * Single-use enforcement for magic-link tokens.
 *
 * `readMagicLinkToken` (tokens.ts) proves a token was signed by this server
 * and has not yet expired. Neither fact proves it has never been redeemed
 * before — verification there is deliberately stateless, the same as every
 * other token kind. This module supplies the missing, necessarily stateful
 * half: every `jti` (nonce) that has been redeemed is recorded here, so a
 * link used twice — forwarded, read by a mail scanner and then by the person,
 * or simply clicked again from an old browser tab — is refused the second
 * time with the SAME message a forged token would get. Distinguishing "used
 * before" from "never valid" in the response would tell an attacker more
 * than they should learn from a failed guess.
 *
 * In-memory, scoped to one process — the same limitation as `RateLimiter` and
 * for the same reason (see its own comment). A link consumed on one instance
 * is not yet known to another; fine for the single-instance deployment this
 * repo currently targets, and worth revisiting together with rate limiting if
 * that ever changes.
 */
const consumed = new Map<string, number>(); // jti -> expiry, epoch seconds

/**
 * Attempt to redeem `jti`. Returns true and records it the first time; false
 * every time after, including a second call in the same tick.
 */
export function tryConsume(jti: string, expiresAt: number): boolean {
  sweep();
  if (consumed.has(jti)) return false;
  consumed.set(jti, expiresAt);
  return true;
}

function sweep(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, expiresAt] of consumed) {
    if (expiresAt < now) consumed.delete(jti);
  }
}

/** Test-only: start each test with a clean slate. */
export function resetForTesting(): void {
  consumed.clear();
}
