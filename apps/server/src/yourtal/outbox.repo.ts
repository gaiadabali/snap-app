import { randomUUID } from 'node:crypto';

import { asUser, type Db } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { get as readObject } from '../storage.js';
import { receiptExternalRef, type ReceiptOriginal } from './external-ref.js';
import { liveLink } from './links.repo.js';

/**
 * `yourtal_outbox` (migration 0037): the reports owed to YourTal.
 *
 * Writing (`queueReceiptReport`) happens as the user, under RLS. Draining
 * (`claimDueReports` and friends) happens on the WORKER's connection, whose
 * `app_worker` policy is the only one that spans users — the queue pattern of
 * `jobs` — and every drain write is fenced by `locked_by`, so a drainer whose
 * lock was taken over cannot overwrite the new holder's outcome.
 */

export type QueueResult =
  | { queued: true; outboxId: string; externalRef: string }
  | { queued: false; reason: 'not_linked' | 'captured_before_link' | 'already_queued' }
  | { queued: false; reason: 'likely_duplicate'; duplicateOfCaptureId: string };

/**
 * A report that counts as "this receipt was already reported": still to be
 * sent, or answered by YourTal — paid, a duplicate, or refused by its ledger
 * (a refusal is final, so a re-photo must not get a second chance at it).
 * Not cancelled, failed or dead ones: those never reached YourTal's ledger.
 */
const REPORTED = ['pending', 'sent', 'duplicate', 'refused'];

/**
 * Queues one `receipt_scanned` report for a confirmed scan.
 *
 * Only for a user with a LIVE link, and only for a receipt captured at or
 * after the moment they linked: re-extracting an old capture (a better model
 * re-reading it) must not report a receipt from before the link existed.
 *
 * Not for a likely RE-PHOTO (founder decision 2026-10-20). A second photo of
 * the same paper receipt is new bytes and so a new `externalRef`, which
 * YourTal would pay again. `sameReceiptCaptureIds` are the captures whose
 * documents share this one's business key (supplier, date, amount, in the
 * workspace — `flagPossibleDuplicate`'s fingerprint in repo.ts); if any of
 * them was already reported for this user, this capture is recorded as
 * `skipped_duplicate` instead of queued — never sent, and counted in the
 * status so the person can see why it earned nothing.
 *
 * The body is serialised HERE, once, and stored. Every later attempt signs
 * and sends exactly that text under the same Idempotency-Key, which is what
 * YourTal's idempotency rules need (partner-api.md §4).
 */
export async function queueReceiptReport(
  input: { userId: string; captureId: string; original: ReceiptOriginal; sameReceiptCaptureIds?: string[] },
  deps: { db?: Db; read?: (key: string) => Buffer } = {},
): Promise<QueueResult> {
  const db = deps.db ?? getDb();
  const link = await liveLink(input.userId, db);
  if (!link) return { queued: false, reason: 'not_linked' };
  if (Date.parse(input.original.receivedAt) < Date.parse(link.linked_at)) {
    return { queued: false, reason: 'captured_before_link' };
  }

  // After the link check, so an unlinked user's PDF is never read for nothing.
  const externalRef = receiptExternalRef(input.original, deps.read ?? readObject);
  const body = JSON.stringify({
    linkId: link.link_id,
    action: 'receipt_scanned',
    externalRef,
    // Kept by YourTal for audit and never parsed. The capture id lets the two
    // sides reconcile a disputed grant; nothing about the receipt's contents
    // or the person leaves Snap Apps (lead decision 2026-10-20: minimum data).
    evidence: { captureId: input.captureId },
  });
  const others = (input.sameReceiptCaptureIds ?? []).filter((id) => id !== input.captureId);

  return asUser(db, input.userId, async (tx): Promise<QueueResult> => {
    // Its own row first: re-extracting a receipt that is already queued,
    // sent or skipped changes nothing.
    const own = await tx.execute<{ id: string }>(sql`
      select id from yourtal_outbox
       where user_id = current_user_id() and action = 'receipt_scanned' and external_ref = ${externalRef}
       limit 1
    `);
    if (own.rows[0]) return { queued: false, reason: 'already_queued' };

    if (others.length > 0) {
      const earlier = await tx.execute<{ capture_id: string }>(sql`
        select capture_id from yourtal_outbox
         where user_id = current_user_id()
           and capture_id = any(${`{${others.join(',')}}`}::uuid[])
           and status = any(${`{${REPORTED.join(',')}}`}::text[])
         order by created_at
         limit 1
      `);
      const duplicateOf = earlier.rows[0]?.capture_id;
      if (duplicateOf) {
        await tx.execute(sql`
          insert into yourtal_outbox (user_id, link_row_id, capture_id, action, external_ref, idempotency_key, body,
                                      status, finished_at, last_code, duplicate_of_capture_id)
          values (current_user_id(), ${link.id}, ${input.captureId}, 'receipt_scanned', ${externalRef},
                  ${randomUUID()}, ${body}, 'skipped_duplicate', now(), 'likely_duplicate', ${duplicateOf})
          on conflict (user_id, action, external_ref) do nothing
        `);
        return { queued: false, reason: 'likely_duplicate', duplicateOfCaptureId: duplicateOf };
      }
    }

    const inserted = await tx.execute<{ id: string }>(sql`
      insert into yourtal_outbox (user_id, link_row_id, capture_id, action, external_ref, idempotency_key, body)
      values (current_user_id(), ${link.id}, ${input.captureId}, 'receipt_scanned', ${externalRef},
              ${randomUUID()}, ${body})
      on conflict (user_id, action, external_ref) do nothing
      returning id
    `);
    const id = inserted.rows[0]?.id;
    if (!id) return { queued: false, reason: 'already_queued' };
    return { queued: true, outboxId: id, externalRef };
  });
}

// ── The drain's side (worker connection) ─────────────────────────────────────

export type ClaimedReport = {
  id: string;
  user_id: string;
  link_row_id: string;
  idempotency_key: string;
  body: string;
  /** After this claim. */
  attempts: number;
};

/**
 * Claims due reports. `FOR UPDATE SKIP LOCKED`, like `claimJobs`: several
 * drainers never take the same row. A lock older than `lockSeconds` is
 * presumed dead (a worker killed mid-send) and taken over.
 */
export async function claimDueReports(
  db: Db,
  workerId: string,
  limit: number,
  lockSeconds: number,
): Promise<ClaimedReport[]> {
  const rows = await db.execute<ClaimedReport>(sql`
    with due as (
      select id from yourtal_outbox
       where status = 'pending'
         and next_attempt_at <= now()
         and (locked_at is null or locked_at < now() - make_interval(secs => ${lockSeconds}))
       order by next_attempt_at
       for update skip locked
       limit ${limit}
    )
    update yourtal_outbox o
       set locked_at = now(), locked_by = ${workerId}, attempts = o.attempts + 1
      from due
     where o.id = due.id
    returning o.id, o.user_id, o.link_row_id, o.idempotency_key, o.body, o.attempts
  `);
  return rows.rows;
}

export interface ReportOutcome {
  status: 'sent' | 'duplicate' | 'refused' | 'link_broken' | 'cancelled' | 'failed' | 'dead';
  httpStatus?: number | null;
  code?: string | null;
  error?: string | null;
  granted?: boolean | null;
  points?: number | null;
}

/** A final outcome. */
export async function finishReport(db: Db, id: string, workerId: string, outcome: ReportOutcome): Promise<void> {
  await db.execute(sql`
    update yourtal_outbox
       set status = ${outcome.status},
           finished_at = now(),
           locked_at = null, locked_by = null,
           last_http_status = ${outcome.httpStatus ?? null},
           last_code = ${outcome.code ?? null},
           last_error = ${outcome.error?.slice(0, 1000) ?? null},
           granted = ${outcome.granted ?? null},
           points = ${outcome.points ?? null}
     where id = ${id} and locked_by = ${workerId} and status = 'pending'
  `);
}

/** Not final: try again after `delaySeconds`. The attempt counts. */
export async function rescheduleReport(
  db: Db,
  id: string,
  workerId: string,
  delaySeconds: number,
  last: { httpStatus: number | null; code: string | null; error: string | null },
): Promise<void> {
  await db.execute(sql`
    update yourtal_outbox
       set locked_at = null, locked_by = null,
           next_attempt_at = now() + make_interval(secs => ${delaySeconds}),
           last_http_status = ${last.httpStatus},
           last_code = ${last.code},
           last_error = ${last.error?.slice(0, 1000) ?? null}
     where id = ${id} and locked_by = ${workerId} and status = 'pending'
  `);
}

/**
 * Hands back claimed reports that were never attempted, because an earlier
 * one in the same batch found YourTal unreachable. Their attempt is NOT
 * counted: nothing was sent.
 */
export async function releaseUnattempted(db: Db, ids: string[], workerId: string, delaySeconds: number): Promise<void> {
  if (ids.length === 0) return;
  await db.execute(sql`
    update yourtal_outbox
       set locked_at = null, locked_by = null,
           attempts = greatest(attempts - 1, 0),
           next_attempt_at = now() + make_interval(secs => ${delaySeconds})
     where id = any(${`{${ids.join(',')}}`}::uuid[]) and locked_by = ${workerId} and status = 'pending'
  `);
}

/** A link just broke: nothing else queued under it can be paid. */
export async function cancelPendingForLink(db: Db, linkRowId: string, exceptId: string): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    update yourtal_outbox
       set status = 'cancelled', finished_at = now(), locked_at = null, locked_by = null,
           last_code = 'link_broken'
     where link_row_id = ${linkRowId} and status = 'pending' and id <> ${exceptId}
       and locked_at is null
    returning id
  `);
  return rows.rows.length;
}
