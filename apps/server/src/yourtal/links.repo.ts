import { asUser, type Db } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

/**
 * `yourtal_links` (migration 0037). USER-scoped: every function runs under
 * `asUser`, so RLS — not a WHERE clause somebody could forget — is what keeps
 * one person's link out of another's hands. The worker uses the same
 * functions with its own connection, after it has taken an event's user from
 * the outbox row.
 */

export type YourtalRegion = 'AU' | 'ID';
export type YourtalBrokenReason = 'link_revoked' | 'unknown_link';

export type YourtalLinkRow = {
  id: string;
  link_id: string;
  region: YourtalRegion;
  linked_at: string;
  revoked_at: string | null;
  broken_at: string | null;
  broken_reason: YourtalBrokenReason | null;
};

const LINK_COLUMNS = sql`
  id, link_id, region,
  to_json(linked_at)#>>'{}'  as linked_at,
  to_json(revoked_at)#>>'{}' as revoked_at,
  to_json(broken_at)#>>'{}'  as broken_at,
  broken_reason
`;

/** The user's live link, if any. */
export async function liveLink(userId: string, db: Db = getDb()): Promise<YourtalLinkRow | null> {
  return asUser(db, userId, async (tx) => {
    const rows = await tx.execute<YourtalLinkRow>(sql`
      select ${LINK_COLUMNS} from yourtal_links
       where user_id = current_user_id() and revoked_at is null and broken_at is null
       limit 1
    `);
    return rows.rows[0] ?? null;
  });
}

/**
 * The link that describes the user's state now: the live one, else the most
 * recent. A most-recent row that is broken means "YourTal ended it, link
 * again"; one that is revoked means the user unlinked here.
 */
export async function latestLink(userId: string, db: Db = getDb()): Promise<YourtalLinkRow | null> {
  return asUser(db, userId, async (tx) => {
    const rows = await tx.execute<YourtalLinkRow>(sql`
      select ${LINK_COLUMNS} from yourtal_links
       where user_id = current_user_id()
       order by (revoked_at is null and broken_at is null) desc, linked_at desc
       limit 1
    `);
    return rows.rows[0] ?? null;
  });
}

export type InsertLinkResult =
  | { ok: true; link: YourtalLinkRow }
  | { ok: false; reason: 'already_linked' | 'linked_to_another_account' };

/**
 * Records a link YourTal has just issued. The two partial unique indexes of
 * 0037 decide the refusals, so two simultaneous requests cannot both win.
 */
export async function insertLink(
  userId: string,
  link: { linkId: string; region: YourtalRegion },
  db: Db = getDb(),
): Promise<InsertLinkResult> {
  try {
    const row = await asUser(db, userId, async (tx) => {
      const rows = await tx.execute<YourtalLinkRow>(sql`
        insert into yourtal_links (user_id, link_id, region)
        values (current_user_id(), ${link.linkId}, ${link.region})
        returning ${LINK_COLUMNS}
      `);
      return rows.rows[0]!;
    });
    return { ok: true, link: row };
  } catch (error) {
    // Drizzle wraps the driver error; the SQLSTATE and the index name are on
    // `.cause` (the same pattern as `finalizeCapturePages`).
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause ?? (error as { code?: string; constraint?: string });
    if (cause?.code === '23505') {
      if (cause.constraint === 'yourtal_links_one_live_per_link') {
        return { ok: false, reason: 'linked_to_another_account' };
      }
      return { ok: false, reason: 'already_linked' };
    }
    throw error;
  }
}

/** The user unlinked here, after YourTal confirmed the revoke. Idempotent. */
export async function markLinkRevoked(userId: string, linkRowId: string, db: Db = getDb()): Promise<void> {
  await asUser(db, userId, async (tx) => {
    await tx.execute(sql`
      update yourtal_links set revoked_at = now()
       where id = ${linkRowId} and user_id = current_user_id() and revoked_at is null
    `);
  });
}

/**
 * YourTal said the link is gone (`link_revoked` or `unknown_link`). Only a
 * live link is marked, so the first reason recorded is the one kept.
 */
export async function markLinkBroken(
  userId: string,
  linkRowId: string,
  reason: YourtalBrokenReason,
  db: Db = getDb(),
): Promise<boolean> {
  return asUser(db, userId, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update yourtal_links set broken_at = now(), broken_reason = ${reason}
       where id = ${linkRowId} and user_id = current_user_id()
         and revoked_at is null and broken_at is null
      returning id
    `);
    return rows.rows.length > 0;
  });
}

/** Is this link row still live? Read by the drain before every send. */
export async function isLinkLive(userId: string, linkRowId: string, db: Db = getDb()): Promise<boolean> {
  return asUser(db, userId, async (tx) => {
    const rows = await tx.execute<{ live: boolean }>(sql`
      select (revoked_at is null and broken_at is null) as live
        from yourtal_links where id = ${linkRowId} and user_id = current_user_id()
    `);
    return rows.rows[0]?.live === true;
  });
}

export interface ReceiptReportCounts {
  pending: number;
  rewarded: number;
  /** Every ledger refusal, `pausedRefused` ones included. */
  refused: number;
  /** Refused with `allocation_exhausted`: receipts scanned while points were paused. Also in `refused`. */
  pausedRefused: number;
  /** Refused with `identity_check_required`: never earned, even later. Also in `refused`. */
  identityRefused: number;
  skippedDuplicate: number;
  /** Scans on a free credit, or none: never sent (group plan 2.5.f). */
  skippedFree: number;
  pointsReported: number;
}

/**
 * What the outbox says about this user's receipts, across every link they
 * have held. `pointsReported` is the sum of what YourTal SAID it granted in
 * its answers — YourTal's own balance is the truth, and may differ (points
 * spent, or held before they can be spent).
 */
export async function receiptReportCounts(userId: string, db: Db = getDb()): Promise<ReceiptReportCounts> {
  return asUser(db, userId, async (tx) => {
    const rows = await tx.execute<{
      pending: string;
      rewarded: string;
      refused: string;
      paused_refused: string;
      identity_refused: string;
      skipped_duplicate: string;
      skipped_free: string;
      points: string;
    }>(sql`
      select count(*) filter (where status = 'pending')                                as pending,
             count(*) filter (where status in ('sent', 'duplicate') and granted)       as rewarded,
             count(*) filter (where status = 'refused')                                as refused,
             count(*) filter (where status = 'refused' and last_code = 'allocation_exhausted') as paused_refused,
             count(*) filter (where status = 'refused' and last_code = 'identity_check_required') as identity_refused,
             count(*) filter (where status = 'skipped_duplicate')                      as skipped_duplicate,
             count(*) filter (where status = 'skipped_free')                           as skipped_free,
             coalesce(sum(points) filter (where status in ('sent', 'duplicate') and granted), 0) as points
        from yourtal_outbox
       where user_id = current_user_id()
    `);
    const r = rows.rows[0];
    return {
      pending: Number(r?.pending ?? 0),
      rewarded: Number(r?.rewarded ?? 0),
      refused: Number(r?.refused ?? 0),
      pausedRefused: Number(r?.paused_refused ?? 0),
      identityRefused: Number(r?.identity_refused ?? 0),
      skippedDuplicate: Number(r?.skipped_duplicate ?? 0),
      skippedFree: Number(r?.skipped_free ?? 0),
      pointsReported: Number(r?.points ?? 0),
    };
  });
}

/**
 * Whether the user's most recent word from YourTal's ledger was "paused":
 * the latest `allocation_exhausted` refusal, and whether anything has been paid
 * since. Returns that refusal's time (epoch ms) or null when the latest
 * outcome is not a pause. Lets the status show "paused" on the first refusal,
 * before the cached status read expires.
 */
export async function lastPausedRefusalAt(userId: string, db: Db = getDb()): Promise<number | null> {
  return asUser(db, userId, async (tx) => {
    const rows = await tx.execute<{ refused_at: string | null; paid_at: string | null }>(sql`
      select extract(epoch from max(finished_at) filter (where status = 'refused' and last_code = 'allocation_exhausted')) * 1000 as refused_at,
             extract(epoch from max(finished_at) filter (where status in ('sent', 'duplicate') and granted))                    * 1000 as paid_at
        from yourtal_outbox
       where user_id = current_user_id()
    `);
    const r = rows.rows[0];
    if (!r || r.refused_at === null) return null;
    const refused = Number(r.refused_at);
    if (r.paid_at !== null && Number(r.paid_at) >= refused) return null;
    return refused;
  });
}

/**
 * The user's latest `identity_check_required` refusal and what it said was
 * missing, or null when they have been paid since (a receipt scanned after they
 * passed the check earned, so the notice clears). The refused receipts stay
 * refused: see `classifyActionResponse`.
 */
export async function latestIdentityRefusal(userId: string, db: Db = getDb()): Promise<string[] | null> {
  return asUser(db, userId, async (tx) => {
    const rows = await tx.execute<{ missing: string[] | null; refused_at: string; paid_at: string | null }>(sql`
      select (select identity_missing from yourtal_outbox
               where user_id = current_user_id() and status = 'refused' and last_code = 'identity_check_required'
               order by finished_at desc limit 1) as missing,
             extract(epoch from max(finished_at) filter (where status = 'refused' and last_code = 'identity_check_required')) * 1000 as refused_at,
             extract(epoch from max(finished_at) filter (where status in ('sent', 'duplicate') and granted))                    * 1000 as paid_at
        from yourtal_outbox
       where user_id = current_user_id()
    `);
    const r = rows.rows[0];
    if (!r || r.refused_at === null) return null;
    if (r.paid_at !== null && Number(r.paid_at) >= Number(r.refused_at)) return null;
    return r.missing ?? [];
  });
}
