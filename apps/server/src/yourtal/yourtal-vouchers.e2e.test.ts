import { randomBytes, randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { withTenantAs } from '@snap/db';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MembershipGuard, SessionGuard, VerifiedEmailGuard, type AuthUser, type CurrentSessionInfo } from '../common/auth.guard.js';
import { closeDb, getDb } from '../db.js';
import { enqueueExtraction } from '../repo.js';
import { startFakeYourtal, type FakeYourtal } from '../test-support/fake-yourtal.js';
import {
  FakeVoucherStore,
  REDEMPTION_DISABLED_FAILURE,
  startFakeYourtalVouchers,
  testVoucherCode,
  type FakeYourtalVouchers,
} from '../test-support/fake-yourtal-vouchers.js';
import { openSessions } from '../test-support/sessions.js';
import { openWorkerDb, type WorkerDb } from '../test-support/worker-db.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { YourtalPartnerClient } from './client.js';
import { YourtalMerchantClient } from './merchant-client.js';
import { advanceRedemption, authorizeOnce, SCANS_VOUCHER, type Mover } from './redeem.service.js';
import { drainVoucherRedemptions } from './redemption-drain.js';
import { grantRedemption, insertRedemption, releaseRedemption, type Enter, type RedemptionRow } from './redemptions.repo.js';
import { parseVoucherCode } from './voucher-code.js';
import { YourtalVouchersController } from './vouchers.controller.js';
import { YourtalLinkController } from './yourtal.controller.js';

/**
 * Group plan 2.8, ticket S4: redeeming a scans voucher, against real Postgres
 * as the real roles (`snap_app` for the request, `snap_worker` for the drain)
 * and the S3 fakes of YourTal's partner and merchant APIs, which check every
 * signature and replay every stored answer like the real service.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'b7a40000-0000-4000-8000-000000000001';
const ANA = 'b7a40000-0000-4000-8000-0000000000a1';
const BEN = 'b7a40000-0000-4000-8000-0000000000a2';
const WORKER = 'b7a40000-0000-4000-8000-0000000000f1';
const SECRET = Buffer.alloc(32, 9);

const ana: AuthUser = { userId: ANA, email: 'ana@vouchers.test', displayName: 'Ana', initials: 'AN', emailVerified: true };
const ben: AuthUser = { userId: BEN, email: 'ben@vouchers.test', displayName: 'Ben', initials: 'BE', emailVerified: true };
const session = { sessionId: 'test', tokenHash: Buffer.alloc(32) } as CurrentSessionInfo;
const quiet = { log: () => {}, warn: () => {}, error: () => {} };

async function refusal(promise: Promise<unknown>): Promise<{ status: number; error: string; redeemedAt?: string }> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof HttpException) {
      const body = e.getResponse() as { error: string; redeemedAt?: string };
      return { status: e.getStatus(), error: body.error, ...(body.redeemedAt ? { redeemedAt: body.redeemedAt } : {}) };
    }
    throw e;
  }
  throw new Error('expected a refusal');
}

describeIfDb('redeeming a YourTal scans voucher (2.8 S4)', () => {
  let admin: Client;
  let partnerFake: FakeYourtal;
  let merchantFake: FakeYourtalVouchers;
  let worker: WorkerDb;
  let merchant: YourtalMerchantClient;
  let controller: YourtalVouchersController;
  let linkController: YourtalLinkController;
  let codeNumber = 1000;

  const fakeNow = () => merchantFake.clock.now();
  const merchantClient = (fetchImpl: typeof fetch = fetch) =>
    new YourtalMerchantClient({ baseUrl: merchantFake.url, keyId: merchantFake.keyId, secret: SECRET, timeoutMs: 2000 }, fetchImpl, fakeNow);

  /** A fresh voucher in a wallet: Ana's by default. */
  function voucher(over: { ownerId?: string; merchantId?: string; faceMinor?: number } = {}): string {
    const code = testVoucherCode((codeNumber += 1));
    merchantFake.inject({ code, faceMinor: 500, currency: 'AUD', status: 'active', ownerId: 'yt-ana', ...over });
    return code;
  }

  /** The redemptions of one code, oldest first. */
  const rows = async (code: string) =>
    (
      await admin.query<RedemptionRow & { last_http_status: number | null }>(
        `select id, status, merchant_order_ref, authorization_id, receipt_id, grant_id, last_code, last_http_status
           from yourtal_voucher_redemptions where tenant_id = $1 and code_sha256 = $2 order by created_at`,
        [TENANT, (parseVoucherCode(code) as { sha256: string }).sha256],
      )
    ).rows;
  const voucherGrants = async () =>
    (await admin.query<{ id: string; amount: number }>(
      `select id, amount from usage_grants where tenant_id = $1 and source = 'yourtal_voucher'`,
      [TENANT],
    )).rows;
  const routes = () => merchantFake.requests.map((r) => r.route);
  /** Makes every unfinished row due now, as if its backoff had passed. */
  const due = () =>
    admin.query(`update yourtal_voucher_redemptions set next_attempt_at = now(), locked_at = null, locked_by = null
                  where tenant_id = $1 and status not in ('granted','voided','expired','refused','abandoned','failed')`, [TENANT]);
  const drain = (workerId?: string) =>
    drainVoucherRedemptions({ client: merchant, worker: worker.actor, db: worker.db, workerId, now: fakeNow, log: quiet });

  beforeAll(async () => {
    const store = new FakeVoucherStore();
    partnerFake = await startFakeYourtal({ vouchers: store });
    merchantFake = await startFakeYourtalVouchers({ store, secret: SECRET });
    process.env.YOURTAL_PARTNER_ID = partnerFake.partnerId;
    process.env.YOURTAL_PARTNER_SECRET = partnerFake.secret;
    process.env.YOURTAL_API_URL = partnerFake.url;
    process.env.YOURTAL_MERCHANT_KEY_ID = merchantFake.keyId;
    process.env.YOURTAL_MERCHANT_SECRET = SECRET.toString('hex');

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Voucher test co',
      users: [
        { id: ANA, role: 'owner', subject: 'test|v-ana', email: 'ana@vouchers.test' },
        { id: BEN, role: 'member', subject: 'test|v-ben', email: 'ben@vouchers.test' },
      ],
      serviceUsers: [{ id: WORKER }],
    });
    worker = openWorkerDb(WORKER);
    merchant = merchantClient();

    const partner = () =>
      new YourtalPartnerClient({ baseUrl: partnerFake.url, partnerId: partnerFake.partnerId, secret: partnerFake.secret, timeoutMs: 2000 });
    linkController = new YourtalLinkController();
    linkController.clientFor = partner;
    controller = new YourtalVouchersController();
    controller.partnerFor = partner;
    controller.merchantFor = () => merchant;
    controller.now = fakeNow;

    await admin.query(`delete from rate_limits where bucket_key like 'yourtal-%'`);
    await linkController.link(ana, session, { code: partnerFake.issueCode({ id: 'yt-ana', region: 'AU' }) });
    await linkController.link(ben, session, { code: partnerFake.issueCode({ id: 'yt-ben', region: 'AU' }) });
  });

  beforeEach(async () => {
    await admin.query(`delete from rate_limits where bucket_key like 'yourtal-voucher:%'`);
    merchantFake.requests.length = 0;
    merchant = merchantClient();
  });

  afterAll(async () => {
    await wipeTenant(admin, TENANT, [ANA, BEN, WORKER]);
    await admin.end();
    await worker.pool.end();
    await closeDb();
    await partnerFake.close();
    await merchantFake.close();
    for (const k of ['YOURTAL_PARTNER_ID', 'YOURTAL_PARTNER_SECRET', 'YOURTAL_API_URL', 'YOURTAL_MERCHANT_KEY_ID', 'YOURTAL_MERCHANT_SECRET']) {
      delete process.env[k];
    }
  });

  it('needs a session, the workspace, a proven email and the person\'s own session', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, YourtalVouchersController) as unknown[];
    expect(guards).toEqual([SessionGuard, MembershipGuard, VerifiedEmailGuard]);
    expect(YourtalVouchersController.prototype.redeem.length).toBe(5); // @CurrentSession: 403 under impersonation
  });

  it('happy path: authorize, capture, 50 credits once; the same code again is already_redeemed', async () => {
    const code = voucher();
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4, 8)} ${code.slice(8)}`;
    const answer = await controller.run(ana, TENANT, typed);
    expect(answer).toMatchObject({ state: 'granted', redemption: { state: 'granted', credits: 50 } });
    expect(routes()).toEqual(['authorize', 'capture']);

    const [row] = await rows(code);
    expect(row).toMatchObject({ status: 'granted', merchant_order_ref: `snap-${row!.id}` });
    expect(row!.receipt_id).toMatch(/^rcpt_/);
    expect(await voucherGrants()).toEqual([{ id: row!.grant_id, amount: 50 }]);
    expect(merchantFake.voucher(code)!.status).toBe('redeemed');

    const again = await refusal(controller.run(ana, TENANT, code));
    expect(again).toMatchObject({ status: 409, error: 'already_redeemed' });
    expect(again.redeemedAt).toMatch(/^\d{4}-/);
    expect(routes()).toEqual(['authorize', 'capture']);

    const status = await linkController.status(ana, TENANT);
    expect(status.vouchers).toMatchObject({ available: true, redemptions: [{ id: row!.id, state: 'granted', credits: 50 }] });
    expect((await linkController.status(ben, TENANT)).vouchers).toMatchObject({ available: false, reason: 'role' });
  });

  it('over the real HTTP stack: 200 granted, 202 pending, the workspace header and body checked', async () => {
    await admin.query(`update users set email_verified_at = now() where id = $1`, [ANA]);
    const tokenFor = await openSessions(ANA);
    const { AppModule } = await import('../app.module.js');
    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    try {
      const vouchers = app.get(YourtalVouchersController);
      vouchers.partnerFor = controller.partnerFor;
      vouchers.merchantFor = () => merchant;
      vouchers.now = fakeNow;
      const call = (url: string, payload?: unknown, workspace: string | null = TENANT) =>
        app.inject({
          method: payload ? 'POST' : 'GET',
          url,
          headers: {
            authorization: `Bearer ${tokenFor(ANA)}`,
            ...(workspace ? { 'x-workspace-id': workspace } : {}),
            ...(payload ? { 'content-type': 'application/json' } : {}),
          },
          ...(payload ? { payload: JSON.stringify(payload) } : {}),
        });

      const granted = await call('/v1/yourtal/vouchers/redeem', { code: voucher() });
      expect(granted.statusCode).toBe(200);
      expect(granted.json()).toMatchObject({ state: 'granted', redemption: { state: 'granted', credits: 50 } });

      merchantFake.hangNext('capture');
      const pending = await call('/v1/yourtal/vouchers/redeem', { code: voucher() });
      expect(pending.statusCode).toBe(202);
      expect(pending.json()).toMatchObject({ state: 'pending', redemption: { state: 'pending' } });

      expect((await call('/v1/yourtal/vouchers/redeem', { code: voucher() }, null)).statusCode).toBe(403);
      expect((await call('/v1/yourtal/vouchers/redeem', {})).statusCode).toBe(400);
      const used = await call('/v1/yourtal/vouchers/redeem', { code: voucher({ ownerId: 'yt-ben' }) });
      expect([used.statusCode, used.json().error]).toEqual([409, 'not_your_voucher']);

      const status = (await call('/v1/yourtal/link')).json();
      expect(status.vouchers.available).toBe(true);
      const listed = new Map(status.vouchers.redemptions.map((r: { id: string; state: string }) => [r.id, r.state]));
      expect(listed.get(granted.json().redemption.id)).toBe('granted');
      expect(listed.get(pending.json().redemption.id)).toBe('pending');
    } finally {
      await app.close();
    }
    await due();
    expect(await drain()).toMatchObject({ claimed: 1, granted: 1 }); // the pending one, finished
  });

  it('voucher credits earn no receipt points: a scan on them is not a paid scan', async () => {
    const captureId = randomUUID();
    await admin.query(
      `insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                             original_byte_size, original_sha256, status)
       values ($1, $2, $3, $4, 'image/jpeg', 1024, decode($5, 'hex'), 'received')`,
      [captureId, TENANT, ANA, `${TENANT}/pages/${captureId}`, randomBytes(32).toString('hex')],
    );
    await enqueueExtraction(ANA, TENANT, captureId);
    const spend = await admin.query(`select grant_source, paid from credit_spends where capture_id = $1`, [captureId]);
    expect(spend.rows).toEqual([{ grant_source: 'yourtal_voucher', paid: false }]);
  });

  it('refuses before any merchant call: a member, a typo, someone else\'s voucher, the wrong face value', async () => {
    expect(await refusal(controller.run(ben, TENANT, voucher()))).toMatchObject({ status: 403, error: 'owner_or_admin_only' });
    const good = voucher();
    const typo = good.slice(0, 16) + (good[16] === '0' ? '1' : '0');
    expect(await refusal(controller.run(ana, TENANT, typo))).toMatchObject({ status: 400, error: 'invalid_voucher_code' });
    expect(await refusal(controller.run(ana, TENANT, voucher({ ownerId: 'yt-ben' })))).toMatchObject({ status: 409, error: 'not_your_voucher' });
    expect(await refusal(controller.run(ana, TENANT, voucher({ faceMinor: 1000 })))).toMatchObject({ status: 409, error: 'not_a_scans_voucher' });
    expect(routes()).toEqual([]);
  });

  it('value mismatch at authorize: voids the hold and refuses; nothing granted', async () => {
    const code = voucher();
    // YourTal says the voucher holds more than the scans voucher's face value.
    merchant = merchantClient(async (url, init) => {
      const response = await fetch(url, init);
      if (!String(url).endsWith('/authorize') || !response.ok) return response;
      const body = (await response.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...body, remaining_balance: 1000 }), { status: 200, headers: response.headers });
    });
    const before = (await voucherGrants()).length;
    expect(await refusal(controller.run(ana, TENANT, code))).toMatchObject({ status: 409, error: 'not_a_scans_voucher' });
    expect(routes()).toEqual(['authorize', 'void']);
    expect((await rows(code)).at(-1)).toMatchObject({ status: 'voided', last_code: null });
    expect(merchantFake.voucher(code)!.status).toBe('active');
    expect((await voucherGrants()).length).toBe(before);
  });

  it('authorize refused, or YourTal\'s kill switch: final, nothing taken, no capture', async () => {
    const otherMerchants = voucher({ merchantId: 'someone-else' });
    expect(await refusal(controller.run(ana, TENANT, otherMerchants))).toMatchObject({ status: 409, error: 'voucher_refused' });
    expect((await rows(otherMerchants)).at(-1)).toMatchObject({ status: 'refused', last_http_status: 402, last_code: 'authorization_refused' });

    merchantFake.failNext('authorize', REDEMPTION_DISABLED_FAILURE);
    const switchedOff = voucher();
    expect(await refusal(controller.run(ana, TENANT, switchedOff))).toMatchObject({ status: 503, error: 'yourtal_unavailable' });
    expect((await rows(switchedOff)).at(-1)).toMatchObject({ status: 'failed', last_code: 'redemption_disabled' });
    expect(routes()).toEqual(['authorize', 'authorize']);
  });

  it('a 5xx on authorize that did hold: pending, then the drain looks it up, captures and grants', async () => {
    const code = voucher();
    merchantFake.failNext('authorize', 500, { applyFirst: true });
    const answer = await controller.run(ana, TENANT, code);
    expect(answer.state).toBe('pending');
    expect((await rows(code)).at(-1)).toMatchObject({ status: 'authorizing' });

    await due();
    expect(await drain()).toMatchObject({ claimed: 1, granted: 1 });
    expect(routes()).toEqual(['authorize', 'lookup', 'capture']);
    expect((await rows(code)).at(-1)).toMatchObject({ status: 'granted' });
    expect(merchantFake.voucher(code)!.status).toBe('redeemed');
  });

  it('a 5xx on authorize that held nothing: abandoned after 17 minutes, never re-authorized; a retry then works', async () => {
    const code = voucher();
    merchantFake.failNext('authorize', 500);
    expect((await controller.run(ana, TENANT, code)).state).toBe('pending');

    await due();
    expect(await drain()).toMatchObject({ claimed: 1, waiting: 1 });
    merchantFake.clock.advance(18 * 60_000);
    await due();
    expect(await drain()).toMatchObject({ claimed: 1, finishedWithout: 1 });
    expect((await rows(code)).at(-1)).toMatchObject({ status: 'abandoned', last_code: 'order_not_found' });
    expect(routes()).toEqual(['authorize', 'lookup', 'lookup']);

    expect(await controller.run(ana, TENANT, code)).toMatchObject({ state: 'granted' });
    const mine = await rows(code);
    expect(mine.map((r) => r.status).sort()).toEqual(['abandoned', 'granted']);
    expect(mine[0]!.merchant_order_ref).not.toBe(mine[1]!.merchant_order_ref);
  });

  it('capture refused by the kill switch: a lookup says the hold is live, so it is voided; nothing taken', async () => {
    const code = voucher();
    merchantFake.failNext('capture', REDEMPTION_DISABLED_FAILURE);
    expect(await refusal(controller.run(ana, TENANT, code))).toMatchObject({ status: 503, error: 'yourtal_unavailable' });
    expect(routes()).toEqual(['authorize', 'capture', 'lookup', 'void']);
    expect((await rows(code)).at(-1)).toMatchObject({ status: 'voided', receipt_id: null, grant_id: null });
    expect(merchantFake.voucher(code)!.status).toBe('active');
  });

  it('crash after capture (the answer is lost): pending, then two drains at once grant exactly once', async () => {
    const code = voucher();
    merchantFake.hangNext('capture');
    expect((await controller.run(ana, TENANT, code)).state).toBe('pending');
    expect((await rows(code)).at(-1)).toMatchObject({ status: 'capturing' });
    expect(merchantFake.voucher(code)!.status).toBe('redeemed');

    const before = (await voucherGrants()).length;
    await due();
    const [a, b] = await Promise.all([drain('drain-a'), drain('drain-b')]);
    expect(a.claimed + b.claimed).toBe(1);
    expect(a.granted + b.granted).toBe(1);
    // The capture was resent with the SAME key and YourTal replayed its 200.
    expect(merchantFake.requests.filter((r) => r.route === 'capture').map((r) => r.replay)).toEqual([false, true]);
    expect((await voucherGrants()).length).toBe(before + 1);
    expect((await rows(code)).at(-1)).toMatchObject({ status: 'granted' });
  });

  it('crash between captured and the grant: the drain grants once, and racing grants never double', async () => {
    const code = voucher();
    const parsed = parseVoucherCode(code) as { canonical: string; sha256: string };
    const link = await admin.query<{ id: string }>(`select id from yourtal_links where user_id = $1 and revoked_at is null`, [ANA]);
    const enter: Enter = (fn) => withTenantAs(getDb(), ANA, TENANT, fn);
    const row = (await insertRedemption(enter, {
      linkRowId: link.rows[0]!.id,
      codeSha256: parsed.sha256,
      ...SCANS_VOUCHER,
      holder: 'request-crash',
      dueInSeconds: 30,
    })) as RedemptionRow;
    // The request's process dies the moment it tries to grant.
    let calls = 0;
    const crashing: Mover = {
      client: merchant,
      enter: (fn) => (calls++ === 3 ? Promise.reject(new Error('process killed')) : enter(fn)),
      holder: 'request-crash',
      now: fakeNow,
      log: quiet,
    };
    const held = await authorizeOnce(row, parsed.canonical, crashing);
    const stopped = await advanceRedemption(held.row, crashing, 'request').catch(() => null);
    expect(stopped?.status ?? 'captured').toBe('captured');
    expect((await rows(code)).at(-1)).toMatchObject({ status: 'captured', grant_id: null });

    const before = (await voucherGrants()).length;
    await due();
    // Two drains and two direct grants, all at once: the row lock decides.
    const results = await Promise.all([
      drain('drain-c'),
      drain('drain-d'),
      grantRedemption(enter, row.id),
      grantRedemption(enter, row.id),
    ]);
    expect(results.slice(2).every((r) => (r as RedemptionRow).status === 'granted')).toBe(true);
    expect((await voucherGrants()).length).toBe(before + 1);
    expect(routes().filter((r) => r === 'capture')).toEqual(['capture']); // never captured again
    await releaseRedemption(enter, row.id, 'request-crash', 0);
  });

  it('a double submit: one redemption, one capture, one grant', async () => {
    const code = voucher();
    const before = (await voucherGrants()).length;
    const answers = await Promise.allSettled([controller.run(ana, TENANT, code), controller.run(ana, TENANT, code)]);
    const states = answers.map((a) =>
      a.status === 'fulfilled' ? a.value.state : ((a.reason as HttpException).getResponse() as { error: string }).error,
    );
    expect(states).toContain('granted');
    expect(['pending', 'already_redeemed', 'voucher_busy', 'voucher_used']).toContain(states.find((s) => s !== 'granted'));
    expect(routes().filter((r) => r === 'capture')).toEqual(['capture']);
    expect((await voucherGrants()).length).toBe(before + 1);
    expect(merchantFake.voucher(code)!.authorizations).toHaveLength(1);
  });

  it('an expired hold: the drain records expired without re-authorizing; a retry uses a new order ref', async () => {
    const code = voucher();
    const parsed = parseVoucherCode(code) as { canonical: string; sha256: string };
    const link = await admin.query<{ id: string }>(`select id from yourtal_links where user_id = $1 and revoked_at is null`, [ANA]);
    const enter: Enter = (fn) => withTenantAs(getDb(), ANA, TENANT, fn);
    const row = (await insertRedemption(enter, {
      linkRowId: link.rows[0]!.id,
      codeSha256: parsed.sha256,
      ...SCANS_VOUCHER,
      holder: 'request-expire',
      dueInSeconds: 0,
    })) as RedemptionRow;
    // Authorized, then the request died before capturing.
    const mover: Mover = { client: merchant, enter, holder: 'request-expire', now: fakeNow, log: quiet };
    expect((await authorizeOnce(row, parsed.canonical, mover)).outcome).toBe('held');
    await releaseRedemption(enter, row.id, 'request-expire', 0);

    merchantFake.clock.advance(16 * 60_000);
    // Asking again while it is unfinished is answered from the row, with no call.
    expect((await controller.run(ana, TENANT, code)).state).toBe('pending');

    await due();
    expect(await drain()).toMatchObject({ claimed: 1, finishedWithout: 1 });
    expect((await rows(code)).at(-1)).toMatchObject({ status: 'expired' });
    expect(routes()).toEqual(['authorize', 'lookup']);

    merchantFake.store.sweep();
    expect(await controller.run(ana, TENANT, code)).toMatchObject({ state: 'granted' });
    const both = await rows(code);
    expect(both.map((r) => r.status).sort()).toEqual(['expired', 'granted']);
    expect(new Set(both.map((r) => r.merchant_order_ref)).size).toBe(2);
    expect(routes().filter((r) => r === 'authorize')).toHaveLength(2);
  });

  it('a revoked link is marked broken and refused', async () => {
    const code = voucher();
    partnerFake.revokeFromYourtal(partnerFake.linkFor('yt-ana')!.linkId);
    expect(await refusal(controller.run(ana, TENANT, code))).toMatchObject({ status: 409, error: 'link_broken' });
    expect((await linkController.status(ana, TENANT)).state).toBe('broken');
    expect(await refusal(controller.run(ana, TENANT, code))).toMatchObject({ status: 409, error: 'not_linked' });
  });
});
