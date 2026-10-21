import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startFakeYourtal, type FakeYourtal } from '../test-support/fake-yourtal.js';
import { openSessions } from '../test-support/sessions.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';

/**
 * The link endpoints through the REAL HTTP stack — the AppModule, its guards,
 * body validation and routing — with the partner client built from config,
 * exactly as in production, pointed at the fake YourTal. The controller
 * suite proves the behaviour; this one proves the wiring.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'b7a30000-0000-4000-8000-000000000001';
const FAY = 'b7a30000-0000-4000-8000-0000000000a1';
const GUS = 'b7a30000-0000-4000-8000-0000000000a2';

describeIfDb('the YourTal link over HTTP', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let fake: FakeYourtal;
  let tokenFor: (userId: string) => string;

  const call = (method: 'GET' | 'POST' | 'DELETE', userId: string | null, payload?: unknown) =>
    app.inject({
      method,
      url: '/v1/yourtal/link',
      headers: {
        ...(userId ? { authorization: `Bearer ${tokenFor(userId)}` } : {}),
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { payload: JSON.stringify(payload) } : {}),
    });

  beforeAll(async () => {
    fake = await startFakeYourtal();
    process.env.YOURTAL_PARTNER_ID = fake.partnerId;
    process.env.YOURTAL_PARTNER_SECRET = fake.secret;
    process.env.YOURTAL_API_URL = fake.url;

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'YourTal HTTP test co',
      users: [
        { id: FAY, role: 'owner', subject: 'test|yth-fay', email: 'fay@yourtal-http.test' },
        { id: GUS, role: 'member', subject: 'test|yth-gus', email: 'gus@yourtal-http.test' },
      ],
    });
    await admin.query(`update users set email_verified_at = now() where id = $1`, [FAY]);
    await admin.query(`update users set email_verified_at = null where id = $1`, [GUS]);
    await admin.query(`delete from rate_limits where bucket_key like 'yourtal-link:%'`);
    tokenFor = await openSessions(FAY, GUS);

    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await wipeTenant(admin, TENANT, [FAY, GUS]);
    await admin.end();
    await fake.close();
    delete process.env.YOURTAL_PARTNER_ID;
    delete process.env.YOURTAL_PARTNER_SECRET;
    delete process.env.YOURTAL_API_URL;
  });

  it('needs a session', async () => {
    expect((await call('GET', null)).statusCode).toBe(401);
  });

  it('reports the state, available because the partner is configured', async () => {
    const res = await call('GET', FAY);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: true, state: 'unlinked' });
  });

  it('refuses to link an unproven email address', async () => {
    const code = fake.issueCode({ id: 'yt-gus', region: 'AU' });
    const res = await call('POST', GUS, { code });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'email_unverified' });
  });

  it('validates the body', async () => {
    expect((await call('POST', FAY, {})).statusCode).toBe(400);
    expect((await call('POST', FAY, { code: 'ABCD2345', extra: true })).statusCode).toBe(400);
  });

  it('links and unlinks end to end, signing every call to YourTal', async () => {
    const code = fake.issueCode({ id: 'yt-fay', region: 'ID' });
    const before = fake.requests.length;

    const linked = await call('POST', FAY, { code });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({
      state: 'linked',
      region: 'ID',
      receiptPoints: { state: 'earning', pointsPerReceipt: 10 },
    });

    const unlinked = await call('DELETE', FAY);
    expect(unlinked.statusCode).toBe(200);
    expect(unlinked.json()).toMatchObject({ state: 'unlinked' });
    expect(fake.linkFor('yt-fay')!.revoked).toBe(true);

    const calls = fake.requests.slice(before);
    expect(calls.map((r) => r.path)).toEqual([
      '/api/partners/links',
      // The link answer carries whether receipts earn (2.10.c), read signed like the rest.
      '/api/partners/receipts/status',
      `/api/partners/links/${fake.linkFor('yt-fay')!.linkId}/revoke`,
    ]);
    expect(calls.every((r) => r.signatureValid && r.idempotencyKey)).toBe(true);
    expect(calls[1]!.raw).toBe('{"region":"ID"}');
    expect(calls[2]!.raw).toBe('{}');
  });

  it('answers a teen with teen_consent_not_allowed', async () => {
    const code = fake.issueCode({ id: 'yt-teen', region: 'AU', teen: true });
    const res = await call('POST', FAY, { code });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'teen_consent_not_allowed' });
  });
});
