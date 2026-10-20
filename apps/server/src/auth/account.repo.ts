import { createHash, randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import type { IdentityRef } from '../repo.js';

/**
 * The database half of password reset, password change and email
 * verification (migration 0036).
 *
 * Every call is one SECURITY DEFINER function, so each rule — single use,
 * expiry, "the link must still match the account's address", which sessions
 * a change revokes — lives in SQL next to the data and holds in one
 * transaction. This module only generates secrets and hashes them; neither
 * the secret nor anything derived from it but its SHA-256 reaches Postgres.
 */

/**
 * Thirty minutes for a reset link.
 *
 * Long enough to switch from the phone to an email app, find the message and
 * choose a new password; short enough that a link read days later from a
 * forwarded or compromised inbox has expired. Twice the magic link's fifteen
 * because a reset asks the person to invent something, not just tap. It is
 * also single use and superseded by any newer request, so the window is a
 * ceiling, not the usual life of a link.
 */
export const PASSWORD_RESET_TTL_SECONDS = 30 * 60;

/**
 * Twenty-four hours for a verification link.
 *
 * A verification link grants no session and changes no credential — it only
 * records that the inbox is real — so a longer window costs little, and
 * people verify "tonight", not within the quarter hour. Bounded at seven days
 * by the table's CHECK.
 */
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;

/** A link secret: 32 random bytes, URL-safe. */
export function newLinkSecret(): { secret: string; hash: Buffer } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: hashLinkSecret(secret) };
}

export function hashLinkSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

type IdentityRow = { user_id: string; email: string; display_name: string };

const toRef = (row: IdentityRow): IdentityRef => ({
  userId: row.user_id,
  email: row.email,
  displayName: row.display_name,
});

/**
 * Record a reset link for this address if it has an account. One database
 * call whether it does or not — the request endpoint must cost the same.
 */
export async function issuePasswordReset(email: string, hash: Buffer): Promise<IdentityRef | null> {
  const { rows } = await getDb().execute<IdentityRow>(sql`
    select user_id, email, display_name
      from identity_password_reset_issue(${email}, ${hash}, ${PASSWORD_RESET_TTL_SECONDS}::int)
  `);
  return rows[0] ? toRef(rows[0]) : null;
}

/** Whether a reset link is still redeemable. Read-only. */
export async function passwordResetIsLive(hash: Buffer): Promise<boolean> {
  const { rows } = await getDb().execute<{ live: boolean }>(sql`
    select identity_password_reset_peek(${hash}) as live
  `);
  return rows[0]?.live === true;
}

/**
 * Redeem a reset link and set the password, revoking every session — or null
 * when the link is unknown, used, superseded or expired (all one answer).
 */
export async function consumePasswordReset(
  hash: Buffer,
  passwordHash: string,
): Promise<IdentityRef | null> {
  const { rows } = await getDb().execute<IdentityRow>(sql`
    select user_id, email, display_name
      from identity_password_reset_consume(${hash}, ${passwordHash})
  `);
  return rows[0] ? toRef(rows[0]) : null;
}

/** Set a new password from a live session, revoking every OTHER session. */
export async function changePassword(
  sessionTokenHash: Buffer,
  passwordHash: string,
): Promise<IdentityRef | null> {
  const { rows } = await getDb().execute<IdentityRow>(sql`
    select user_id, email, display_name
      from identity_password_change(${sessionTokenHash}, ${passwordHash})
  `);
  return rows[0] ? toRef(rows[0]) : null;
}

/** Record a verification link. Null when the address is already proven. */
export async function issueEmailVerification(
  userId: string,
  hash: Buffer,
): Promise<{ email: string; displayName: string } | null> {
  const { rows } = await getDb().execute<{ email: string; display_name: string }>(sql`
    select email, display_name
      from identity_email_verification_issue(${userId}::uuid, ${hash}, ${EMAIL_VERIFICATION_TTL_SECONDS}::int)
  `);
  const row = rows[0];
  return row ? { email: row.email, displayName: row.display_name } : null;
}

/** Redeem a verification link. Null for unknown, used, superseded or expired. */
export async function consumeEmailVerification(
  hash: Buffer,
): Promise<{ userId: string; email: string } | null> {
  const { rows } = await getDb().execute<{ user_id: string; email: string }>(sql`
    select user_id, email from identity_email_verify(${hash})
  `);
  const row = rows[0];
  return row ? { userId: row.user_id, email: row.email } : null;
}

/**
 * The address has just been proven by a magic link or by Google. On the
 * FIRST proof, a password set while it was unproven is cleared and its
 * sessions revoked (the pre-hijacking case — see 0036). True if a password
 * was cleared.
 */
export async function markEmailProven(userId: string): Promise<boolean> {
  const { rows } = await getDb().execute<{ cleared: boolean }>(sql`
    select identity_email_proven(${userId}::uuid) as cleared
  `);
  return rows[0]?.cleared === true;
}
