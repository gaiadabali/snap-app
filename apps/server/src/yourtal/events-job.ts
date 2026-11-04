import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { claimJobs, completeJob, failJob, type Db } from '@snap/db';
import { sql } from 'drizzle-orm';

import { sendAndRecord } from '../auth/mail-delivery.js';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { EVENT, verifySet, YOURTAL_EVENT_JOB, yourtalEventsSettings } from './events-verify.js';
import { endTeenInvite, teenInvitesConfigured } from '../teens/invite-api.js';

/**
 * The worker's half of YourTal's events (group task 3.7, ticket S2;
 * yourtal/docs/29 §6). Three job kinds, all with tenant_id NULL so none
 * cascades away with a workspace it erases:
 *
 *   yourtal_event   the raw SET the endpoint stored. RE-VERIFIED here (the
 *                   row is no trust boundary: app_rw can insert one). For
 *                   `account-deleted`: identity_yourtal_subject_erase(sub),
 *                   then erase_person on the user id THAT returns — never an
 *                   id from the payload — with the members' notices queued in
 *                   the same transaction (erase_person returns them once).
 *   storage_purge   queued by erase_workspace (0043): removes {STORAGE_DIR}/
 *                   {tenantId}/, only for a uuid, and only once that
 *                   workspace no longer exists.
 *   erasure_notice  one email to a member left behind; the address is
 *                   re-checked first (its owner may have been erased since),
 *                   and the payload is emptied once it is done.
 *
 * Any of these with a tenant_id is refused unread. A `yourtal_event` is not
 * claimed while unconfigured, and a failure on our side (YourTal's keys
 * unreachable) postpones it without spending an attempt.
 *
 * Logs carry the jti, type and outcome; never the token, the sub or an address.
 */

export const STORAGE_PURGE_JOB = 'storage_purge';
export const ERASURE_NOTICE_JOB = 'erasure_notice';
/** YourTal's end for a teen invite, when the parent's End access could not reach it (0045). */
export const TEEN_INVITE_END_JOB = 'teen_invite_end';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Job = { id: string; tenantId: string | null; payload: unknown };

/** Our side failed (YourTal's keys unreachable), not the job: retry later without spending an attempt. */
class NotNow extends Error {}
type Log = Pick<Console, 'log' | 'warn' | 'error'>;

async function handleEvent(db: Db, job: Job, log: Log): Promise<void> {
  const settings = yourtalEventsSettings();
  if (!settings) throw new NotNow('YourTal events are not configured');
  const token = (job.payload as { set?: unknown } | null)?.set;
  if (typeof token !== 'string') throw new Error('no SET in the payload');
  const verified = await verifySet(token, settings, { maxAge: false });
  if (!verified.ok) {
    if (verified.status === 503) throw new NotNow(`the SET could not be re-verified: ${verified.reason}`);
    throw new Error(`the SET failed re-verification: ${verified.err}`);
  }
  const { jti, sub, type, body } = verified.set;
  if (jti !== job.id.toLowerCase()) throw new Error('the SET belongs to another job');

  if (type === EVENT.accountDeleted) {
    const outcome = await db.transaction(async (tx) => {
      const erased = await tx.execute<{ user_id: string | null }>(
        sql`select identity_yourtal_subject_erase(${sub}) as user_id`,
      );
      const userId = erased.rows[0]?.user_id;
      if (!userId) return 'unknown sub, recorded as erased';
      const { rows } = await tx.execute<{ workspace_id: string; outcome: 'erased' | 'handed_over'; notify_emails: string[] }>(
        sql`select workspace_id, outcome, notify_emails from erase_person(${userId}::uuid)`,
      );
      let notices = 0;
      for (const row of rows) {
        for (const to of row.notify_emails) {
          await tx.execute(sql`
            insert into jobs (id, tenant_id, kind, payload, max_attempts)
            values (gen_random_uuid(), null, ${ERASURE_NOTICE_JOB},
                    ${JSON.stringify({ to, outcome: row.outcome })}::jsonb, 10)
          `);
          notices += 1;
        }
      }
      const erasedCount = rows.filter((r) => r.outcome === 'erased').length;
      return `person erased: ${erasedCount} workspace(s) erased, ${rows.length - erasedCount} handed over, ${notices} notice(s) queued`;
    });
    log.log(`yourtal event ${jti} account-deleted: ${outcome}`);
    return;
  }

  if (type === EVENT.accessEnded) {
    // Sessions opened before iat were ended by the endpoint. With erase_data
    // (a teen's access ended: docs/26 §2.2) the teen's space starts its
    // 30-day hold (0045); erasing it at the end is 3.10.f.
    let hold = '';
    if (body.erase_data === true) {
      const { rows } = await db.execute<{ ended: boolean }>(sql`select teen_space_end_for_subject(${sub}) as ended`);
      hold = `; erase_data (${String(body.reason)}): ${rows[0]?.ended ? 'teen space held for 30 days' : 'no live teen space'}`;
    }
    log.log(`yourtal event ${jti} access-ended: sessions already ended${hold}`);
    return;
  }

  log.log(`yourtal event ${jti} ${type}: not a type SnapApp acts on; acknowledged`);
}

/** True while the workspace row exists, as the worker sees it under RLS. */
async function tenantExists(db: Db, tenantId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    const { rows } = await tx.execute<{ found: boolean }>(
      sql`select exists (select 1 from tenants where id = current_tenant_id()) as found`,
    );
    return rows[0]?.found !== false;
  });
}

/** Removes `{STORAGE_DIR}/{tenantId}/`. A uuid only, directly under the root; rm does not follow a symlink. */
function removeTenantDir(tenantId: string, root = resolve(config().STORAGE_DIR)): void {
  if (!UUID.test(tenantId)) throw new Error('storage_purge: tenantId is not a uuid');
  const dir = resolve(join(root, tenantId.toLowerCase()));
  if (resolve(dir, '..') !== root) throw new Error('storage_purge: refusing a path outside the storage root');
  rmSync(dir, { recursive: true, force: true });
}

async function handleStoragePurge(db: Db, job: Job, log: Log): Promise<void> {
  const tenantId = (job.payload as { tenantId?: unknown } | null)?.tenantId;
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) throw new Error('storage_purge: tenantId is not a uuid');
  if (await tenantExists(db, tenantId)) throw new Error(`storage_purge: workspace ${tenantId} still exists; refusing`);
  removeTenantDir(tenantId);
  log.log(`storage_purge ${job.id}: removed the files of workspace ${tenantId}`);
}

/**
 * Housekeeping the loop runs about hourly (3.7.c):
 *  - a `yourtal_event` (a raw SET) or `teen_invite_end` (the parent's sub) job
 *    that is finished, or dead (attempts used up), and over 30 days old keeps
 *    its row, which is what refuses a replayed jti, but not its payload;
 *  - a `{tenantId}/` directory that an in-flight upload recreated after its
 *    workspace was erased. A directory goes only when ALL hold: it is a real
 *    directory (a symlink is left alone) with a lower-case uuid name directly
 *    under the storage root; no workspace row exists; a `storage_purge` job
 *    once named this id (so a wrong or restored database, with no purge
 *    history, can never empty the storage volume); and it was last modified
 *    over 24 hours ago.
 * `root` is for tests.
 */
export async function runErasureSweepsOnce(
  db: Db = getDb(),
  log: Log = console,
  root = resolve(config().STORAGE_DIR),
): Promise<{ blanked: number; orphans: number }> {
  const blankedRows = await db.execute(sql`
    update jobs set payload = '{}'::jsonb
     where kind in ('yourtal_event', 'teen_invite_end') and tenant_id is null and payload <> '{}'::jsonb
       and ((completed_at < now() - interval '30 days')
         or (completed_at is null and attempts >= max_attempts and created_at < now() - interval '30 days'))
    returning 1
  `);
  const blanked = blankedRows.rows.length;

  let orphans = 0;
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    /* no storage directory yet: nothing to sweep */
  }
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    // Ids are stored lower-case, so a differently-cased name is not ours.
    if (!entry.isDirectory() || !UUID.test(entry.name) || entry.name !== entry.name.toLowerCase()) continue;
    if (statSync(join(root, entry.name)).mtimeMs > dayAgo) continue;
    if (await tenantExists(db, entry.name)) continue;
    const { rows } = await db.execute<{ purged: boolean }>(sql`
      select exists (select 1 from jobs where kind = 'storage_purge' and tenant_id is null
                      and payload ->> 'tenantId' = ${entry.name}) as purged
    `);
    if (rows[0]?.purged !== true) continue;
    removeTenantDir(entry.name, root);
    orphans += 1;
  }
  if (blanked || orphans) log.log(`erasure sweeps: ${blanked} payload(s) emptied, ${orphans} orphan director(ies) removed`);
  return { blanked, orphans };
}

const NOTICE = {
  erased: {
    subject: 'A SnapApp workspace you belonged to has been deleted',
    text:
      'Hello,\n\nThe person who ran a SnapApp workspace you belonged to has deleted their account, and no other ' +
      'owner or admin was left. So the workspace and everything in it, including its receipts, files and ' +
      'records, have been deleted, and SnapApp cannot restore them.\n\nYour own SnapApp account and any other ' +
      'workspaces are unchanged.\n\nSnapApp',
  },
  handed_over: {
    subject: 'You are now the owner of a SnapApp workspace',
    text:
      'Hello,\n\nThe only owner of a SnapApp workspace you are an admin of has deleted their account. As its ' +
      'longest-serving admin, you are now its owner. Nothing in the workspace has been deleted.\n\nSnapApp',
  },
} as const;

async function handleNotice(db: Db, job: Job, log: Log): Promise<void> {
  const { to, outcome } = (job.payload ?? {}) as { to?: unknown; outcome?: unknown };
  if (typeof to !== 'string' || (outcome !== 'erased' && outcome !== 'handed_over')) {
    throw new Error('erasure_notice: malformed payload');
  }
  // The address came from erase_person; its owner may have been erased since.
  const { rows } = await db.execute<{ live: boolean }>(
    sql`select exists (select 1 from identity_password_lookup(${to}::citext)) as live`,
  );
  if (!rows[0]?.live) {
    log.log(`erasure_notice ${job.id}: no account has this address any more; not sent`);
    return;
  }
  const sent = await sendAndRecord('notification', { to, ...NOTICE[outcome] });
  if (sent.outcome === 'transient') throw new Error('erasure_notice: transient mail failure');
  log.log(`erasure_notice ${job.id}: ${sent.outcome}`);
}

async function handleTeenInviteEnd(db: Db, job: Job, log: Log): Promise<void> {
  const { inviteId, parentSub } = (job.payload ?? {}) as { inviteId?: unknown; parentSub?: unknown };
  if (typeof inviteId !== 'string' || !UUID.test(inviteId) || typeof parentSub !== 'string') {
    throw new Error('teen_invite_end: bad payload');
  }
  const needed = await db.execute<{ needed: boolean }>(sql`select teen_invite_end_needed(${inviteId}::uuid) as needed`);
  if (needed.rows[0]?.needed === false) {
    log.log(`teen_invite_end ${job.id}: YourTal already confirmed; nothing to do`);
    return;
  }
  if (!teenInvitesConfigured()) throw new NotNow('teen invites are not configured');
  if ((await endTeenInvite(inviteId, parentSub)) !== 'ended') throw new Error('teen_invite_end: YourTal did not end it yet');
  await db.execute(sql`select teen_invite_yourtal_ended_by_worker(${inviteId}::uuid)`);
  log.log(`teen_invite_end ${job.id}: ended at YourTal`);
}

const HANDLERS: Array<[string, (db: Db, job: Job, log: Log) => Promise<void>]> = [
  [YOURTAL_EVENT_JOB, handleEvent],
  [STORAGE_PURGE_JOB, handleStoragePurge],
  [ERASURE_NOTICE_JOB, handleNotice],
  [TEEN_INVITE_END_JOB, handleTeenInviteEnd],
];

/** Claims and runs what is due of each kind, events first. Returns how many jobs ran. */
export async function runErasureJobsOnce(db: Db = getDb(), log: Log = console): Promise<number> {
  const workerId = `worker-${process.pid}-erasure`;
  let ran = 0;
  for (const [kind, handle] of HANDLERS) {
    // Unconfigured, an event job is left alone: claiming it would spend an attempt.
    if (kind === YOURTAL_EVENT_JOB && !yourtalEventsSettings()) continue;
    for (const job of await claimJobs(db, kind, workerId, 1)) {
      ran += 1;
      try {
        // These kinds are system jobs. One with a tenant was written inside a
        // workspace (app_rw can, under jobs_tenant), not by us: never act on it.
        if (job.tenantId !== null) throw new Error(`a ${kind} job must have no tenant; refusing`);
        await handle(db, job, log);
        if (kind === ERASURE_NOTICE_JOB) {
          // Done with the address: a completed job is kept, its recipient is not.
          await db.execute(sql`
            update jobs set completed_at = now(), locked_at = null, last_error = null, payload = '{}'::jsonb
             where id = ${job.id}
          `);
        } else {
          await completeJob(db, job.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof NotNow) {
          // Give the attempt back and look again in a minute.
          await db.execute(sql`
            update jobs set attempts = greatest(attempts - 1, 0), locked_at = null, locked_by = null,
                            last_error = ${message}, run_after = now() + interval '60 seconds'
             where id = ${job.id}
          `);
          log.warn(`${kind} job ${job.id} postponed: ${message}`);
        } else {
          await failJob(db, job.id, message);
          log.error(`${kind} job ${job.id} failed: ${message}`);
        }
      }
    }
  }
  return ran;
}

/** The loop the worker runs beside extraction. */
export async function runErasureLoop(isStopping: () => boolean, idleMs = 5_000): Promise<void> {
  let lastSweep = 0;
  while (!isStopping()) {
    let ran = 0;
    try {
      ran = await runErasureJobsOnce();
      if (Date.now() - lastSweep > 60 * 60 * 1000) {
        lastSweep = Date.now();
        await runErasureSweepsOnce();
      }
    } catch (error) {
      console.error('erasure jobs:', error instanceof Error ? error.message : error);
    }
    if (ran === 0) {
      const until = Date.now() + idleMs;
      while (!isStopping() && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
    }
  }
}
