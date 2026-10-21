import type { Tx } from '@snap/db';
import { sql } from 'drizzle-orm';

import { enterTenantAsWorker, type WorkerActor } from '../tenant-entry.js';

/**
 * A scan spends one credit; a scan no model could read gives it back
 * (group plan 7.1.a and 7.1.c, founder decision 0.11; migration 0039).
 *
 * `spendScanCredit` runs INSIDE `enqueueExtraction`'s tenant transaction, next
 * to the job insert, so a capture is queued if and only if its spend is
 * recorded. `refundScanCredit` runs in the worker when a capture's extraction
 * job ends for good without a document.
 *
 * Which credit: free grants first (the signup bonus first among them), then
 * bought ones (a grant backed by a paid `credit_purchases` row), oldest
 * `granted_at` first, ties by id. With no usable grant the spend is still
 * recorded, with no grant, and the scan still goes ahead: refusing a scan when
 * credits run out is 7.1.b, not built yet.
 *
 * Only a PAID spend that was not refunded lets the receipt earn YourTal points
 * (`readPaidScan`, read by `saveExtraction`; group plan 2.5.f).
 */

export type ScanSpend =
  | { alreadySpent: true }
  | { alreadySpent: false; grantId: string | null; grantSource: string | null; paid: boolean };

/** Bounded, and never reached in practice: see the loop below. */
const MAX_TAKE_ATTEMPTS = 5;

/** The grants a scan may be paid from, in spend order. Used twice below. */
const usableGrants = sql`
  select g.id
    from usage_grants g
   where g.tenant_id = current_tenant_id()
     and g.metric = 'scans'
     and g.remaining > 0
     and (g.expires_at is null or g.expires_at > now())
`;

/**
 * Takes one credit for `captureId` and records it. Must be given a
 * transaction already inside the capture's tenant (`withTenantAs`).
 *
 * ── Why it is safe under concurrency and retries ─────────────────────────
 *
 *  1. A per-tenant advisory lock (`pg_advisory_xact_lock`, two-key form so it
 *     never collides with the one-key user locks elsewhere) serialises every
 *     spend in a workspace until its transaction commits. The "already
 *     spent?" check below therefore sees any spend for this capture that a
 *     concurrent call committed: it runs after the lock is taken, and each
 *     statement under READ COMMITTED reads a fresh snapshot.
 *  2. The decrement is ONE statement that picks a grant and takes from it
 *     only `where remaining > 0`. If another writer changed that row between
 *     the pick and the update (a refund, or a spender that did not take the
 *     lock), Postgres re-checks `remaining > 0` on the new row version; when
 *     it no longer holds the statement takes nothing, and the loop picks
 *     again rather than giving up while another grant still has credit. That
 *     is the trap of `SELECT … FOR UPDATE … LIMIT 1`, which can answer "no
 *     row" after a lock wait even though a later grant is still usable.
 *  3. `credit_spends_one_per_capture` (unique) is the final guard: a second
 *     spend row for the capture fails the transaction, and the second
 *     decrement rolls back with it.
 *
 * `remaining` can never go below zero: the update takes only where it is
 * above zero, and `usage_grants` CHECKs `remaining >= 0` besides.
 */
export async function spendScanCredit(
  tx: Tx,
  input: { tenantId: string; userId: string; captureId: string },
): Promise<ScanSpend> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('credit_spend'), hashtext(${input.tenantId}))`);

  const existing = await tx.execute<{ id: string }>(sql`
    select id from credit_spends where capture_id = ${input.captureId} limit 1
  `);
  if (existing.rows[0]) return { alreadySpent: true };

  let taken: { id: string; source: string; paid: boolean } | null = null;
  let decided = false;
  for (let attempt = 0; attempt < MAX_TAKE_ATTEMPTS && !decided; attempt += 1) {
    const rows = await tx.execute<{ id: string; source: string; paid: boolean }>(sql`
      with pick as (
        ${usableGrants}
         order by exists (
                    select 1 from credit_purchases cp
                     where cp.grant_id = g.id and cp.status = 'paid'
                  ),
                  (g.source = 'signup_bonus') desc,
                  g.granted_at,
                  g.id
         limit 1
      )
      update usage_grants u
         set remaining = u.remaining - 1
        from pick
       where u.id = pick.id
         and u.remaining > 0
      returning u.id, u.source,
                exists (
                  select 1 from credit_purchases cp
                   where cp.grant_id = u.id and cp.status = 'paid'
                ) as paid
    `);
    if (rows.rows[0]) {
      taken = rows.rows[0];
      decided = true;
      break;
    }
    // Nothing taken: either there is no usable grant at all, or the one
    // picked was emptied under us. Only the second is worth another pick.
    const left = await tx.execute<{ any: boolean }>(sql`select exists (${usableGrants}) as any`);
    if (!left.rows[0]?.any) decided = true;
  }
  if (!decided) {
    // Rolls the transaction back, job insert included: the capture stays
    // stored and un-queued rather than being queued against a wrong record.
    throw new Error(`could not take a scan credit for capture ${input.captureId} after ${MAX_TAKE_ATTEMPTS} attempts`);
  }

  // The insert policy (0039) recomputes `paid` and `grant_source` from the
  // grant itself; these values must agree with it or the insert is refused.
  await tx.execute(sql`
    insert into credit_spends (tenant_id, capture_id, user_id, grant_id, grant_source, paid)
    values (current_tenant_id(), ${input.captureId}, ${input.userId},
            ${taken?.id ?? null}, ${taken?.source ?? null}, ${taken?.paid ?? false})
  `);
  return {
    alreadySpent: false,
    grantId: taken?.id ?? null,
    grantSource: taken?.source ?? null,
    paid: taken?.paid ?? false,
  };
}

/**
 * Was this capture's scan paid with a bought credit that was not given back?
 * A capture with no spend row (queued before migration 0039) counts as not
 * paid. Read inside the tenant transaction.
 */
export async function readPaidScan(tx: Tx, captureId: string): Promise<boolean> {
  const rows = await tx.execute<{ paid: boolean }>(sql`
    select (paid and refunded_at is null) as paid
      from credit_spends
     where capture_id = ${captureId}
     limit 1
  `);
  return rows.rows[0]?.paid === true;
}

export type RefundReason = 'unreadable' | 'not_extracted';

export type RefundResult =
  | { refunded: false; why: 'no_capture' | 'has_document' | 'no_spend_or_already_refunded' }
  | { refunded: true; creditReturned: boolean };

/**
 * Gives a scan's credit back when its capture ended with no document
 * (7.1.c). Exactly once, and never for a capture that produced a document.
 *
 * Runs on the WORKER's connection: only `app_worker` may set `refunded_at`
 * (migration 0039). The capture row is locked first. `saveExtraction` takes
 * the same lock at the start of its transaction, so the two cannot interleave:
 * either the document is committed before this looks for it, or this
 * finishes before the extraction starts writing (and that extraction then
 * reads the spend as refunded, so the receipt earns nothing either).
 *
 * The update takes only a spend with `refunded_at is null`, so running this
 * twice gives one credit back once. The credit goes back to the grant it was
 * taken from, if that grant still exists; `remaining < amount` always holds
 * then, because this spend took from it, and the guard only keeps a corrupted
 * grant from failing the CHECK.
 */
export async function refundScanCredit(
  // The worker only. It enters through `withWorkerTenant` (the API's
  // connection is refused there), and only `app_worker` may set
  // `refunded_at` anyway. A test holding a worker pool passes it on the actor.
  worker: WorkerActor,
  tenantId: string,
  captureId: string,
  reason: RefundReason,
): Promise<RefundResult> {
  return enterTenantAsWorker(worker, tenantId, async (tx): Promise<RefundResult> => {
    const capture = await tx.execute<{ id: string }>(sql`
      select id from captures where id = ${captureId} for update
    `);
    if (!capture.rows[0]) return { refunded: false, why: 'no_capture' };

    const doc = await tx.execute<{ found: boolean }>(sql`
      select exists (select 1 from documents where capture_id = ${captureId}) as found
    `);
    if (doc.rows[0]?.found) return { refunded: false, why: 'has_document' };

    const spend = await tx.execute<{ grant_id: string | null }>(sql`
      update credit_spends
         set refunded_at = now(), refund_reason = ${reason}
       where capture_id = ${captureId} and refunded_at is null
      returning grant_id
    `);
    const row = spend.rows[0];
    if (!row) return { refunded: false, why: 'no_spend_or_already_refunded' };
    if (!row.grant_id) return { refunded: true, creditReturned: false };

    const back = await tx.execute<{ id: string }>(sql`
      update usage_grants
         set remaining = remaining + 1
       where id = ${row.grant_id} and remaining < amount
      returning id
    `);
    return { refunded: true, creditReturned: back.rows.length > 0 };
  });
}
