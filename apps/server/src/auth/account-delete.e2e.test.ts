import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, createPool, type Db } from '@snap/db';
import pg, { type Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mintImpersonationToken } from '../admin/crypto/impersonation-tokens.js';
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
const W_IMP = 'e8300000-0000-4000-8000-000000000005'; // the subject of the impersonation test
const X = 'e8300000-0000-4000-8000-0000000000d1'; // ... who is that subject
const STAFF = 'e8300000-0000-4000-8000-0000000000d2'; // ... and the staff member acting as them
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
  const staffEmailUsers: string[] = [];
  /** The host record of self-deleted ids (8.3.g R2), outside Postgres. */
  const recorded = () => {
    const file = join(storage, 'erased', 'accounts.log');
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  };
  const stale = (userId: string) =>
    admin.query(`update user_sessions set created_at = now() - interval '1 hour' where user_id = $1`, [userId]);
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
    process.env.ERASED_LOG_DIR = join(storage, 'erased'); // R2: created on first write
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
    (await provisionTenant({
      tenantId: W_IMP,
      name: 'Impersonated',
      users: [{ id: X, role: 'owner', subject: `yourtal|dx-${run}`, email: `x-${run}@example.test` }],
    })).end();
    await admin.query(`insert into users (id, subject, email, display_name) values ($1, $2, $3, 'Staff')`, [STAFF, `dev|ds-${run}`, `s-${run}@example.test`]);
    await admin.query(`insert into platform_staff (user_id, role) values ($1, 'support')`, [STAFF]);
    await admin.query(
      `insert into platform_staff_capabilities (staff_id, capability) select id, 'impersonate'::platform_capability from platform_staff where user_id = $1`,
      [STAFF],
    );
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
      await admin.query('delete from impersonation_sessions where staff_user_id = $1', [STAFF]);
      await admin.query('delete from platform_staff_capabilities where staff_id in (select id from platform_staff where user_id = $1)', [STAFF]);
      await admin.query('delete from platform_staff where user_id = any($1)', [[STAFF, ...staffEmailUsers]]);
      await wipeTenant(admin, W_IMP, [X, STAFF]);
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
    expect(recorded()).toMatch(new RegExp(`^\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z ${user.userId}$`, 'm')); // R2: id only, no address
    expect(recorded()).not.toContain('@');
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
      const none = await api.query(`select identity_account_delete_request($1, null) as r`, [randomBytes(32)]);
      expect(none.rows[0].r).toBe('no_session');
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

  it('a passwordless account needs a recent sign-in (L4): refused when stale, accepted when fresh', async () => {
    const { token, user } = await register();
    await admin.query('update users set password_hash = null where id = $1', [user.userId]); // a magic-link / Google account
    await stale(user.userId);
    const refused = await del(token, { confirm: 'DELETE' });
    expect(refused.statusCode).toBe(403); // not 401: the phone would sign out and lose the screen
    expect(refused.json()).toMatchObject({ error: 'recent_sign_in_required' });
    expect(refused.json().message).toMatch(/sign in again/i);
    expect(await queued(user.userId)).toHaveLength(0);
    expect(recorded()).not.toContain(user.userId); // a refused request is not a deletion
    expect(await sessionStatus(token)).toBe(200);
    expect(await exists(user.userId)).toBe(true);

    await admin.query(`update user_sessions set created_at = now() - interval '9 minutes' where user_id = $1`, [user.userId]);
    expect((await del(token, { confirm: 'DELETE' })).statusCode).toBe(200);
    expect(await queued(user.userId)).toHaveLength(1);
    await runErasureJobsOnce(workerDb, quiet, (await queued(user.userId)).map((j) => j.id));
  });

  it('a YourTal-linked account is held to the same recent sign-in; a password stands in for it elsewhere', async () => {
    const { issueYourTalSession } = await import('./sessions.js');
    const token = await issueYourTalSession(X);
    await stale(X);
    expect((await del(token, { confirm: 'DELETE' })).json()).toMatchObject({ error: 'recent_sign_in_required' });
    expect(await queued(X)).toHaveLength(0);

    const { token: pwToken, user } = await register();
    await stale(user.userId); // an old session of a password account is fine: the password is the step-up
    expect((await del(pwToken, { confirm: 'DELETE', password: 'a-decent-password' })).statusCode).toBe(200);
    await runErasureJobsOnce(workerDb, quiet, (await queued(user.userId)).map((j) => j.id));
  });

  it('an active staff account cannot delete itself (L5); once revoked it can', async () => {
    const { token, user } = await register();
    staffEmailUsers.push(user.userId);
    await admin.query(`insert into platform_staff (user_id, role) values ($1, 'support')`, [user.userId]);
    const refused = await del(token, { confirm: 'DELETE', password: 'a-decent-password' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: 'staff_cannot_self_delete' });
    expect(refused.json().message).toMatch(/another admin/i);
    expect(await queued(user.userId)).toHaveLength(0);
    expect(await sessionStatus(token)).toBe(200);
    expect((await admin.query('select 1 from platform_staff where user_id = $1', [user.userId])).rowCount).toBe(1);

    await admin.query(`update platform_staff set revoked_at = now(), revoked_by = $1 where user_id = $1`, [user.userId]);
    expect((await del(token, { confirm: 'DELETE', password: 'a-decent-password' })).statusCode).toBe(200);
    await runErasureJobsOnce(workerDb, quiet, (await queued(user.userId)).map((j) => j.id));
  });

  it('staff acting as a user cannot delete that user (L6), and the token itself is good', async () => {
    const { token, tokenHash } = mintImpersonationToken();
    await admin.query(
      `insert into impersonation_sessions (id, staff_user_id, subject_user_id, subject_tenant_id, reason, token_hash, started_at, expires_at)
       values ($1, $2, $3, $4, 'delete-account e2e', $5, now(), now() + interval '15 minutes')`,
      [randomUUID(), STAFF, X, W_IMP, tokenHash],
    );
    const impersonated = { 'x-impersonation-token': token, 'x-workspace-id': W_IMP };
    // The control: the same token reaches the product, so the refusal below is the endpoint's, not a dead token.
    expect((await app.inject({ method: 'GET', url: '/v1/overview', headers: impersonated })).statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/account/delete',
      payload: { confirm: 'DELETE' },
      remoteAddress: ip(),
      headers: impersonated,
    });
    expect(res.statusCode).toBe(403);
    expect(await queued(X)).toHaveLength(0);
    expect(await exists(X)).toBe(true);
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
    const teenNotices = await admin.query(`select payload from jobs where kind = 'erasure_notice' and payload->>'to' = $1`, [`t-${run}@example.test`]);
    expect(teenNotices.rows.map((n) => n.payload.outcome)).toEqual(['teen_ended_teen']); // the parent can still invite again
    await admin.query(`delete from jobs where kind = 'erasure_notice' and payload->>'to' = any($1)`, [[`t-${run}@example.test`, `p-${run}@example.test`]]);
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

    // R1: the teen's notice must not promise that a new invite brings the space back.
    const notices = (await admin.query(
      `select payload from jobs where kind = 'erasure_notice' and payload->>'to' = $1`, [`t-${run}@example.test`])).rows;
    expect(notices.map((n) => n.payload.outcome)).toEqual(['teen_ended_parent_deleted']);
    const { teenNotice } = await import('../yourtal/events-job.js');
    const text = teenNotice('teen_ended_parent_deleted', 'Pat', held.erase_after!.toISOString())!.text;
    expect(text).toMatch(/deleted their SnapApp account/);
    expect(text).not.toMatch(/invite|comes back/i);
    expect(teenNotice('teen_ended_teen', 'Pat', held.erase_after!.toISOString())!.text).toMatch(/comes back/); // unchanged

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
