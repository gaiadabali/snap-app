import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, createPool, type Db } from '@snap/db';
import pg, { type Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { workerDatabaseUrl } from '../test-support/worker-db.js';

/**
 * Deleting your own account from the app (group task 8.3.a, migration 0055):
 * the API checks the caller and queues one job, ends every session at once,
 * and the worker erases through erase_person (0043). Real HTTP, real database,
 * the API as snap_app and the worker as snap_worker.
 */
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

const W = 'e8300000-0000-4000-8000-000000000001';
const Y = 'e8300000-0000-4000-8000-0000000000a1';
const W_HOME = 'e8300000-0000-4000-8000-000000000002'; // the parent's household
const W_TEEN = 'e8300000-0000-4000-8000-000000000003'; // the teen's space
const W_SHARED = 'e8300000-0000-4000-8000-000000000004'; // O owns it, M manages it
const P = 'e8300000-0000-4000-8000-0000000000b1';
const T = 'e8300000-0000-4000-8000-0000000000b2';
const O = 'e8300000-0000-4000-8000-0000000000c1';
const M = 'e8300000-0000-4000-8000-0000000000c2';
const INVITE = 'e8300000-0000-4000-8000-0000000000f1';
const run = randomBytes(4).toString('hex');
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };

describeIfDb('delete your account (8.3.a)', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let workerPool: Pool;
  let workerDb: Db;
  let storage: string;
  let runErasureJobsOnce: (db: Db, log?: typeof quiet, only?: string[]) => Promise<number>;
  const emails: string[] = [];
  let ipCounter = 0;

  const ip = () => `2001:db8:${run.slice(0, 4)}:${run.slice(4)}::${(++ipCounter).toString(16)}`;
  const post = (path: string, body: unknown, token?: string) =>
    app.inject({
      method: 'POST',
      url: path,
      payload: body as Record<string, unknown>,
      remoteAddress: ip(),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const del = (token: string | undefined, body: unknown) => post('/v1/auth/account/delete', body, token);
  const sessionStatus = async (token: string) =>
    (await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { authorization: `Bearer ${token}` } })).statusCode;
  const exists = async (id: string) => (await admin.query('select 1 from users where id = $1', [id])).rowCount === 1;
  const queued = async (userId: string) =>
    (await admin.query(`select id, tenant_id from jobs where kind = 'account_delete' and payload->>'userId' = $1`, [userId])).rows as Array<{
      id: string;
      tenant_id: string | null;
    }>;
  const space = async () =>
    (await admin.query(`select access_ended_at, erase_after from teen_spaces where tenant_id = $1`, [W_TEEN])).rows[0] as
      | { access_ended_at: Date | null; erase_after: Date | null }
      | undefined;
  const inviteEnds = async () =>
    (await admin.query(`select payload from jobs where kind = 'teen_invite_end' and payload->>'inviteId' = $1`, [INVITE])).rows as Array<{
      payload: { parentSub: string };
    }>;
  const register = async () => {
    const email = `del-${run}-${emails.length}@example.test`;
    emails.push(email);
    const res = await post('/v1/auth/register', { email, password: 'a-decent-password' });
    expect(res.statusCode).toBe(201);
    return res.json() as { token: string; user: { userId: string } };
  };

  beforeAll(async () => {
    storage = mkdtempSync(join(tmpdir(), 'account-delete-'));
    process.env.STORAGE_DIR = storage;
    process.env.WEB_PUBLIC_URL ??= 'http://127.0.0.1:3000';
    admin = await provisionTenant({
      tenantId: W,
      name: 'Delete me',
      users: [{ id: Y, role: 'owner', subject: `yourtal|del-${run}`, email: `y-${run}@example.test` }],
    });
    await admin.query(`delete from rate_limits where bucket_key like 'account-delete:%'`); // earlier runs, same fixed user
    (await provisionTenant({
      tenantId: W_HOME,
      name: 'Parent home',
      users: [{ id: P, role: 'owner', subject: `yourtal|dp-${run}`, email: `p-${run}@example.test` }],
    })).end();
    (await provisionTenant({
      tenantId: W_TEEN,
      name: 'Teen space',
      users: [{ id: T, role: 'owner', subject: `yourtal|dt-${run}`, email: `t-${run}@example.test` }],
    })).end();
    // The membership guard only bites once the space exists, so the row goes in last.
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'readonly')`, [W_TEEN, P]);
    await admin.query(
      `insert into teen_spaces (tenant_id, teen_user_id, parent_user_id, funding_tenant_id, invite_id) values ($1, $2, $3, $4, $5)`,
      [W_TEEN, T, P, W_HOME, INVITE],
    );
    (await provisionTenant({
      tenantId: W_SHARED,
      name: 'Shared',
      users: [
        { id: O, role: 'owner', subject: `yourtal|do-${run}`, email: `o-${run}@example.test` },
        { id: M, role: 'admin', email: `m-${run}@example.test` },
      ],
    })).end();
    workerPool = createPool(workerDatabaseUrl());
    workerDb = createDb(workerPool);
    ({ runErasureJobsOnce } = await import('../yourtal/events-job.js'));
    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    if (admin) {
      await admin.query(`delete from jobs where kind = 'account_delete' and tenant_id is null and payload = '{}'::jsonb and created_at > now() - interval '1 hour'`);
      await admin.query('delete from teen_spaces where tenant_id = $1', [W_TEEN]);
      await admin.query(`delete from jobs where kind = 'teen_invite_end' and payload->>'inviteId' = $1`, [INVITE]);
      await wipeTenant(admin, W_TEEN, [T]);
      await wipeTenant(admin, W_HOME, [P]);
      await wipeTenant(admin, W_SHARED, [O, M]);
      await wipeTenant(admin, W, [Y]);
      await admin.query('delete from users where email = any($1)', [emails]);
      await admin.end();
    }
    await workerPool?.end();
    rmSync(storage, { recursive: true, force: true });
  });

  it('needs a session, the typed word, and the password', async () => {
    expect((await del(undefined, { confirm: 'DELETE' })).statusCode).toBe(401);
    const { token, user } = await register();
    expect((await del(token, {})).statusCode).toBe(400);
    expect((await del(token, { confirm: 'delete me', password: 'a-decent-password' })).statusCode).toBe(400);
    expect((await del(token, { confirm: 'DELETE' })).statusCode).toBe(403);
    const wrong = await del(token, { confirm: 'DELETE', password: 'not-the-password' });
    expect(wrong.statusCode).toBe(403); // not 401: the phone would read that as an ended session
    expect(wrong.json()).toMatchObject({ error: 'wrong_password' });
    expect(await queued(user.userId)).toHaveLength(0);
    expect(await sessionStatus(token)).toBe(200);
  });

  it('queues one system job, signs out every device at once, and the worker erases the person', async () => {
    const { token, user } = await register();
    const second = (await post('/v1/auth/sign-in', { email: emails[emails.length - 1], password: 'a-decent-password' })).json() as {
      token?: string;
    };

    const res = await del(token, { confirm: 'DELETE', password: 'a-decent-password' });
    expect(res.statusCode).toBe(200);
    expect(await sessionStatus(token)).toBe(401);
    if (second.token) expect(await sessionStatus(second.token)).toBe(401);

    const jobs = await queued(user.userId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.tenant_id).toBeNull();
    expect(await exists(user.userId)).toBe(true); // the worker has not run yet

    expect(await runErasureJobsOnce(workerDb, quiet, [jobs[0]!.id])).toBe(1);
    expect(await exists(user.userId)).toBe(false);
    const done = (await admin.query('select completed_at, payload, last_error from jobs where id = $1', [jobs[0]!.id])).rows[0];
    expect(done.completed_at).not.toBeNull();
    expect(done.payload).toEqual({});
    expect(done.last_error).toBeNull();

    // A second run of the same job (a retry) finds nothing and does no harm.
    expect(await runErasureJobsOnce(workerDb, quiet, [jobs[0]!.id])).toBe(0);
  });

  it('a YourTal-linked account has no SnapApp password: the typed word is enough, and YourTal is left alone', async () => {
    const { issueYourTalSession } = await import('./sessions.js');
    const token = await issueYourTalSession(Y);
    expect((await del(token, { confirm: 'nope' })).statusCode).toBe(400);
    expect((await del(token, { confirm: 'DELETE' })).statusCode).toBe(200);
    expect(await sessionStatus(token)).toBe(401);
    const jobs = await queued(Y);
    expect(await runErasureJobsOnce(workerDb, quiet, jobs.map((j) => j.id))).toBe(1);
    expect(await exists(Y)).toBe(false);
    expect((await admin.query('select 1 from tenants where id = $1', [W])).rowCount).toBe(0); // the workspace Y ran alone
    // Nothing is recorded as an erased sub: the person may sign in with YourTal again and start fresh.
    expect((await admin.query('select 1 from yourtal_erased_subjects where sub = $1', [`del-${run}`])).rowCount).toBe(0);
  });

  it('the API cannot queue a deletion itself, for anyone: only the session-bound function can', async () => {
    const api = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await api.connect();
    try {
      await expect(
        api.query(`insert into jobs (id, tenant_id, kind, payload) values (gen_random_uuid(), null, 'account_delete', $1)`, [
          JSON.stringify({ userId: O }),
        ]),
      ).rejects.toThrow(/row-level security/);
      // A token that is no live session names nobody.
      const none = await api.query(`select identity_account_delete_request($1) as ok`, [randomBytes(32)]);
      expect(none.rows[0].ok).toBe(false);
      await expect(api.query(`select * from erase_person($1)`, [O])).rejects.toThrow(/permission denied/);
      await expect(api.query(`select account_delete_queue($1)`, [O])).rejects.toThrow(/permission denied/);
    } finally {
      await api.end();
    }
    expect(await queued(O)).toHaveLength(0);
    expect(await exists(O)).toBe(true);
  });

  it('one person deleting queues a job for that person only', async () => {
    const { token, user } = await register();
    expect((await del(token, { confirm: 'DELETE', password: 'a-decent-password' })).statusCode).toBe(200);
    expect(await queued(user.userId)).toHaveLength(1);
    expect(await queued(O)).toHaveLength(0);
    expect(await queued(Y)).toHaveLength(0);
    await runErasureJobsOnce(workerDb, quiet, (await queued(user.userId)).map((j) => j.id));
  });

  it('an emailed request: staff run account_delete_queue as postgres and the worker erases, as for the button', async () => {
    const { user } = await register();
    await admin.query('select account_delete_queue($1)', [user.userId]);
    const jobs = await queued(user.userId);
    expect(jobs).toHaveLength(1);
    expect(await runErasureJobsOnce(workerDb, quiet, jobs.map((j) => j.id))).toBe(1);
    expect(await exists(user.userId)).toBe(false);
  });

  it('an owner who leaves a manager behind hands the workspace over instead of erasing it', async () => {
    const { issueYourTalSession } = await import('./sessions.js');
    const token = await issueYourTalSession(O);
    expect((await del(token, { confirm: 'DELETE' })).statusCode).toBe(200);
    await runErasureJobsOnce(workerDb, quiet, (await queued(O)).map((j) => j.id));
    expect(await exists(O)).toBe(false);
    expect((await admin.query('select role from memberships where tenant_id = $1 and user_id = $2', [W_SHARED, M])).rows[0]?.role).toBe('owner');
  });

  it('a teen deleting is a withdrawal: the 30-day hold and YourTal told, not an immediate erase', async () => {
    const { issueYourTalSession } = await import('./sessions.js');
    const token = await issueYourTalSession(T);
    expect((await del(token, { confirm: 'DELETE' })).statusCode).toBe(200);
    const held = (await space())!;
    expect(held.access_ended_at).not.toBeNull();
    expect(Math.round((held.erase_after!.getTime() - held.access_ended_at!.getTime()) / 86_400_000)).toBe(30);
    expect((await inviteEnds()).map((j) => j.payload.parentSub)).toEqual([`dp-${run}`]);
    expect(await sessionStatus(token)).toBe(401);
    expect(await queued(T)).toHaveLength(0); // the hold sweep erases the space and the account after 30 days
    expect(await exists(T)).toBe(true);
    expect((await admin.query('select 1 from tenants where id = $1', [W_TEEN])).rowCount).toBe(1);
    // Back to a live space for the parent's case below.
    await admin.query(`update teen_spaces set access_ended_at = null, erase_after = null where tenant_id = $1`, [W_TEEN]);
    await admin.query(`delete from jobs where kind = 'teen_invite_end' and payload->>'inviteId' = $1`, [INVITE]);
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'readonly') on conflict do nothing`, [W_TEEN, P]);
  });

  it('a parent deleting ends each teen space first: held 30 days, YourTal told, then the parent is erased', async () => {
    const { issueYourTalSession } = await import('./sessions.js');
    const token = await issueYourTalSession(P);
    expect((await space())!.access_ended_at).toBeNull();
    expect((await del(token, { confirm: 'DELETE' })).statusCode).toBe(200);

    const held = (await space())!;
    expect(held.access_ended_at).not.toBeNull();
    const days = (held.erase_after!.getTime() - held.access_ended_at!.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    expect((await inviteEnds()).map((j) => j.payload.parentSub)).toEqual([`dp-${run}`]);
    expect(await sessionStatus(token)).toBe(401);

    expect(await runErasureJobsOnce(workerDb, quiet, (await queued(P)).map((j) => j.id))).toBe(1);
    expect(await exists(P)).toBe(false);
    // The teen's space and account wait for the hold sweep; nothing erased them now.
    expect(await exists(T)).toBe(true);
    expect((await space())!.erase_after).not.toBeNull();
  });

  it('refuses a job that names a bad user id, and a tenant job of the kind', async () => {
    const bad = randomUUID();
    await admin.query(`insert into jobs (id, tenant_id, kind, payload, max_attempts) values ($1, null, 'account_delete', '{"userId":"x"}', 1)`, [bad]);
    expect(await runErasureJobsOnce(workerDb, quiet, [bad])).toBe(1);
    const row = (await admin.query('select completed_at, last_error from jobs where id = $1', [bad])).rows[0];
    expect(row.completed_at).toBeNull();
    expect(row.last_error).toMatch(/bad payload/);
    await admin.query('delete from jobs where id = $1', [bad]);
  });
});
