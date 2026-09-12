import { beforeAll, describe, expect, it } from 'vitest';

import { hashImpersonationToken, mintImpersonationToken } from './impersonation-tokens.js';

/**
 * Impersonation tokens vs ordinary session tokens — the mutual-unusability
 * proof this module's own header promises.
 *
 * `docs/WEB.md` §6 and `packages/db/migrations/0021_admin_plane.sql`'s header
 * both require that a normal session token can never be used as an
 * impersonation token, or vice versa. Half of that proof is a database fact
 * (`admin_impersonation_verify` finds no row for a session token's hash —
 * see `packages/db/test/admin_plane.test.ts`); this file is the OTHER half,
 * against the REAL `readSession` from `apps/server/src/tokens.ts`, not a
 * reimplementation of it.
 */
let issueSession: typeof import('../../tokens.js').issueSession;
let readSession: typeof import('../../tokens.js').readSession;

beforeAll(async () => {
  // Same reasoning as `tokens.test.ts`: `config()` wants a full environment
  // this suite otherwise never touches, so it is set before the dynamic
  // import that actually reads it.
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
  process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
  const tokens = await import('../../tokens.js');
  issueSession = tokens.issueSession;
  readSession = tokens.readSession;
});

describe('minting', () => {
  it('produces an opaque token with no HMAC structure at all', () => {
    const { token } = mintImpersonationToken();
    expect(token.startsWith('imp_')).toBe(true);
    // A real session token is `base64url(json).base64url(hmac)` — exactly
    // one dot separating two segments. This has none.
    expect(token.includes('.')).toBe(false);
  });

  it('hashes deterministically, so the same token always verifies the same row', () => {
    const { token, tokenHash } = mintImpersonationToken();
    expect(hashImpersonationToken(token).equals(tokenHash)).toBe(true);
  });

  it('two mints never collide', () => {
    const a = mintImpersonationToken();
    const b = mintImpersonationToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash.equals(b.tokenHash)).toBe(false);
  });
});

describe('a real impersonation token is refused by the REAL session verifier', () => {
  it('readSession returns null for an impersonation token', () => {
    const { token } = mintImpersonationToken();
    expect(readSession(token)).toBeNull();
  });

  it('readSession returns null even for the token hash, base64-encoded (in case anyone tries)', () => {
    const { tokenHash } = mintImpersonationToken();
    expect(readSession(tokenHash.toString('base64url'))).toBeNull();
  });
});

describe('a real session token has no structure this module could mistake for one of its own', () => {
  it('a session token contains a "." separating a signed body from a signature — an impersonation token never does', () => {
    const session = issueSession('11111111-1111-4111-8111-111111111111');
    expect(session.includes('.')).toBe(true);
    const { token: impersonationToken } = mintImpersonationToken();
    expect(impersonationToken.includes('.')).toBe(false);
  });

  it('hashing a real session token produces a hash that matches no impersonation token this module minted', () => {
    const session = issueSession('11111111-1111-4111-8111-111111111111');
    const sessionHash = hashImpersonationToken(session);
    const { tokenHash: mintedHash } = mintImpersonationToken();
    expect(sessionHash.equals(mintedHash)).toBe(false);
    // The point proved end-to-end in `packages/db/test/admin_plane.test.ts`:
    // `admin_impersonation_verify(sessionHash, ...)` finds no row, because
    // no `impersonation_sessions.token_hash` was ever set to this value —
    // only `mintImpersonationToken`'s output ever is.
  });
});
