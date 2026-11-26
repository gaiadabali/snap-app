import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ForbiddenException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startFakeYourTalOidc, type FakeYourTalOidc } from '../test-support/fake-yourtal-oidc.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { DevicesController, MailController } from './mail.controller.js';

/**
 * Spambank mail, SnapApp's bridge (spambank/BUILD.md §5.6, ticket T11), end to
 * end: the real AppModule over HTTP, as the application role (so RLS is what is
 * being tested), a real Postgres, and the stand-in YourTal behind a real
 * client-credentials token.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const run = randomUUID().slice(0, 8);
const W_OWN = 'b8110000-0000-4000-8000-000000000001'; // LINKED owns it
const W_OTHER = 'b8110000-0000-4000-8000-000000000002'; // PLAIN owns it; LINKED is only a member
const LINKED = 'b8110000-0000-4000-8000-0000000000a1'; // signed in with YourTal
const PLAIN = 'b8110000-0000-4000-8000-0000000000a2'; // did not
const TEEN = 'b8110000-0000-4000-8000-0000000000a3'; // YourTal refuses (not_allowed)
const SUB = { linked: `mail-linked-${run}`, teen: `mail-teen-${run}` };

const PHONE_A = 'fcm-phone-a-0123456789abcdefghij:APA91b';
const PHONE_B = 'fcm-phone-b-0123456789abcdefghij:APA91b';

describeIfDb('Spambank mail bridge (T11)', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let yt: FakeYourTalOidc;
  let keyDir: string;
  let token: (userId: string) => string;

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    as: string | null,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      headers: {
        ...(as ? { authorization: `Bearer ${token(as)}` } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });

  const pushTokens = async (userId: string) =>
    (await admin.query<{ token: string }>('select token from push_tokens where user_id = $1 order by token', [userId])).rows.map(
      (r) => r.token,
    );
  const settingsRow = async (userId: string) =>
    (await admin.query<{ import_tenant_id: string | null; alerts: boolean }>('select import_tenant_id, alerts from mail_settings where user_id = $1', [userId]))
      .rows[0];

  beforeAll(async () => {
    yt = await startFakeYourTalOidc();
    keyDir = mkdtempSync(join(tmpdir(), 'snap-mail-e2e-'));
    const keyFile = join(keyDir, 'yourtal-oidc-web.jwk');
    writeFileSync(keyFile, JSON.stringify(yt.webPrivateJwk), { mode: 0o600 });
    process.env.YOURTAL_OIDC_ISSUER = yt.issuer;
    process.env.YOURTAL_OIDC_KEY_FILE = keyFile;
    process.env.YOURTAL_OIDC_SERVER_CLIENT_ID = yt.serverClientId;
    process.env.YOURTAL_API_URL = yt.issuer.replace(/\/oidc$/, '');
    delete process.env.SPAMBANK_ENABLED;

    yt.spambank.addPerson(SUB.linked);
    yt.spambank.addPerson(SUB.teen, { refusal: 'not_allowed' });

    admin = await provisionTenant({
      tenantId: W_OWN,
      name: 'Mail own',
      users: [
        { id: LINKED, role: 'owner', subject: `yourtal|${SUB.linked}`, email: `linked-${run}@mail-e2e.test` },
        { id: TEEN, role: 'member', subject: `yourtal|${SUB.teen}`, email: `teen-${run}@mail-e2e.test` },
      ],
    });
    (
      await provisionTenant({
        tenantId: W_OTHER,
        name: 'Mail other',
        users: [{ id: PLAIN, role: 'owner', subject: `pwd|plain-${run}`, email: `plain-${run}@mail-e2e.test` }],
      })
    ).end();
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'member')`, [W_OTHER, LINKED]);
    await admin.query(`delete from rate_limits where bucket_key like 'mail-%'`);

    // A YourTal-linked account can only hold a session its own door opened (0039); the other account uses the ordinary one.
    const { issueSession, issueYourTalSession } = await import('../auth/sessions.js');
    const tokens = new Map([
      [LINKED, await issueYourTalSession(LINKED)],
      [TEEN, await issueYourTalSession(TEEN)],
      [PLAIN, await issueSession(PLAIN)],
    ]);
    token = (userId) => tokens.get(userId)!;

    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    app.useGlobalFilters(new (await import('../common/errors.filter.js')).ErrorsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    if (admin) {
      await admin.query(`delete from rate_limits where bucket_key like 'mail-%'`);
      await admin.query('delete from push_tokens where user_id = any($1)', [[LINKED, PLAIN, TEEN]]);
      await admin.query('delete from mail_settings where user_id = any($1)', [[LINKED, PLAIN, TEEN]]);
      await wipeTenant(admin, W_OWN, [LINKED, TEEN]);
      await wipeTenant(admin, W_OTHER, [PLAIN]);
      await admin.end();
    }
    const { closeDb } = await import('../db.js');
    await closeDb();
    await yt?.close();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
    for (const name of ['YOURTAL_OIDC_ISSUER', 'YOURTAL_OIDC_KEY_FILE', 'YOURTAL_OIDC_SERVER_CLIENT_ID', 'YOURTAL_API_URL']) {
      delete process.env[name];
    }
  });

  describe('who may call', () => {
    it('needs a signed-in session on every route', async () => {
      for (const [method, url] of [
        ['GET', '/v1/mail/status'],
        ['POST', '/v1/mail/enable'],
        ['POST', '/v1/mail/session'],
        ['PATCH', '/v1/mail/settings'],
        ['GET', '/v1/mail/app-passwords'],
        ['POST', '/v1/mail/app-passwords'],
        ['DELETE', '/v1/mail/app-passwords/abc'],
        ['POST', '/v1/devices/push-token'],
        ['DELETE', '/v1/devices/push-token'],
      ] as const) {
        const res = await call(method, url, null, method === 'GET' || url.endsWith('/abc') ? undefined : {});
        expect({ url, status: res.statusCode }).toEqual({ url, status: 401 });
      }
    });

    it("takes the person's OWN session on every handler, so staff acting as a user are refused", () => {
      // @CurrentSession throws 403 when there is no session on the request, which is what impersonation looks like
      // (auth.guard.ts). Run every parameter decorator of every handler against such a request: one must refuse.
      const refuses = (controller: object, handler: string): boolean => {
        const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler) as
          | Record<string, { factory?: (data: unknown, ctx: unknown) => unknown; data?: unknown }>
          | undefined;
        const context = {
          switchToHttp: () => ({ getRequest: () => ({ authUser: { userId: LINKED }, headers: {} }) }),
        };
        return Object.values(meta ?? {}).some((arg) => {
          try {
            arg.factory?.(arg.data, context);
            return false;
          } catch (error) {
            return error instanceof ForbiddenException;
          }
        });
      };
      for (const handler of ['status', 'enable', 'session', 'updateSettings', 'listAppPasswords', 'createAppPassword', 'revokeAppPassword']) {
        expect({ handler, refuses: refuses(MailController, handler) }).toEqual({ handler, refuses: true });
      }
      for (const handler of ['register', 'unregister']) {
        expect({ handler, refuses: refuses(DevicesController, handler) }).toEqual({ handler, refuses: true });
      }
    });
  });

  describe('an account that did not sign in with YourTal', () => {
    it('is reported as not linked, with no mailbox, and the settings defaults', async () => {
      const res = await call('GET', '/v1/mail/status', PLAIN);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        available: true,
        linked: false,
        mailbox: null,
        settings: { statements: false, workspaceId: null, alerts: true },
      });
    });

    it.each([
      ['POST', '/v1/mail/enable', undefined],
      ['POST', '/v1/mail/session', undefined],
      ['PATCH', '/v1/mail/settings', { alerts: false }],
      ['GET', '/v1/mail/app-passwords', undefined],
      ['POST', '/v1/mail/app-passwords', { name: 'Phone' }],
      ['DELETE', '/v1/mail/app-passwords/abc123', undefined],
    ] as const)('refuses %s %s with 409 yourtal_not_linked, without calling YourTal', async (method, url, payload) => {
      const before = yt.spambank.calls.length;
      const res = await call(method, url, PLAIN, payload);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'yourtal_not_linked' });
      expect(yt.spambank.calls.length).toBe(before);
    });
  });

  describe('a YourTal-linked account', () => {
    let address: string;

    it('starts with no mailbox', async () => {
      const res = await call('GET', '/v1/mail/status', LINKED);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        available: true,
        linked: true,
        mailbox: { state: 'off' },
        settings: { statements: false, workspaceId: null, alerts: true },
      });
    });

    it('cannot get a session before switching on', async () => {
      const res = await call('POST', '/v1/mail/session', LINKED);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'not_enabled' });
    });

    it('switches the mailbox on: 201 the first time, 200 after, the same address, and the status agrees', async () => {
      const first = await call('POST', '/v1/mail/enable', LINKED);
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ state: 'on', created: true });
      address = first.json().address;
      expect(address).toMatch(/@yourtal\.test$/);

      const second = await call('POST', '/v1/mail/enable', LINKED);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ state: 'on', address, created: false });

      const status = (await call('GET', '/v1/mail/status', LINKED)).json();
      expect(status.mailbox).toMatchObject({ state: 'on', address, quota: { limitBytes: 2147483648 } });
      // The person is named by their YourTal sub, read from their own session; the request named no one.
      expect(yt.spambank.bodies.every((b) => b.sub === SUB.linked)).toBe(true);
    });

    it('mints a session of exactly the contract\'s five fields, never cached', async () => {
      const res = await call('POST', '/v1/mail/session', LINKED);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      const body = res.json();
      expect(Object.keys(body).sort()).toEqual(['address', 'expiresAt', 'helpersBase', 'sessionUrl', 'token']);
      expect(body.address).toBe(address);
      expect(body.token.startsWith('sbm1.')).toBe(true);
    });

    it('answers a YourTal body that is not the shape promised as 502 yourtal_rejected', async () => {
      yt.spambank.malformedSession = true;
      try {
        const res = await call('POST', '/v1/mail/session', LINKED);
        expect(res.statusCode).toBe(502);
        expect(res.json()).toMatchObject({ error: 'yourtal_rejected' });
        expect(res.body).not.toContain('sbm1.');
      } finally {
        yt.spambank.malformedSession = false;
      }
    });

    it('says YourTal being down is 503, and its mail server being down is a different 503', async () => {
      yt.spambank.down = 'yourtal';
      expect((await call('GET', '/v1/mail/status', LINKED)).json()).toMatchObject({ error: 'yourtal_unavailable' });
      yt.spambank.down = 'spambank';
      const res = await call('POST', '/v1/mail/session', LINKED);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: 'spambank_unavailable' });
      yt.spambank.down = null;
    });
  });

  describe('settings', () => {
    it('refuses a workspace the person is only a member of, and one they do not belong to', async () => {
      for (const workspaceId of [W_OTHER, randomUUID()]) {
        const res = await call('PATCH', '/v1/mail/settings', LINKED, { workspaceId });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ error: 'not_workspace_admin' });
      }
      expect(await settingsRow(LINKED)).toBeUndefined();
    });

    it('turns statements on with no workspace chosen: the first workspace they own is picked, here and at YourTal', async () => {
      const res = await call('PATCH', '/v1/mail/settings', LINKED, { statements: true });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ statements: true, workspaceId: W_OWN, alerts: true });
      expect(await settingsRow(LINKED)).toEqual({ import_tenant_id: W_OWN, alerts: true });
      expect(yt.spambank.people.get(SUB.linked)?.statementsToSnapApp).toBe(true);
    });

    it('turns alerts off in both places, and keeps the other settings', async () => {
      const res = await call('PATCH', '/v1/mail/settings', LINKED, { alerts: false });
      expect(res.json()).toEqual({ statements: true, workspaceId: W_OWN, alerts: false });
      expect(await settingsRow(LINKED)).toEqual({ import_tenant_id: W_OWN, alerts: false });
      expect(yt.spambank.people.get(SUB.linked)?.newMailAlerts).toBe(false);

      const status = (await call('GET', '/v1/mail/status', LINKED)).json();
      expect(status.settings).toEqual({ statements: true, workspaceId: W_OWN, alerts: false });
    });

    it('clears the workspace with null, and leaves a refused YourTal change unsaved', async () => {
      const cleared = await call('PATCH', '/v1/mail/settings', LINKED, { workspaceId: null, statements: false });
      expect(cleared.json()).toMatchObject({ statements: false, workspaceId: null });
      expect(await settingsRow(LINKED)).toMatchObject({ import_tenant_id: null });

      yt.spambank.down = 'yourtal';
      const refused = await call('PATCH', '/v1/mail/settings', LINKED, { alerts: true });
      yt.spambank.down = null;
      expect(refused.statusCode).toBe(503);
      expect(await settingsRow(LINKED)).toMatchObject({ alerts: false });
    });

    it('refuses a body with an unknown field or a bad value', async () => {
      for (const body of [{ statements: 'yes' }, { workspaceId: 'not-a-uuid' }, { alerts: 1 }, { admin: true }]) {
        expect({ body, status: (await call('PATCH', '/v1/mail/settings', LINKED, body)).statusCode }).toEqual({ body, status: 400 });
      }
    });
  });

  describe('app passwords', () => {
    let id: string;

    it('creates one, shows the secret once with the phone settings, never cached', async () => {
      const res = await call('POST', '/v1/mail/app-passwords', LINKED, { name: '  Pixel mail  ' });
      expect(res.statusCode).toBe(201);
      expect(res.headers['cache-control']).toBe('private, no-store');
      const body = res.json();
      expect(body).toMatchObject({
        name: 'Pixel mail',
        imap: { port: 993, security: 'ssl' },
        smtp: { port: 465, security: 'ssl' },
      });
      expect(body.secret.startsWith('app_')).toBe(true);
      id = body.id;
    });

    it('lists it without the secret', async () => {
      const res = await call('GET', '/v1/mail/app-passwords', LINKED);
      expect(res.statusCode).toBe(200);
      expect(res.json().items.map((i: { name: string }) => i.name)).toEqual(['Pixel mail']);
      expect(res.body).not.toContain('app_');
    });

    it('refuses a blank or too long name', async () => {
      for (const name of ['', '   ', 'x'.repeat(41), 7]) {
        expect((await call('POST', '/v1/mail/app-passwords', LINKED, { name })).statusCode).toBe(400);
      }
    });

    it('revokes it with 204, and refuses an id that is not an id before asking YourTal', async () => {
      const before = yt.spambank.calls.length;
      expect((await call('DELETE', `/v1/mail/app-passwords/${'a'.repeat(65)}`, LINKED)).statusCode).toBe(400);
      expect(yt.spambank.calls.length).toBe(before);

      expect((await call('DELETE', `/v1/mail/app-passwords/${id}`, LINKED)).statusCode).toBe(204);
      expect((await call('GET', '/v1/mail/app-passwords', LINKED)).json().items).toEqual([]);
    });
  });

  describe('an account YourTal will not serve (a teen, suspended, or consent ended)', () => {
    it('shows state not_allowed in the status, and refuses the rest with 403 not_allowed', async () => {
      const status = await call('GET', '/v1/mail/status', TEEN);
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ available: true, linked: true, mailbox: { state: 'not_allowed' } });

      for (const [method, url] of [
        ['POST', '/v1/mail/enable'],
        ['POST', '/v1/mail/session'],
      ] as const) {
        const res = await call(method, url, TEEN);
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ error: 'not_allowed' });
      }
    });
  });

  describe('push tokens', () => {
    it('registers a phone, and the same phone again without a second row', async () => {
      expect((await call('POST', '/v1/devices/push-token', LINKED, { token: PHONE_A, platform: 'android' })).statusCode).toBe(204);
      expect((await call('POST', '/v1/devices/push-token', LINKED, { token: PHONE_A, platform: 'android' })).statusCode).toBe(204);
      expect(await pushTokens(LINKED)).toEqual([PHONE_A]);
    });

    it('works for an account with no YourTal sign-in: a token is a device fact', async () => {
      expect((await call('POST', '/v1/devices/push-token', PLAIN, { token: PHONE_B, platform: 'android' })).statusCode).toBe(204);
      expect(await pushTokens(PLAIN)).toEqual([PHONE_B]);
    });

    it('moves a phone to the next account that signs in on it', async () => {
      expect((await call('POST', '/v1/devices/push-token', PLAIN, { token: PHONE_A, platform: 'android' })).statusCode).toBe(204);
      expect(await pushTokens(PLAIN)).toEqual([PHONE_A, PHONE_B]);
      expect(await pushTokens(LINKED)).toEqual([]);
    });

    it('forgets only the caller\'s own token, and forgetting one that is not there is not an error', async () => {
      // LINKED does not hold PHONE_A any more: nothing of PLAIN's is touched.
      expect((await call('DELETE', '/v1/devices/push-token', LINKED, { token: PHONE_A })).statusCode).toBe(204);
      expect(await pushTokens(PLAIN)).toEqual([PHONE_A, PHONE_B]);

      expect((await call('DELETE', '/v1/devices/push-token', PLAIN, { token: PHONE_A })).statusCode).toBe(204);
      expect(await pushTokens(PLAIN)).toEqual([PHONE_B]);
    });

    it('refuses a token that is too short or has odd characters, and any platform but android', async () => {
      for (const body of [
        { token: 'short', platform: 'android' },
        { token: `${PHONE_A} with spaces`, platform: 'android' },
        { token: PHONE_A, platform: 'ios' },
        { token: PHONE_A },
        { platform: 'android' },
      ]) {
        expect({ body, status: (await call('POST', '/v1/devices/push-token', LINKED, body)).statusCode }).toEqual({ body, status: 400 });
      }
      expect((await call('DELETE', '/v1/devices/push-token', LINKED, { token: 'short' })).statusCode).toBe(400);
    });
  });
});
