import type { Db } from '@snap/db';

import { getDb } from '../db.js';
import { YOURTAL_PATHS, yourtalPartnerClient, type PartnerResponse, type YourtalPartnerClient } from './client.js';
import { isLinkLive, markLinkBroken } from './links.repo.js';
import {
  cancelPendingForLink,
  claimDueReports,
  finishReport,
  releaseUnattempted,
  rescheduleReport,
  type ClaimedReport,
  type ReportOutcome,
} from './outbox.repo.js';

/**
 * Draining `yourtal_outbox` to YourTal's `POST /api/partners/actions`.
 *
 * Runs in the worker, beside extraction and never inside it: the drain loop
 * is its own async loop, so a slow or dead YourTal costs the drain time and
 * never a scan's.
 *
 * What a response means for the event (partner-api.md §4–5, and the 2.5
 * ticket's rules):
 *
 *   200                                   final  sent / duplicate (duplicate is success)
 *   403 link_revoked, 400 unknown_link    final  link_broken: the link is marked broken,
 *                                                 and the rest queued under it cancelled
 *   409 velocity_capped, insufficient_available, solvency_blocked, allocation_exhausted
 *                                         final  refused, logged
 *   network error, timeout, 5xx, 408      retry  same key, same bytes
 *   429                                   retry  no sooner than retryAfterSeconds
 *   409 idempotency_request_in_progress   retry
 *   401 invalid_partner_signature         retry  our configuration is wrong; the event
 *                                                 is kept until it is fixed, logged loudly
 *   any other 4xx                         final  failed, logged
 *
 * A retry is backed off exponentially: 30 s, 1 min, 2 min ... (4 h 16 min at
 * the tenth attempt), capped at 6 h from the eleventh,
 * for up to 30 attempts (about five days in all), after which the event
 * is `dead` — kept, never deleted, for a person to requeue.
 */

export const OUTBOX_RETRY = {
  baseSeconds: 30,
  capSeconds: 6 * 3600,
  maxAttempts: 30,
  /** Must exceed a whole batch's worst case: `batchSize` x the client timeout. */
  lockSeconds: 300,
  batchSize: 10,
} as const;

/** The wait before the next attempt, after `attempts` have been made. */
export function retryDelaySeconds(attempts: number, retryAfterSeconds?: number | null): number {
  const exponential = Math.min(
    OUTBOX_RETRY.capSeconds,
    OUTBOX_RETRY.baseSeconds * 2 ** Math.max(0, attempts - 1),
  );
  return Math.ceil(Math.max(exponential, retryAfterSeconds ?? 0));
}

const LEDGER_REFUSALS = new Set([
  'velocity_capped',
  'insufficient_available',
  'solvency_blocked',
  'allocation_exhausted',
]);

export type Disposition =
  | { final: true; outcome: ReportOutcome; brokenReason?: 'link_revoked' | 'unknown_link' }
  | {
      final: false;
      httpStatus: number | null;
      code: string | null;
      error: string | null;
      retryAfterSeconds: number | null;
      /** YourTal itself looks unreachable or unwell: stop this batch. */
      pauseBatch: boolean;
    };

export function classifyActionResponse(response: PartnerResponse): Disposition {
  if (response.kind === 'network') {
    return { final: false, httpStatus: null, code: null, error: response.error, retryAfterSeconds: null, pauseBatch: true };
  }

  if (response.kind === 'ok') {
    const b = response.body;
    const duplicate = b.duplicate === true;
    const points = typeof b.points === 'number' && Number.isInteger(b.points) ? b.points : null;
    return {
      final: true,
      outcome: {
        status: duplicate ? 'duplicate' : 'sent',
        httpStatus: response.status,
        granted: typeof b.granted === 'boolean' ? b.granted : null,
        points,
      },
    };
  }

  const { status, code, message, retryAfterSeconds } = response;
  const last = { httpStatus: status, code, error: message };

  if ((status === 403 && code === 'link_revoked') || (status === 400 && code === 'unknown_link')) {
    return {
      final: true,
      outcome: { status: 'link_broken', ...last },
      brokenReason: code as 'link_revoked' | 'unknown_link',
    };
  }
  if (status === 409 && code !== null && LEDGER_REFUSALS.has(code)) {
    return { final: true, outcome: { status: 'refused', ...last } };
  }
  if (status === 429) {
    return { final: false, ...last, retryAfterSeconds, pauseBatch: true };
  }
  if (status >= 500 || status === 408) {
    return { final: false, ...last, retryAfterSeconds: null, pauseBatch: true };
  }
  if (status === 409 && code === 'idempotency_request_in_progress') {
    return { final: false, ...last, retryAfterSeconds: null, pauseBatch: false };
  }
  if (status === 401) {
    return { final: false, ...last, retryAfterSeconds: null, pauseBatch: true };
  }
  return { final: true, outcome: { status: 'failed', ...last } };
}

export interface DrainSummary {
  claimed: number;
  sent: number;
  duplicate: number;
  refused: number;
  linkBroken: number;
  cancelled: number;
  failed: number;
  dead: number;
  retried: number;
  released: number;
}

type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

/**
 * One pass: claim up to a batch of due reports and send each.
 *
 * `db` must be the WORKER's connection (`app_worker`), the only role that
 * reads the queue across users.
 */
export async function drainYourtalOutbox(options: {
  client: YourtalPartnerClient;
  db?: Db;
  workerId?: string;
  batchSize?: number;
  log?: Logger;
}): Promise<DrainSummary> {
  const db = options.db ?? getDb();
  const workerId = options.workerId ?? `yourtal-${process.pid}`;
  const log = options.log ?? console;
  const summary: DrainSummary = {
    claimed: 0, sent: 0, duplicate: 0, refused: 0, linkBroken: 0,
    cancelled: 0, failed: 0, dead: 0, retried: 0, released: 0,
  };

  const claimed = await claimDueReports(db, workerId, options.batchSize ?? OUTBOX_RETRY.batchSize, OUTBOX_RETRY.lockSeconds);
  summary.claimed = claimed.length;

  for (let i = 0; i < claimed.length; i++) {
    const event = claimed[i]!;
    const pause = await sendOne(db, workerId, options.client, event, summary, log);
    if (pause !== null) {
      // YourTal is down or throttling us: the rest of this batch would only
      // burn a timeout each. Hand them back unattempted, due when this one is.
      const rest = claimed.slice(i + 1).map((e) => e.id);
      await releaseUnattempted(db, rest, workerId, pause);
      summary.released = rest.length;
      break;
    }
  }
  return summary;
}

/** Sends one report. Returns a delay to pause the batch for, or null. */
async function sendOne(
  db: Db,
  workerId: string,
  client: YourtalPartnerClient,
  event: ClaimedReport,
  summary: DrainSummary,
  log: Logger,
): Promise<number | null> {
  // The link may have been unlinked or broken since this was queued.
  if (!(await isLinkLive(event.user_id, event.link_row_id, db))) {
    await finishReport(db, event.id, workerId, { status: 'cancelled', code: 'link_not_live' });
    summary.cancelled += 1;
    return null;
  }

  const response = await client.post(YOURTAL_PATHS.actions, event.body, event.idempotency_key);
  const disposition = classifyActionResponse(response);

  if (disposition.final) {
    const { outcome } = disposition;
    await finishReport(db, event.id, workerId, outcome);
    switch (outcome.status) {
      case 'sent':
        summary.sent += 1;
        break;
      case 'duplicate':
        summary.duplicate += 1;
        break;
      case 'refused':
        summary.refused += 1;
        log.warn(`yourtal outbox ${event.id}: refused by YourTal's ledger (${outcome.code}); final for this receipt`);
        break;
      case 'link_broken': {
        summary.linkBroken += 1;
        await markLinkBroken(event.user_id, event.link_row_id, disposition.brokenReason!, db);
        const cancelled = await cancelPendingForLink(db, event.link_row_id, event.id);
        summary.cancelled += cancelled;
        log.warn(
          `yourtal outbox ${event.id}: link ${event.link_row_id} is gone at YourTal (${outcome.code}); ` +
            `marked broken, ${cancelled} queued report(s) cancelled`,
        );
        break;
      }
      default:
        summary.failed += 1;
        log.error(
          `yourtal outbox ${event.id}: YourTal answered ${outcome.httpStatus} ${outcome.code ?? '(no code)'}; ` +
            `final, needs a person — ${outcome.error ?? ''}`,
        );
    }
    return null;
  }

  const last = { httpStatus: disposition.httpStatus, code: disposition.code, error: disposition.error };
  if (disposition.httpStatus === 401) {
    log.error(
      `yourtal outbox ${event.id}: YourTal rejected our partner signature (401 ${disposition.code ?? ''}). ` +
        'Check YOURTAL_PARTNER_ID and the secret file; the report is kept and retried.',
    );
  }

  if (event.attempts >= OUTBOX_RETRY.maxAttempts) {
    await finishReport(db, event.id, workerId, { status: 'dead', ...last });
    summary.dead += 1;
    log.error(`yourtal outbox ${event.id}: gave up after ${event.attempts} attempts (${describeLast(last)}); kept as dead`);
    return null;
  }

  const delay = retryDelaySeconds(event.attempts, disposition.retryAfterSeconds);
  await rescheduleReport(db, event.id, workerId, delay, last);
  summary.retried += 1;
  log.warn(`yourtal outbox ${event.id}: attempt ${event.attempts} not delivered (${describeLast(last)}); retry in ${delay}s`);
  return disposition.pauseBatch ? delay : null;
}

function describeLast(last: { httpStatus: number | null; code: string | null; error: string | null }): string {
  return last.httpStatus === null ? `network: ${last.error ?? 'unknown'}` : `${last.httpStatus} ${last.code ?? ''}`.trim();
}

/**
 * The drain loop the worker runs beside extraction. Off (and says so once)
 * while the partner link is not configured; reports queued meanwhile wait.
 */
export async function runYourtalOutboxLoop(
  isStopping: () => boolean,
  options: { idleMs?: number; offMs?: number; log?: Logger } = {},
): Promise<void> {
  const idleMs = options.idleMs ?? 5_000;
  const offMs = options.offMs ?? 60_000;
  const log = options.log ?? console;
  let announcedOff = false;

  while (!isStopping()) {
    const client = yourtalPartnerClient();
    if (!client) {
      if (!announcedOff) {
        log.log('yourtal outbox: partner link off (no YOURTAL_PARTNER_ID or secret); queued reports wait');
        announcedOff = true;
      }
      await sleepUnlessStopping(offMs, isStopping);
      continue;
    }
    if (announcedOff) log.log('yourtal outbox: partner link on');
    announcedOff = false;

    try {
      const summary = await drainYourtalOutbox({ client, log });
      if (summary.claimed > 0) {
        log.log(`yourtal outbox: ${JSON.stringify(summary)}`);
      }
      // A full batch means there is likely more; anything less, rest.
      if (summary.claimed < OUTBOX_RETRY.batchSize || summary.released > 0) {
        await sleepUnlessStopping(idleMs, isStopping);
      }
    } catch (error) {
      log.error('yourtal outbox: drain failed:', error instanceof Error ? error.message : error);
      await sleepUnlessStopping(idleMs, isStopping);
    }
  }
}

async function sleepUnlessStopping(ms: number, isStopping: () => boolean): Promise<void> {
  const until = Date.now() + ms;
  while (!isStopping() && Date.now() < until) {
    await new Promise((r) => setTimeout(r, Math.min(500, until - Date.now())));
  }
}
