import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { provisionTenant, wipeTenant } from '../test-support/tenant.js';

/**
 * A workspace with no scan credits is told to buy more and loses no capture
 * (group plan 7.1.b), and `GET /v1/usage` lists what was spent (7.1.e) —
 * through real HTTP, as the phone calls it.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'c7b10000-0000-4000-8000-000000000001';
const USER = 'c7b10000-0000-4000-8000-000000000002';

describeIfDb('out of scan credits — real HTTP (7.1.b, 7.1.e)', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let issueSession: (userId: string) => string;
  const savedFulfil = process.env.CREDITS_MANUAL_FULFIL;

  const auth = () => ({
    authorization: `Bearer ${issueSession(USER)}`,
    'x-workspace-id': TENANT,
  });

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);
    // The simulated purchase, so a bought pack can resume held captures.
    process.env.CREDITS_MANUAL_FULFIL = 'true';

    // No scanCredits: this workspace starts with none.
    admin = await provisionTenant({ tenantId: TENANT, name: 'Out of credits co', users: [{ id: USER, role: 'owner' }] });
    issueSession = await (await import('../test-support/sessions.js')).openSessions(USER);

    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ bodyLimit: 32 * 1024 * 1024, routerOptions: { maxParamLength: 600 } }),
      { logger: false },
    );
    const fastify = app.getHttpAdapter().getInstance();
    const rawBody = { parseAs: 'buffer' as const, bodyLimit: 32 * 1024 * 1024 };
    const passthrough = (_r: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) =>
      done(null, body);
    fastify.addContentTypeParser(/^image\//, rawBody, passthrough);
    await app.init();
    await fastify.ready();
  });

  afterAll(async () => {
    if (savedFulfil === undefined) delete process.env.CREDITS_MANUAL_FULFIL;
    else process.env.CREDITS_MANUAL_FULFIL = savedFulfil;
    await admin.query(`delete from jobs where tenant_id = $1`, [TENANT]);
    await admin.query(`delete from capture_pages where tenant_id = $1`, [TENANT]);
    await wipeTenant(admin, TENANT, [USER]);
    await admin.end();
    await app.close();
  });

  const photo = () => randomBytes(256);
  const register = (bytes: Buffer) =>
    app.inject({
      method: 'POST',
      url: '/v1/captures',
      headers: auth(),
      payload: {
        pages: [{ sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/jpeg', byteSize: bytes.byteLength }],
      },
    });
  const upload = (url: string, bytes: Buffer) =>
    app.inject({ method: 'PUT', url, headers: { ...auth(), 'content-type': 'image/jpeg' }, payload: bytes });
  const jobsFor = async (captureId: string) =>
    (
      await admin.query(`select count(*)::int as n from jobs where kind = 'extract' and payload->>'captureId' = $1`, [
        captureId,
      ])
    ).rows[0].n as number;
  const grant = (n: number) =>
    admin.query(
      `insert into usage_grants (id, tenant_id, metric, amount, remaining, source) values ($1, $2, 'scans', $3, $3, 'support_credit')`,
      [randomUUID(), TENANT, n],
    );

  it('refuses a new snap with 402 quota_exhausted and where to buy, storing nothing', async () => {
    const res = await register(photo());
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({
      error: 'quota_exhausted',
      message: expect.stringContaining('out of scan credits'),
      buyUrl: expect.stringMatching(/\/app\/credits\/buy$/),
    });
    const stored = await admin.query(`select count(*)::int as n from captures where tenant_id = $1`, [TENANT]);
    expect(stored.rows[0].n).toBe(0);
  });

  it('holds a snap whose credit went between registering and uploading, then queues it when it is sent again with a credit', async () => {
    await grant(1);
    const first = photo();
    const second = photo();
    const a = await register(first);
    const b = await register(second);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);

    expect((await upload(a.json().uploadUrl, first)).statusCode).toBe(200);
    const held = await upload(b.json().uploadUrl, second);
    expect(held.statusCode).toBe(402);
    expect(held.json()).toMatchObject({ error: 'quota_exhausted', message: expect.stringContaining('saved') });

    const heldId = b.json().captureId as string;
    expect(await jobsFor(a.json().captureId)).toBe(1);
    expect(await jobsFor(heldId)).toBe(0);
    // Never dropped: the capture and its page are kept.
    const pages = await admin.query(`select count(*)::int as n from capture_pages where capture_id = $1`, [heldId]);
    expect(pages.rows[0].n).toBe(1);

    // The phone re-sends it from its queue: still no credit, still 402 (it stays queued there).
    expect((await register(second)).statusCode).toBe(402);
    // With a credit, the re-send queues the held capture, once.
    await grant(1);
    const again = await register(second);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toMatchObject({ duplicate: true, captureId: heldId });
    expect(await jobsFor(heldId)).toBe(1);
    expect((await register(second)).statusCode).toBe(201);
    expect(await jobsFor(heldId)).toBe(1);
  });

  it('queues held snaps as soon as a pack is bought', async () => {
    const bytes = photo();
    await grant(1);
    const reg = await register(bytes);
    expect(reg.statusCode).toBe(201);
    await admin.query(`update usage_grants set remaining = 0 where tenant_id = $1`, [TENANT]);
    expect((await upload(reg.json().uploadUrl, bytes)).statusCode).toBe(402);
    const heldId = reg.json().captureId as string;

    const packs = (await app.inject({ method: 'GET', url: '/v1/credit-packs', headers: auth() })).json() as Array<{
      code: string;
    }>;
    const bought = await app.inject({
      method: 'POST',
      url: '/v1/credits/purchases',
      headers: auth(),
      payload: { packCode: packs[0]!.code },
    });
    expect(bought.statusCode).toBe(200);
    const fulfil = await app.inject({
      method: 'POST',
      url: `/v1/credits/purchases/${bought.json().id as string}/fulfil`,
      headers: auth(),
    });
    expect(fulfil.statusCode).toBe(200);
    expect(await jobsFor(heldId)).toBe(1);
  });

  it('reads held snaps first, oldest first, when the next new snap is accepted (credits from anywhere)', async () => {
    const heldBytes = photo();
    await grant(1);
    await admin.query(`update usage_grants set remaining = 0 where tenant_id = $1 and source <> 'support_credit'`, [TENANT]);
    // Exactly one usable credit: the one just granted.
    const reg = await register(heldBytes);
    expect(reg.statusCode).toBe(201);
    await admin.query(`update usage_grants set remaining = 0 where tenant_id = $1`, [TENANT]);
    expect((await upload(reg.json().uploadUrl, heldBytes)).statusCode).toBe(402);
    const heldId = reg.json().captureId as string;

    // Credits arrive without a purchase (a voucher, a parent's top-up for a teen): no hook runs.
    await grant(2);
    expect(await jobsFor(heldId)).toBe(0);
    const next = photo();
    const nextReg = await register(next);
    expect(nextReg.statusCode).toBe(201);
    expect(await jobsFor(heldId)).toBe(1);
    expect((await upload(nextReg.json().uploadUrl, next)).statusCode).toBe(200);
    expect(await jobsFor(nextReg.json().captureId)).toBe(1);
  });

  it('refuses an upload that is not the kind of file registered (a CSV registration carrying a photo)', async () => {
    const bytes = photo();
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/captures',
      headers: auth(),
      payload: {
        pages: [{ sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: 'text/csv', byteSize: bytes.byteLength }],
      },
    });
    expect(reg.statusCode).toBe(201);
    const res = await upload(reg.json().uploadUrl, bytes);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'content_type_mismatch' });
    const pages = await admin.query(`select count(*)::int as n from capture_pages where capture_id = $1`, [reg.json().captureId]);
    expect(pages.rows[0].n).toBe(0);
  });

  it('lists what was spent this month, for this workspace only', async () => {
    // The workspace's month (an AU workspace reads Sydney time).
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit' })
      .format(new Date())
      .slice(0, 7);
    const months = await app.inject({ method: 'GET', url: '/v1/usage/months?kind=credits', headers: auth() });
    expect(months.json()).toEqual([month]);

    const res = await app.inject({ method: 'GET', url: `/v1/usage?kind=credits&month=${month}&limit=3`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Five scans paid above: the first upload, the resumed one, the one queued by the
    // purchase, and the held one plus the new one in the test before.
    expect(body).toMatchObject({ month, kind: 'credits', total: 5 });
    expect(body.items).toHaveLength(3);
    expect(body.items[0]).toMatchObject({ label: 'Scan', amount: 1 });
    const rest = await app.inject({
      method: 'GET',
      url: `/v1/usage?kind=credits&month=${month}&limit=3&before=${body.nextBefore as string}`,
      headers: auth(),
    });
    expect(rest.json().items).toHaveLength(2);
    expect(rest.json().nextBefore).toBeNull();

    expect((await app.inject({ method: 'GET', url: '/v1/usage?kind=credits&month=2026-13', headers: auth() })).statusCode).toBe(400);
    const noWorkspace = await app.inject({
      method: 'GET',
      url: `/v1/usage?kind=credits&month=${month}`,
      headers: { authorization: `Bearer ${issueSession(USER)}` },
    });
    expect(noWorkspace.statusCode).toBe(403);
  });
});
