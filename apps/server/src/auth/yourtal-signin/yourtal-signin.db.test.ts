import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startFakeYourTalOidc, type FakePerson, type FakeYourTalOidc } from '../../test-support/fake-yourtal-oidc.js';
import type { MailMessage } from '../mailer.js';

/**
 * Sign in with YourTal, end to end (group task 3.3.a), against a REAL
 * Postgres and a REAL `oidc-provider` standing in for YourTal.
 *
 * Every step is the production path: the controller builds the authorization
 * URL with openid-client, the stand-in provider runs its sign-in, PKCE,
 * pairwise subject and code issuance, the controller redeems the code (as the
 * website with private_key_jwt, or as the public phone client), verifies the
 * ID token and links or creates the account through 0039's SECURITY DEFINER
 * function, as the unprivileged application role.
 *
 * Linking is where a mistake lets one person into another's account, so most
 * of these are refusals.
 *
 * Skipped without DATABASE_URL, like the other DB suites; CI sets REQUIRE_DB=1.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

type Controller = InstanceType<typeof import('./yourtal-signin.controller.js').YourTalSignInController>;
type AuthControllerT = InstanceType<typeof import('../auth.controller.js').AuthController>;

describeIfDb('Sign in with YourTal — real database, real provider', () => {
  let yt: FakeYourTalOidc;
  let controller: Controller;
  let auth: AuthControllerT;
  let admin: Client;
  let keyDir: string;
  let app: NestFastifyApplication;
  const sent: MailMessage[] = [];
  let restoreMailer: () => void;
  let settleMail: () => Promise<void>;
  const emails: string[] = [];
  const subs: string[] = [];

  /** Each call its own caller address, so the per-IP limits never couple tests. */
  const caller = () => ({ ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

  const freshEmail = (tag: string) => {
    const email = `yt-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    emails.push(email);
    return email;
  };

  const person = (tag: string, extra: Partial<FakePerson> = {}): FakePerson => {
    const p: FakePerson = {
      accountId: randomUUID(),
      email: freshEmail(tag),
      name: `Person ${tag}`,
      region: 'AU',
      ageBand: 'adult',
      ...extra,
    };
    subs.push(yt.subFor(p.accountId));
    return p;
  };

  /** Start, sign in at the stand-in YourTal, and return what the callback would hand to finish. */
  async function authorize(
    who: FakePerson,
    options: { client?: 'web' | 'mobile'; amr?: string[]; returnTo?: string; signUp?: boolean } = {},
  ) {
    const started = await controller.start(
      { client: options.client ?? 'web', returnTo: options.returnTo, signUp: options.signUp },
      caller(),
    );
    yt.nextSignIn = { person: who, amr: options.amr };
    const redirect = await yt.authorize(started.url);
    const code = redirect.searchParams.get('code');
    const state = redirect.searchParams.get('state');
    const iss = redirect.searchParams.get('iss');
    if (!code || !state || !iss) throw new Error(`no code in redirect: ${redirect.search}`);
    return { flowId: started.flowId, code, state, iss, redirect };
  }

  async function signIn(who: FakePerson, options: Parameters<typeof authorize>[1] = {}) {
    return controller.finish(await authorize(who, options), caller());
  }

  async function userRow(userId: string) {
    const { rows } = await admin.query(
      'SELECT id, subject, email::text AS email, display_name, email_verified_at, password_hash FROM users WHERE id = $1',
      [userId],
    );
    return rows[0];
  }

  beforeAll(async () => {
    yt = await startFakeYourTalOidc();
    keyDir = mkdtempSync(join(tmpdir(), 'snap-yt-oidc-'));
    const keyFile = join(keyDir, 'yourtal-oidc-web.jwk');
    writeFileSync(keyFile, JSON.stringify(yt.webPrivateJwk), { mode: 0o600 });

    process.env.YOURTAL_OIDC_ISSUER = yt.issuer;
    process.env.YOURTAL_OIDC_WEB_CLIENT_ID = yt.webClientId;
    process.env.YOURTAL_OIDC_MOBILE_CLIENT_ID = yt.mobileClientId;
    process.env.YOURTAL_OIDC_WEB_REDIRECT_URI = yt.webRedirectUri;
    process.env.YOURTAL_OIDC_KEY_FILE = keyFile;

    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();

    controller = new (await import('./yourtal-signin.controller.js')).YourTalSignInController();
    auth = new (await import('../auth.controller.js')).AuthController();

    restoreMailer = (await import('../mailer.js')).setMailerForTesting({
      send: async (message) => {
        sent.push(message);
      },
    });
    settleMail = (await import('../account-mail.js')).settleMailForTesting;

    const { AppModule } = await import('../../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (subs.length) {
      await admin.query('DELETE FROM yourtal_sign_in_reviews WHERE yourtal_sub = ANY($1)', [subs]);
    }
    if (emails.length) {
      await admin.query('DELETE FROM platform_staff WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))', [emails]);
      await admin.query('DELETE FROM users WHERE email = ANY($1) OR subject = ANY($2)', [
        emails,
        subs.map((s) => `yourtal|${s}`),
      ]);
    }
    await admin?.end();
    await app?.close();
    restoreMailer?.();
    await yt?.close();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    yt.nextSignIn = null;
  });

  it('reports both clients as available', () => {
    expect(controller.status()).toEqual({ web: true, mobile: true });
  });

  it('builds the authorization request docs/26 asks for', async () => {
    const who = person('request');
    const started = await controller.start({ client: 'web', signUp: true, locale: 'id-ID' }, caller());
    const params = new URL(started.url).searchParams;
    expect(new URL(started.url).href.startsWith(`${yt.issuer}/auth?`)).toBe(true);
    expect(params.get('client_id')).toBe(yt.webClientId);
    expect(params.get('redirect_uri')).toBe(yt.webRedirectUri);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('openid email profile account');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('state')).toBeTruthy();
    expect(params.get('nonce')).toBeTruthy();
    expect(params.get('prompt')).toBe('create');
    expect(params.get('ui_locales')).toBe('id-ID');
    // The verifier never leaves the server.
    expect(started.url).not.toMatch(/code_verifier/);

    // And the provider accepts it (prompt=create included) and completes.
    yt.nextSignIn = { person: who };
    const redirect = await yt.authorize(started.url);
    expect(redirect.searchParams.get('iss')).toBe(yt.issuer);
    expect(redirect.searchParams.get('code')).toBeTruthy();
  });

  it('creates a new account, keyed on the sub, and opens a working session', async () => {
    const who = person('new');
    const result = await signIn(who, { returnTo: '/app/receipts?x=1' });

    expect(result.outcome).toBe('created');
    expect(result.user.email).toBe(who.email);
    expect(result.user.displayName).toBe('Person new');
    expect(result.user.emailVerified).toBe(true);
    expect(result.returnTo).toBe('/app/receipts?x=1');
    expect(result.workspaces).toEqual([]);

    const row = await userRow(result.user.userId);
    expect(row.subject).toBe(`yourtal|${yt.subFor(who.accountId)}`);

    const { authenticateSession } = await import('../sessions.js');
    const session = await authenticateSession(result.token);
    expect(session?.user.userId).toBe(result.user.userId);

    // Signing in again is the same account, found by sub.
    const again = await signIn(who);
    expect(again.outcome).toBe('signed_in');
    expect(again.user.userId).toBe(result.user.userId);
  });

  it('links an existing verified-email account ONCE, then keys on the sub', async () => {
    const repo = await import('../../repo.js');
    const who = person('legacy');
    const legacy = await repo.upsertUserByEmail(who.email, 'Legacy Name'); // subject dev|<email>
    await admin.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [legacy.userId]);

    const first = await signIn(who);
    expect(first.outcome).toBe('linked');
    expect(first.user.userId).toBe(legacy.userId);
    expect(first.user.displayName).toBe('Person legacy'); // YourTal's name wins

    const row = await userRow(legacy.userId);
    expect(row.subject).toBe(`yourtal|${yt.subFor(who.accountId)}`);

    const second = await signIn(who);
    expect(second.outcome).toBe('signed_in');
    expect(second.user.userId).toBe(legacy.userId);
  });

  it('links a password account too, and its password and SnapApp doors then refuse it', async () => {
    const who = person('pwd');
    const registered = await auth.register({ email: who.email, password: 'a-decent-password' }, caller());
    await admin.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [registered.user.userId]);
    expect((await userRow(registered.user.userId)).subject).toBe(`pwd|${who.email}`);

    const linked = await signIn(who);
    expect(linked.outcome).toBe('linked');
    expect(linked.user.userId).toBe(registered.user.userId);

    // Password: the right password is now refused, pointing to YourTal.
    await expect(
      auth.passwordSignIn({ email: who.email, password: 'a-decent-password' }, caller()),
    ).rejects.toMatchObject({ status: 403, response: { error: 'use_yourtal' } });

    // Magic link: a genuine, unused link is refused too.
    const { issueMagicLinkToken } = await import('../../tokens.js');
    await expect(
      auth.consumeMagicLink({ token: issueMagicLinkToken(who.email).token }),
    ).rejects.toMatchObject({ status: 403, response: { error: 'use_yourtal' } });

    // The development email sign-in (the demo door) as well.
    await expect(auth.signIn({ email: who.email })).rejects.toMatchObject({ status: 403 });

    // And YourTal still works.
    expect((await signIn(who)).user.userId).toBe(registered.user.userId);
  });

  it('a password account NOT yet linked keeps working', async () => {
    const email = freshEmail('unlinked');
    await auth.register({ email, password: 'a-decent-password' }, caller());
    const ok = await auth.passwordSignIn({ email, password: 'a-decent-password' }, caller());
    expect(ok.user.email).toBe(email);
  });

  it('linking an account whose address was never proven clears its password and ends its sessions', async () => {
    // Pre-hijacking: someone registered this address with their own password
    // and holds a session. The owner arrives through YourTal.
    const who = person('hijack');
    const squatter = await auth.register({ email: who.email, password: 'squatters-password' }, caller());
    expect((await userRow(squatter.user.userId)).email_verified_at).toBeNull();

    const linked = await signIn(who);
    expect(linked.outcome).toBe('linked');

    const row = await userRow(squatter.user.userId);
    expect(row.password_hash).toBeNull();
    expect(row.email_verified_at).not.toBeNull();
    const { authenticateSession } = await import('../sessions.js');
    expect(await authenticateSession(squatter.token)).toBeNull();
    expect((await authenticateSession(linked.token))?.user.userId).toBe(squatter.user.userId);
  });

  it('REFUSES a second sub for the email of a linked account, and lists it for review', async () => {
    const owner = person('owner');
    const first = await signIn(owner);
    expect(first.outcome).toBe('created');

    // A different YourTal account presenting the same address.
    const intruder = person('intruder', { email: owner.email });
    await expect(signIn(intruder)).rejects.toMatchObject({ status: 409, response: { error: 'account_review' } });

    const { rows } = await admin.query(
      'SELECT kind, user_id, attempts FROM yourtal_sign_in_reviews WHERE yourtal_sub = $1 AND resolved_at IS NULL',
      [yt.subFor(intruder.accountId)],
    );
    expect(rows).toEqual([{ kind: 'second_sub', user_id: first.user.userId, attempts: 1 }]);

    // Trying again does not link, and bumps the one open case.
    await expect(signIn(intruder)).rejects.toMatchObject({ status: 409 });
    const again = await admin.query('SELECT attempts FROM yourtal_sign_in_reviews WHERE yourtal_sub = $1', [
      yt.subFor(intruder.accountId),
    ]);
    expect(again.rows).toEqual([{ attempts: 2 }]);

    // The owner's account is untouched and still theirs.
    expect((await userRow(first.user.userId)).subject).toBe(`yourtal|${yt.subFor(owner.accountId)}`);
    expect((await signIn(owner)).user.userId).toBe(first.user.userId);
  });

  it('never links an account whose subject is not a legacy format it knows', async () => {
    const who = person('foreign');
    const id = randomUUID();
    await admin.query(
      `INSERT INTO users (id, subject, email, display_name, email_verified_at) VALUES ($1, $2, $3, 'Foreign', now())`,
      [id, `idp|${randomUUID()}`, who.email],
    );
    await expect(signIn(who)).rejects.toMatchObject({ status: 409, response: { error: 'account_review' } });
    expect((await userRow(id)).subject).toMatch(/^idp\|/);
    const { rows } = await admin.query('SELECT kind FROM yourtal_sign_in_reviews WHERE yourtal_sub = $1', [
      yt.subFor(who.accountId),
    ]);
    expect(rows).toEqual([{ kind: 'unlinkable_account' }]);
  });

  it('refreshes the email copy, but keeps the old one and flags it when another account holds the new one', async () => {
    const repo = await import('../../repo.js');
    const who = person('mover');
    const first = await signIn(who);

    // YourTal now says a new address nobody here has: the copy follows.
    const fresh = freshEmail('moved');
    who.email = fresh;
    const moved = await signIn(who);
    expect(moved.user.userId).toBe(first.user.userId);
    expect(moved.user.email).toBe(fresh);

    // Then an address another SnapApp account holds: the copy stays.
    const taken = freshEmail('taken');
    const other = await repo.upsertUserByEmail(taken, 'Someone Else');
    who.email = taken;
    const kept = await signIn(who);
    expect(kept.user.userId).toBe(first.user.userId);
    expect(kept.user.email).toBe(fresh);
    expect((await userRow(other.userId)).email).toBe(taken);
    const { rows } = await admin.query(
      'SELECT kind, user_id, other_user_id FROM yourtal_sign_in_reviews WHERE yourtal_sub = $1',
      [yt.subFor(who.accountId)],
    );
    expect(rows).toEqual([{ kind: 'email_collision', user_id: first.user.userId, other_user_id: other.userId }]);
  });

  it('refuses a wrong state, and the flow is then spent', async () => {
    const who = person('state');
    const response = await authorize(who);
    await expect(
      controller.finish({ ...response, state: `${response.state}x` }, caller()),
    ).rejects.toMatchObject({ status: 400, response: { error: 'invalid_flow' } });
    await expect(controller.finish(response, caller())).rejects.toMatchObject({
      response: { error: 'invalid_flow' },
    });
  });

  it('refuses a wrong iss (mix-up)', async () => {
    const who = person('iss');
    const response = await authorize(who);
    await expect(
      controller.finish({ ...response, iss: 'https://evil.example/oidc' }, caller()),
    ).rejects.toMatchObject({ status: 400, response: { error: 'invalid_flow' } });
  });

  it('refuses a replayed finish, and an unknown flow', async () => {
    const who = person('replay');
    const response = await authorize(who);
    await controller.finish(response, caller());
    await expect(controller.finish(response, caller())).rejects.toMatchObject({
      response: { error: 'invalid_flow' },
    });
    await expect(controller.finish({ ...response, flowId: randomUUID() }, caller())).rejects.toMatchObject({
      response: { error: 'invalid_flow' },
    });
  });

  it('refuses a code from another flow (the PKCE verifier and nonce do not match)', async () => {
    const a = await authorize(person('swap-a'));
    const b = await authorize(person('swap-b'));
    // b's flow (its state is right) with a's code.
    await expect(controller.finish({ ...b, code: a.code }, caller())).rejects.toMatchObject({
      status: 401,
      response: { error: 'yourtal_failed' },
    });
  });

  it('refuses a teen (invites are not built yet) and creates nothing', async () => {
    const teen = person('teen', { ageBand: 'teen' });
    await expect(signIn(teen)).rejects.toMatchObject({
      status: 403,
      response: { error: 'teen_invite_required' },
    });
    const { rows } = await admin.query('SELECT 1 FROM users WHERE email = $1', [teen.email]);
    expect(rows).toHaveLength(0);
  });

  it('refuses a region SnapApp does not serve, and creates nothing', async () => {
    const kiwi = person('nz', { region: 'NZ' });
    await expect(signIn(kiwi)).rejects.toMatchObject({
      status: 403,
      response: { error: 'region_not_supported' },
    });
    const { rows } = await admin.query('SELECT 1 FROM users WHERE email = $1', [kiwi.email]);
    expect(rows).toHaveLength(0);
  });

  it('accepts Indonesia', async () => {
    const who = person('id', { region: 'ID' });
    expect((await signIn(who)).outcome).toBe('created');
  });

  it('refuses an unverified email', async () => {
    const who = person('unverified', { emailVerified: false });
    await expect(signIn(who)).rejects.toMatchObject({ status: 403, response: { error: 'email_unverified' } });
  });

  it('refuses staff without a passkey or two factors, and admits them with one', async () => {
    const who = person('staff');
    const first = await signIn(who, { amr: ['hwk'] });
    await admin.query(`INSERT INTO platform_staff (user_id, role) VALUES ($1, 'support')`, [first.user.userId]);

    await expect(signIn(who, { amr: ['pwd'] })).rejects.toMatchObject({
      status: 403,
      response: { error: 'staff_strong_auth_required' },
    });
    expect((await signIn(who, { amr: ['pwd', 'otp', 'mfa'] })).user.userId).toBe(first.user.userId);
    expect((await signIn(who, { amr: ['hwk'] })).user.userId).toBe(first.user.userId);
  });

  it('refuses to LINK a legacy staff account without a passkey, and changes nothing', async () => {
    const repo = await import('../../repo.js');
    const who = person('legacy-staff');
    const legacy = await repo.upsertUserByEmail(who.email, 'Staff Person');
    await admin.query(`INSERT INTO platform_staff (user_id, role) VALUES ($1, 'support')`, [legacy.userId]);

    await expect(signIn(who)).rejects.toMatchObject({ response: { error: 'staff_strong_auth_required' } });
    expect((await userRow(legacy.userId)).subject).toBe(`dev|${who.email}`);

    const linked = await signIn(who, { amr: ['hwk'] });
    expect(linked.outcome).toBe('linked');
    expect(linked.user.userId).toBe(legacy.userId);
  });

  it('the phone app signs in as a public client and lands on the SAME account (one sector)', async () => {
    const who = person('phone');
    const fromWeb = await signIn(who);
    const fromPhone = await signIn(who, { client: 'mobile' });
    expect(fromPhone.outcome).toBe('signed_in');
    expect(fromPhone.user.userId).toBe(fromWeb.user.userId);
    expect(yt.lastAuthorizationParams?.get('client_id')).toBe(yt.mobileClientId);
    expect(yt.lastAuthorizationParams?.get('redirect_uri')).toBe(yt.mobileRedirectUri);
  });

  it('a phone-app response cannot be finished as a web flow, and vice versa', async () => {
    // The flow row decides the client, not the caller: a web flow's state
    // with a phone code fails the code redemption.
    const phone = await authorize(person('cross-p'), { client: 'mobile' });
    const web = await authorize(person('cross-w'));
    await expect(controller.finish({ ...web, code: phone.code }, caller())).rejects.toMatchObject({
      response: { error: 'yourtal_failed' },
    });
  });

  it('refuses a returnTo that is not a same-origin path', async () => {
    for (const bad of ['https://evil.example/', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)']) {
      await expect(controller.start({ client: 'web', returnTo: bad }, caller())).rejects.toMatchObject({
        status: 400,
        response: { error: 'invalid_return_to' },
      });
    }
  });

  it('rate-limits start per caller', async () => {
    const ip = caller();
    let refused = 0;
    for (let i = 0; i < 32; i += 1) {
      try {
        await controller.start({ client: 'mobile' }, ip);
      } catch (error) {
        expect(error).toMatchObject({ status: 429 });
        refused += 1;
      }
    }
    expect(refused).toBe(2);
  });
  it('a linked account gets no password-reset mail; an unlinked one does', async () => {
    const { AccountController } = await import('../account.controller.js');
    const account = new AccountController();

    const unlinked = freshEmail('reset-unlinked');
    await auth.register({ email: unlinked, password: 'a-decent-password' }, caller());
    const who = person('reset-linked');
    await auth.register({ email: who.email, password: 'a-decent-password' }, caller());
    await signIn(who);

    sent.length = 0;
    expect(await account.requestPasswordReset({ email: unlinked }, caller())).toEqual({ ok: true });
    expect(await account.requestPasswordReset({ email: who.email }, caller())).toEqual({ ok: true });
    await settleMail();
    expect(sent.map((m) => m.to)).toEqual([unlinked]);
  });

  describe('over HTTP, through the real application', () => {
    const post = (path: string, body: unknown) =>
      app.getHttpAdapter().getInstance().inject({ method: 'POST', url: path, payload: body as object });

    it('answers status, validates bodies, and completes a sign-in', async () => {
      const status = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/v1/auth/yourtal' });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toEqual({ web: true, mobile: true });

      expect((await post('/v1/auth/yourtal/start', { client: 'desktop' })).statusCode).toBe(400);
      expect((await post('/v1/auth/yourtal/finish', { flowId: 'nope', code: 'c', state: 's', iss: 'i' })).statusCode).toBe(400);

      const started = await post('/v1/auth/yourtal/start', { client: 'web', returnTo: '/app' });
      expect(started.statusCode).toBe(200);
      const { url: authUrl, flowId } = started.json() as { url: string; flowId: string };

      const who = person('http');
      yt.nextSignIn = { person: who };
      const redirect = await yt.authorize(authUrl);
      const finished = await post('/v1/auth/yourtal/finish', {
        flowId,
        code: redirect.searchParams.get('code'),
        state: redirect.searchParams.get('state'),
        iss: redirect.searchParams.get('iss'),
      });
      expect(finished.statusCode).toBe(200);
      const body = finished.json() as { token: string; outcome: string; returnTo: string; user: { email: string } };
      expect(body).toMatchObject({ outcome: 'created', returnTo: '/app', user: { email: who.email } });
      // Nothing YourTal issued is in the answer.
      expect(finished.body).not.toContain(redirect.searchParams.get('code')!);
      expect(finished.body).not.toMatch(/id_token|access_token/);

      const session = await app.getHttpAdapter().getInstance().inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { authorization: `Bearer ${body.token}` },
      });
      expect(session.statusCode).toBe(200);

      // A refusal has the { error, message } shape the website shows.
      const teen = person('http-teen', { ageBand: 'teen' });
      const s2 = (await post('/v1/auth/yourtal/start', { client: 'web' })).json() as { url: string; flowId: string };
      yt.nextSignIn = { person: teen };
      const r2 = await yt.authorize(s2.url);
      const refused = await post('/v1/auth/yourtal/finish', {
        flowId: s2.flowId,
        code: r2.searchParams.get('code'),
        state: r2.searchParams.get('state'),
        iss: r2.searchParams.get('iss'),
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: 'teen_invite_required' });
    });
  });
});
