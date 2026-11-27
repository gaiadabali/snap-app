import type { GodConsentDecision, GodConsentMethod } from '@snap/api-contract';
import { asUser, type Db } from '@snap/db';
import { sql } from 'drizzle-orm';

import { sqlState } from '../auth/sessions.js';
import { getDb } from '../db.js';

/**
 * The database half of GOD group consent (migration 0062). Reads go through
 * RLS under `asUser`; every write is one of the `god_consent_*` SECURITY
 * DEFINER functions, which take the person from the session, not from here.
 */

export type GodConsentStatusRow = {
  decision: GodConsentDecision;
  version: string;
  method: GodConsentMethod;
  decidedAt: string;
};

/** The person's current answer, or null when they have never answered. */
export async function getGodConsentStatus(userId: string, db: Db = getDb()): Promise<GodConsentStatusRow | null> {
  return asUser(db, userId, async (tx) => {
    const { rows } = await tx.execute<{
      decision: GodConsentDecision;
      notice_version: string;
      method: GodConsentMethod;
      decided_at: string;
    }>(sql`
      select decision, notice_version, method, to_json(decided_at)#>>'{}' as decided_at
        from god_consent_status where user_id = current_user_id()
    `);
    const r = rows[0];
    return r ? { decision: r.decision, version: r.notice_version, method: r.method, decidedAt: r.decided_at } : null;
  });
}

/** Records the caller's own decision. False when it changed nothing (a repeat, or nothing to withdraw). */
export async function recordGodConsent(
  userId: string,
  input: { version: string; decision: GodConsentDecision; method: 'registration' | 'next_sign_in' },
  db: Db = getDb(),
): Promise<boolean> {
  return asUser(db, userId, async (tx) => {
    const { rows } = await tx.execute<{ r: boolean }>(sql`
      select god_consent_record(${input.version}, ${input.decision}, ${input.method}) as r
    `);
    return rows[0]?.r === true;
  });
}

/** A parent's decision for the teen of a space they invited. Throws with SQLSTATE GC003 for any other space. */
export async function recordGodConsentForTeen(
  parentUserId: string,
  tenantId: string,
  input: { version: string; decision: 'accepted' | 'withdrawn' },
  db: Db = getDb(),
): Promise<boolean> {
  return asUser(db, parentUserId, async (tx) => {
    const { rows } = await tx.execute<{ r: boolean }>(sql`
      select god_consent_record_for_teen(${tenantId}::uuid, ${input.version}, ${input.decision}) as r
    `);
    return rows[0]?.r === true;
  });
}

/** SQLSTATEs the consent functions raise (0062). */
export const consentErrorCode = (error: unknown): 'GC001' | 'GC003' | undefined => {
  const code = sqlState(error);
  return code === 'GC001' || code === 'GC003' ? code : undefined;
};
