import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { verifyMerchantSignature } from '../yourtal/merchant-signing.js';
import { parseVoucherCode } from '../yourtal/voucher-code.js';

/**
 * A fake of YourTal's merchant voucher API (`POST /v1/vouchers/...`), in
 * process, for tests (group plan 2.8, ticket S3). It copies the behaviour of
 * YourTal's Go service (`services/voucher/internal/{redeem,idempotency,
 * merchantauth}`) on the points SnapApp's redemption depends on, and it
 * CHECKS rather than trusts:
 *
 *   - `X-YourTal-Signature` is verified over the raw bytes with the
 *     independent verifier (401 `invalid_signature`), before anything else;
 *   - `Idempotency-Key` is required (400 `idempotency_key_required`);
 *   - EVERY answer is stored per (merchant, key) and replayed with
 *     `Idempotent-Replay: true`, 5xx included; the same key with other bytes is
 *     409 `idempotency_key_reused`; a key still in progress is 409
 *     `idempotency_request_in_progress` (and runs again after 5 minutes);
 *     keys last 24 hours (all on the injectable clock);
 *   - authorize refuses an unknown or malformed code, another merchant's code,
 *     an inactive or expired voucher and too little value with one answer,
 *     402 `authorization_refused`; only unknown codes and other merchants'
 *     codes count as failed attempts, and 20 of them in 5 minutes throttle the
 *     merchant (429 `too_many_failed_attempts`);
 *   - a hold lasts 15 minutes; a voucher has one live hold; an order reference
 *     authorizes once; capture and void need a live hold; a captured
 *     single-use voucher is redeemed; an expired hold releases its voucher;
 *   - `lookup` resolves an order reference to its authorization.
 *
 * The request log never carries a voucher code or a body.
 */

export type FakeVoucherStatus = 'active' | 'held' | 'redeemed' | 'expired';

export interface FakeVoucherInput {
  /** Any valid voucher code (see `testVoucherCode`). */
  code: string;
  faceMinor: number;
  currency: string;
  status: FakeVoucherStatus;
  /** Who may redeem it at the merchant API. Defaults to the fake's merchant. */
  merchantId?: string;
  /** The YourTal user whose wallet holds it (the ownership read). */
  ownerId?: string;
  /** Defaults to a year after injection. */
  expiresAt?: Date;
  /** What the capture does to the value. Defaults to `single_use`. */
  policy?: 'single_use' | 'balance_carrying';
  /** The partner the listing is bound to (the ownership read). Defaults to `snap-app`. */
  redeemPartnerId?: string;
}

export interface FakeAuthorization {
  id: string;
  orderRef: string;
  amountMinor: number;
  currency: string;
  orderTotalMinor: number;
  state: 'held' | 'captured' | 'voided' | 'expired';
  expiresAt: Date;
  receiptId?: string;
  amountCapturedMinor?: number;
}

export interface FakeVoucherState {
  status: FakeVoucherStatus;
  remainingMinor: number;
  authorizations: FakeAuthorization[];
}

export type VoucherRoute = 'authorize' | 'capture' | 'void' | 'lookup';

export interface VoucherRequestRecord {
  route: VoucherRoute | 'unknown';
  key: string | undefined;
  /** Served from a stored answer. */
  replay: boolean;
  status: number;
}

export interface FakeClock {
  now(): Date;
  advance(ms: number): void;
}

interface StoredVoucher {
  hash: string;
  merchantId: string;
  ownerId: string | undefined;
  redeemPartnerId: string;
  faceMinor: number;
  remainingMinor: number;
  currency: string;
  status: FakeVoucherStatus;
  expiresAt: Date;
  policy: 'single_use' | 'balance_carrying';
}

interface StoredAuthorization extends FakeAuthorization {
  merchantId: string;
  voucherHash: string;
}

interface Answer {
  status: number;
  body: unknown;
}

export const HOLD_MS = 15 * 60_000;
export const FAILURE_WINDOW_MS = 5 * 60_000;
export const FAILURE_THRESHOLD = 20;
export const IN_PROGRESS_RERUN_MS = 5 * 60_000;
export const KEY_TTL_MS = 24 * 60 * 60_000;

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECK_ALPHABET = `${CODE_ALPHABET}*~$=U`;

/** A valid, distinct voucher code for test number `n` (the real check symbol, so it passes `parseVoucherCode`). */
export function testVoucherCode(n: number): string {
  let rest = n;
  let payload = '';
  for (let i = 0; i < 16; i++) {
    payload = CODE_ALPHABET[rest % 32]! + payload;
    rest = Math.floor(rest / 32);
  }
  let remainder = 0;
  for (const ch of payload) remainder = (remainder * 32 + CODE_ALPHABET.indexOf(ch)) % 37;
  return payload + CHECK_ALPHABET[remainder]!;
}

function err(status: number, type: string, code: string, message: string): Answer {
  return { status, body: { error: { type, code, message } } };
}

const internalError = () => err(500, 'api_error', 'internal_error', 'something went wrong');
const refused = () =>
  err(402, 'card_error', 'authorization_refused', 'redeem: this voucher cannot be authorized for this amount');
const noLiveHold = () =>
  err(404, 'invalid_request_error', 'no_live_authorization', 'redeem: no live authorization; it was resolved or has expired');

function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The voucher state shared by the merchant API fake and the ownership read in
 * `fake-yourtal.ts`: vouchers, holds, attempts and the clock.
 */
export class FakeVoucherStore {
  readonly merchantId: string;
  private offsetMs = 0;
  readonly clock: FakeClock = {
    now: () => new Date(Date.now() + this.offsetMs),
    advance: (ms) => {
      this.offsetMs += ms;
    },
  };
  private vouchers = new Map<string, StoredVoucher>();
  private authorizations = new Map<string, StoredAuthorization>();
  private attempts: Array<{ merchantId: string; outcome: string; at: number }> = [];

  constructor(options: { merchantId?: string } = {}) {
    this.merchantId = options.merchantId ?? randomUUID();
  }

  inject(voucher: FakeVoucherInput): void {
    const parsed = parseVoucherCode(voucher.code);
    if ('error' in parsed) throw new Error('inject: not a valid voucher code (use testVoucherCode)');
    this.vouchers.set(parsed.sha256, {
      hash: parsed.sha256,
      merchantId: voucher.merchantId ?? this.merchantId,
      ownerId: voucher.ownerId,
      redeemPartnerId: voucher.redeemPartnerId ?? 'snap-app',
      faceMinor: voucher.faceMinor,
      remainingMinor: voucher.faceMinor,
      currency: voucher.currency,
      status: voucher.status,
      expiresAt: voucher.expiresAt ?? new Date(this.clock.now().getTime() + 365 * 24 * 60 * 60_000),
      policy: voucher.policy ?? 'single_use',
    });
  }

  reset(): void {
    this.offsetMs = 0;
    this.vouchers.clear();
    this.authorizations.clear();
    this.attempts = [];
  }

  /** A voucher's state and its authorizations (newest last), or `undefined` when it was never injected. */
  state(code: string): FakeVoucherState | undefined {
    const parsed = parseVoucherCode(code);
    if ('error' in parsed) return undefined;
    return this.stateByHash(parsed.sha256);
  }

  stateByHash(hash: string): FakeVoucherState | undefined {
    this.sweep();
    const voucher = this.vouchers.get(hash);
    if (!voucher) return undefined;
    return {
      status: this.effectiveStatus(voucher),
      remainingMinor: voucher.remainingMinor,
      authorizations: [...this.authorizations.values()]
        .filter((a) => a.voucherHash === hash)
        .map(({ merchantId: _m, voucherHash: _v, ...a }) => ({ ...a })),
    };
  }

  /** What the ownership read needs, or `undefined` for an unknown hash. */
  holding(hash: string): { ownerId: string | undefined; redeemPartnerId: string; status: FakeVoucherStatus; faceMinor: number; currency: string; expiresAt: Date } | undefined {
    this.sweep();
    const voucher = this.vouchers.get(hash);
    if (!voucher) return undefined;
    return {
      ownerId: voucher.ownerId,
      redeemPartnerId: voucher.redeemPartnerId,
      status: this.effectiveStatus(voucher),
      faceMinor: voucher.faceMinor,
      currency: voucher.currency,
      expiresAt: voucher.expiresAt,
    };
  }

  private effectiveStatus(voucher: StoredVoucher): FakeVoucherStatus {
    if ((voucher.status === 'active' || voucher.status === 'held') && voucher.expiresAt <= this.clock.now()) return 'expired';
    return voucher.status;
  }

  /** The sweeper, run before every read: expired holds release their voucher. */
  sweep(): void {
    const now = this.clock.now();
    for (const auth of this.authorizations.values()) {
      if (auth.state === 'held' && auth.expiresAt <= now) {
        auth.state = 'expired';
        const voucher = this.vouchers.get(auth.voucherHash);
        if (voucher && voucher.status === 'held') voucher.status = 'active';
      }
    }
  }

  private record(merchantId: string, outcome: string): void {
    this.attempts.push({ merchantId, outcome, at: this.clock.now().getTime() });
  }

  authorize(merchantId: string, body: Record<string, unknown>): Answer {
    this.sweep();
    const amount = typeof body.amount === 'number' ? body.amount : 0;
    const currency = typeof body.currency === 'string' ? body.currency : '';
    const orderRef = typeof body.merchant_order_ref === 'string' ? body.merchant_order_ref : '';
    const orderTotal = typeof body.order_total === 'number' && body.order_total !== 0 ? body.order_total : amount;
    if (!Number.isInteger(amount) || amount <= 0 || !orderRef) return refused();

    // The throttle counts only probes: an unknown code or another merchant's (Go: CountFailedAttemptsSince).
    const since = this.clock.now().getTime() - FAILURE_WINDOW_MS;
    const failures = this.attempts.filter(
      (a) => a.merchantId === merchantId && a.at >= since && (a.outcome === 'unknown_code' || a.outcome === 'wrong_merchant'),
    ).length;
    if (failures >= FAILURE_THRESHOLD) {
      this.record(merchantId, 'throttled');
      return err(
        429,
        'rate_limit_error',
        'too_many_failed_attempts',
        'redeem: too many failed lookups; this merchant is throttled',
      );
    }

    const parsed = typeof body.code === 'string' ? parseVoucherCode(body.code) : { error: 'malformed' as const };
    const hash = 'error' in parsed ? undefined : parsed.sha256;

    // A retried authorize for the same order returns the hold it already has.
    const existing = [...this.authorizations.values()].find((a) => a.merchantId === merchantId && a.orderRef === orderRef);
    if (existing) {
      const same =
        existing.amountMinor === amount &&
        existing.currency === currency &&
        existing.orderTotalMinor === orderTotal &&
        hash !== undefined &&
        existing.voucherHash === hash;
      if (!same || existing.state !== 'held') {
        return err(409, 'invalid_request_error', 'duplicate_order', 'redeem: this merchant order was already authorized');
      }
      const voucher = this.vouchers.get(existing.voucherHash)!;
      return this.authorizedAnswer(existing, voucher.remainingMinor);
    }

    const voucher = hash ? this.vouchers.get(hash) : undefined;
    if (!voucher) {
      this.record(merchantId, 'unknown_code');
      return refused();
    }
    if (voucher.merchantId !== merchantId) {
      this.record(merchantId, 'wrong_merchant');
      return refused();
    }
    if (currency !== voucher.currency) {
      this.record(merchantId, 'currency_mismatch');
      return err(
        400,
        'invalid_request_error',
        'currency_mismatch',
        `redeem: the request's currency does not match this voucher's: ${voucher.currency}`,
      );
    }
    if (
      this.effectiveStatus(voucher) !== 'active' ||
      amount > voucher.remainingMinor ||
      amount > orderTotal
    ) {
      this.record(merchantId, 'refused');
      return refused();
    }

    const remainingBefore = voucher.remainingMinor;
    const auth: StoredAuthorization = {
      id: randomUUID(),
      merchantId,
      voucherHash: voucher.hash,
      orderRef,
      amountMinor: amount,
      currency,
      orderTotalMinor: orderTotal,
      state: 'held',
      expiresAt: new Date(this.clock.now().getTime() + HOLD_MS),
    };
    this.authorizations.set(auth.id, auth);
    voucher.status = 'held';
    this.record(merchantId, 'authorized');
    return this.authorizedAnswer(auth, remainingBefore);
  }

  private authorizedAnswer(auth: StoredAuthorization, remainingBefore: number): Answer {
    return {
      status: 200,
      body: {
        authorization_id: auth.id,
        amount_authorized: auth.amountMinor,
        remaining_balance: remainingBefore,
        expires_at: isoSeconds(auth.expiresAt),
      },
    };
  }

  /** The caller's own, still-live hold; `undefined` otherwise (unknown, another merchant's, resolved or expired). */
  private liveHold(merchantId: string, id: unknown): StoredAuthorization | undefined {
    const auth = typeof id === 'string' ? this.authorizations.get(id) : undefined;
    if (!auth || auth.merchantId !== merchantId) return undefined;
    if (auth.state !== 'held' || auth.expiresAt <= this.clock.now()) return undefined;
    return auth;
  }

  capture(merchantId: string, body: Record<string, unknown>): Answer {
    this.sweep();
    const auth = this.liveHold(merchantId, body.authorization_id);
    if (!auth) return noLiveHold();
    const final = typeof body.final_amount === 'number' ? body.final_amount : 0;
    if (!Number.isInteger(final) || final <= 0 || final > auth.amountMinor) {
      return err(
        402,
        'invalid_request_error',
        'capture_exceeds_authorization',
        `redeem: cannot capture ${final} against an authorization for ${auth.amountMinor}`,
      );
    }
    const voucher = this.vouchers.get(auth.voucherHash)!;
    if (voucher.policy === 'balance_carrying') {
      voucher.remainingMinor -= final;
      voucher.status = voucher.remainingMinor <= 0 ? 'redeemed' : 'active';
      if (voucher.remainingMinor < 0) voucher.remainingMinor = 0;
    } else {
      voucher.remainingMinor = 0;
      voucher.status = 'redeemed';
    }
    auth.state = 'captured';
    auth.receiptId = `rcpt_${randomUUID()}`;
    auth.amountCapturedMinor = final;
    return {
      status: 200,
      body: { receipt_id: auth.receiptId, amount_captured: final, remaining_balance: voucher.remainingMinor },
    };
  }

  void(merchantId: string, body: Record<string, unknown>): Answer {
    this.sweep();
    const auth = this.liveHold(merchantId, body.authorization_id);
    if (!auth) return noLiveHold();
    auth.state = 'voided';
    const voucher = this.vouchers.get(auth.voucherHash)!;
    voucher.status = 'active';
    return { status: 200, body: { authorization_id: auth.id, voided: true } };
  }

  lookup(merchantId: string, body: Record<string, unknown>): Answer {
    this.sweep();
    const orderRef = typeof body.merchant_order_ref === 'string' ? body.merchant_order_ref : '';
    const auth = [...this.authorizations.values()].find((a) => a.merchantId === merchantId && a.orderRef === orderRef);
    if (!auth) {
      return err(404, 'invalid_request_error', 'order_not_found', 'no authorization for this merchant order');
    }
    const result: Record<string, unknown> = {
      authorization_id: auth.id,
      state: auth.state,
      amount_authorized: auth.amountMinor,
      expires_at: isoSeconds(auth.expiresAt),
    };
    if (auth.state === 'captured') {
      result.receipt_id = auth.receiptId;
      result.amount_captured = auth.amountCapturedMinor;
    }
    return { status: 200, body: result };
  }
}

export interface FakeYourtalVouchers {
  url: string;
  keyId: string;
  /** The merchant the credential belongs to (what an injected voucher is bound to by default). */
  merchantId: string;
  store: FakeVoucherStore;
  clock: FakeClock;
  /** Every request, in order: route, key, replay and status. Never a code or a body. */
  requests: VoucherRequestRecord[];
  inject(voucher: FakeVoucherInput): void;
  /** A voucher's state and its authorizations. */
  voucher(code: string): FakeVoucherState | undefined;
  /**
   * The next request on `route` answers `status` and that answer is stored for
   * its key (and replayed, like any answer). By default the work is NOT done;
   * with `applyFirst` it is, so the caller sees a 5xx for something that
   * happened.
   */
  failNext(route: VoucherRoute, status?: number, options?: { applyFirst?: boolean }): void;
  /** The next request on `route` does its work and stores its answer, then the connection drops: a lost answer. */
  hangNext(route: VoucherRoute): void;
  /** The next request on `route` claims its key and stays open (in progress) until `releaseStalled()`. */
  stallNext(route: VoucherRoute): void;
  releaseStalled(): void;
  reset(): void;
  close(): Promise<void>;
}

function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const ROUTES: Record<string, VoucherRoute> = {
  '/v1/vouchers/authorize': 'authorize',
  '/v1/vouchers/capture': 'capture',
  '/v1/vouchers/void': 'void',
  '/v1/vouchers/lookup': 'lookup',
};

type Control =
  | { kind: 'fail'; status: number; applyFirst: boolean }
  | { kind: 'hang' }
  | { kind: 'stall' };

interface StoredKey {
  fingerprint: string;
  state: 'in_progress' | 'completed';
  at: number;
  answer?: Answer;
}

export async function startFakeYourtalVouchers(
  options: { keyId?: string; secret?: Uint8Array; store?: FakeVoucherStore } = {},
): Promise<FakeYourtalVouchers> {
  const keyId = options.keyId ?? 'mc_00000000-0000-4000-8000-000000000001';
  const secret = options.secret ?? Buffer.alloc(32, 9);
  const store = options.store ?? new FakeVoucherStore();
  const merchantId = store.merchantId;

  const keys = new Map<string, StoredKey>(); // `${merchantId}:${key}`
  const controls: Array<{ route: VoucherRoute; control: Control }> = [];
  const stalled: Array<() => void> = [];
  const requests: VoucherRequestRecord[] = [];

  function run(route: VoucherRoute, raw: string): Answer {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return err(400, 'invalid_request_error', 'malformed_body', 'the request body is not valid JSON');
    }
    if (!isRecord(body)) return err(400, 'invalid_request_error', 'malformed_body', 'the request body is not valid JSON');
    switch (route) {
      case 'authorize':
        return store.authorize(merchantId, body);
      case 'capture':
        return store.capture(merchantId, body);
      case 'void':
        return store.void(merchantId, body);
      case 'lookup':
        return store.lookup(merchantId, body);
    }
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = await readRaw(req);
      const path = (req.url ?? '').split('?')[0]!;
      const route = ROUTES[path];
      const key = req.headers['idempotency-key'] as string | undefined;
      const log = (status: number, replay: boolean) => requests.push({ route: route ?? 'unknown', key, replay, status });

      const send = (answer: Answer, replay = false) => {
        log(answer.status, replay);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (replay) headers['Idempotent-Replay'] = 'true';
        res.writeHead(answer.status, headers);
        res.end(JSON.stringify(answer.body));
      };

      if (req.method !== 'POST' || !route) return send(err(404, 'invalid_request_error', 'not_found', path));

      const verified = verifyMerchantSignature({
        header: req.headers['x-yourtal-signature'] as string | undefined,
        secret,
        expectedKeyId: keyId,
        method: req.method,
        pathAndQuery: req.url ?? '',
        idempotencyKey: key ?? '',
        body: raw,
      });
      if (!verified.ok) {
        return send(err(401, 'authentication_error', 'invalid_signature', 'invalid or missing merchant signature'));
      }
      if (!key) {
        return send(
          err(
            400,
            'invalid_request_error',
            'idempotency_key_required',
            'this endpoint moves value and requires an Idempotency-Key header',
          ),
        );
      }
      if (key.length > 255) {
        return send(err(400, 'invalid_request_error', 'idempotency_key_too_long', 'the idempotency key must be at most 255 characters'));
      }

      const scope = `${merchantId}:${key}`;
      const fingerprint = createHash('sha256').update(`${path}\n${raw}`).digest('hex');
      const nowMs = store.clock.now().getTime();
      const seen = keys.get(scope);
      const live =
        seen &&
        (seen.state === 'completed' ? nowMs - seen.at < KEY_TTL_MS : nowMs - seen.at < IN_PROGRESS_RERUN_MS);
      if (seen && live) {
        if (seen.fingerprint !== fingerprint) {
          return send(
            err(
              409,
              'idempotency_error',
              'idempotency_key_reused',
              'this idempotency key was already used with a different request',
            ),
          );
        }
        if (seen.state !== 'completed') {
          return send(
            err(
              409,
              'idempotency_error',
              'idempotency_request_in_progress',
              'a request with this idempotency key is already being processed',
            ),
          );
        }
        return send(seen.answer!, true);
      }

      // Claim the key, then do the work.
      const claim: StoredKey = { fingerprint, state: 'in_progress', at: nowMs };
      keys.set(scope, claim);
      const controlAt = controls.findIndex((c) => c.route === route);
      const control = controlAt >= 0 ? controls.splice(controlAt, 1)[0]!.control : undefined;

      if (control?.kind === 'stall') {
        await new Promise<void>((resolve) => stalled.push(resolve));
      }

      let answer: Answer;
      if (control?.kind === 'fail') {
        if (control.applyFirst) run(route, raw);
        answer =
          control.status >= 500
            ? control.status === 500
              ? internalError()
              : err(control.status, 'api_error', 'unavailable', 'injected failure')
            : err(control.status, 'api_error', 'injected_failure', 'injected failure');
      } else {
        answer = run(route, raw);
      }

      claim.state = 'completed';
      claim.at = store.clock.now().getTime();
      claim.answer = answer;

      if (control?.kind === 'hang') {
        log(answer.status, false);
        req.socket.destroy();
        return;
      }
      return send(answer);
    })().catch((error) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    keyId,
    merchantId,
    store,
    clock: store.clock,
    requests,
    inject: (voucher) => store.inject(voucher),
    voucher: (code) => store.state(code),
    failNext(route, status = 500, failOptions = {}) {
      controls.push({ route, control: { kind: 'fail', status, applyFirst: failOptions.applyFirst ?? false } });
    },
    hangNext(route) {
      controls.push({ route, control: { kind: 'hang' } });
    },
    stallNext(route) {
      controls.push({ route, control: { kind: 'stall' } });
    },
    releaseStalled() {
      for (const release of stalled.splice(0)) release();
    },
    reset() {
      store.reset();
      keys.clear();
      controls.length = 0;
      requests.length = 0;
      for (const release of stalled.splice(0)) release();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const release of stalled.splice(0)) release();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
