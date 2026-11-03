import { randomUUID } from 'node:crypto';

import type { Db } from '@snap/db';

import { getDb } from '../db.js';
import { enterTenantAsWorker, type WorkerActor } from '../tenant-entry.js';
import { yourtalMerchantClient, type YourtalMerchantClient } from './merchant-client.js';
import { advanceRedemption, REDEMPTION_TIMING, type Mover } from './redeem.service.js';
import { claimDueRedemptions, moveRedemption, releaseRedemption, type RedemptionRow } from './redemptions.repo.js';

/**
 * The redemption drain (yourtal docs/28 §5 S4): finishes every redemption a
 * request could not, in the worker, beside the outbox. It is what makes
 * "captured" always end in "granted": a request that crashed or lost an
 * answer leaves its row here.
 *
 *   authorizing (30 s after the request)  lookup: held → capture, captured → grant,
 *                                         not found after 17 min → abandoned
 *   authorized                            capture while the hold is live, else lookup
 *   capturing                             resend with the same key; an error, or past 23 h → lookup
 *   voiding                               resend with the same key; an error → lookup
 *   captured                              grant; still failing after 24 h → needs_review
 *   capturing for 3 days                  needs_review
 *
 * Retries back off 15 s, doubling, to 15 min. It never sends an authorize.
 */
export const REDEMPTION_DRAIN = {
  batchSize: 5,
  /** Over a whole batch's worst case (a few 8 s calls per row). */
  lockSeconds: 300,
  baseSeconds: 15,
  capSeconds: 900,
} as const;

export function redemptionBackoffSeconds(attempts: number): number {
  return Math.min(REDEMPTION_DRAIN.capSeconds, REDEMPTION_DRAIN.baseSeconds * 2 ** Math.max(0, attempts - 1));
}

type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

export interface RedemptionDrainSummary {
  claimed: number;
  granted: number;
  finishedWithout: number;
  waiting: number;
  review: number;
}

/** One pass. `db` must be the worker's connection (`app_worker`). */
export async function drainVoucherRedemptions(options: {
  client: YourtalMerchantClient;
  worker: WorkerActor;
  db?: Db;
  workerId?: string;
  now?: () => Date;
  log?: Logger;
}): Promise<RedemptionDrainSummary> {
  const db = options.db ?? options.worker.db ?? getDb();
  const worker: WorkerActor = { ...options.worker, db };
  const workerId = options.workerId ?? `voucher-${process.pid}-${randomUUID().slice(0, 8)}`;
  const log = options.log ?? console;
  const now = options.now ?? (() => new Date());
  const summary: RedemptionDrainSummary = { claimed: 0, granted: 0, finishedWithout: 0, waiting: 0, review: 0 };

  const claimed = await claimDueRedemptions(db, workerId, REDEMPTION_DRAIN.batchSize, REDEMPTION_DRAIN.lockSeconds);
  summary.claimed = claimed.length;
  for (const row of claimed) {
    const mover: Mover = {
      client: options.client,
      enter: (fn) => enterTenantAsWorker(worker, row.tenant_id, fn),
      holder: workerId,
      now,
      log,
    };
    let result: RedemptionRow = row;
    try {
      result = await advanceRedemption(row, mover, 'drain');
      if (result.status === 'capturing' && now().getTime() - Date.parse(result.created_at) > REDEMPTION_TIMING.stuckReviewAfterMs) {
        result = (await moveRedemption(mover.enter, row.id, workerId, ['capturing'], 'needs_review')) ?? result;
      }
    } catch (error) {
      log.error(`voucher redemption ${row.id}: drain pass failed (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      await releaseRedemption(mover.enter, row.id, workerId, redemptionBackoffSeconds(row.attempts)).catch((error) =>
        log.error(`voucher redemption ${row.id}: could not release (${error instanceof Error ? error.message : String(error)})`),
      );
    }
    if (result.status === 'granted') summary.granted += 1;
    else if (result.status === 'needs_review') {
      summary.review += 1;
      log.error(`voucher redemption ${row.id}: needs review (${result.last_code ?? 'stuck'})`);
    } else if (['voided', 'expired', 'refused', 'abandoned', 'failed'].includes(result.status)) summary.finishedWithout += 1;
    else summary.waiting += 1;
  }
  return summary;
}

/** The loop the worker runs beside the outbox. Off (said once) without the merchant credential. */
export async function runVoucherRedemptionLoop(
  isStopping: () => boolean,
  worker: WorkerActor,
  options: { idleMs?: number; offMs?: number; log?: Logger } = {},
): Promise<void> {
  const idleMs = options.idleMs ?? 5_000;
  const offMs = options.offMs ?? 60_000;
  const log = options.log ?? console;
  let announcedOff = false;

  while (!isStopping()) {
    const client = yourtalMerchantClient();
    if (!client) {
      if (!announcedOff) log.log('voucher redemptions: merchant credential off; unfinished redemptions wait');
      announcedOff = true;
      await sleepUnlessStopping(offMs, isStopping);
      continue;
    }
    announcedOff = false;
    try {
      const summary = await drainVoucherRedemptions({ client, worker, log });
      if (summary.claimed > 0) log.log(`voucher redemptions: ${JSON.stringify(summary)}`);
      if (summary.claimed < REDEMPTION_DRAIN.batchSize) await sleepUnlessStopping(idleMs, isStopping);
    } catch (error) {
      log.error('voucher redemptions: drain failed:', error instanceof Error ? error.message : error);
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
