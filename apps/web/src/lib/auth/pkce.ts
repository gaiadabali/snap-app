import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

/**
 * PKCE (RFC 7636) plus the two other one-time values an OAuth code flow
 * needs: `state` (CSRF — binds the callback to the browser that started it)
 * and `nonce` (binds the returned ID token to this exact attempt, checked
 * again server-side in `apps/server/src/auth/google-verify.ts`). All three
 * are generated the same way — cryptographically random, never derived from
 * anything guessable — and none of them are secrets in the sense a password
 * is; their job is simply to be values an attacker cannot predict or supply
 * themselves.
 */

export function generateCodeVerifier(): string {
  // 32 random bytes -> 43 base64url characters, inside RFC 7636's 43-128.
  return randomBytes(32).toString('base64url');
}

export function codeChallengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function generateState(): string {
  return randomBytes(24).toString('base64url');
}

export function generateNonce(): string {
  return randomBytes(24).toString('base64url');
}
