import { randomUUID } from 'node:crypto';

import { asUser } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

/**
 * Points — earned by scanning, spent in a different ecosystem app entirely
 * (yourtal, unbuilt). USER-scoped: `docs/ECOSYSTEM.md` D27, migration 0024.
 * A point is earned by a person and redeemed somewhere a workspace has no
 * meaning, so every function here runs under `asUser`, never `withTenantAs` —
 * `current_tenant_id()` is the wrong predicate for this table.
 *
 * No redemption function lives here on purpose. Redemption happens in
 * yourtal; `point_ledger` being append-only (`app_rw` has no UPDATE or
 * DELETE grant — migration 0024) means a redemption would just be another
 * row, and nothing in this module should assume it is the one writing it.
 */

export async function getPointBalance(userId: string): Promise<number> {
  return asUser(getDb(), userId, async (tx) => {
    const rows = await tx.execute<{ balance: string }>(sql`
      select coalesce(sum(delta), 0)::bigint as balance
        from point_ledger
       where user_id = current_user_id()
    `);
    return Number(rows.rows[0]?.balance ?? 0);
  });
}

export type PointLedgerRow = {
  id: string;
  delta: number;
  reason: string;
  ref: string | null;
  app: string;
  created_at: string;
};

export async function listPointLedger(userId: string, limit = 50): Promise<PointLedgerRow[]> {
  return asUser(getDb(), userId, async (tx) => {
    const rows = await tx.execute<PointLedgerRow>(sql`
      select id, delta, reason, ref, app, created_at::text as created_at
        from point_ledger
       where user_id = current_user_id()
       order by created_at desc
       limit ${limit}
    `);
    return rows.rows;
  });
}

/**
 * One point for one genuinely completed scan.
 *
 * Called from `saveExtraction` in `repo.ts`, at the moment a capture's
 * extraction actually succeeds — not on upload (a photo that is never read
 * successfully is not a completed scan) and not gated behind a later human
 * review step (most captures auto-accept and nobody ever touches them again,
 * so waiting for review would silently under-pay the common case). A
 * capture that fails extraction never reaches this function at all —
 * `saveExtractionFailure` is a different path and does not call it.
 *
 * Re-extraction (a better model re-reading an old capture — `docs/PLAN.md`'s
 * second principle: extraction is a versioned, replayable function of the
 * image) calls this again with the SAME `ref`. The unique partial index
 * `point_ledger_scan_once_idx` — `(user_id, ref) WHERE reason = 'scan' AND
 * ref IS NOT NULL` — is what stops that from paying twice, and this function
 * relies on the conflict rather than checking first: a check-then-insert has
 * exactly the race a retried or re-run capture would hit.
 *
 * Attributed to `uploadedByUserId` (whoever captured the receipt,
 * `captures.uploaded_by`) rather than to the caller's own identity, which is
 * why this runs under `asUser(uploadedByUserId, …)` instead of inside the
 * tenant-scoped transaction `saveExtraction` is already in: `point_ledger`'s
 * RLS requires `user_id = current_user_id()`, and the extraction worker's
 * own service identity is neither the point's rightful owner nor, in
 * general, a member of the capture's workspace at all.
 */
export async function awardScanPoint(
  uploadedByUserId: string,
  captureId: string,
): Promise<{ awarded: boolean }> {
  return asUser(getDb(), uploadedByUserId, async (tx) => {
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into point_ledger (id, user_id, delta, reason, ref, app)
      values (${randomUUID()}, current_user_id(), 1, 'scan', ${captureId}, 'snap-apps')
      on conflict (user_id, ref) where reason = 'scan' and ref is not null
      do nothing
      returning id
    `);
    return { awarded: inserted.rows.length > 0 };
  });
}
