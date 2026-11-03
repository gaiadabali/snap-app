import { randomUUID } from 'node:crypto';

import type { Db, Tx } from '@snap/db';
import { sql, type SQL } from 'drizzle-orm';

/**
 * `yourtal_voucher_redemptions` (migration 0041): one row per attempt to
 * redeem a YourTal scans voucher (group plan 2.8, yourtal docs/28 §5 S4).
 *
 * Every function runs inside an `Enter`: the row's tenant, entered as the
 * requesting user (`withTenantAs`, the API) or as the worker
 * (`withWorkerTenant`, the drain). One call is one transaction. External calls
 * never run inside one: callers do the HTTP between these functions.
 *
 * Progress writes are fenced twice: by `locked_by` (the API request or drain
 * pass that holds the row) and by the expected current status, so a holder
 * whose lock was taken over, or that read a stale row, changes nothing. The
 * table's guard trigger keeps every move on the docs/28 machine besides.
 * The grant is NOT fenced by holder: it locks the row and needs `captured`
 * with no grant, which is what makes it exactly-once whoever runs it.
 */

export type Enter = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const FINAL_STATUSES = ['granted', 'voided', 'expired', 'refused', 'abandoned', 'failed'] as const;
export type RedemptionStatus =
  | 'authorizing'
  | 'authorized'
  | 'capturing'
  | 'captured'
  | 'voiding'
  | 'needs_review'
  | (typeof FINAL_STATUSES)[number];

export type RedemptionRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  code_sha256: string;
  face_minor: number;
  currency: string;
  credits: number;
  merchant_order_ref: string;
  authorize_key: string;
  capture_key: string;
  void_key: string;
  authorization_id: string | null;
  hold_expires_at: string | null;
  capture_sent_at: string | null;
  receipt_id: string | null;
  grant_id: string | null;
  status: RedemptionStatus;
  attempts: number;
  locked_by: string | null;
  last_code: string | null;
  created_at: string;
  finished_at: string | null;
};

const COLUMNS = sql.raw(`
  id, tenant_id, user_id, code_sha256, face_minor, currency, credits, merchant_order_ref,
  authorize_key, capture_key, void_key, authorization_id,
  to_json(hold_expires_at)#>>'{}' as hold_expires_at,
  to_json(capture_sent_at)#>>'{}' as capture_sent_at,
  receipt_id, grant_id, status, attempts, locked_by, last_code,
  to_json(created_at)#>>'{}'  as created_at,
  to_json(finished_at)#>>'{}' as finished_at
`);

const textArray = (items: readonly string[]) => `{${items.join(',')}}`;

export function isFinal(status: RedemptionStatus): boolean {
  return (FINAL_STATUSES as readonly string[]).includes(status);
}

/** This workspace's (RLS) redemption of this code that is in progress or granted, if any. */
export async function liveRedemptionForCode(enter: Enter, codeSha256: string): Promise<RedemptionRow | null> {
  return enter(async (tx) => {
    const rows = await tx.execute<RedemptionRow>(sql`
      select ${COLUMNS} from yourtal_voucher_redemptions
       where tenant_id = current_tenant_id() and code_sha256 = ${codeSha256}
         and status not in ('voided', 'expired', 'refused', 'abandoned', 'failed')
       order by created_at desc limit 1
    `);
    return rows.rows[0] ?? null;
  });
}

/** This workspace's redemptions, newest first. */
export async function listRedemptions(enter: Enter, limit = 20): Promise<RedemptionRow[]> {
  return enter(async (tx) => {
    const rows = await tx.execute<RedemptionRow>(sql`
      select ${COLUMNS} from yourtal_voucher_redemptions
       where tenant_id = current_tenant_id()
       order by created_at desc limit ${limit}
    `);
    return rows.rows;
  });
}

/**
 * Step 5 of the flow: the row, committed before any value-moving call, held
 * by `holder` and due for the drain only after `dueInSeconds` (the request
 * path works it first). `busy` when another row for this code is in progress
 * or granted anywhere (the partial unique index).
 */
export async function insertRedemption(
  enter: Enter,
  input: {
    linkRowId: string;
    codeSha256: string;
    faceMinor: number;
    currency: string;
    credits: number;
    holder: string;
    dueInSeconds: number;
  },
): Promise<RedemptionRow | 'busy'> {
  const id = randomUUID();
  try {
    return await enter(async (tx) => {
      const rows = await tx.execute<RedemptionRow>(sql`
        insert into yourtal_voucher_redemptions
          (id, user_id, tenant_id, link_row_id, code_sha256, face_minor, currency, credits,
           merchant_order_ref, locked_at, locked_by, next_attempt_at)
        values (${id}, current_user_id(), current_tenant_id(), ${input.linkRowId}, ${input.codeSha256},
                ${input.faceMinor}, ${input.currency}, ${input.credits}, ${`snap-${id}`},
                now(), ${input.holder}, now() + make_interval(secs => ${input.dueInSeconds}))
        returning ${COLUMNS}
      `);
      return rows.rows[0]!;
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause ?? (error as { code?: string; constraint?: string });
    if (cause?.code === '23505' && cause.constraint === 'yourtal_voucher_redemptions_one_live_per_code') return 'busy';
    throw error;
  }
}

/** Progress columns a move may set. `capture_sent_at: 'now'` stamps the database clock. */
export interface RedemptionPatch {
  authorization_id?: string;
  hold_expires_at?: string | null;
  capture_sent_at?: 'now';
  receipt_id?: string;
  last_http_status?: number | null;
  last_code?: string | null;
  last_error?: string | null;
}

function patchSql(patch: RedemptionPatch): SQL[] {
  const sets: SQL[] = [];
  if (patch.authorization_id !== undefined) sets.push(sql`authorization_id = ${patch.authorization_id}`);
  if (patch.hold_expires_at !== undefined) sets.push(sql`hold_expires_at = ${patch.hold_expires_at}::timestamptz`);
  if (patch.capture_sent_at === 'now') sets.push(sql`capture_sent_at = now()`);
  if (patch.receipt_id !== undefined) sets.push(sql`receipt_id = ${patch.receipt_id}`);
  if (patch.last_http_status !== undefined) sets.push(sql`last_http_status = ${patch.last_http_status}`);
  if (patch.last_code !== undefined) sets.push(sql`last_code = ${patch.last_code}`);
  if (patch.last_error !== undefined) sets.push(sql`last_error = ${patch.last_error?.slice(0, 1000) ?? null}`);
  return sets;
}

/**
 * Moves a row the caller holds from one of `from` to `to` (through `via`
 * first, in the same transaction, when the machine has no direct edge, e.g.
 * authorizing → authorized → voiding). Returns the new row, or null when the
 * row is not held by `holder` or not in `from` any more: the caller stops.
 */
export async function moveRedemption(
  enter: Enter,
  id: string,
  holder: string,
  from: readonly RedemptionStatus[],
  to: RedemptionStatus,
  patch: RedemptionPatch = {},
  via?: RedemptionStatus,
): Promise<RedemptionRow | null> {
  return enter(async (tx) => {
    const step = async (fromStatuses: readonly string[], status: RedemptionStatus, extra: SQL[]) => {
      const sets = [sql`status = ${status}`, ...extra];
      if (isFinal(status)) sets.push(sql`finished_at = now()`);
      const rows = await tx.execute<RedemptionRow>(sql`
        update yourtal_voucher_redemptions set ${sql.join(sets, sql`, `)}
         where id = ${id} and locked_by = ${holder} and status = any(${textArray(fromStatuses)}::text[])
        returning ${COLUMNS}
      `);
      return rows.rows[0] ?? null;
    };
    if (!via) return step(from, to, patchSql(patch));
    const first = await step(from, via, patchSql(patch));
    return first ? step([via], to, []) : null;
  });
}

/** Records what YourTal last said without moving the row. */
export async function noteRedemption(enter: Enter, id: string, holder: string, patch: RedemptionPatch): Promise<void> {
  const sets = patchSql(patch);
  if (sets.length === 0) return;
  await enter((tx) =>
    tx.execute(sql`
      update yourtal_voucher_redemptions set ${sql.join(sets, sql`, `)}
       where id = ${id} and locked_by = ${holder}
    `),
  );
}

/** Lets go of a row: due again after `delaySeconds` (ignored once final). */
export async function releaseRedemption(enter: Enter, id: string, holder: string, delaySeconds: number): Promise<void> {
  await enter((tx) =>
    tx.execute(sql`
      update yourtal_voucher_redemptions
         set locked_at = null, locked_by = null,
             next_attempt_at = now() + make_interval(secs => ${Math.max(0, Math.ceil(delaySeconds))})
       where id = ${id} and locked_by = ${holder}
    `),
  );
}

/**
 * Step 8: the credits, exactly once. Locks the row, and grants only when it
 * is `captured` with no grant: a second caller, concurrent or later, finds it
 * `granted` and gets the row back unchanged. The grant and the row move
 * commit together (and 0041's deferred trigger refuses a voucher grant
 * without exactly one granted redemption naming it). No `credit_purchases`
 * row: these credits were not bought, so their scans earn no receipt points.
 */
export async function grantRedemption(enter: Enter, id: string): Promise<RedemptionRow | null> {
  return enter(async (tx) => {
    const locked = await tx.execute<RedemptionRow>(sql`
      select ${COLUMNS} from yourtal_voucher_redemptions where id = ${id} for update
    `);
    const row = locked.rows[0];
    if (!row || row.status !== 'captured' || row.grant_id !== null) return row ?? null;

    const grantId = randomUUID();
    await tx.execute(sql`
      insert into usage_grants (id, tenant_id, metric, amount, remaining, source)
      values (${grantId}, ${row.tenant_id}, 'scans', ${row.credits}, ${row.credits}, 'yourtal_voucher')
    `);
    const updated = await tx.execute<RedemptionRow>(sql`
      update yourtal_voucher_redemptions
         set status = 'granted', grant_id = ${grantId}, finished_at = now(),
             locked_at = null, locked_by = null, last_code = null, last_error = null
       where id = ${id}
      returning ${COLUMNS}
    `);
    return updated.rows[0]!;
  });
}

/**
 * The drain's claim, ACROSS workspaces (`db` must be the worker's connection,
 * whose `app_worker` policy spans tenants). `FOR UPDATE SKIP LOCKED`, like the
 * outbox: drainers never take the same row; a lock older than `lockSeconds`
 * (a crashed request or drain) is taken over. `needs_review` waits for a person.
 */
export async function claimDueRedemptions(
  db: Db,
  workerId: string,
  limit: number,
  lockSeconds: number,
): Promise<RedemptionRow[]> {
  const rows = await db.execute<RedemptionRow>(sql`
    with due as (
      select id as due_id from yourtal_voucher_redemptions
       where status not in ('granted', 'voided', 'expired', 'refused', 'abandoned', 'failed')
         and status <> 'needs_review'
         and next_attempt_at <= now()
         and (locked_at is null or locked_at < now() - make_interval(secs => ${lockSeconds}))
       order by next_attempt_at
       for update skip locked
       limit ${limit}
    )
    update yourtal_voucher_redemptions r
       set locked_at = now(), locked_by = ${workerId}, attempts = r.attempts + 1
      from due
     where r.id = due.due_id
    returning ${COLUMNS}
  `);
  return rows.rows;
}
