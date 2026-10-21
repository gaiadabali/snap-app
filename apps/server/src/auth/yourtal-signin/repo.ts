import { sql } from 'drizzle-orm';

import { getDb } from '../../db.js';
import type { YourTalClientKind } from './settings.js';

/**
 * The database half of Sign in with YourTal (migration 0039). Every call is
 * one SECURITY DEFINER function owned by app_identity; the application role
 * cannot read the flow table, the review list or `users`.
 */

/** Ten minutes from start to finish (docs/26 §1.9). The table caps it at fifteen. */
export const FLOW_TTL_SECONDS = 10 * 60;

export type StoredFlow = {
  client: YourTalClientKind;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string | null;
  signUp: boolean;
};

export async function openFlow(flow: StoredFlow): Promise<{ flowId: string; expiresAt: Date }> {
  const { rows } = await getDb().execute<{ flow_id: string; expires_at: string | Date }>(sql`
    select flow_id, expires_at
      from identity_yourtal_flow_open(
        ${flow.client}, ${flow.state}, ${flow.nonce}, ${flow.codeVerifier},
        ${flow.returnTo}, ${flow.signUp}, ${FLOW_TTL_SECONDS}::int
      )
  `);
  const row = rows[0];
  if (!row) throw new Error('identity_yourtal_flow_open returned no row');
  return { flowId: row.flow_id, expiresAt: new Date(row.expires_at) };
}

/** Take a flow: once, unexpired. Null for unknown, used or expired (one answer). */
export async function takeFlow(flowId: string): Promise<StoredFlow | null> {
  const { rows } = await getDb().execute<{
    client: YourTalClientKind;
    state: string;
    nonce: string;
    code_verifier: string;
    return_to: string | null;
    sign_up: boolean;
  }>(sql`
    select client, state, nonce, code_verifier, return_to, sign_up
      from identity_yourtal_flow_take(${flowId}::uuid)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    client: row.client,
    state: row.state,
    nonce: row.nonce,
    codeVerifier: row.code_verifier,
    returnTo: row.return_to,
    signUp: row.sign_up,
  };
}

export type LinkOutcome =
  | 'signed_in'
  | 'linked'
  | 'created'
  | 'second_sub'
  | 'unlinkable_account'
  | 'email_unverified'
  | 'staff_strong_auth_required'
  | 'staff_reauth_required'
  | 'retry';

/** Find, link or create the account for a verified YourTal identity (0039's rules). */
export async function signInWithYourTal(input: {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | undefined;
  strongAuth: boolean;
  recentAuth: boolean;
}): Promise<{ outcome: LinkOutcome; userId: string | null; emailFlagged: boolean }> {
  const { rows } = await getDb().execute<{ outcome: LinkOutcome; user_id: string | null; email_flagged: boolean }>(sql`
    select outcome, user_id, email_flagged
      from identity_yourtal_sign_in(
        ${input.sub}, ${input.email}, ${input.emailVerified}, ${input.name ?? null},
        ${input.strongAuth}, ${input.recentAuth}
      )
  `);
  const row = rows[0];
  if (!row) throw new Error('identity_yourtal_sign_in returned no row');
  return { outcome: row.outcome, userId: row.user_id, emailFlagged: row.email_flagged === true };
}

/** True once an account is linked to a YourTal `sub`: SnapApp's own sign-in methods then refuse it. */
export async function isLinkedToYourTal(userId: string): Promise<boolean> {
  const { rows } = await getDb().execute<{ linked: boolean }>(sql`
    select identity_yourtal_linked(${userId}::uuid) as linked
  `);
  return rows[0]?.linked === true;
}

/**
 * True when the account with this address is linked to YourTal. Only so the
 * magic-link request can decline to mail a link that would be refused anyway;
 * never used to sign anyone in.
 */
export async function emailLinkedToYourTal(email: string): Promise<boolean> {
  const { rows } = await getDb().execute<{ linked: boolean }>(sql`
    select identity_yourtal_email_linked(${email}) as linked
  `);
  return rows[0]?.linked === true;
}

/** Deletes flows a day after they expired. Returns how many. */
export async function flowHousekeeping(): Promise<number> {
  const { rows } = await getDb().execute<{ removed: number }>(sql`
    select identity_yourtal_flow_housekeeping() as removed
  `);
  return Number(rows[0]?.removed ?? 0);
}
