import { createHash, randomBytes } from 'node:crypto';

/**
 * Impersonation bearer tokens.
 *
 * Deliberately NOT built on `apps/server/src/tokens.ts`'s HMAC scheme. That
 * module verifies a session by SIGNATURE, with no database round trip — which
 * is exactly wrong for an impersonation token, which the migration header
 * requires to be revocable and to expire from server-side state, not from a
 * client-held claim. So this is the opposite shape on purpose: a bare random
 * value with no structure at all, verified by a hash lookup against
 * `impersonation_sessions` (`admin_impersonation_verify` in
 * `packages/db/migrations/0021_admin_plane.sql`), the same discipline
 * `invitations.token_hash` already established in migration 0012.
 *
 * That difference in SHAPE is what makes the two token kinds mutually
 * unusable without either side needing to know about the other:
 *   - `readSession` (tokens.ts) expects `base64url(json).base64url(hmac)` and
 *     rejects anything without that literal dot and a matching signature —
 *     the random value this module mints has neither.
 *   - `admin_impersonation_verify` looks up a SHA-256 in a table; a real
 *     session token's hash matches no row, because it was never issued
 *     through `mintImpersonationToken`.
 * See `apps/server/src/admin/admin.repo.test.ts` for both halves proved
 * against the real verifiers.
 */

export interface MintedImpersonationToken {
  /** Returned to the caller ONCE. Never stored anywhere in this process. */
  token: string;
  /** What actually goes to Postgres — the plaintext token never does. */
  tokenHash: Buffer;
}

export function mintImpersonationToken(): MintedImpersonationToken {
  const token = `imp_${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashImpersonationToken(token) };
}

export function hashImpersonationToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
