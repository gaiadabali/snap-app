import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, createPool, type Db } from '@snap/db';
import { sql } from 'drizzle-orm';
import { SignJWT, type JWTPayload } from 'jose';
import type { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MailMessage } from '../auth/mailer.js';
import { startFakeYourTalOidc, type FakeYourTalOidc } from '../test-support/fake-yourtal-oidc.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { workerDatabaseUrl } from '../test-support/worker-db.js';

/**
 * YourTal's security events end to end (group task 3.7, ticket S2;
 * yourtal/docs/29 §4.3 and §6): SETs signed by the stand-in YourTal, posted
 * through the real AppModule, then the worker's jobs run on the worker's own
 * connection (snap_worker), as in production.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const W_ALONE = 'e5200000-0000-4000-8000-000000000001'; // A runs it alone; M is its bookkeeper
const W_SHARED = 'e5200000-0000-4000-8000-000000000002'; // B owns it; A, C and D are members
const A = 'e5200000-0000-4000-8000-0000000000a1';
const B = 'e5200000-0000-4000-8000-0000000000b1';
const C = 'e5200000-0000-4000-8000-0000000000c1';
const D = 'e5200000-0000-4000-8000-0000000000e1';
const M = 'e5200000-0000-4000-8000-0000000000d1';
const run = randomUUID().slice(0, 8);
const SUB = { A: `s2-a-${run}`, B: `s2-b-${run}`, C: `s2-c-${run}`, D: `s2-d-${run}`, unknown: `s2-x-${run}` };
const EV = {
  deleted: 'urn:yourtal:event:account-deleted',
  ended: 'urn:yourtal:event:access-ended',
  adult: 'urn:yourtal:event:became-adult',
};

describeIfDb('YourTal security events (S2)', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let yt: FakeYourTalOidc;
  let workerPool: Pool;
  let workerDb: Db;
  let storage: string;
  let restoreMailer: () => void;
  let runErasureJobsOnce: (db: Db, log?: Pick<Console, 'log' | 'warn' | 'error'>) => Promise<number>;
  let issueYourTalSession: (userId: string) => Promise<string>;
  let resetYourtalEventKeys: () => void;
  const startedAt = new Date();
  const mail: MailMessage[] = [];
  const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };

  const claims = (sub: string, event: string, body: object = {}, over: JWTPayload = {}): JWTPayload => ({
    iss: yt.issuer,
    aud: yt.serverClientId,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
    sub_id: { format: 'iss_sub', iss: yt.issuer, sub },
    events: { [event]: body },
    ...over,
  });
  const post = (token: string, contentType = 'application/secevent+jwt') =>
    app.inject({ method: 'POST', url: '/v1/yourtal/events', headers: { 'content-type': contentType }, payload: token });
  const sessionStatus = async (token: string) =>
    (await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { authorization: `Bearer ${token}` } }))
      .statusCode;
  const job = async (id: unknown) =>
    (await admin.query('select * from jobs where id = $1', [id])).rows[0] as
      | { tenant_id: string | null; kind: string; payload: { set?: string }; completed_at: Date | null; last_error: string | null }
      | undefined;
  const eventJobs = async () => (await admin.query(`select count(*)::int as n from jobs where kind = 'yourtal_event'`)).rows[0].n as number;
  const userExists = async (id: string) => (await admin.query('select 1 from users where id = $1', [id])).rowCount === 1;
  const isErased = async (sub: string) =>
    (await admin.query('select 1 from yourtal_erased_subjects where sub = $1', [sub])).rowCount === 1;
  const drain = async () => {
    while ((await runErasureJobsOnce(workerDb, quiet)) > 0) {
      /* until nothing is due */
    }
  };

  beforeAll(async () => {
    storage = mkdtempSync(join(tmpdir(), 'yourtal-events-'));
    process.env.STORAGE_DIR = storage;
    yt = await startFakeYourTalOidc();
    process.env.YOURTAL_OIDC_ISSUER = yt.issuer;
    process.env.YOURTAL_OIDC_SERVER_CLIENT_ID = yt.serverClientId;

    admin = await provisionTenant({
      tenantId: W_ALONE,
      name: 'S2 alone',
      users: [
        { id: A, role: 'owner', subject: `yourtal|${SUB.A}`, email: `a-${run}@s2.test` },
        { id: M, role: 'bookkeeper', email: `m-${run}@s2.test` },
      ],
    });
    (
      await provisionTenant({
        tenantId: W_SHARED,
        name: 'S2 shared',
        users: [
          { id: B, role: 'owner', subject: `yourtal|${SUB.B}`, email: `b-${run}@s2.test` },
          { id: C, role: 'member', subject: `yourtal|${SUB.C}`, email: `c-${run}@s2.test` },
          { id: D, role: 'member', subject: `yourtal|${SUB.D}`, email: `d-${run}@s2.test` },
        ],
      })
    ).end();
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'member')`, [W_SHARED, A]);
    await admin.query(`delete from rate_limits where bucket_key like 'yourtal-events:%'`);

    workerPool = createPool(workerDatabaseUrl());
    workerDb = createDb(workerPool);
    ({ runErasureJobsOnce } = await import('./events-job.js'));
    ({ issueYourTalSession } = await import('../auth/sessions.js'));
    ({ resetYourtalEventKeys } = await import('./events-verify.js'));
    restoreMailer = (await import('../auth/mailer.js')).setMailerForTesting({
      send: async (m) => {
        mail.push(m);
      },
    });

    const { AppModule } = await import('../app.module.js');
    const { registerSecEventParser } = await import('./events.controller.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    registerSecEventParser(app.getHttpAdapter().getInstance());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    if (admin) {
      await admin.query(
        `delete from jobs where kind in ('yourtal_event', 'erasure_notice', 'storage_purge') and tenant_id is null and created_at >= $1`,
        [startedAt],
      );
      await admin.query('delete from yourtal_erased_subjects where sub = any($1)', [Object.values(SUB)]);
      await admin.query(`delete from rate_limits where bucket_key like 'yourtal-events:%'`);
      await admin.query('delete from mail_deliveries where recipient like $1', [`%-${run}@s2.test`]);
      await wipeTenant(admin, W_ALONE, [A, M]);
      await wipeTenant(admin, W_SHARED, [B, C, D]);
      await admin.end();
    }
    await workerPool?.end();
    restoreMailer?.();
    await yt?.close();
    rmSync(storage, { recursive: true, force: true });
  });

  it('answers 202 and stores one job with the raw SET; a replay adds none', async () => {
    const c = claims(SUB.unknown, EV.adult);
    const token = await yt.signSet(c);
    const before = await eventJobs();

    expect((await post(token)).statusCode).toBe(202);
    const stored = await job(c.jti);
    expect(stored).toMatchObject({ tenant_id: null, kind: 'yourtal_event', payload: { set: token } });

    expect((await post(token)).statusCode).toBe(202);
    expect(await eventJobs()).toBe(before + 1);
  });

  it('refuses every bad token with its RFC 8935 code, and stores nothing', async () => {
    const before = await eventJobs();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const cases: Array<[string, Promise<string> | string, string, string?]> = [
      ['not a token', 'not.a.token', 'invalid_request'],
      ['a JSON body', JSON.stringify({ set: 'x' }), 'invalid_request', 'application/json'],
      [
        'HS256',
        new SignJWT(claims(SUB.B, EV.deleted))
          .setProtectedHeader({ alg: 'HS256', typ: 'secevent+jwt', kid: 'test-2026-10-a' })
          .sign(new TextEncoder().encode('a-shared-secret-of-thirty-two-bytes!')),
        'authentication_failed',
      ],
      ['alg none', `${b64({ alg: 'none', typ: 'secevent+jwt' })}.${b64(claims(SUB.B, EV.deleted))}.`, 'authentication_failed'],
      ['another key', yt.signSet(claims(SUB.B, EV.deleted), { impostor: true }), 'authentication_failed'],
      ['an unknown kid', yt.signSet(claims(SUB.B, EV.deleted), { header: { kid: 'nobody' } }), 'invalid_key'],
      ['another issuer', yt.signSet(claims(SUB.B, EV.deleted, {}, { iss: 'https://evil.example/oidc' })), 'invalid_issuer'],
      ['another audience', yt.signSet(claims(SUB.B, EV.deleted, {}, { aud: 'ftr-web' })), 'invalid_audience'],
      ['an audience list', yt.signSet(claims(SUB.B, EV.deleted, {}, { aud: [yt.serverClientId, 'ftr-web'] })), 'invalid_audience'],
      ['an ID token typ', yt.signSet(claims(SUB.B, EV.deleted), { header: { typ: 'JWT' } }), 'invalid_request'],
      [
        'sub_id from another issuer',
        yt.signSet(claims(SUB.B, EV.deleted, {}, { sub_id: { format: 'iss_sub', iss: 'https://evil.example', sub: SUB.B } })),
        'invalid_issuer',
      ],
      ['an iat 31 days old', yt.signSet(claims(SUB.B, EV.deleted, {}, { iat: Math.floor(Date.now() / 1000) - 31 * 86_400 })), 'invalid_request'],
      ['an iat 10 minutes ahead', yt.signSet(claims(SUB.B, EV.deleted, {}, { iat: Math.floor(Date.now() / 1000) + 600 })), 'invalid_request'],
      ['two events', yt.signSet(claims(SUB.B, EV.deleted, {}, { events: { [EV.deleted]: {}, [EV.adult]: {} } })), 'invalid_request'],
      ['a jti that is not a uuid', yt.signSet(claims(SUB.B, EV.deleted, {}, { jti: 'abc' })), 'invalid_request'],
    ];
    for (const [name, token, err, contentType] of cases) {
      const res = await post(await token, contentType);
      expect({ name, status: res.statusCode, body: res.json() }).toEqual({ name, status: 400, body: { err } });
    }
    expect(await eventJobs()).toBe(before);
    expect(await userExists(B)).toBe(true);
    await admin.query(`delete from rate_limits where bucket_key like 'yourtal-events:%'`);
  });

  it('turns away a caller after 30 bad tokens in a minute', async () => {
    for (let i = 0; i < 30; i += 1) expect((await post('junk')).statusCode).toBe(400);
    expect((await post('junk')).statusCode).toBe(429);
    await admin.query(`delete from rate_limits where bucket_key like 'yourtal-events:%'`);
  });

  it('account-deleted: 401 at once for every session, then the job erases the person, their workspace and its files', async () => {
    const tokA = await issueYourTalSession(A);
    const tokB = await issueYourTalSession(B);
    expect(await sessionStatus(tokA)).toBe(200);
    for (const w of [W_ALONE, W_SHARED]) {
      mkdirSync(join(storage, w, 'originals'), { recursive: true });
      writeFileSync(join(storage, w, 'originals', 'receipt.jpg'), 'x');
    }

    const c = claims(SUB.A, EV.deleted);
    expect((await post(await yt.signSet(c))).statusCode).toBe(202);
    expect(await sessionStatus(tokA)).toBe(401);
    expect(await sessionStatus(tokB)).toBe(200);
    expect(await userExists(A)).toBe(true); // the erasure is the worker's

    await drain();

    expect((await job(c.jti))?.completed_at).not.toBeNull();
    expect(await userExists(A)).toBe(false);
    expect(await isErased(SUB.A)).toBe(true);
    expect((await admin.query('select 1 from tenants where id = $1', [W_ALONE])).rowCount).toBe(0);
    expect(existsSync(join(storage, W_ALONE))).toBe(false);
    // B's workspace, its files and its people stay; A's membership there went with A.
    expect(existsSync(join(storage, W_SHARED, 'originals', 'receipt.jpg'))).toBe(true);
    expect((await admin.query('select user_id from memberships where tenant_id = $1 order by user_id', [W_SHARED])).rows).toEqual([
      { user_id: B },
      { user_id: C },
      { user_id: D },
    ]);
    expect(await userExists(M)).toBe(true);
    // The bookkeeper left behind is told, once.
    expect(mail.filter((m) => m.to === `m-${run}@s2.test`)).toEqual([
      expect.objectContaining({ subject: 'A SnapApp workspace you belonged to has been deleted' }),
    ]);
    // ...and once sent, the job no longer holds the address.
    expect((await admin.query(`select count(*)::int as n from jobs where payload::text like $1`, [`%m-${run}@%`])).rows[0].n).toBe(0);

    // A replay after the erasure: 202, nothing new, nothing sent.
    expect((await post(await yt.signSet(c))).statusCode).toBe(202);
    await drain();
    expect(mail.filter((m) => m.to === `m-${run}@s2.test`)).toHaveLength(1);
  });

  it('access-ended ends only the sessions opened before the event, and keeps the account', async () => {
    const older = await issueYourTalSession(C);
    await admin.query(
      `update user_sessions set created_at = now() - interval '1 hour'
        where user_id = $1 and revoked_at is null`,
      [C],
    );
    const newer = await issueYourTalSession(C);
    const c = claims(SUB.C, EV.ended, { reason: 'user_removed', erase_data: false }, { iat: Math.floor(Date.now() / 1000) - 1800 });

    expect((await post(await yt.signSet(c))).statusCode).toBe(202);
    expect(await sessionStatus(older)).toBe(401);
    expect(await sessionStatus(newer)).toBe(200);

    await drain();
    expect((await job(c.jti))?.completed_at).not.toBeNull();
    expect(await userExists(C)).toBe(true);
    expect(await isErased(SUB.C)).toBe(false);
  });

  it('access-ended with erase_data completes for someone with no teen space, and keeps the account', async () => {
    const c = claims(SUB.C, EV.ended, { reason: 'teen_removed', erase_data: true });
    expect((await post(await yt.signSet(c))).statusCode).toBe(202);
    await drain();
    expect((await job(c.jti))?.completed_at).not.toBeNull();
    expect(await userExists(C)).toBe(true);
  });

  it('records an unknown sub as erased, and touches no one', async () => {
    const c = claims(SUB.unknown, EV.deleted);
    expect((await post(await yt.signSet(c))).statusCode).toBe(202);
    await drain();
    expect((await job(c.jti))?.completed_at).not.toBeNull();
    expect(await isErased(SUB.unknown)).toBe(true);
    expect(await userExists(B)).toBe(true);
  });

  it('a forged payload cannot make the worker erase someone else', async () => {
    const insert = async (id: string, payload: object) =>
      admin.query(`insert into jobs (id, tenant_id, kind, payload, max_attempts) values ($1, null, 'yourtal_event', $2, 10)`, [
        id,
        JSON.stringify(payload),
      ]);

    // A SET for B signed with another key, with B's user id beside it.
    const forged = claims(SUB.B, EV.deleted);
    await insert(forged.jti as string, { set: await yt.signSet(forged, { impostor: true }), userId: B, user_id: B });
    // A genuine SET for nobody, with B's id beside it.
    const nobody = claims(`${SUB.unknown}-2`, EV.deleted);
    await insert(nobody.jti as string, { set: await yt.signSet(nobody), userId: B, user_id: B });
    // A genuine SET stored under another job's id.
    const moved = randomUUID();
    await insert(moved, { set: await yt.signSet(claims(SUB.B, EV.deleted)), run });

    await drain();

    expect(await job(forged.jti)).toMatchObject({ completed_at: null, last_error: expect.stringContaining('authentication_failed') });
    expect((await job(nobody.jti))?.completed_at).not.toBeNull();
    expect(await job(moved)).toMatchObject({ completed_at: null, last_error: expect.stringContaining('another job') });
    expect(await userExists(B)).toBe(true);
    expect(await isErased(SUB.B)).toBe(false);
    await admin.query('delete from jobs where id = any($1)', [[forged.jti, nobody.jti, moved]]);
    await admin.query('delete from yourtal_erased_subjects where sub = $1', [`${SUB.unknown}-2`]);
  });

  it('a notice is not sent to an address no account has any more', async () => {
    const id = randomUUID();
    await admin.query(`insert into jobs (id, tenant_id, kind, payload) values ($1, null, 'erasure_notice', $2)`, [
      id,
      JSON.stringify({ to: `gone-${run}@s2.test`, outcome: 'erased' }),
    ]);
    await drain();
    expect(await job(id)).toMatchObject({ completed_at: expect.any(Date), payload: {} });
    expect(mail.some((m) => m.to === `gone-${run}@s2.test`)).toBe(false);
  });

  it('refuses, unread, any of its job kinds written with a tenant id', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const sentBefore = mail.length;
    await admin.query(
      `insert into jobs (id, tenant_id, kind, payload) values
         ($1, $4, 'erasure_notice', $5), ($2, $4, 'storage_purge', $6), ($3, $4, 'yourtal_event', $7)`,
      [
        ...ids,
        W_SHARED,
        JSON.stringify({ to: `b-${run}@s2.test`, outcome: 'handed_over' }),
        JSON.stringify({ tenantId: randomUUID() }),
        JSON.stringify({ set: await yt.signSet(claims(`${SUB.unknown}-t`, EV.deleted)) }),
      ],
    );
    await drain();
    for (const id of ids) {
      expect(await job(id)).toMatchObject({ completed_at: null, last_error: expect.stringContaining('must have no tenant') });
    }
    expect(mail.length).toBe(sentBefore);
    expect(await isErased(`${SUB.unknown}-t`)).toBe(false);
    await admin.query('delete from jobs where id = any($1)', [ids]);
  });

  it('leaves event jobs unclaimed while the worker is not configured, then runs them', async () => {
    const c = claims(`${SUB.unknown}-u`, EV.deleted);
    await admin.query(`insert into jobs (id, tenant_id, kind, payload, max_attempts) values ($1, null, 'yourtal_event', $2, 10)`, [
      c.jti,
      JSON.stringify({ set: await yt.signSet(c) }),
    ]);
    delete process.env.YOURTAL_OIDC_SERVER_CLIENT_ID;
    try {
      await runErasureJobsOnce(workerDb, quiet);
      expect(await job(c.jti)).toMatchObject({ completed_at: null, attempts: 0, locked_at: null });
    } finally {
      process.env.YOURTAL_OIDC_SERVER_CLIENT_ID = yt.serverClientId;
    }
    await drain();
    expect((await job(c.jti))?.completed_at).not.toBeNull();
    expect(await isErased(`${SUB.unknown}-u`)).toBe(true);
    await admin.query('delete from yourtal_erased_subjects where sub = $1', [`${SUB.unknown}-u`]);
  });

  it("spends no attempt while YourTal's keys cannot be fetched", async () => {
    const c = claims(`${SUB.unknown}-k`, EV.deleted);
    await admin.query(`insert into jobs (id, tenant_id, kind, payload, max_attempts) values ($1, null, 'yourtal_event', $2, 10)`, [
      c.jti,
      JSON.stringify({ set: await yt.signSet(c) }),
    ]);
    resetYourtalEventKeys();
    const down = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    try {
      await runErasureJobsOnce(workerDb, quiet);
    } finally {
      down.mockRestore();
      resetYourtalEventKeys();
    }
    const after = (await admin.query(`select attempts, completed_at, locked_at, run_after > now() as later from jobs where id = $1`, [c.jti])).rows[0];
    expect(after).toEqual({ attempts: 0, completed_at: null, locked_at: null, later: true });
    expect(await isErased(`${SUB.unknown}-k`)).toBe(false);
    await admin.query('delete from jobs where id = $1', [c.jti]);
  });

  it('a job whose SET is over 30 days old still verifies and erases', async () => {
    const c = claims(SUB.D, EV.deleted, {}, { iat: Math.floor(Date.now() / 1000) - 40 * 86_400 });
    const token = await yt.signSet(c);
    expect((await post(token)).json()).toEqual({ err: 'invalid_request' }); // the endpoint keeps its bound
    await admin.query(`insert into jobs (id, tenant_id, kind, payload, max_attempts) values ($1, null, 'yourtal_event', $2, 10)`, [
      c.jti,
      JSON.stringify({ set: token }),
    ]);
    await drain();
    expect((await job(c.jti))?.completed_at).not.toBeNull();
    expect(await userExists(D)).toBe(false);
    expect(await isErased(SUB.D)).toBe(true);
    expect(await userExists(B)).toBe(true);
    await admin.query(`delete from rate_limits where bucket_key like 'yourtal-events:%'`);
  });

  it('storage_purge refuses a workspace that still exists, and anything but a uuid', async () => {
    const live = randomUUID();
    const odd = randomUUID();
    await admin.query(
      `insert into jobs (id, tenant_id, kind, payload) values ($1, null, 'storage_purge', $2), ($3, null, 'storage_purge', $4)`,
      [live, JSON.stringify({ tenantId: W_SHARED }), odd, JSON.stringify({ tenantId: '../etc' })],
    );
    await drain();
    expect(await job(live)).toMatchObject({ completed_at: null, last_error: expect.stringContaining('still exists') });
    expect(await job(odd)).toMatchObject({ completed_at: null, last_error: expect.stringContaining('not a uuid') });
    expect(existsSync(join(storage, W_SHARED, 'originals', 'receipt.jpg'))).toBe(true);
    await admin.query('delete from jobs where id = any($1)', [[live, odd]]);
  });

  it('the API role may queue only a NULL-tenant yourtal_event job (0044)', async () => {
    const { getDb } = await import('../db.js');
    await expect(
      getDb().execute(sql`insert into jobs (id, tenant_id, kind) values (${randomUUID()}, null, 'storage_purge')`),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('answers 503 while the client id is not configured', async () => {
    delete process.env.YOURTAL_OIDC_SERVER_CLIENT_ID;
    try {
      const res = await post(await yt.signSet(claims(SUB.B, EV.deleted)));
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'not_configured' });
    } finally {
      process.env.YOURTAL_OIDC_SERVER_CLIENT_ID = yt.serverClientId;
    }
  });
});
