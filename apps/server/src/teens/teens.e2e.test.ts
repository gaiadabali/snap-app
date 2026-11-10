import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, createPool } from '@snap/db';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startFakeYourTalOidc, type FakePerson, type FakeYourTalOidc } from '../test-support/fake-yourtal-oidc.js';

/**
 * Teens join SnapApp by a parent's invite (group 3.10.a, b, c, e), end to end
 * against a real Postgres as the application roles and a real
 * `oidc-provider` standing in for YourTal, which also serves the invite API.
 *
 * Sign-ins go through the controller (each with its own caller address, so
 * the per-IP limits never couple tests); everything a signed-in person does
 * goes over HTTP through the real application and its guards.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

type SignInController = InstanceType<
  typeof import('../auth/yourtal-signin/yourtal-signin.controller.js').YourTalSignInController
>;

describeIfDb('teen spaces — real database, real provider', () => {
  let yt: FakeYourTalOidc;
  let signInController: SignInController;
  let admin: Client;
  let app: NestFastifyApplication;
  let keyDir: string;
  let workerPool: Pool;
  const subs: string[] = [];

  const caller = () => ({ ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

  const person = (tag: string, extra: Partial<FakePerson> = {}): FakePerson => {
    const p: FakePerson = {
      accountId: randomUUID(),
      email: `teen-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
      name: `Person ${tag}`,
      region: 'AU',
      ageBand: 'adult',
      ...extra,
    };
    subs.push(yt.subFor(p.accountId));
    return p;
  };

  async function authorize(who: FakePerson, teenInvite?: string) {
    const started = await signInController.start({ client: 'web', ...(teenInvite ? { teenInvite } : {}) }, caller());
    yt.nextSignIn = { person: who };
    const redirect = await yt.authorize(started.url);
    return { flowId: started.flowId, redirect, url: started.url };
  }

  async function signIn(who: FakePerson, teenInvite?: string) {
    const { flowId, redirect } = await authorize(who, teenInvite);
    const code = redirect.searchParams.get('code');
    if (!code) throw new Error(`refused at YourTal: ${redirect.search}`);
    return signInController.finish(
      { flowId, code, state: redirect.searchParams.get('state')!, iss: redirect.searchParams.get('iss')! },
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
    (await admin.query('SELECT id FROM users WHERE subject = $1', [`yourtal|${yt.subFor(who.accountId)}`])).rows[0]?.id as
      | string
      | undefined;

  /** The parent: signed in with YourTal, owning a personal workspace with the 10-scan signup bonus. */
  let parent: FakePerson;
  let parentToken: string;
  let household: string;

  async function inviteCode(): Promise<{ code: string; inviteId: string }> {
    const made = await http('POST', '/v1/family/invites', parentToken, household);
    expect(made.statusCode).toBe(201);
    const body = made.json() as { inviteId: string; joinUrl: string };
    const code = new URL(body.joinUrl).searchParams.get('teenInvite')!;
    return { code, inviteId: body.inviteId };
  }

  /** Runs the worker's due `teen_invite_end` jobs until none is due. Returns what it logged. */
  async function runTeenEndJobs(): Promise<string> {
    const { runErasureJobsOnce } = await import('../yourtal/events-job.js');
    const lines: string[] = [];
    const log = { log: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
    for (let i = 0; i < 20; i += 1) {
      const due = await admin.query(
        `SELECT 1 FROM jobs WHERE kind = 'teen_invite_end' AND completed_at IS NULL AND run_after <= now() AND attempts < max_attempts`,
      );
      if (due.rowCount === 0) break;
      await runErasureJobsOnce(createDb(workerPool), log);
    }
    return lines.join('\n');
  }

  beforeAll(async () => {
    yt = await startFakeYourTalOidc();
    keyDir = mkdtempSync(join(tmpdir(), 'snap-yt-teen-'));
    const keyFile = join(keyDir, 'yourtal-oidc-web.jwk');
    writeFileSync(keyFile, JSON.stringify(yt.webPrivateJwk), { mode: 0o600 });

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

    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    // As main.ts does: the 403s for a teen space are the filter's.
    app.useGlobalFilters(new (await import('../common/errors.filter.js')).ErrorsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const workerUrl =
      process.env.WORKER_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace(/:\/\/[^:]+:/, '://snap_worker:');
    workerPool = createPool(workerUrl);

    parent = person('parent', { name: 'Pat' });
    parentToken = (await signIn(parent)).token;
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
      for (const table of ['credit_spends', 'jobs', 'captures']) {
        await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
      }
      await admin.query(`DELETE FROM jobs WHERE kind = 'teen_invite_end'`);
      await admin.query('DELETE FROM teen_space_spends WHERE funding_tenant_id = ANY($1::uuid[])', [tenants]);
      await admin.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenants]);
      await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
      await admin.query('DELETE FROM yourtal_sign_in_reviews WHERE yourtal_sub = ANY($1)', [subs]);
      await admin.end();
    }
    await app?.close();
    await workerPool?.end();
    await yt?.close();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    yt.enforceTeenInvites = true;
    yt.teenInviteLimit = 100; // this file makes more invites than one parent's daily 10
  });

  it('makes an invite for the parent at YourTal and answers a join link with its code', async () => {
    const { code, inviteId } = await inviteCode();
    const atYourTal = yt.teenInvites.get(inviteId)!;
    expect(atYourTal.parentSub).toBe(yt.subFor(parent.accountId));
    expect(atYourTal.code).toBe(code);

    // The code is kept only as a hash; the parent sees the invite as open.
    const { rows } = await admin.query('SELECT code_sha256 FROM teen_invites WHERE id = $1', [inviteId]);
    expect(rows[0].code_sha256).toHaveLength(32);
    const family = (await http('GET', '/v1/family', parentToken)).json();
    expect(family.invitesAvailable).toBe(true);
    expect(family.pendingInvites.map((i: { inviteId: string }) => i.inviteId)).toContain(inviteId);

    // The sign-in carries it to YourTal.
    const started = await signInController.start({ client: 'web', teenInvite: code }, caller());
    expect(new URL(started.url).searchParams.get('teen_invite')).toBe(code);
  });

  it('refuses a code it never issued before going to YourTal', async () => {
    await expect(
      signInController.start({ client: 'web', teenInvite: randomBytes(16).toString('base64url') }, caller()),
    ).rejects.toMatchObject({ response: { error: 'teen_invite_expired' } });
  });

  it('refuses a teen whose guardian is someone else, and makes nothing', async () => {
    const stranger = person('stranger-teen', { ageBand: 'teen', guardianAccountId: randomUUID() });
    const { code } = await inviteCode();
    const { redirect } = await authorize(stranger, code);
    expect(redirect.searchParams.get('error')).toBe('access_denied');
    expect(redirect.searchParams.get('error_description')).toBe('teen_invite_required');
    expect(await userIdOf(stranger)).toBeUndefined();
  });

  it('refuses a teen YourTal let through when the invite is not accepted by that teen (the app’s own check)', async () => {
    yt.enforceTeenInvites = false;
    const teen = person('unaccepted-teen', { ageBand: 'teen', guardianAccountId: parent.accountId });
    const { code } = await inviteCode();
    await expect(signIn(teen, code)).rejects.toMatchObject({ response: { error: 'teen_invite_not_yours' } });
    // Without any invite at all, too.
    await expect(signIn(person('no-invite-teen', { ageBand: 'teen' }))).rejects.toMatchObject({
      response: { error: 'teen_invite_required' },
    });
    expect(await userIdOf(teen)).toBeUndefined();
  });

  it('tells an adult who opened a teen’s link that it is not for them, and leaves the invite pending (3.10.i)', async () => {
    const adult = person('adult-with-link', { name: 'Alex' });
    const { code, inviteId } = await inviteCode();
    const signedIn = await signIn(adult, code);
    // An ordinary sign-up: no teen space, and the reason is in the answer.
    expect(signedIn.outcome).toBe('created');
    expect(signedIn.teenInvite).toBe('not_for_you');
    expect(signedIn.workspaces).toHaveLength(0);
    const { rows } = await admin.query('SELECT 1 FROM teen_spaces WHERE invite_id = $1', [inviteId]);
    expect(rows).toHaveLength(0);
    // Not consumed: still open for the parent, and still pending at YourTal.
    const family = (await http('GET', '/v1/family', parentToken)).json();
    expect(family.pendingInvites.map((i: { inviteId: string }) => i.inviteId)).toContain(inviteId);
    expect(yt.teenInvites.get(inviteId)!.status).toBe('pending');
    // An adult who signs in with no link gets no such note.
    expect((await signIn(person('adult-no-link', { name: 'Sam' }))).teenInvite).toBeUndefined();
  });

  describe('the guardian’s teen', () => {
    let teen: FakePerson;
    let teenId: string;
    let teenToken: string;
    let space: string;

    beforeAll(async () => {
      yt.enforceTeenInvites = true;
      teen = person('teen', { ageBand: 'teen', guardianAccountId: parent.accountId, name: 'Tia' });
    });

    it('joins: a space the teen owns, the parent read-only, paid from the parent’s workspace', async () => {
      const { code, inviteId } = await inviteCode();
      const joined = await signIn(teen, code);
      expect(joined.outcome).toBe('created');
      teenToken = joined.token;
      teenId = joined.user.userId;
      expect(joined.workspaces).toHaveLength(1);
      space = joined.workspaces[0]!.id;
      expect(joined.workspaces[0]).toMatchObject({ name: 'Tia’s space', kind: 'personal', role: 'owner', teenSpace: 'teen' });
      // Set up like any new personal workspace.
      expect((await admin.query('SELECT count(*)::int AS n FROM categories WHERE tenant_id = $1', [space])).rows[0].n).toBeGreaterThan(0);

      const members = await admin.query('SELECT user_id, role FROM memberships WHERE tenant_id = $1 ORDER BY role', [space]);
      expect(members.rows).toEqual([
        { user_id: teenId, role: 'owner' },
        { user_id: (await userIdOf(parent))!, role: 'readonly' },
      ]);
      const row = (await admin.query('SELECT funding_tenant_id, invite_id FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0];
      expect(row).toEqual({ funding_tenant_id: household, invite_id: inviteId });
      // No signup scans of its own.
      expect((await admin.query('SELECT count(*)::int AS n FROM usage_grants WHERE tenant_id = $1', [space])).rows[0].n).toBe(0);
    });

    it('tells the teen who can see the space, and lists the teen for the parent', async () => {
      const asTeen = (await http('GET', '/v1/family', teenToken)).json();
      expect(asTeen.asTeen).toEqual({ workspaceId: space, parentName: 'Pat' });
      const asParent = (await http('GET', '/v1/family', parentToken)).json();
      expect(asParent.teens).toEqual([
        expect.objectContaining({ workspaceId: space, teenName: 'Tia', accessEndedAt: null }),
      ]);
      expect(asParent.asTeen).toBeNull();
    });

    it('signs the teen in again with no code', async () => {
      const again = await signIn(teen);
      expect(again.outcome).toBe('signed_in');
      expect(again.user.userId).toBe(teenId);
      teenToken = again.token;
    });

    it('lets the parent view the space but change nothing in it', async () => {
      const list = (await http('GET', '/v1/workspaces', parentToken)).json() as Array<{ id: string; role: string; teenSpace: string | null }>;
      expect(list.find((w) => w.id === space)).toMatchObject({ role: 'readonly', teenSpace: 'parent' });
      // The parent's own workspace comes first, so it is the default.
      expect(list[0]).toMatchObject({ id: household, teenSpace: null });
      expect((await http('GET', '/v1/goals', parentToken, space)).statusCode).toBe(200);
      const write = await http('POST', '/v1/goals', parentToken, space, { name: 'Bike', target: '100.00' });
      expect(write.statusCode).toBe(403);
      expect(write.json()).toMatchObject({ error: 'view_only' });
      // The teen can.
      expect((await http('POST', '/v1/goals', teenToken, space, { name: 'Bike', target: '100.00' })).statusCode).toBe(201);
    });

    it('answers every GET route for the parent in the teen space without a write or a server error', async () => {
      const { AppModule } = await import('../app.module.js');
      const controllers = (Reflect.getMetadata('controllers', AppModule) ?? []) as Array<new () => object>;
      const paths: string[] = [];
      for (const ctrl of controllers) {
        const base = String(Reflect.getMetadata('path', ctrl) ?? '').replace(/^\/|\/$/g, '');
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          const fn = (ctrl.prototype as Record<string, unknown>)[name];
          if (typeof fn !== 'function' || Reflect.getMetadata('method', fn) !== 0) continue; // RequestMethod.GET
          const sub = String(Reflect.getMetadata('path', fn) ?? '').replace(/^\/|\/$/g, '');
          paths.push(`/${[base, sub].filter(Boolean).join('/')}`.replace(/:[A-Za-z]+/g, randomUUID()));
        }
      }
      expect(paths.length).toBeGreaterThan(40);
      const bad: string[] = [];
      let ok = 0;
      for (const path of paths) {
        // Serves the APK from storage, with no workspace: nothing a teen space changes.
        if (path.startsWith('/v1/downloads/')) continue;
        const res = await http('GET', path, parentToken, space);
        if (res.statusCode < 300) ok += 1;
        const error = String(res.headers['content-type'] ?? '').includes('json') ? (res.json() as { error?: string }).error : undefined;
        if (res.statusCode >= 500 || error === 'view_only') bad.push(`${path} → ${res.statusCode} ${error ?? ''}`);
      }
      expect(bad, bad.join('\n')).toEqual([]);
      expect(ok).toBeGreaterThan(20);
    });

    it('locks the teen in: no other workspace, no invitations, no purchases', async () => {
      const own = await http('POST', '/v1/workspaces', teenToken, undefined, { name: 'Mine', kind: 'personal' });
      expect(own.statusCode).toBe(403);
      expect(own.json()).toMatchObject({ error: 'teen_space' });

      const buy = await http('POST', '/v1/credits/purchases', teenToken, space, { packCode: 'credits_50' });
      expect(buy.statusCode).toBe(403);
      expect(buy.json()).toMatchObject({ error: 'teen_space' });

      const link = await http('POST', '/v1/yourtal/link', teenToken, undefined, { code: 'ABCD1234' });
      expect(link.statusCode).toBe(403);
      expect(link.json()).toMatchObject({ error: 'teen_consent_not_allowed' });
    });

    it('spends the parent’s credit for the teen’s scan, earns no points, and refunds to the parent', async () => {
      const { enqueueExtraction } = await import('../repo.js');
      const { readPaidScan, refundScanCredit } = await import('../credits/spend.js');
      const { workerActor } = await import('../tenant-entry.js');
      const { withTenantAs } = await import('@snap/db');
      const { getDb } = await import('../db.js');
      const parentBalance = async () =>
        (await admin.query(`SELECT coalesce(sum(remaining), 0)::int AS n FROM usage_grants WHERE tenant_id = $1`, [household]))
          .rows[0].n as number;
      const before = await parentBalance();
      expect(before).toBe(10);

      const capture = randomUUID();
      await admin.query(
        `INSERT INTO captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type, original_byte_size, original_sha256, status)
         VALUES ($1, $2, $3, 'k', 'image/jpeg', 10, $4, 'received')`,
        [capture, space, teenId, randomBytes(32)],
      );
      await enqueueExtraction(teenId, space, capture);
      await enqueueExtraction(teenId, space, capture); // a retry spends nothing more
      expect(await parentBalance()).toBe(before - 1);

      // The teen's balance is the parent's.
      expect((await http('GET', '/v1/credits', teenToken, space)).json()).toEqual({ creditsRemaining: before - 1 });
      // Not paid, so the receipt can never earn YourTal points.
      expect(await withTenantAs(getDb(), teenId, space, (tx) => readPaidScan(tx, capture))).toBe(false);

      const worker = workerActor(teenId, createDb(workerPool));
      expect(await refundScanCredit(worker, space, capture, 'unreadable')).toEqual({ refunded: true, creditReturned: true });
      expect(await parentBalance()).toBe(before);

      // Two at once on one capture: one parent credit, one record.
      const twin = randomUUID();
      await admin.query(
        `INSERT INTO captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type, original_byte_size, original_sha256, status)
         VALUES ($1, $2, $3, 'k', 'image/jpeg', 10, $4, 'received')`,
        [twin, space, teenId, randomBytes(32)],
      );
      await Promise.allSettled([enqueueExtraction(teenId, space, twin), enqueueExtraction(teenId, space, twin)]);
      expect(await parentBalance()).toBe(before - 1);
      expect((await admin.query('SELECT count(*)::int AS n FROM teen_space_spends WHERE capture_id = $1', [twin])).rows[0].n).toBe(1);

      // Only while the parent still owns the paying workspace.
      const parentId = (await userIdOf(parent))!;
      await admin.query(`UPDATE memberships SET role = 'admin' WHERE tenant_id = $1 AND user_id = $2`, [household, parentId]);
      try {
        const third = randomUUID();
        await admin.query(
          `INSERT INTO captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type, original_byte_size, original_sha256, status)
           VALUES ($1, $2, $3, 'k', 'image/jpeg', 10, $4, 'received')`,
          [third, space, teenId, randomBytes(32)],
        );
        await expect(enqueueExtraction(teenId, space, third)).rejects.toMatchObject({ cause: { code: 'TS004' } });
        expect(await parentBalance()).toBe(before - 1);
      } finally {
        await admin.query(`UPDATE memberships SET role = 'owner' WHERE tenant_id = $1 AND user_id = $2`, [household, parentId]);
      }
    });

    it('lists a teen’s paid scans in both usage lists: 1 credit for the teen, a "Teen scan" line for the parent (0056)', async () => {
      const { listCreditUsage, listCreditUsageMonths } = await import('../credits/credits.repo.js');
      const parentId = (await userIdOf(parent))!;
      // The previous test left one paid scan and one refunded (given back) in this space.
      const [month] = await listCreditUsageMonths(teenId, space);
      expect(month).toBeDefined();

      const teenList = await listCreditUsage(teenId, space, month!, 100, null);
      expect(teenList.total).toBe(1);
      expect(teenList.items.map((i) => [i.amount, i.refunded]).sort()).toEqual([[0, true], [1, false]]);

      // The parent's workspace lists them, with no supplier and no capture; their own list is untouched.
      const parentList = await listCreditUsage(parentId, household, month!, 100, null);
      expect(parentList.total).toBe(1);
      expect(parentList.items.map((i) => [i.label, i.amount, i.refunded]).sort()).toEqual([
        ['Teen scan', 0, true],
        ['Teen scan', 1, false],
      ]);
      expect(await listCreditUsageMonths(parentId, household)).toEqual([month]);
      // Paging works across the merged list.
      const one = await listCreditUsage(parentId, household, month!, 1, null);
      expect(one.nextBefore).toBe(one.items[0]!.id);
      expect((await listCreditUsage(parentId, household, month!, 1, one.nextBefore)).nextBefore).toBeNull();

      // Other members of the parent's workspace see none of it (the teen agreed to the parent, not staff).
      const sam = person('staff', { name: 'Sam' });
      await signIn(sam);
      const staff = (await userIdOf(sam))!;
      await admin.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'member')`, [household, staff]);
      try {
        expect(await listCreditUsage(staff, household, month!, 100, null)).toMatchObject({ total: 0, items: [] });
        expect(await listCreditUsageMonths(staff, household)).toEqual([]);
      } finally {
        await admin.query(`DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2`, [household, staff]);
      }

      // A credit spent stays spent: the teen deleting the capture changes neither list.
      await admin.query(`DELETE FROM captures WHERE tenant_id = $1`, [space]);
      expect((await listCreditUsage(teenId, space, month!, 100, null)).total).toBe(1);
      expect((await listCreditUsage(parentId, household, month!, 100, null)).total).toBe(1);

      // The workspace handed to a new owner: the lines stay the inviting parent's, never the new owner's.
      await admin.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [household, staff]);
      await admin.query(`UPDATE memberships SET role = 'admin' WHERE tenant_id = $1 AND user_id = $2`, [household, parentId]);
      try {
        expect(await listCreditUsage(staff, household, month!, 100, null)).toMatchObject({ total: 0, items: [] });
        expect(await listCreditUsageMonths(staff, household)).toEqual([]);
        expect((await listCreditUsage(parentId, household, month!, 100, null)).total).toBe(1);
      } finally {
        await admin.query(`UPDATE memberships SET role = 'owner' WHERE tenant_id = $1 AND user_id = $2`, [household, parentId]);
        await admin.query(`DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2`, [household, staff]);
      }
    });

    it('redoes a setup that failed after the join, at the next sign-in', async () => {
      await admin.query('DELETE FROM categories WHERE tenant_id = $1', [space]);
      teenToken = (await signIn(teen)).token;
      expect((await admin.query('SELECT count(*)::int AS n FROM categories WHERE tenant_id = $1', [space])).rows[0].n).toBeGreaterThan(0);
    });

    it('refuses an unfunded teen’s scan before storing anything', async () => {
      const { CapturesController, CreateCaptureDto } = await import('../captures/captures.controller.js');
      const body = new CreateCaptureDto();
      body.pages = [{ sha256: randomBytes(32).toString('hex'), mimeType: 'image/jpeg', byteSize: 1024 }];
      const teenUser = { userId: teenId, displayName: 'Tia', email: teen.email, initials: 'T', emailVerified: true };
      const count = async () => (await admin.query('SELECT count(*)::int AS n FROM captures WHERE tenant_id = $1', [space])).rows[0].n;
      const before = await count();
      const parentId = (await userIdOf(parent))!;
      await admin.query(`UPDATE memberships SET role = 'admin' WHERE tenant_id = $1 AND user_id = $2`, [household, parentId]);
      try {
        await expect(new CapturesController().create(teenUser, space, body)).rejects.toMatchObject({
          response: { error: 'teen_space_unfunded' },
        });
        expect(await count()).toBe(before);
      } finally {
        await admin.query(`UPDATE memberships SET role = 'owner' WHERE tenant_id = $1 AND user_id = $2`, [household, parentId]);
      }
    });

    it('lets only the parent end access; then the teen is signed out and refused', async () => {
      const stranger = person('other-adult');
      const strangerToken = (await signIn(stranger)).token;
      expect((await http('POST', `/v1/family/teens/${space}/end`, strangerToken)).statusCode).toBe(404);
      expect((await http('POST', `/v1/family/teens/${space}/end`, teenToken)).statusCode).toBe(404);

      const inviteId = (await admin.query('SELECT invite_id FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0].invite_id;
      const ended = await http('POST', `/v1/family/teens/${space}/end`, parentToken);
      expect(ended.statusCode).toBe(200);
      expect(yt.teenInvites.get(inviteId)?.status).toBe('ended');
      expect(yt.teenInviteCalls).toContain(`POST /api/oidc-clients/teen-invites/${inviteId}/end`);
      // YourTal answered, so the job queued with the end finds nothing to do.
      const calls = yt.teenInviteCalls.length;
      expect(await runTeenEndJobs()).toContain('YourTal already confirmed; nothing to do');
      expect(yt.teenInviteCalls.length).toBe(calls);
      expect((await http('POST', `/v1/family/teens/${space}/end`, parentToken)).statusCode).toBe(200);

      const held = (await admin.query('SELECT erase_after - access_ended_at AS hold FROM teen_spaces WHERE tenant_id = $1', [space]))
        .rows[0];
      expect(held.hold).toMatchObject({ days: 30 });
      expect((await http('GET', '/v1/family', teenToken)).statusCode).toBe(401);

      // Refused here even when YourTal lets the teen through.
      yt.enforceTeenInvites = false;
      await expect(signIn(teen)).rejects.toMatchObject({ response: { error: 'teen_invite_required' } });
      const family = (await http('GET', '/v1/family', parentToken)).json();
      expect(family.teens[0].accessEndedAt).not.toBeNull();
    });
  });

  it('never links a teen by email to an account here, and writes nothing', async () => {
    const repo = await import('../repo.js');
    const { issueSession, authenticateSession } = await import('../auth/sessions.js');
    for (const shape of ['with a workspace', 'with none'] as const) {
      const teen = person(`legacy-teen-${shape === 'with none' ? 'bare' : 'ws'}`, {
        ageBand: 'teen',
        guardianAccountId: parent.accountId,
      });
      const legacy = await repo.upsertUserByEmail(teen.email, 'Old account');
      if (shape === 'with a workspace') {
        const ws = await http('POST', '/v1/workspaces', await issueSession(legacy.userId), undefined, { name: 'Old', kind: 'personal' });
        expect(ws.statusCode).toBe(201);
      }
      const live = await issueSession(legacy.userId);
      const before = (await admin.query('SELECT subject, password_hash, yourtal_linked_at FROM users WHERE id = $1', [legacy.userId])).rows[0];

      const { code } = await inviteCode();
      await expect(signIn(teen, code)).rejects.toMatchObject({ response: { error: 'teen_account_in_use' } });

      const after = (await admin.query('SELECT subject, password_hash, yourtal_linked_at FROM users WHERE id = $1', [legacy.userId])).rows[0];
      expect(after).toEqual(before);
      expect(before.subject.startsWith('dev|')).toBe(true);
      expect((await authenticateSession(live))?.user.userId).toBe(legacy.userId);
      expect(await userIdOf(teen)).toBeUndefined();
      await admin.query('DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM memberships WHERE user_id = $1)', [legacy.userId]);
      await admin.query('DELETE FROM users WHERE id = $1', [legacy.userId]);
    }
  });

  it('lets the teen finish the first of two openings of one link', async () => {
    yt.enforceTeenInvites = true;
    const teen = person('twice-teen', { ageBand: 'teen', guardianAccountId: parent.accountId });
    const { code } = await inviteCode();
    const first = await signInController.start({ client: 'web', teenInvite: code }, caller());
    await signInController.start({ client: 'web', teenInvite: code }, caller()); // opened again, never finished
    yt.nextSignIn = { person: teen };
    const redirect = await yt.authorize(first.url);
    const joined = await signInController.finish(
      {
        flowId: first.flowId,
        code: redirect.searchParams.get('code')!,
        state: redirect.searchParams.get('state')!,
        iss: redirect.searchParams.get('iss')!,
      },
      caller(),
    );
    expect(joined.outcome).toBe('created');
    expect(joined.workspaces[0]).toMatchObject({ teenSpace: 'teen' });
  });

  describe('End access when YourTal does not answer', () => {
    async function joinTeen(tag: string) {
      yt.enforceTeenInvites = true;
      const teen = person(tag, { ageBand: 'teen', guardianAccountId: parent.accountId });
      const { code } = await inviteCode();
      const joined = await signIn(teen, code);
      return { teen, token: joined.token, space: joined.workspaces[0]!.id };
    }

    it('ends here at once when YourTal is down, and the worker ends it there later', async () => {
      const { token, space } = await joinTeen('down-teen');
      const inviteId = (await admin.query('SELECT invite_id FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0].invite_id;
      yt.inviteApiDown = true;
      try {
        expect((await http('POST', `/v1/family/teens/${space}/end`, parentToken)).statusCode).toBe(200);
      } finally {
        yt.inviteApiDown = false;
      }
      expect((await http('GET', '/v1/family', token)).statusCode).toBe(401);
      expect((await admin.query('SELECT access_ended_at FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0].access_ended_at).not.toBeNull();
      expect(yt.teenInvites.get(inviteId)?.status).toBe('accepted');

      const job = (await admin.query(`SELECT id, tenant_id FROM jobs WHERE kind = 'teen_invite_end' AND payload->>'inviteId' = $1`, [inviteId])).rows;
      expect(job).toHaveLength(1);
      expect(job[0].tenant_id).toBeNull();
      expect(await runTeenEndJobs()).toContain('ended at YourTal');
      expect(yt.teenInvites.get(inviteId)?.status).toBe('ended');
      expect((await admin.query('SELECT completed_at FROM jobs WHERE id = $1', [job[0].id])).rows[0].completed_at).not.toBeNull();
      expect((await admin.query('SELECT yourtal_ended_at FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0].yourtal_ended_at).not.toBeNull();
    });

    it('still ends YourTal’s invite through the job when the request dies after the local end', async () => {
      const { space } = await joinTeen('crash-teen');
      const inviteId = (await admin.query('SELECT invite_id FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0].invite_id;
      // The request's first step, then nothing: as if it died before reaching YourTal.
      const { endTeenSpace } = await import('./teens.repo.js');
      expect(await endTeenSpace((await userIdOf(parent))!, space)).toBe(true);
      expect(yt.teenInvites.get(inviteId)?.status).toBe('accepted');

      // The parent's retry on the ended space keeps one job, not two.
      await admin.query(`DELETE FROM jobs WHERE kind = 'teen_invite_end' AND payload->>'inviteId' = $1`, [inviteId]);
      yt.inviteApiDown = true;
      try {
        expect((await http('POST', `/v1/family/teens/${space}/end`, parentToken)).statusCode).toBe(200);
        expect((await http('POST', `/v1/family/teens/${space}/end`, parentToken)).statusCode).toBe(200);
      } finally {
        yt.inviteApiDown = false;
      }
      expect(
        (await admin.query(`SELECT count(*)::int AS n FROM jobs WHERE kind = 'teen_invite_end' AND completed_at IS NULL AND payload->>'inviteId' = $1`, [inviteId]))
          .rows[0].n,
      ).toBe(1);
      await admin.query(`UPDATE jobs SET run_after = now() WHERE kind = 'teen_invite_end' AND payload->>'inviteId' = $1`, [inviteId]);
      expect(await runTeenEndJobs()).toContain('ended at YourTal');
      expect(yt.teenInvites.get(inviteId)?.status).toBe('ended');
    });

    it('treats a 404 from YourTal as already ended', async () => {
      const { space } = await joinTeen('gone-teen');
      const inviteId = (await admin.query('SELECT invite_id FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0].invite_id;
      yt.teenInvites.delete(inviteId);
      expect((await http('POST', `/v1/family/teens/${space}/end`, parentToken)).statusCode).toBe(200);
      expect((await admin.query('SELECT access_ended_at, yourtal_ended_at FROM teen_spaces WHERE tenant_id = $1', [space])).rows[0])
        .toEqual({ access_ended_at: expect.any(Date), yourtal_ended_at: expect.any(Date) });
      const calls = yt.teenInviteCalls.length;
      await runTeenEndJobs();
      expect(yt.teenInviteCalls.length).toBe(calls);
    });
  });

  it('makes a new invite when YourTal answers a replay without a code', async () => {
    const before = yt.teenInvites.size;
    yt.replayNextCreate = true;
    const { code, inviteId } = await inviteCode();
    expect(code).toBeTruthy();
    expect(yt.teenInvites.size).toBe(before + 2);
    expect(yt.teenInvites.get(inviteId)?.code).toBe(code);
  });

  it('maps YourTal’s 403 parent_not_eligible', async () => {
    parent.ageBand = 'teen'; // the fake reads the person it signed in
    try {
      const refused = await http('POST', '/v1/family/invites', parentToken, household);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: 'parent_not_eligible' });
    } finally {
      parent.ageBand = 'adult';
    }
  });

  it('maps YourTal’s 429 and refuses a non-owner', async () => {
    yt.teenInviteLimit = 0;
    const limited = await http('POST', '/v1/family/invites', parentToken, household);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'too_many_invites' });
    yt.teenInviteLimit = 100; // this file makes more invites than one parent's daily 10

    const other = person('not-owner');
    const otherToken = (await signIn(other)).token;
    expect((await http('POST', '/v1/family/invites', otherToken, household)).statusCode).toBe(403);
  });
});
