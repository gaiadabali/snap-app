import { createHash, randomBytes } from 'node:crypto';

import type { AuthUser } from '@snap/api-contract';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { initialsOf } from '../repo.js';
import { readSession, signSessionToken } from '../tokens.js';

/**
 * Sessions that end (task 1.2.c, migration 0036).
 *
 * A session is two halves: a signed bearer token on the device, and a row in
 * `user_sessions` holding the SHA-256 of the random secret inside it. The
 * signature is checked first (no database work for a forged or expired
 * token); then `identity_session_check` finds the live row, which is what
 * makes revocation real.
 *
 * ── The lifetimes, and why ─────────────────────────────────────────────────
 *
 * ABSOLUTE: 30 days. NIST SP 800-63B asks an AAL1 verifier (a password, or a
 * link to an inbox — which is what Snap Apps has) to re-authenticate at least
 * every 30 days. Nothing extends it: a stolen token is useful for at most a
 * month, whatever its holder does with it.
 *
 * IDLE: 14 days. Each use pushes the idle deadline out (written at most every
 * five minutes, in SQL), so someone who snaps receipts every week or two
 * stays signed in up to the 30-day cap, while a phone left in a drawer, or a
 * token lifted from a backup, stops working two weeks after its last use. Much
 * shorter would sign out the person who only opens the app at month-end
 * close, and a forced sign-in is when people choose worse passwords.
 *
 * Both are bounded again by a CHECK on the table (90 days), so a typo here
 * cannot mint a session that never ends.
 *
 * ── Why there is no separate refresh token ─────────────────────────────────
 *
 * A refresh token earns its keep when the access token is stateless and
 * short-lived, so revocation waits for the access token to lapse. Here every
 * request is checked against the row, so revocation is immediate already,
 * and the sliding idle window is the "refresh". A second long-lived secret in
 * the same secure storage would add a credential to steal and nothing to
 * defend with. When a session ends, the phone app clears it and shows the
 * sign-in screen (apps/mobile/src/api/http.ts, `onSessionEnded`).
 */
export const SESSION_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_IDLE_SECONDS = 14 * 24 * 60 * 60;

/** SHA-256 of a session secret: the only form in which it reaches the database. */
export function hashSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** Open a session for a user who has just authenticated. Returns the bearer token. */
export async function issueSession(userId: string): Promise<string> {
  const secret = randomBytes(32).toString('base64url');
  const { rows } = await getDb().execute<{ expires_at: string | Date }>(sql`
    select expires_at
      from identity_session_open(
        ${userId}::uuid,
        ${hashSecret(secret)},
        ${SESSION_ABSOLUTE_SECONDS}::int,
        ${SESSION_IDLE_SECONDS}::int
      )
  `);
  const row = rows[0];
  if (!row) throw new Error('identity_session_open returned no row');
  const expiresAt = Math.floor(new Date(row.expires_at).getTime() / 1000);
  return signSessionToken(userId, secret, expiresAt);
}

export type AuthenticatedSession = {
  user: AuthUser;
  sessionId: string;
  /** For the calls that act on "this session" — sign-out, password change. */
  tokenHash: Buffer;
};

/**
 * The user behind a bearer token, or null.
 *
 * Null for every failure — forged, expired, idle too long, revoked, user gone
 * — and the guard answers every one with the same 401, so a caller learns
 * nothing about WHICH it was.
 */
export async function authenticateSession(
  token: string | undefined,
): Promise<AuthenticatedSession | null> {
  const claim = readSession(token);
  if (!claim) return null;
  const tokenHash = hashSecret(claim.secret);
  const { rows } = await getDb().execute<{
    session_id: string;
    user_id: string;
    email: string;
    display_name: string;
    email_verified: boolean;
  }>(sql`
    select session_id, user_id, email, display_name, email_verified
      from identity_session_check(${tokenHash}, ${claim.userId}::uuid)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    tokenHash,
    user: {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      initials: initialsOf(row.display_name),
      emailVerified: row.email_verified,
    },
  };
}

/**
 * Ends the session this token names. True if it was live.
 *
 * Takes the TOKEN rather than a session id: the only party able to sign a
 * session out is the one holding it. A token that fails its signature or has
 * expired is simply not live — signing out of it is already done.
 */
export async function revokeSession(token: string | undefined): Promise<boolean> {
  const claim = readSession(token);
  if (!claim) return false;
  const { rows } = await getDb().execute<{ revoked: boolean }>(sql`
    select identity_session_revoke(${hashSecret(claim.secret)}) as revoked
  `);
  return rows[0]?.revoked === true;
}

/** Ends every session of the user behind this one, this one included. Returns how many. */
export async function revokeAllSessions(tokenHash: Buffer): Promise<number> {
  const { rows } = await getDb().execute<{ revoked: number }>(sql`
    select identity_sessions_revoke_all(${tokenHash}) as revoked
  `);
  return Number(rows[0]?.revoked ?? 0);
}
