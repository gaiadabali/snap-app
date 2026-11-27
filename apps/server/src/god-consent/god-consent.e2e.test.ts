import { randomBytes } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MailMessage } from '../auth/mailer.js';
import { wipeTenant } from '../test-support/tenant.js';
import { GOD_NOTICE } from './notice.js';

/**
 * GOD GROUP CONSENT (9.1.d), end to end: real HTTP, real database, the
 * application roles. Proves what the ticket promises:
 *
 *   - sign-up is REFUSED without the tick (server side, not only the form);
 *   - an existing person who declines keeps normal use and stays out;
 *   - a version bump asks again, and a stale version cannot be answered;
 *   - withdrawal is recorded;
 *   - a teen cannot accept; the parent who invited them can, and a stranger cannot.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('GOD group consent — real HTTP, real database', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let sent: MailMessage[] = [];
  let restoreMailer: () => void;
  let settleMail: () => Promise<void>;
  const emails: string[] = [];
  const tenants: string[] = [];

  const run = randomBytes(4).toString('hex');
  let ip = 0;
  const freshIp = () => `2001:db8:${run.slice(0, 4)}:${run.slice(4)}::${(++ip).toString(16)}`;

  const call = (
    method: 'GET' | 'POST',
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ) =>
    app.inject({
      method,
      url: path,
      remoteAddress: freshIp(),
      ...(opts.body === undefined ? {} : { payload: opts.body as Record<string, unknown> }),
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    });

  async function signUp(tag: string): Promise<{ token: string; userId: string }> {
    const email = `godc-${tag}-${Date.now()}-${randomBytes(3).toString('hex')}@example.test`;
    emails.push(email);
    expect((await call('POST', '/v1/auth/magic-link/request', { body: { email } })).statusCode).toBe(200);
    await settleMail();
    const mail = [...sent].reverse().find((m) => m.to === email);
    expect(mail, `no sign-in mail to ${email}`).toBeDefined();
    const linkToken = decodeURIComponent(mail!.text.match(/token=([^\s&]+)/)![1]!);
    const opened = await call('POST', '/v1/auth/magic-link/consume', { body: { token: linkToken } });
    expect(opened.statusCode).toBe(200);
    const body = opened.json() as { token: string; user: { userId: string } };
    return { token: body.token, userId: body.user.userId };
  }

  /** A signed-up person who has also finished onboarding (so an "existing" account). */
  async function signUpAndOnboard(tag: string): Promise<{ token: string; userId: string; workspaceId: string }> {
    const who = await signUp(tag);
    const res = await call('POST', '/v1/workspaces/onboarding', {
      token: who.token,
      body: { workspaceName: `godc ${tag}`, kind: 'personal', acceptedGodNotice: true },
    });
    expect(res.statusCode).toBe(200);
    const workspaceId = res.json().workspaceId as string;
    tenants.push(workspaceId);
    return { ...who, workspaceId };
  }

  /** What an account looked like before 9.1.d: a workspace, and no answer at all. */
  async function forgetAnswer(userId: string) {
    await admin.query('DELETE FROM god_consent_status WHERE user_id = $1', [userId]);
    await admin.query('DELETE FROM god_consent_events WHERE user_id = $1', [userId]);
  }

  const state = async (token: string) => (await call('GET', '/v1/god-consent', { token })).json();
  const events = async (userId: string) =>
    (
      await admin.query(
        'select decision, notice_version, method, guardian_user_id from god_consent_events where user_id = $1 order by created_at, id',
        [userId],
      )
    ).rows;

  async function wipeOnboardedTenant(tenantId: string): Promise<void> {
    const { rows } = await admin.query<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'tenant_id'
          and table_name in (select table_name from information_schema.tables
                              where table_schema = 'public' and table_type = 'BASE TABLE')`,
    );
    for (let pass = 0; pass < 4; pass++) {
      for (const { table_name } of rows) {
        if (table_name === 'tax_codes') continue;
        await admin.query(`DELETE FROM "${table_name}" WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
      }
    }
    await wipeTenant(admin, tenantId);
  }

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);
    process.env.WEB_PUBLIC_URL ??= 'http://127.0.0.1:3000';
    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();

    const mailer = await import('../auth/mailer.js');
    restoreMailer = mailer.setMailerForTesting({
      send: async (message) => {
        sent.push(message);
      },
    });
    settleMail = (await import('../auth/account-mail.js')).settleMailForTesting;

    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await settleMail?.();
    restoreMailer?.();
    if (tenants.length) await admin.query('DELETE FROM teen_spaces WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    for (const id of tenants) await wipeOnboardedTenant(id);
    if (emails.length) await admin.query('DELETE FROM users WHERE email = ANY($1)', [emails]);
    await admin.end();
    await app?.close();
  });

  it('serves the notice with the two sentences verbatim', async () => {
    const { token } = await signUp('notice');
    const s = await state(token);
    expect(s.notice).toEqual({
      id: 'god-group-notice',
      version: '1.0',
      effective: '2026-11-27',
      url: 'https://god.gaiada.com/privacy-notice/',
      teenUrl: 'https://god.gaiada.com/privacy-notice/#teens',
      adultText:
        'I have read and accept the GOD Group Privacy Notice. I understand that my activity in YourTal, SnapApps and Free Tax Returns is combined into one profile, and that businesses receive reports about groups of people, never about me.',
      guardianText:
        "I am this teen's parent or guardian. I have read the GOD Group Privacy Notice for teens and agree that my teen's activity may be combined and used, in groups of 20 or more, to give businesses insight about young people. No business receives anything about my teen individually.",
    });
    // A brand-new sign-up: required, nothing answered.
    expect(s).toMatchObject({ status: null, prompt: 'required', teen: false, accepted: false });
  });

  describe('sign-up', () => {
    it('is refused without the tick, nothing is created, and nothing is recorded', async () => {
      const { token, userId } = await signUp('notick');
      for (const body of [
        { workspaceName: 'No tick', kind: 'personal' },
        { workspaceName: 'No tick', kind: 'personal', acceptedGodNotice: false },
      ]) {
        const res = await call('POST', '/v1/workspaces/onboarding', { token, body });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({ error: 'god_notice_required' });
      }
      expect((await call('GET', '/v1/auth/session', { token })).json().workspaces).toEqual([]);
      expect(await events(userId)).toEqual([]);
      expect(await state(token)).toMatchObject({ status: null, prompt: 'required' });
    });

    it('creating the first workspace directly is a sign-up too: refused without the tick, allowed with it', async () => {
      const { token, userId } = await signUp('direct');
      const refused = await call('POST', '/v1/workspaces', { token, body: { name: 'Direct', kind: 'personal' } });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({ error: 'god_notice_required' });
      expect(await events(userId)).toEqual([]);
      expect((await call('GET', '/v1/auth/session', { token })).json().workspaces).toEqual([]);

      const ok = await call('POST', '/v1/workspaces', {
        token,
        body: { name: 'Direct', kind: 'personal', acceptedGodNotice: true },
      });
      expect(ok.statusCode).toBe(201);
      tenants.push(ok.json().id);
      expect(await events(userId)).toEqual([
        { decision: 'accepted', notice_version: '1.0', method: 'registration', guardian_user_id: null },
      ]);
    });

    it('an existing user creating another workspace is unaffected', async () => {
      const { token, userId } = await signUpAndOnboard('another');
      await forgetAnswer(userId);
      const res = await call('POST', '/v1/workspaces', { token, body: { name: 'Second', kind: 'personal' } });
      expect(res.statusCode).toBe(201);
      tenants.push(res.json().id);
      expect(await events(userId)).toEqual([]);
    });

    it('a new sign-up cannot use "Not now": the answer is required', async () => {
      const { token, userId } = await signUp('nodecline');
      const res = await call('POST', '/v1/god-consent', { token, body: { decision: 'declined', version: GOD_NOTICE.version } });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'required' });
      expect(await events(userId)).toEqual([]);
    });

    it('with the tick, finishes and records accepted by registration', async () => {
      const { token, userId } = await signUpAndOnboard('tick');
      expect(await events(userId)).toEqual([
        { decision: 'accepted', notice_version: '1.0', method: 'registration', guardian_user_id: null },
      ]);
      expect(await state(token)).toMatchObject({
        status: { decision: 'accepted', version: '1.0', method: 'registration' },
        prompt: 'none',
        accepted: true,
      });
    });
  });

  describe('an existing account (a workspace, no answer yet)', () => {
    it('is asked, declines, keeps using the app, stays out, and is not asked again', async () => {
      const { token, userId, workspaceId } = await signUpAndOnboard('decline');
      await forgetAnswer(userId);

      expect(await state(token)).toMatchObject({ status: null, prompt: 'ask' });

      const res = await call('POST', '/v1/god-consent', { token, body: { decision: 'declined', version: '1.0' } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: { decision: 'declined', method: 'next_sign_in' }, prompt: 'none', accepted: false });
      expect(await events(userId)).toEqual([
        { decision: 'declined', notice_version: '1.0', method: 'next_sign_in', guardian_user_id: null },
      ]);

      // Normal use is untouched: the session, the workspace list and a workspace read all work.
      expect((await call('GET', '/v1/auth/session', { token })).statusCode).toBe(200);
      const list = await call('GET', '/v1/workspaces', { token });
      expect(list.statusCode).toBe(200);
      expect(list.json().map((w: { id: string }) => w.id)).toContain(workspaceId);

      // Asking again changes nothing (idempotent); the decline is not re-asked.
      await call('POST', '/v1/god-consent', { token, body: { decision: 'declined', version: '1.0' } });
      expect(await events(userId)).toHaveLength(1);
      expect(await state(token)).toMatchObject({ prompt: 'none' });
    });

    it('accepts at next sign-in', async () => {
      const { token, userId } = await signUpAndOnboard('accept-later');
      await forgetAnswer(userId);
      const res = await call('POST', '/v1/god-consent', { token, body: { decision: 'accepted', version: '1.0' } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: { decision: 'accepted', method: 'next_sign_in' }, accepted: true, prompt: 'none' });
    });

    it('is asked again when the version changes, and a stale version cannot be answered', async () => {
      const { token, userId } = await signUpAndOnboard('bump');
      await forgetAnswer(userId);
      // An answer given to an OLDER notice (0.9, as if 1.0 were the bump).
      const ev = await admin.query(
        `insert into god_consent_events (user_id, notice_version, decision, method) values ($1, '0.9', 'declined', 'next_sign_in') returning id, created_at`,
        [userId],
      );
      await admin.query(
        `insert into god_consent_status (user_id, notice_version, decision, method, decided_at, event_id)
         values ($1, '0.9', 'declined', 'next_sign_in', $2, $3)`,
        [userId, ev.rows[0].created_at, ev.rows[0].id],
      );
      expect(await state(token)).toMatchObject({ status: { decision: 'declined', version: '0.9' }, prompt: 'ask' });

      const stale = await call('POST', '/v1/god-consent', { token, body: { decision: 'accepted', version: '0.9' } });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ error: 'version_changed' });

      const ok = await call('POST', '/v1/god-consent', { token, body: { decision: 'accepted', version: '1.0' } });
      expect(ok.statusCode).toBe(200);
      expect((await events(userId)).map((e) => `${e.decision}@${e.notice_version}`)).toEqual(['declined@0.9', 'accepted@1.0']);
    });

    it('cannot decline after accepting: withdrawing is the way', async () => {
      const { token } = await signUpAndOnboard('no-flip');
      const res = await call('POST', '/v1/god-consent', { token, body: { decision: 'declined', version: '1.0' } });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'already_accepted' });
    });
  });

  describe('withdrawal', () => {
    it('records withdrawn, changes nothing else, and a repeat records nothing', async () => {
      const { token, userId, workspaceId } = await signUpAndOnboard('withdraw');
      const first = await call('POST', '/v1/god-consent/withdraw', { token });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        withdrawn: true,
        state: { status: { decision: 'withdrawn' }, accepted: false, prompt: 'none' },
      });
      const again = await call('POST', '/v1/god-consent/withdraw', { token });
      expect(again.json()).toMatchObject({ withdrawn: false });
      expect((await events(userId)).map((e) => `${e.decision}/${e.method}`)).toEqual(['accepted/registration', 'withdrawn/request']);
      // The account and workspace are untouched.
      expect((await call('GET', '/v1/workspaces', { token })).json().map((w: { id: string }) => w.id)).toContain(workspaceId);
    });

    it('has nothing to withdraw for someone who never accepted', async () => {
      const { token, userId } = await signUpAndOnboard('withdraw-none');
      await forgetAnswer(userId);
      const res = await call('POST', '/v1/god-consent/withdraw', { token });
      expect(res.json()).toMatchObject({ withdrawn: false });
      expect(await events(userId)).toEqual([]);
    });

    it('needs a signed-in person', async () => {
      expect((await call('POST', '/v1/god-consent/withdraw')).statusCode).toBe(401);
      expect((await call('GET', '/v1/god-consent')).statusCode).toBe(401);
    });
  });

  describe('teens: the parent answers, never the teen', () => {
    async function teenAndParent(tag: string) {
      const parent = await signUpAndOnboard(`${tag}-parent`);
      const teen = await signUpAndOnboard(`${tag}-teen`);
      // The teen's own workspace is their teen space; the parent invited them (0045 shape).
      await admin.query(
        `insert into teen_spaces (tenant_id, teen_user_id, parent_user_id, invite_id) values ($1, $2, $3, gen_random_uuid())`,
        [teen.workspaceId, teen.userId, parent.userId],
      );
      return { parent, teen };
    }

    it('a teen is never asked and cannot accept for themselves', async () => {
      const { teen } = await teenAndParent('t1');
      await forgetAnswer(teen.userId);
      expect(await state(teen.token)).toMatchObject({ teen: true, prompt: 'none', status: null });
      const res = await call('POST', '/v1/god-consent', { token: teen.token, body: { decision: 'accepted', version: '1.0' } });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'teen_parent_accepts' });
      expect(await events(teen.userId)).toEqual([]);
    });

    it('the parent accepts for the teen (guardian, naming the parent) and can withdraw', async () => {
      const { parent, teen } = await teenAndParent('t2');
      await forgetAnswer(teen.userId);

      const before = await call('GET', '/v1/family', { token: parent.token });
      expect(before.json().teens[0]).toMatchObject({ workspaceId: teen.workspaceId, godConsent: { accepted: false, version: null } });

      const ok = await call('POST', `/v1/family/teens/${teen.workspaceId}/god-consent`, {
        token: parent.token,
        body: { decision: 'accepted', version: '1.0' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ accepted: true, version: '1.0' });
      expect(await events(teen.userId)).toEqual([
        { decision: 'accepted', notice_version: '1.0', method: 'guardian', guardian_user_id: parent.userId },
      ]);
      expect((await call('GET', '/v1/family', { token: parent.token })).json().teens[0].godConsent).toEqual({
        accepted: true,
        version: '1.0',
      });

      const out = await call('POST', `/v1/family/teens/${teen.workspaceId}/god-consent`, {
        token: parent.token,
        body: { decision: 'withdrawn', version: '1.0' },
      });
      expect(out.json()).toEqual({ accepted: false, version: null });
      expect((await events(teen.userId)).map((e) => e.decision)).toEqual(['accepted', 'withdrawn']);
    });

    it('a stranger gets 404, and a stale version gets 409', async () => {
      const { parent, teen } = await teenAndParent('t3');
      const stranger = await signUpAndOnboard('t3-stranger');
      const refused = await call('POST', `/v1/family/teens/${teen.workspaceId}/god-consent`, {
        token: stranger.token,
        body: { decision: 'accepted', version: '1.0' },
      });
      expect(refused.statusCode).toBe(404);
      const stale = await call('POST', `/v1/family/teens/${teen.workspaceId}/god-consent`, {
        token: parent.token,
        body: { decision: 'accepted', version: '0.9' },
      });
      expect(stale.statusCode).toBe(409);
      expect((await events(teen.userId)).filter((e) => e.method === 'guardian')).toEqual([]);
    });
  });
});
