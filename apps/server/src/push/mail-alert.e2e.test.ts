import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, createPool, type Db } from '@snap/db';
import type { JWTPayload } from 'jose';
import type { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startFakeYourTalOidc, type FakeYourTalOidc } from '../test-support/fake-yourtal-oidc.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { workerDatabaseUrl } from '../test-support/worker-db.js';
import { simulatedFcm } from './fcm.js';

/**
 * The phone's new-mail alert, end to end (Spambank BUILD.md §4.9, F6; ticket
 * T11): a `spambank-mail` Security Event Token signed by the stand-in YourTal,
 * posted to `/v1/yourtal/events` through the real AppModule, then run by the
 * worker's job loop on the worker's own connection (snap_worker) into the
 * simulated FCM sender, as production runs it with the real one.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const run = randomUUID().slice(0, 8);
const W = 'c6110000-0000-4000-8000-000000000001';
const ANA = 'c6110000-0000-4000-8000-0000000000a1';
const BEN = 'c6110000-0000-4000-8000-0000000000a2';
const SUB = { ana: `alert-ana-${run}`, ben: `alert-ben-${run}`, nobody: `alert-nobody-${run}` };
const MAIL = 'urn:yourtal:event:spambank-mail';

const PHONE = (n: string) => `fcm-alert-${n}-0123456789abcdefghijklmn`;
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };

describeIfDb('spambank-mail alerts (T11)', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let yt: FakeYourTalOidc;
  let workerPool: Pool;
  let workerDb: Db;
  let runErasureJobsOnce: (db: Db, log?: Pick<Console, 'log' | 'warn' | 'error'>, only?: string[]) => Promise<number>;
  let resetYourtalEventKeys: () => void;
  const fcm = simulatedFcm();

  const claims = (sub: string, body: object, over: JWTPayload = {}): JWTPayload => ({
    iss: yt.issuer,
    aud: yt.serverClientId,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
    sub_id: { format: 'iss_sub', iss: yt.issuer, sub },
    events: { [MAIL]: body },
    ...over,
  });

  /** Posts the SET, drains the worker for exactly that job, and returns the job row. */
  async function deliver(sub: string, body: object, over: JWTPayload = {}) {
    const c = claims(sub, body, over);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/yourtal/events',
      headers: { 'content-type': 'application/secevent+jwt' },
      payload: await yt.signSet(c),
    });
    expect(res.statusCode).toBe(202);
    await runErasureJobsOnce(workerDb, quiet, [c.jti!]);
    return (await admin.query<{ completed_at: Date | null; last_error: string | null; attempts: number }>(
      'select completed_at, last_error, attempts from jobs where id = $1',
      [c.jti],
    )).rows[0]!;
  }

  const addPhone = (userId: string, token: string) =>
    admin.query(`insert into push_tokens (user_id, platform, token) values ($1, 'android', $2)`, [userId, token]);
  const phonesOf = async (userId: string) =>
    (await admin.query<{ token: string }>('select token from push_tokens where user_id = $1 order by token', [userId])).rows.map((r) => r.token);

  beforeAll(async () => {
    yt = await startFakeYourTalOidc();
    process.env.YOURTAL_OIDC_ISSUER = yt.issuer;
    process.env.YOURTAL_OIDC_SERVER_CLIENT_ID = yt.serverClientId;
    process.env.FCM_SIMULATOR = 'true';

    admin = await provisionTenant({
      tenantId: W,
      name: 'Alerts',
      users: [
        { id: ANA, role: 'owner', subject: `yourtal|${SUB.ana}`, email: `ana-${run}@alerts.test` },
        { id: BEN, role: 'member', subject: `yourtal|${SUB.ben}`, email: `ben-${run}@alerts.test` },
      ],
    });
    workerPool = createPool(workerDatabaseUrl());
    workerDb = createDb(workerPool);
    ({ runErasureJobsOnce } = await import('../yourtal/events-job.js'));
    ({ resetYourtalEventKeys } = await import('../yourtal/events-verify.js'));
    resetYourtalEventKeys();

    const { AppModule } = await import('../app.module.js');
    const { registerSecEventParser } = await import('../yourtal/events.controller.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    registerSecEventParser(app.getHttpAdapter().getInstance());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    if (admin) {
      await admin.query(`delete from jobs where kind = 'yourtal_event' and tenant_id is null and payload::text like $1`, [`%${run}%`]);
      await admin.query('delete from push_tokens where user_id = any($1)', [[ANA, BEN]]);
      await admin.query('delete from mail_settings where user_id = any($1)', [[ANA, BEN]]);
      await admin.query(`delete from rate_limits where bucket_key like 'yourtal-events:%'`);
      await wipeTenant(admin, W, [ANA, BEN]);
      await admin.end();
    }
    const { closeDb } = await import('../db.js');
    await closeDb();
    await workerPool?.end();
    await yt?.close();
    delete process.env.FCM_SIMULATOR;
  });

  beforeEach(async () => {
    fcm.sent.length = 0;
    fcm.failNext(0);
    await admin.query('delete from push_tokens where user_id = any($1)', [[ANA, BEN]]);
    await admin.query('delete from mail_settings where user_id = any($1)', [[ANA, BEN]]);
  });

  it('sends "You have 3 new emails" to each of the person\'s phones, and to nobody else\'s', async () => {
    await addPhone(ANA, PHONE('a1'));
    await addPhone(ANA, PHONE('a2'));
    await addPhone(BEN, PHONE('b1'));

    const job = await deliver(SUB.ana, { unread_inbox: 3 });

    expect(job.completed_at).not.toBeNull();
    expect(fcm.sent.map((m) => m.token).sort()).toEqual([PHONE('a1'), PHONE('a2')]);
    for (const message of fcm.sent) {
      expect(message).toMatchObject({
        title: 'Spambank',
        body: 'You have 3 new emails',
        data: { type: 'spambank-mail' },
        channelId: 'mail',
      });
    }
  });

  it('says "1 new email" for one, and puts no sender or subject on a lock screen', async () => {
    await addPhone(ANA, PHONE('a1'));
    await deliver(SUB.ana, { unread_inbox: 1, from: 'boss@example.com', subject: 'Salary' });
    expect(fcm.sent).toHaveLength(1);
    expect(fcm.sent[0]?.body).toBe('You have 1 new email');
    expect(JSON.stringify(fcm.sent[0])).not.toMatch(/boss@|Salary/);
  });

  it('deletes a token FCM says is dead, and keeps the others', async () => {
    await addPhone(ANA, PHONE('dead'));
    await addPhone(ANA, PHONE('live'));
    fcm.killToken(PHONE('dead'));

    const job = await deliver(SUB.ana, { unread_inbox: 2 });

    expect(job.completed_at).not.toBeNull();
    expect(fcm.sent).toHaveLength(2);
    expect(await phonesOf(ANA)).toEqual([PHONE('live')]);
  });

  it('sends nothing when the person turned alerts off, but does with no settings row (the default is on)', async () => {
    await addPhone(ANA, PHONE('a1'));
    await admin.query('insert into mail_settings (user_id, alerts) values ($1, false)', [ANA]);
    expect((await deliver(SUB.ana, { unread_inbox: 4 })).completed_at).not.toBeNull();
    expect(fcm.sent).toHaveLength(0);

    await admin.query('delete from mail_settings where user_id = $1', [ANA]);
    await deliver(SUB.ana, { unread_inbox: 4 });
    expect(fcm.sent).toHaveLength(1);
  });

  it('drops an alert for a person with no phone, with no SnapApp account, or whose count is not a count', async () => {
    expect((await deliver(SUB.ben, { unread_inbox: 2 })).completed_at).not.toBeNull(); // no phones
    expect((await deliver(SUB.nobody, { unread_inbox: 2 })).completed_at).not.toBeNull(); // no account

    await addPhone(ANA, PHONE('a1'));
    for (const body of [{ unread_inbox: 0 }, { unread_inbox: -1 }, { unread_inbox: 1.5 }, { unread_inbox: '3' }, { unread_inbox: 10_000 }, {}]) {
      expect({ body, done: (await deliver(SUB.ana, body)).completed_at !== null }).toEqual({ body, done: true });
    }
    expect(fcm.sent).toHaveLength(0);
  });

  it('drops an alert older than 15 minutes: "3 new emails" an hour late is worse than none', async () => {
    await addPhone(ANA, PHONE('a1'));
    const job = await deliver(SUB.ana, { unread_inbox: 3 }, { iat: Math.floor(Date.now() / 1000) - 16 * 60 });
    expect(job.completed_at).not.toBeNull();
    expect(fcm.sent).toHaveLength(0);
  });

  it('retries when FCM is down and nothing was delivered, then delivers once', async () => {
    await addPhone(ANA, PHONE('a1'));
    fcm.failNext(1);

    const first = await deliver(SUB.ana, { unread_inbox: 5 });
    expect(first.completed_at).toBeNull();
    expect(first.last_error).toMatch(/will retry/);
    expect(fcm.sent).toHaveLength(1);
    // The phone was not told; the job waits, and runs again when due.
    await admin.query(`update jobs set run_after = now(), locked_at = null where id in (
      select id from jobs where kind = 'yourtal_event' and completed_at is null and last_error like '%will retry%')`);
    await runErasureJobsOnce(workerDb, quiet);
    expect(fcm.sent).toHaveLength(2);
    expect((await admin.query(`select count(*)::int as n from jobs where kind = 'yourtal_event' and completed_at is null and last_error like '%will retry%'`)).rows[0].n).toBe(0);
  });

  it('does not retry once any phone has it: a retry would notify that phone twice', async () => {
    await addPhone(ANA, PHONE('a1'));
    await addPhone(ANA, PHONE('a2'));
    // Phones are tried newest first; the first send fails, the second is delivered.
    fcm.failNext(1);
    const job = await deliver(SUB.ana, { unread_inbox: 2 });
    expect(job.completed_at).not.toBeNull();
    expect(fcm.sent).toHaveLength(2);
  });

  it('is acknowledged and dropped while FCM is not configured', async () => {
    delete process.env.FCM_SIMULATOR;
    try {
      await addPhone(ANA, PHONE('a1'));
      const job = await deliver(SUB.ana, { unread_inbox: 3 });
      expect(job.completed_at).not.toBeNull();
      expect(fcm.sent).toHaveLength(0);
      expect(await phonesOf(ANA)).toEqual([PHONE('a1')]);
    } finally {
      process.env.FCM_SIMULATOR = 'true';
    }
  });

  it('removes a person\'s phones and settings when their account is erased', async () => {
    await addPhone(BEN, PHONE('b1'));
    await admin.query('insert into mail_settings (user_id, alerts) values ($1, true)', [BEN]);
    await admin.query('select erase_person($1::uuid)', [BEN]);
    expect((await admin.query('select 1 from push_tokens where user_id = $1', [BEN])).rowCount).toBe(0);
    expect((await admin.query('select 1 from mail_settings where user_id = $1', [BEN])).rowCount).toBe(0);
  });
});
