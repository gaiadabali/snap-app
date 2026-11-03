import { randomUUID } from 'node:crypto';

import type { YourtalVoucherRedemption } from '@snap/api-contract';

import type { MerchantResult, YourtalMerchantClient } from './merchant-client.js';
import {
  grantRedemption,
  isFinal,
  moveRedemption,
  noteRedemption,
  type Enter,
  type RedemptionPatch,
  type RedemptionRow,
  type RedemptionStatus,
} from './redemptions.repo.js';

/**
 * The redemption state machine's moves (yourtal docs/28 §3 and §5 S4), shared
 * by the request path and the worker drain. Each move is one external call
 * followed by one transaction; nothing here holds a transaction across a call.
 *
 * The key rules:
 *   - a key is written with the row, before its first send, and reused on
 *     every retry; any answer for a key, even a replayed 5xx, is final for it;
 *   - authorize is sent once, by the request, never by the drain (D6): a lost
 *     authorize answer is resolved by the order lookup;
 *   - a capture counts only on a 200 with a receipt, or a lookup saying
 *     captured; after a capture was sent, void only if a lookup says the hold
 *     is still live;
 *   - captured means grant: never capture again and never void.
 */

/** D8: the only voucher SnapApp redeems. A$5 face = 50 scans. */
export const SCANS_VOUCHER = { faceMinor: 500, currency: 'AUD', credits: 50 } as const;

export const REDEMPTION_TIMING = {
  /** The drain looks an unanswered authorize up after this. */
  authorizeLookupAfterSeconds: 30,
  /** A 15-minute hold plus slack: an order still unknown then never held anything. */
  abandonAfterMs: 17 * 60_000,
  /** YourTal keeps a key 24 h; past 23 h a capture is resolved by lookup, not resent. */
  captureLookupAfterMs: 23 * 3_600_000,
  grantReviewAfterMs: 24 * 3_600_000,
  stuckReviewAfterMs: 3 * 24 * 3_600_000,
} as const;

type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

export interface Mover {
  client: YourtalMerchantClient;
  /** Runs a transaction in the row's tenant. */
  enter: Enter;
  /** `locked_by` of the request or drain pass that holds the row. */
  holder: string;
  now: () => Date;
  log: Logger;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

function lastOf(r: MerchantResult): RedemptionPatch {
  if (r.kind === 'network') return { last_http_status: null, last_code: 'network', last_error: r.error };
  if (r.kind === 'ok') return { last_http_status: r.status, last_code: null, last_error: null };
  return { last_http_status: r.status, last_code: r.code, last_error: r.message };
}

const inProgress = (r: MerchantResult) =>
  r.kind === 'error' && r.status === 409 && r.code === 'idempotency_request_in_progress';

export type AuthorizeOutcome = 'held' | 'mismatch' | 'unknown' | 'refused' | 'failed' | 'lost';

/**
 * Step 6, the request's one authorize. `amount_authorized` and
 * `remaining_balance` must both be the face value, else the hold is voided
 * (authorizing → authorized → voiding in one transaction, so a crash cannot
 * leave a mismatched hold that the drain would capture).
 */
export async function authorizeOnce(
  row: RedemptionRow,
  canonicalCode: string,
  m: Mover,
): Promise<{ outcome: AuthorizeOutcome; row: RedemptionRow }> {
  const r = await m.client.authorize(
    {
      code: canonicalCode,
      amountMinor: row.face_minor,
      currency: row.currency,
      merchantOrderRef: row.merchant_order_ref,
      orderTotalMinor: row.face_minor,
    },
    row.authorize_key,
  );

  const unknown = async () => {
    await noteRedemption(m.enter, row.id, m.holder, lastOf(r));
    return { outcome: 'unknown' as const, row };
  };
  const moved = async (outcome: AuthorizeOutcome, next: RedemptionRow | null) =>
    next ? { outcome, row: next } : { outcome: 'lost' as const, row };

  if (r.kind === 'network' || inProgress(r)) return unknown();
  if (r.kind === 'ok') {
    const authorizationId = str(r.body.authorization_id);
    if (!authorizationId) return unknown();
    const patch: RedemptionPatch = { ...lastOf(r), authorization_id: authorizationId, hold_expires_at: str(r.body.expires_at) };
    if (int(r.body.amount_authorized) !== row.face_minor || int(r.body.remaining_balance) !== row.face_minor) {
      m.log.warn(`voucher redemption ${row.id}: authorized value is not the scans voucher's; voiding`);
      return moved(
        'mismatch',
        await moveRedemption(m.enter, row.id, m.holder, ['authorizing'], 'voiding', { ...patch, last_code: 'value_mismatch' }, 'authorized'),
      );
    }
    return moved('held', await moveRedemption(m.enter, row.id, m.holder, ['authorizing'], 'authorized', patch));
  }
  // A stored 5xx may still have held the voucher: the drain's lookup decides.
  if (r.status >= 500 || r.status === 408) return unknown();
  if (r.status === 401) m.log.error(`voucher redemption ${row.id}: YourTal rejected our merchant signature (401 ${r.code ?? ''})`);
  const refused = r.status === 402 || r.code === 'currency_mismatch';
  return moved(
    refused ? 'refused' : 'failed',
    await moveRedemption(m.enter, row.id, m.holder, ['authorizing'], refused ? 'refused' : 'failed', lastOf(r)),
  );
}

/**
 * Moves the row as far as it can go now. Stops when it is final or in
 * review, when an outcome is unknown (the drain comes back), or when the row
 * is no longer this holder's. `drain` alone resolves an unanswered authorize.
 */
export async function advanceRedemption(row: RedemptionRow, m: Mover, mode: 'request' | 'drain'): Promise<RedemptionRow> {
  let current = row;
  for (let i = 0; i < 8 && !isFinal(current.status) && current.status !== 'needs_review'; i++) {
    const next = await step(current, m, mode);
    if (!next || next.status === current.status) return next ?? current;
    current = next;
  }
  return current;
}

const ageMs = (iso: string | null, m: Mover) => (iso ? m.now().getTime() - Date.parse(iso) : 0);

async function step(row: RedemptionRow, m: Mover, mode: 'request' | 'drain'): Promise<RedemptionRow | null> {
  switch (row.status) {
    case 'authorizing':
      return mode === 'drain' ? resolveByLookup(row, m) : null;
    case 'authorized': {
      if (row.hold_expires_at && Date.parse(row.hold_expires_at) <= m.now().getTime()) return resolveByLookup(row, m);
      const capturing = await moveRedemption(m.enter, row.id, m.holder, ['authorized'], 'capturing', { capture_sent_at: 'now' });
      return capturing && sendCapture(capturing, m);
    }
    case 'capturing':
      if (ageMs(row.capture_sent_at, m) > REDEMPTION_TIMING.captureLookupAfterMs) return resolveByLookup(row, m);
      return sendCapture(row, m);
    case 'voiding':
      return sendVoid(row, m);
    case 'captured':
      try {
        return await grantRedemption(m.enter, row.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        m.log.error(`voucher redemption ${row.id}: captured, but the grant failed (${message}); retrying the grant only`);
        await noteRedemption(m.enter, row.id, m.holder, { last_code: 'grant_failed', last_error: message });
        if (mode === 'drain' && ageMs(row.capture_sent_at ?? row.created_at, m) > REDEMPTION_TIMING.grantReviewAfterMs) {
          return moveRedemption(m.enter, row.id, m.holder, ['captured'], 'needs_review');
        }
        return null;
      }
    default:
      return null;
  }
}

async function sendCapture(row: RedemptionRow, m: Mover): Promise<RedemptionRow | null> {
  const r = await m.client.capture({ authorizationId: row.authorization_id!, finalAmountMinor: row.face_minor }, row.capture_key);
  if (r.kind === 'ok') {
    const receiptId = str(r.body.receipt_id);
    if (receiptId) return moveRedemption(m.enter, row.id, m.holder, ['capturing'], 'captured', { ...lastOf(r), receipt_id: receiptId });
    return resolveByLookup(row, m);
  }
  await noteRedemption(m.enter, row.id, m.holder, lastOf(r));
  if (r.kind === 'network' || inProgress(r)) return null;
  // 404, 5xx, 409 retry, the kill switch: did it capture? Only a lookup says.
  return resolveByLookup(row, m);
}

async function sendVoid(row: RedemptionRow, m: Mover): Promise<RedemptionRow | null> {
  const r = await m.client.void({ authorizationId: row.authorization_id! }, row.void_key);
  if (r.kind === 'ok') return moveRedemption(m.enter, row.id, m.holder, ['voiding'], 'voided', lastOf(r));
  await noteRedemption(m.enter, row.id, m.holder, lastOf(r));
  if (r.kind === 'network' || inProgress(r)) return null;
  return resolveByLookup(row, m);
}

/** The order lookup (docs/28 §4.3), with a fresh key each time: it settles every unknown outcome. */
async function resolveByLookup(row: RedemptionRow, m: Mover): Promise<RedemptionRow | null> {
  const r = await m.client.lookup({ merchantOrderRef: row.merchant_order_ref }, randomUUID());
  const from: RedemptionStatus[] = [row.status];
  if (r.kind !== 'ok') {
    if (r.kind === 'error' && r.status === 404 && r.code === 'order_not_found' && row.status === 'authorizing'
        && ageMs(row.created_at, m) > REDEMPTION_TIMING.abandonAfterMs) {
      return moveRedemption(m.enter, row.id, m.holder, from, 'abandoned', lastOf(r));
    }
    await noteRedemption(m.enter, row.id, m.holder, lastOf(r));
    return null;
  }

  const b = r.body;
  const authorizationId = str(b.authorization_id);
  // One authorization per order: another id is an anomaly to stop on, not to act on.
  if (row.authorization_id && authorizationId && authorizationId !== row.authorization_id) {
    m.log.error(`voucher redemption ${row.id}: the order lookup names another authorization; stopped for a person`);
    const mismatch: RedemptionPatch = { last_code: 'authorization_mismatch', last_error: null };
    if (row.status === 'capturing') return moveRedemption(m.enter, row.id, m.holder, from, 'needs_review', mismatch);
    await noteRedemption(m.enter, row.id, m.holder, mismatch);
    return null;
  }
  const known: RedemptionPatch = row.authorization_id || !authorizationId ? {} : { authorization_id: authorizationId };
  switch (b.state) {
    case 'held':
      if (row.status === 'authorizing') {
        if (!authorizationId) return null;
        const patch: RedemptionPatch = { ...known, hold_expires_at: str(b.expires_at) };
        if (int(b.amount_authorized) !== row.face_minor) {
          return moveRedemption(m.enter, row.id, m.holder, from, 'voiding', { ...patch, last_code: 'value_mismatch' }, 'authorized');
        }
        return moveRedemption(m.enter, row.id, m.holder, from, 'authorized', patch);
      }
      // A capture answered with an error, and the hold is still live: release it.
      if (row.status === 'capturing') return moveRedemption(m.enter, row.id, m.holder, from, 'voiding');
      return null; // authorized (clocks disagree) or voiding (void refused): wait for YourTal
    case 'captured': {
      const receiptId = str(b.receipt_id);
      if (!receiptId) return null;
      if (row.status === 'voiding') m.log.warn(`voucher redemption ${row.id}: a void was asked for, but YourTal says captured; granting`);
      return moveRedemption(m.enter, row.id, m.holder, from, 'captured', { ...known, receipt_id: receiptId });
    }
    case 'voided':
      return moveRedemption(m.enter, row.id, m.holder, from, 'voided', known, row.status === 'authorized' ? 'voiding' : undefined);
    case 'expired':
      return moveRedemption(m.enter, row.id, m.holder, from, 'expired', known);
    default:
      return null;
  }
}

/** What a client sees of a row. */
export function publicRedemption(row: RedemptionRow): YourtalVoucherRedemption {
  return {
    id: row.id,
    state: row.status === 'granted' ? 'granted' : isFinal(row.status) ? 'failed' : 'pending',
    credits: row.credits,
    createdAt: row.created_at,
    grantedAt: row.status === 'granted' ? row.finished_at : null,
  };
}
