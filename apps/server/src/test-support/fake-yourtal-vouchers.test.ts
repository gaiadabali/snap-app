import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { voucherOwner, YourtalPartnerClient } from '../yourtal/client.js';
import { YourtalMerchantClient, type MerchantResult } from '../yourtal/merchant-client.js';
import { parseVoucherCode } from '../yourtal/voucher-code.js';
import { startFakeYourtal, type FakeYourtal } from './fake-yourtal.js';
import {
  FAILURE_THRESHOLD,
  FakeVoucherStore,
  startFakeYourtalVouchers,
  testVoucherCode,
  type FakeYourtalVouchers,
} from './fake-yourtal-vouchers.js';

const CODE = testVoucherCode(1);
const OTHER_MERCHANT = '99999999-9999-4999-8999-999999999999';

let fake: FakeYourtalVouchers;
let client: YourtalMerchantClient;
let keyCounter = 0;
const key = () => `k-${++keyCounter}`;

function merchant(over: { keyId?: string; secret?: Uint8Array } = {}) {
  return new YourtalMerchantClient({
    baseUrl: fake.url,
    keyId: over.keyId ?? fake.keyId,
    secret: over.secret ?? Buffer.alloc(32, 9),
  });
}

function authorize(over: { code?: string; amountMinor?: number; ref?: string; currency?: string; key?: string } = {}) {
  return client.authorize(
    {
      code: over.code ?? CODE,
      amountMinor: over.amountMinor ?? 500,
      currency: over.currency ?? 'AUD',
      merchantOrderRef: over.ref ?? 'snap-1',
      orderTotalMinor: over.amountMinor ?? 500,
    },
    over.key ?? key(),
  );
}

function ok(result: MerchantResult): Record<string, unknown> {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.body;
}

function errorOf(result: MerchantResult) {
  if (result.kind !== 'error') throw new Error(`expected an error, got ${JSON.stringify(result)}`);
  return result;
}

beforeEach(async () => {
  fake = await startFakeYourtalVouchers();
  client = merchant();
  fake.inject({ code: CODE, faceMinor: 500, currency: 'AUD', status: 'active' });
});

afterEach(async () => {
  await fake.close();
});

describe('signature and idempotency key', () => {
  it('answers 401 invalid_signature for a wrong secret, a wrong key id, and refuses before any work', async () => {
    const badSecret = errorOf(await merchant({ secret: Buffer.alloc(32, 1) }).authorize(
      { code: CODE, amountMinor: 500, currency: 'AUD', merchantOrderRef: 'snap-1' },
      key(),
    ));
    expect(badSecret).toMatchObject({ status: 401, code: 'invalid_signature' });
    const badKey = errorOf(await merchant({ keyId: 'mc_other' }).lookup({ merchantOrderRef: 'x' }, key()));
    expect(badKey).toMatchObject({ status: 401, code: 'invalid_signature' });
    expect(fake.voucher(CODE)!.authorizations).toEqual([]);
  });

  it('answers 400 idempotency_key_required without a key', async () => {
    // The client refuses to send without a key, so send one unsigned by hand, then one signed without a key.
    const unsigned = await fetch(`${fake.url}/v1/vouchers/authorize`, { method: 'POST', body: '{}' });
    expect(unsigned.status).toBe(401);
    const { signMerchantRequest } = await import('../yourtal/merchant-signing.js');
    const body = '{}';
    const signature = signMerchantRequest({
      secret: Buffer.alloc(32, 9),
      keyId: fake.keyId,
      method: 'POST',
      pathAndQuery: '/v1/vouchers/authorize',
      idempotencyKey: '',
      body,
      timestamp: new Date(),
    });
    const response = await fetch(`${fake.url}/v1/vouchers/authorize`, {
      method: 'POST',
      headers: { 'X-YourTal-Signature': signature },
      body,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'idempotency_key_required' } });
  });
});

describe('replay', () => {
  it('replays a 200 with Idempotent-Replay and does the work once', async () => {
    const k = key();
    const first = await authorize({ key: k });
    const second = await authorize({ key: k });
    expect(first).toMatchObject({ kind: 'ok', replay: false });
    expect(second).toMatchObject({ kind: 'ok', replay: true });
    expect(ok(second)).toEqual(ok(first));
    expect(fake.voucher(CODE)!.authorizations).toHaveLength(1);
    expect(fake.requests.map((r) => [r.route, r.replay])).toEqual([
      ['authorize', false],
      ['authorize', true],
    ]);
  });

  it('stores and replays a 5xx, even though the work would now succeed', async () => {
    fake.failNext('authorize', 500);
    const k = key();
    expect(errorOf(await authorize({ key: k }))).toMatchObject({ status: 500, replay: false });
    // The same key keeps answering 500; a new key does the work.
    expect(errorOf(await authorize({ key: k }))).toMatchObject({ status: 500, code: 'internal_error', replay: true });
    expect(fake.voucher(CODE)!.authorizations).toEqual([]);
    expect(ok(await authorize({ key: key() })).authorization_id).toBeTruthy();
  });

  it('409 idempotency_key_reused for the same key with other bytes', async () => {
    const k = key();
    await authorize({ key: k });
    expect(errorOf(await authorize({ key: k, amountMinor: 400 }))).toMatchObject({
      status: 409,
      code: 'idempotency_key_reused',
    });
  });

  it('409 idempotency_request_in_progress while the key is in progress, then the answer once it finishes; runs again after 5 minutes', async () => {
    fake.stallNext('authorize');
    const k = key();
    const first = authorize({ key: k });
    await new Promise((r) => setTimeout(r, 50));
    expect(errorOf(await authorize({ key: k }))).toMatchObject({ status: 409, code: 'idempotency_request_in_progress' });
    fake.releaseStalled();
    expect(ok(await first).authorization_id).toBeTruthy();
    expect(await authorize({ key: k })).toMatchObject({ kind: 'ok', replay: true });

    // A key that sat in progress for 5 minutes runs again.
    fake.stallNext('capture');
    const k2 = key();
    const stuck = client.capture({ authorizationId: 'x', finalAmountMinor: 1 }, k2);
    await new Promise((r) => setTimeout(r, 50));
    fake.clock.advance(5 * 60_000);
    expect(errorOf(await client.capture({ authorizationId: 'x', finalAmountMinor: 1 }, k2))).toMatchObject({
      status: 404,
      replay: false,
    });
    fake.releaseStalled();
    await stuck;
  });

  it('hangNext does the work, stores the answer and drops the connection; the same key then replays it', async () => {
    fake.hangNext('authorize');
    const k = key();
    expect((await authorize({ key: k })).kind).toBe('network');
    expect(fake.voucher(CODE)!.status).toBe('held');
    const again = await authorize({ key: k });
    expect(again).toMatchObject({ kind: 'ok', replay: true });
    expect(ok(again).authorization_id).toBe(fake.voucher(CODE)!.authorizations[0]!.id);
  });

  it('failNext with applyFirst answers 5xx for something that happened; lookup resolves it', async () => {
    fake.failNext('authorize', 503, { applyFirst: true });
    expect(errorOf(await authorize({ ref: 'snap-7' })).status).toBe(503);
    const found = ok(await client.lookup({ merchantOrderRef: 'snap-7' }, key()));
    expect(found.state).toBe('held');
  });
});

describe('authorize, capture, void', () => {
  it('authorize then capture: amounts, receipt, voucher redeemed', async () => {
    const auth = ok(await authorize());
    expect(auth).toMatchObject({ amount_authorized: 500, remaining_balance: 500 });
    expect(auth.authorization_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Math.abs(Date.parse(auth.expires_at as string) - (fake.clock.now().getTime() + 15 * 60_000))).toBeLessThan(2000);
    expect(auth.expires_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(fake.voucher(CODE)).toMatchObject({ status: 'held', remainingMinor: 500 });

    const captured = ok(
      await client.capture({ authorizationId: auth.authorization_id as string, finalAmountMinor: 500 }, key()),
    );
    expect(captured).toMatchObject({ amount_captured: 500, remaining_balance: 0 });
    expect(String(captured.receipt_id)).toMatch(/^rcpt_/);
    expect(fake.voucher(CODE)).toMatchObject({ status: 'redeemed', remainingMinor: 0 });

    // A second capture finds no live hold.
    expect(
      errorOf(await client.capture({ authorizationId: auth.authorization_id as string, finalAmountMinor: 500 }, key())),
    ).toMatchObject({ status: 404, code: 'no_live_authorization' });
  });

  it('capture above the hold is 402 capture_exceeds_authorization', async () => {
    const auth = ok(await authorize());
    expect(
      errorOf(await client.capture({ authorizationId: auth.authorization_id as string, finalAmountMinor: 501 }, key())),
    ).toMatchObject({ status: 402, code: 'capture_exceeds_authorization' });
  });

  it('void releases the voucher; a second void finds no live hold; a retry needs a new order ref', async () => {
    const auth = ok(await authorize());
    const id = auth.authorization_id as string;
    expect(ok(await client.void({ authorizationId: id }, key()))).toEqual({ authorization_id: id, voided: true });
    expect(fake.voucher(CODE)!.status).toBe('active');
    expect(errorOf(await client.void({ authorizationId: id }, key()))).toMatchObject({
      status: 404,
      code: 'no_live_authorization',
    });
    expect(errorOf(await authorize({ ref: 'snap-1' }))).toMatchObject({ status: 409, code: 'duplicate_order' });
    expect(ok(await authorize({ ref: 'snap-2' })).authorization_id).toBeTruthy();
  });

  it('an unknown authorization id is no_live_authorization for capture and void', async () => {
    expect(errorOf(await client.void({ authorizationId: 'nope' }, key()))).toMatchObject({ status: 404 });
    expect(
      errorOf(await client.capture({ authorizationId: crypto.randomUUID(), finalAmountMinor: 1 }, key())),
    ).toMatchObject({ status: 404, code: 'no_live_authorization' });
  });

  it('a hold lasts 15 minutes: after that the voucher is free, capture and void find no live hold, lookup says expired', async () => {
    const auth = ok(await authorize());
    const id = auth.authorization_id as string;
    fake.clock.advance(15 * 60_000 - 1000);
    expect(fake.voucher(CODE)!.status).toBe('held');
    fake.clock.advance(1000);
    expect(fake.voucher(CODE)).toMatchObject({ status: 'active' });
    expect(fake.voucher(CODE)!.authorizations[0]!.state).toBe('expired');
    expect(errorOf(await client.capture({ authorizationId: id, finalAmountMinor: 500 }, key()))).toMatchObject({
      status: 404,
    });
    expect(errorOf(await client.void({ authorizationId: id }, key()))).toMatchObject({ status: 404 });
    expect(ok(await client.lookup({ merchantOrderRef: 'snap-1' }, key())).state).toBe('expired');
    // The voucher can be held again under a new order.
    expect(ok(await authorize({ ref: 'snap-2' })).authorization_id).toBeTruthy();
  });

  it('refuses a second hold on a held voucher, one authorization per order, and a retry of the same order replays the hold', async () => {
    const first = ok(await authorize({ ref: 'snap-1' }));
    expect(errorOf(await authorize({ ref: 'snap-2' }))).toMatchObject({ status: 402, code: 'authorization_refused' });
    const retry = ok(await authorize({ ref: 'snap-1' }));
    expect(retry.authorization_id).toBe(first.authorization_id);
    expect(errorOf(await authorize({ ref: 'snap-1', amountMinor: 400 }))).toMatchObject({
      status: 409,
      code: 'duplicate_order',
    });
  });

  it('one refusal for unknown, malformed, inactive, expired, another merchant and too little value', async () => {
    const wrong = testVoucherCode(2);
    const used = testVoucherCode(3);
    const stale = testVoucherCode(4);
    const theirs = testVoucherCode(5);
    const small = testVoucherCode(6);
    fake.inject({ code: used, faceMinor: 500, currency: 'AUD', status: 'redeemed' });
    fake.inject({ code: stale, faceMinor: 500, currency: 'AUD', status: 'active', expiresAt: new Date(Date.now() - 1000) });
    fake.inject({ code: theirs, faceMinor: 500, currency: 'AUD', status: 'active', merchantId: OTHER_MERCHANT });
    fake.inject({ code: small, faceMinor: 300, currency: 'AUD', status: 'active' });
    let n = 0;
    for (const code of [wrong, 'not-a-code', used, stale, theirs, small]) {
      const result = errorOf(await authorize({ code, ref: `r-${n++}` }));
      expect(result).toMatchObject({ status: 402, code: 'authorization_refused' });
    }
    expect(errorOf(await authorize({ currency: 'IDR', ref: 'r-x' }))).toMatchObject({ status: 400, code: 'currency_mismatch' });
  });

  it('balance_carrying vouchers keep the rest', async () => {
    const code = testVoucherCode(7);
    fake.inject({ code, faceMinor: 1000, currency: 'AUD', status: 'active', policy: 'balance_carrying' });
    const auth = ok(await authorize({ code, amountMinor: 400, ref: 'bc' }));
    expect(auth.remaining_balance).toBe(1000);
    await client.capture({ authorizationId: auth.authorization_id as string, finalAmountMinor: 400 }, key());
    expect(fake.voucher(code)).toMatchObject({ status: 'active', remainingMinor: 600 });
  });
});

describe('throttle', () => {
  it('20 failed lookups in 5 minutes throttle the merchant with 429, and it clears after the window', async () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      const miss = await authorize({ code: testVoucherCode(1000 + i), ref: `t-${i}` });
      expect(errorOf(miss).status).toBe(402);
    }
    // Even a good code is now refused, with the throttle answer.
    expect(errorOf(await authorize({ ref: 'good' }))).toMatchObject({ status: 429, code: 'too_many_failed_attempts' });
    expect(fake.voucher(CODE)!.authorizations).toEqual([]);
    fake.clock.advance(5 * 60_000 + 1000);
    expect(ok(await authorize({ ref: 'good-2' })).authorization_id).toBeTruthy();
  });

  it('honest refusals (inactive, too little value) do not count toward the throttle', async () => {
    const used = testVoucherCode(3);
    fake.inject({ code: used, faceMinor: 500, currency: 'AUD', status: 'redeemed' });
    for (let i = 0; i < FAILURE_THRESHOLD + 2; i++) await authorize({ code: used, ref: `h-${i}` });
    expect(ok(await authorize({ ref: 'good' })).authorization_id).toBeTruthy();
  });
});

describe('lookup', () => {
  it('reads held, captured, voided and expired, and 404 order_not_found for unknown or another merchant', async () => {
    const a = ok(await authorize({ ref: 'o-held' }));
    expect(ok(await client.lookup({ merchantOrderRef: 'o-held' }, key()))).toMatchObject({
      authorization_id: a.authorization_id,
      state: 'held',
      amount_authorized: 500,
      expires_at: a.expires_at,
    });
    const found = ok(await client.lookup({ merchantOrderRef: 'o-held' }, key()));
    expect(found).not.toHaveProperty('receipt_id');

    await client.capture({ authorizationId: a.authorization_id as string, finalAmountMinor: 500 }, key());
    const captured = ok(await client.lookup({ merchantOrderRef: 'o-held' }, key()));
    expect(captured).toMatchObject({ state: 'captured', amount_captured: 500 });
    expect(String(captured.receipt_id)).toMatch(/^rcpt_/);

    const two = testVoucherCode(8);
    fake.inject({ code: two, faceMinor: 500, currency: 'AUD', status: 'active' });
    const b = ok(await authorize({ code: two, ref: 'o-void' }));
    await client.void({ authorizationId: b.authorization_id as string }, key());
    expect(ok(await client.lookup({ merchantOrderRef: 'o-void' }, key())).state).toBe('voided');

    const three = testVoucherCode(9);
    fake.inject({ code: three, faceMinor: 500, currency: 'AUD', status: 'active' });
    await authorize({ code: three, ref: 'o-exp' });
    fake.clock.advance(16 * 60_000);
    expect(ok(await client.lookup({ merchantOrderRef: 'o-exp' }, key())).state).toBe('expired');

    expect(errorOf(await client.lookup({ merchantOrderRef: 'nobody' }, key()))).toMatchObject({
      status: 404,
      code: 'order_not_found',
    });
  });

  it('is not an attempt: unknown orders never throttle', async () => {
    for (let i = 0; i < FAILURE_THRESHOLD + 5; i++) await client.lookup({ merchantOrderRef: `none-${i}` }, key());
    expect(ok(await authorize()).authorization_id).toBeTruthy();
  });
});

describe('request log', () => {
  it('records route, key, replay and status, never a code or a body', async () => {
    const k = key();
    await authorize({ key: k });
    await authorize({ key: k });
    expect(fake.requests).toEqual([
      { route: 'authorize', key: k, replay: false, status: 200 },
      { route: 'authorize', key: k, replay: true, status: 200 },
    ]);
    expect(JSON.stringify(fake.requests)).not.toContain(CODE);
  });

  it('reset empties everything', async () => {
    await authorize();
    fake.reset();
    expect(fake.requests).toEqual([]);
    expect(fake.voucher(CODE)).toBeUndefined();
  });
});

describe('the ownership read in fake-yourtal', () => {
  let partner: FakeYourtal;
  let partnerClient: YourtalPartnerClient;
  let linkId: string;
  const OWNER = { id: 'yt-user-1', region: 'AU' as const };
  const STRANGER = { id: 'yt-user-2', region: 'AU' as const };

  async function linkUser(user: { id: string; region: 'AU' | 'ID' }) {
    const code = partner.issueCode(user);
    const response = await partnerClient.post('/api/partners/links', JSON.stringify({ code }), key());
    if (response.kind !== 'ok') throw new Error('link failed');
    return response.body.linkId as string;
  }

  beforeEach(async () => {
    const store = new FakeVoucherStore();
    await fake.close();
    fake = await startFakeYourtalVouchers({ store });
    client = merchant();
    partner = await startFakeYourtal({ vouchers: store });
    partnerClient = new YourtalPartnerClient({ baseUrl: partner.url, partnerId: partner.partnerId, secret: partner.secret });
    fake.inject({ code: CODE, faceMinor: 500, currency: 'AUD', status: 'active', ownerId: OWNER.id });
    linkId = await linkUser(OWNER);
  });

  afterEach(async () => {
    await partner.close();
  });

  const sha = (code: string) => (parseVoucherCode(code) as { sha256: string }).sha256;

  it('answers held with the facts for the linked holder', async () => {
    const answer = await voucherOwner(partnerClient, { linkId, codeSha256: sha(CODE) });
    expect(answer).toMatchObject({ held: true, status: 'active', faceValueMinor: 500, currency: 'AUD' });
    expect(answer && answer.held && Number.isNaN(Date.parse(answer.expiresAt))).toBe(false);
  });

  it('shows the live status: held while a hold is open, redeemed after the capture', async () => {
    const auth = ok(await authorize());
    expect(await voucherOwner(partnerClient, { linkId, codeSha256: sha(CODE) })).toMatchObject({ held: true, status: 'held' });
    await client.capture({ authorizationId: auth.authorization_id as string, finalAmountMinor: 500 }, key());
    expect(await voucherOwner(partnerClient, { linkId, codeSha256: sha(CODE) })).toMatchObject({
      held: true,
      status: 'redeemed',
    });
  });

  it('answers the identical held:false for an unknown hash, another user\'s voucher and an unbound voucher', async () => {
    const strangerLink = await linkUser(STRANGER);
    const unbound = testVoucherCode(20);
    fake.inject({ code: unbound, faceMinor: 500, currency: 'AUD', status: 'active', ownerId: OWNER.id, redeemPartnerId: 'other-app' });
    expect(await voucherOwner(partnerClient, { linkId, codeSha256: 'a'.repeat(64) })).toEqual({ held: false });
    expect(await voucherOwner(partnerClient, { linkId: strangerLink, codeSha256: sha(CODE) })).toEqual({ held: false });
    expect(await voucherOwner(partnerClient, { linkId, codeSha256: sha(unbound) })).toEqual({ held: false });
    const raw = await partnerClient.post(
      '/api/partners/vouchers/owner',
      JSON.stringify({ linkId: strangerLink, codeSha256: sha(CODE) }),
      key(),
    );
    expect(raw).toMatchObject({ kind: 'ok', body: { linkId: strangerLink, held: false } });
  });

  it('400 unknown_link and 403 link_revoked like the other routes', async () => {
    const unknown = await partnerClient.post(
      '/api/partners/vouchers/owner',
      JSON.stringify({ linkId: 'nope', codeSha256: sha(CODE) }),
      key(),
    );
    expect(unknown).toMatchObject({ kind: 'error', status: 400 });
    partner.revokeFromYourtal(linkId);
    const revoked = await partnerClient.post(
      '/api/partners/vouchers/owner',
      JSON.stringify({ linkId, codeSha256: sha(CODE) }),
      key(),
    );
    expect(revoked).toMatchObject({ kind: 'error', status: 403 });
  });

  it('a malformed hash is 400', async () => {
    const bad = await partnerClient.post(
      '/api/partners/vouchers/owner',
      JSON.stringify({ linkId, codeSha256: 'xyz' }),
      key(),
    );
    expect(bad).toMatchObject({ kind: 'error', status: 400 });
  });
});
