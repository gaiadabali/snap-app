import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, createPool, type Db } from '@snap/db';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MailMessage } from '../auth/mailer.js';
import { startFakeYourTalOidc, type FakePerson, type FakeYourTalOidc } from '../test-support/fake-yourtal-oidc.js';

/**
 * The teen hold and turning 18 (group 3.10.f, 3.10.h; migration 0047), end
 * to end: real Postgres as the application roles, the real controllers, a
 * real `oidc-provider` standing in for YourTal (sign-in, invite API and the
 * signed events), and the worker's own connection for its jobs and sweeps.
 * The clock is moved by moving the hold's timestamps back.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

type SignInController = InstanceType<
  typeof import('../auth/yourtal-signin/yourtal-signin.controller.js').YourTalSignInController
>;
type Log = Pick<Console, 'log' | 'warn' | 'error'>;

describeIfDb('the teen hold and turning 18 — real database, real provider', () => {
  let yt: FakeYourTalOidc;
  let signInController: SignInController;
  let admin: Client;
  let app: NestFastifyApplication;
  let keyDir: string;
  let storage: string;
  let workerPool: Pool;
  let workerDb: Db;
  let restoreMailer: () => void;
  let jobs: typeof import('../yourtal/events-job.js');
  const startedAt = new Date();
  const subs: string[] = [];
  const mail: MailMessage[] = [];
  const logged: string[] = [];
  /** What this file made, so drain() claims only its own jobs (other files share the database). */
  const jtis: string[] = [];
  const spaces: string[] = [];
  const log: Log = { log: (m) => logged.push(m), warn: (m) => logged.push(m), error: (m) => logged.push(m) };

  const caller = () => ({ ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

  const person = (tag: string, extra: Partial<FakePerson> = {}): FakePerson => {
    const p: FakePerson = {
      accountId: randomUUID(),
      email: `hold-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
      name: `Person ${tag}`,
      region: 'AU',
      ageBand: 'adult',
      ...extra,
    };
    subs.push(yt.subFor(p.accountId));
    return p;
  };

  async function signIn(who: FakePerson, teenInvite?: string) {
    const started = await signInController.start({ client: 'web', ...(teenInvite ? { teenInvite } : {}) }, caller());
    yt.nextSignIn = { person: who };
    const redirect = await yt.authorize(started.url);
    const code = redirect.searchParams.get('code');
    if (!code) throw new Error(`refused at YourTal: ${redirect.search}`);
    return signInController.finish(
      { flowId: started.flowId, code, state: redirect.searchParams.get('state')!, iss: redirect.searchParams.get('iss')! },
      caller(),
    );
  }

  const http = (method: 'GET' | 'POST', path: string, token: string, workspaceId?: string, payload?: object) =>
    app.getHttpAdapter().getInstance().inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${token}`, ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}) },
      ...(payload ? { payload } : {}),
    });

  const userIdOf = async (who: FakePerson) =>
    (await admin.query('SELECT id FROM users WHERE subject = $1', [`yourtal|${yt.subFor(who.accountId)}`])).rows[0]?.id as string;

  /** A signed YourTal event for this person, through the real endpoint. */
  async function event(who: FakePerson, type: string, body: object = {}, iat = Math.floor(Date.now() / 1000)) {
    const jti = randomUUID();
    jtis.push(jti);
    const token = await yt.signSet({
      iss: yt.issuer,
      aud: yt.serverClientId,
      iat,
      jti,
      sub_id: { format: 'iss_sub', iss: yt.issuer, sub: yt.subFor(who.accountId) },
      events: { [type]: body },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/yourtal/events',
      headers: { 'content-type': 'application/secevent+jwt' },
      payload: token,
    });
    expect(res.statusCode).toBe(202);
  }

  /** The worker: every due job of THIS file, until none is left. Returns what it logged. */
  async function drain(): Promise<string> {
    logged.length = 0;
    for (;;) {
      const { rows } = await admin.query(
        `SELECT id FROM jobs WHERE tenant_id IS NULL AND completed_at IS NULL AND created_at >= $1
            AND (id = ANY($2::uuid[]) OR payload->>'to' LIKE 'hold-%@example.test'
                 OR payload->>'parentSub' = $3 OR payload->>'tenantId' = ANY($4::text[]))`,
        [startedAt, jtis, yt.subFor(parent.accountId), spaces],
      );
      if ((await jobs.runErasureJobsOnce(workerDb, log, rows.map((r) => r.id as string))) === 0) break;
    }
    return logged.join('\n');
  }

  const mailTo = (to: string) => mail.filter((m) => m.to === to);
  /** Moves the hold back, as if `days` had passed since access ended. */
  const daysPass = (space: string, days: number) =>
    admin.query(
      `UPDATE teen_spaces SET access_ended_at = access_ended_at - make_interval(mins => $2),
                              erase_after = erase_after - make_interval(mins => $2) WHERE tenant_id = $1`,
      [space, Math.round(days * 24 * 60)],
    );

  let parent: FakePerson;
  let parentToken: string;
  let parentId: string;
  let household: string;

  async function inviteCode(): Promise<string> {
    const made = await http('POST', '/v1/family/invites', parentToken, household);
    expect(made.statusCode).toBe(201);
    return new URL((made.json() as { joinUrl: string }).joinUrl).searchParams.get('teenInvite')!;
  }

  async function joinTeen(name: string) {
    const teen = person(name.toLowerCase(), { ageBand: 'teen', guardianAccountId: parent.accountId, name });
    const joined = await signIn(teen, await inviteCode());
    expect(joined.outcome).toBe('created');
    spaces.push(joined.workspaces[0]!.id);
    return { teen, token: joined.token, teenId: joined.user.userId, space: joined.workspaces[0]!.id };
  }

  const parentBalance = async () =>
    (await admin.query(`SELECT coalesce(sum(remaining), 0)::int AS n FROM usage_grants WHERE tenant_id = $1`, [household])).rows[0]
      .n as number;

  beforeAll(async () => {
    yt = await startFakeYourTalOidc();
    keyDir = mkdtempSync(join(tmpdir(), 'snap-yt-hold-'));
    storage = mkdtempSync(join(tmpdir(), 'snap-yt-hold-storage-'));
    const keyFile = join(keyDir, 'yourtal-oidc-web.jwk');
    writeFileSync(keyFile, JSON.stringify(yt.webPrivateJwk), { mode: 0o600 });

    process.env.STORAGE_DIR = storage;
    process.env.YOURTAL_OIDC_ISSUER = yt.issuer;
    process.env.YOURTAL_OIDC_WEB_CLIENT_ID = yt.webClientId;
    process.env.YOURTAL_OIDC_MOBILE_CLIENT_ID = yt.mobileClientId;
    process.env.YOURTAL_OIDC_WEB_REDIRECT_URI = yt.webRedirectUri;
    process.env.YOURTAL_OIDC_KEY_FILE = keyFile;
    process.env.YOURTAL_OIDC_SERVER_CLIENT_ID = yt.serverClientId;
    process.env.YOURTAL_API_URL = yt.issuer.replace(/\/oidc$/, '');
    process.env.WEB_PUBLIC_URL = 'https://snap-apps.test';

    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();
    signInController = new (await import('../auth/yourtal-signin/yourtal-signin.controller.js')).YourTalSignInController();
    restoreMailer = (await import('../auth/mailer.js')).setMailerForTesting({
      send: async (m) => {
        mail.push(m);
      },
    });

    const { AppModule } = await import('../app.module.js');
    const { registerSecEventParser } = await import('../yourtal/events.controller.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    registerSecEventParser(app.getHttpAdapter().getInstance());
    app.useGlobalFilters(new (await import('../common/errors.filter.js')).ErrorsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const workerUrl =
      process.env.WORKER_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace(/:\/\/[^:]+:/, '://snap_worker:');
    workerPool = createPool(workerUrl);
    workerDb = createDb(workerPool);
    jobs = await import('../yourtal/events-job.js');

    yt.enforceTeenInvites = true;
    yt.teenInviteLimit = 100;
    parent = person('parent', { name: 'Pat' });
    parentToken = (await signIn(parent)).token;
    parentId = await userIdOf(parent);
    const created = await http('POST', '/v1/workspaces', parentToken, undefined, { name: 'Pat household', kind: 'personal' });
    expect(created.statusCode).toBe(201);
    household = (created.json() as { id: string }).id;
  });

  afterAll(async () => {
    const subjects = subs.map((s) => `yourtal|${s}`);
    if (admin) {
      const ids = (await admin.query('SELECT id FROM users WHERE subject = ANY($1)', [subjects])).rows.map((r) => r.id);
      const tenants = (
        await admin.query('SELECT DISTINCT tenant_id FROM memberships WHERE user_id = ANY($1::uuid[])', [ids])
      ).rows.map((r) => r.tenant_id);
      await admin.query('DELETE FROM teen_spaces WHERE tenant_id = ANY($1::uuid[])', [tenants]);
      for (const table of ['credit_spends', 'jobs', 'goals', 'captures']) {
        await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
      }
      await admin.query(
        `DELETE FROM jobs WHERE tenant_id IS NULL AND created_at >= $1
           AND kind IN ('teen_invite_end', 'yourtal_event', 'erasure_notice', 'storage_purge')`,
        [startedAt],
      );
      await admin.query('DELETE FROM teen_space_spends WHERE funding_tenant_id = ANY($1::uuid[])', [tenants]);
      await admin.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenants]);
      await admin.query('DELETE FROM mail_deliveries WHERE recipient LIKE $1', ['hold-%@example.test']);
      await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM yourtal_sign_in_reviews WHERE yourtal_sub = ANY($1)', [subs]);
      await admin.end();
    }
    await app?.close();
    await workerPool?.end();
    restoreMailer?.();
    await yt?.close();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
    if (storage) rmSync(storage, { recursive: true, force: true });
  });

  describe('the hold (3.10.f)', () => {
    let teen: FakePerson;
    let teenToken: string;
    let space: string;

    it('ending access takes away the parent’s view at once and emails both, naming the day', async () => {
      ({ teen, token: teenToken, space } = await joinTeen('Tia'));
      expect((await http('POST', '/v1/goals', teenToken, space, { name: 'Bike', target: '100.00' })).statusCode).toBe(201);
      expect((await http('GET', '/v1/goals', parentToken, space)).statusCode).toBe(200);
      mail.length = 0;

      expect((await http('POST', `/v1/family/teens/${space}/end`, parentToken)).statusCode).toBe(200);
      expect((await http('GET', '/v1/goals', parentToken, space)).statusCode).toBeGreaterThanOrEqual(400);
      const workspaces = (await http('GET', '/v1/workspaces', parentToken)).json() as Array<{ id: string }>;
      expect(workspaces.map((w) => w.id)).not.toContain(space);
      // Family still lists the teen by name, with the hold.
      const family = (await http('GET', '/v1/family', parentToken)).json();
      expect(family.teens).toEqual([expect.objectContaining({ workspaceId: space, teenName: 'Tia', accessEndedAt: expect.any(String) })]);
      // A repeat still answers (the parent is no longer a member).
      expect((await http('POST', `/v1/family/teens/${space}/end`, parentToken)).statusCode).toBe(200);

      await drain();
      const eraseAfter = (await admin.query('SELECT erase_after FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0]
        .erase_after as Date;
      const day = eraseAfter.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      const toParent = mailTo(parent.email);
      expect(toParent).toHaveLength(1);
      expect(toParent[0]).toMatchObject({ subject: 'Tia’s access to SnapApp has ended' });
      expect(toParent[0]!.text).toContain(`will be deleted on ${day}`);
      expect(toParent[0]!.text).toContain('you can no longer see their SnapApp space');
      const toTeen = mailTo(teen.email);
      expect(toTeen).toHaveLength(1);
      expect(toTeen[0]).toMatchObject({ subject: 'Your access to SnapApp has ended' });
      expect(toTeen[0]!.text).toContain(`deleted on ${day}`);
      expect(toTeen[0]!.text).toContain('If Pat invites you again before then');
      // The payloads are emptied once sent.
      expect(
        (await admin.query(`SELECT count(*)::int AS n FROM jobs WHERE kind = 'erasure_notice' AND payload->>'to' = $1`, [teen.email]))
          .rows[0].n,
      ).toBe(0);

      // No way back without a new invite, even when YourTal lets the teen through.
      yt.enforceTeenInvites = false;
      try {
        await expect(signIn(teen)).rejects.toMatchObject({ response: { error: 'teen_invite_required' } });
      } finally {
        yt.enforceTeenInvites = true;
      }
    });

    it('a new invite from the parent on day 29 brings the same space back, as it was', async () => {
      await daysPass(space, 29);
      await jobs.runTeenHoldSweepOnce(workerDb, log);
      expect((await admin.query('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [space])).rows[0].n).toBe(1);

      const back = await signIn(teen, await inviteCode());
      expect(back.outcome).toBe('signed_in');
      expect(back.workspaces.map((w) => w.id)).toEqual([space]);
      expect(back.workspaces[0]).toMatchObject({ teenSpace: 'teen' });
      teenToken = back.token;
      const goals = (await http('GET', '/v1/goals', teenToken, space)).json() as Array<{ name: string }>;
      expect(goals.map((g) => g.name)).toContain('Bike');
      expect((await http('GET', '/v1/goals', parentToken, space)).statusCode).toBe(200);
      const row = (await admin.query('SELECT access_ended_at, erase_after FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0];
      expect(row).toEqual({ access_ended_at: null, erase_after: null });
      // And the next sign-in needs no code.
      const next = await signIn(teen);
      expect(next.workspaces.map((w) => w.id)).toEqual([space]);
      teenToken = next.token;
    });

    it('ignores the End that the restore undid when YourTal delivers it late', async () => {
      mail.length = 0;
      // YourTal's parent_ended for the first End, its iat an hour back (before the restore).
      await event(teen, 'urn:yourtal:event:access-ended', { reason: 'parent_ended', erase_data: true }, Math.floor(Date.now() / 1000) - 3600);
      expect(await drain()).toContain('no live teen space, or one restored since');
      expect((await admin.query('SELECT access_ended_at FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0].access_ended_at).toBeNull();
      expect((await http('GET', '/v1/goals', teenToken, space)).statusCode).toBe(200);
      expect((await http('GET', '/v1/goals', parentToken, space)).statusCode).toBe(200);
      expect(mail).toEqual([]);
    });

    it('YourTal’s access-ended (teen removed) holds it again, and on day 31 the sweep erases it and its files', async () => {
      mail.length = 0;
      await event(teen, 'urn:yourtal:event:access-ended', { reason: 'teen_removed', erase_data: true });
      expect(await drain()).toContain('teen space held for 30 days');
      expect((await http('GET', '/v1/goals', parentToken, space)).statusCode).toBeGreaterThanOrEqual(400);
      expect(mailTo(parent.email).map((m) => m.subject)).toEqual(['Tia’s access to SnapApp has ended']);
      expect(mailTo(teen.email).map((m) => m.subject)).toEqual(['Your access to SnapApp has ended']);

      mkdirSync(join(storage, space, 'originals'), { recursive: true });
      writeFileSync(join(storage, space, 'originals', 'receipt.jpg'), 'x');
      await daysPass(space, 30.01);
      const swept = await jobs.runTeenHoldSweepOnce(workerDb, log);
      expect(swept.teenErased).toBeGreaterThanOrEqual(1);
      expect((await admin.query('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [space])).rows[0].n).toBe(0);
      await drain(); // storage_purge
      expect(existsSync(join(storage, space))).toBe(false);
      // The teen's account goes too, but not their sub: a new invite starts afresh.
      expect(await userIdOf(teen)).toBeUndefined();
      expect((await admin.query('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [household])).rows[0].n).toBe(1);
      expect((await http('GET', '/v1/family', parentToken)).json().teens).toEqual([]);
      const fresh = await signIn(teen, await inviteCode());
      expect(fresh.outcome).toBe('created');
      expect(fresh.workspaces[0]!.id).not.toBe(space);
      spaces.push(fresh.workspaces[0]!.id);
    });

    it('goes on past a space it cannot erase, and erases the rest', async () => {
      const stuck = await joinTeen('Xan');
      const clean = await joinTeen('Yoli');
      for (const t of [stuck, clean]) {
        expect((await http('POST', `/v1/family/teens/${t.space}/end`, parentToken)).statusCode).toBe(200);
        await daysPass(t.space, 30.01);
      }
      // A row in the stuck space pointing into the parent's workspace: the spill guard refuses it.
      const goal = randomUUID();
      await admin.query(`INSERT INTO goals (id, tenant_id, name, target) VALUES ($1, $2, 'Car', 100)`, [goal, household]);
      await admin.query(
        `INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on) VALUES (gen_random_uuid(), $1, $2, 5, '2026-08-20')`,
        [stuck.space, goal],
      );
      try {
        logged.length = 0;
        const swept = await jobs.runTeenHoldSweepOnce(workerDb, log);
        expect(swept.failed).toBeGreaterThanOrEqual(1);
        expect(logged.join('\n')).toContain(`workspace ${stuck.space} not erased: failed:`);
        expect((await admin.query('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [stuck.space])).rows[0].n).toBe(1);
        expect((await admin.query('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [clean.space])).rows[0].n).toBe(0);
      } finally {
        await admin.query('DELETE FROM goal_contributions WHERE tenant_id = $1', [stuck.space]);
        await admin.query('DELETE FROM goals WHERE id = $1', [goal]);
      }
      await jobs.runTeenHoldSweepOnce(workerDb, log);
      expect((await admin.query('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [stuck.space])).rows[0].n).toBe(0);
      await drain();
    });
  });

  describe('turning 18 (3.10.h)', () => {
    it('removes the parent, lifts the locks, stops the parent’s credits and tells both', async () => {
      const { teen, token, teenId, space } = await joinTeen('Uma');
      mail.length = 0;
      await event(teen, 'urn:yourtal:event:became-adult');
      expect(await drain()).toContain('became-adult: teen space is now their own');

      // The parent's view is gone; the young adult keeps their session and data.
      expect((await http('GET', '/v1/goals', parentToken, space)).statusCode).toBeGreaterThanOrEqual(400);
      expect(((await http('GET', '/v1/family', parentToken)).json().teens as Array<{ workspaceId: string }>).map((t) => t.workspaceId)).not.toContain(space);
      expect((await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
      const mine = (await http('GET', '/v1/workspaces', token)).json() as Array<{ id: string; role: string; teenSpace: string | null }>;
      expect(mine).toEqual([expect.objectContaining({ id: space, role: 'owner', teenSpace: null })]);
      expect((await admin.query('SELECT user_id FROM memberships WHERE tenant_id = $1', [space])).rows).toEqual([{ user_id: teenId }]);

      // An ordinary workspace now: a scan no longer spends the parent's credit.
      const before = await parentBalance();
      const capture = randomUUID();
      await admin.query(
        `INSERT INTO captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type, original_byte_size, original_sha256, status)
         VALUES ($1, $2, $3, 'k', 'image/jpeg', 10, $4, 'received')`,
        [capture, space, teenId, randomBytes(32)],
      );
      const { enqueueExtraction } = await import('../repo.js');
      // It has no credits of its own yet, so the scan is refused as its own
      // (not the parent's) and waits (7.1.b).
      await expect(enqueueExtraction(teenId, space, capture)).rejects.toMatchObject({
        name: 'QuotaExhaustedError',
        teen: false,
      });
      expect(await parentBalance()).toBe(before);
      expect((await admin.query('SELECT count(*)::int AS n FROM teen_space_spends WHERE capture_id = $1', [capture])).rows[0].n).toBe(0);
      // And the teen-space locks are gone: they can make a workspace of their own.
      expect((await http('POST', '/v1/workspaces', token, undefined, { name: 'Side gig', kind: 'personal' })).statusCode).toBe(201);

      expect(mailTo(parent.email)).toEqual([
        expect.objectContaining({ subject: 'Uma is 18 now', text: expect.stringContaining('Uma is 18 now, so you can no longer see their SnapApp space.') }),
      ]);
      expect(mailTo(teen.email)).toEqual([
        expect.objectContaining({
          subject: 'Your SnapApp space is now just yours',
          text: expect.stringContaining("You're 18 now, so this space is just yours. Pat can't see it any more"),
        }),
      ]);

      // A repeat of the event does nothing more.
      mail.length = 0;
      await event(teen, 'urn:yourtal:event:became-adult');
      expect(await drain()).toContain('became-adult: no teen space');
      expect(mail).toEqual([]);
    });

    it('during the hold, changes nothing: the erasure stands', async () => {
      const { teen, space } = await joinTeen('Vic');
      expect((await http('POST', `/v1/family/teens/${space}/end`, parentToken)).statusCode).toBe(200);
      await drain();
      mail.length = 0;
      await event(teen, 'urn:yourtal:event:became-adult');
      expect(await drain()).toContain('its erasure stands');
      expect(mail).toEqual([]);
      expect((await admin.query('SELECT access_ended_at FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0].access_ended_at).not.toBeNull();

      // Now 18, they cannot sign in to the space being deleted, and nothing is written.
      teen.ageBand = 'adult';
      const sessions = async () =>
        (await admin.query('SELECT count(*)::int AS n FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE subject = $1)', [
          `yourtal|${yt.subFor(teen.accountId)}`,
        ])).rows[0].n as number;
      const before = await sessions();
      await expect(signIn(teen)).rejects.toMatchObject({ response: { error: 'teen_access_ended' } });
      expect(await sessions()).toBe(before);

      await daysPass(space, 30.01);
      await jobs.runTeenHoldSweepOnce(workerDb, log);
      expect((await admin.query('SELECT count(*)::int AS n FROM tenants WHERE id = $1', [space])).rows[0].n).toBe(0);
    });
  });
});
