import { randomBytes } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { MailMessage } from './mailer.js';

/**
 * Sign-in safety (task 1.2, migration 0036) — through REAL HTTP against a
 * REAL database, as the application role.
 *
 * Sessions end and can be revoked; a password reset is single use, expires,
 * revokes every session and never reveals whether an address exists; an
 * unverified address cannot act on other people; and every limit holds. The
 * refusals are the point, so most of what follows is a refusal.
 *
 * Each case uses its own address and its own client IP (Fastify's inject
 * `remoteAddress`), because the limiters' counters live in Postgres and
 * outlast a test: two cases sharing a key would be testing each other.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('sign-in safety — real HTTP, real database', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let sent: MailMessage[] = [];
  let restoreMailer: () => void;
  let settleMail: () => Promise<void>;
  const made: string[] = [];

  const freshEmail = (tag: string) => {
    const email = `safety-${tag}-${Date.now()}-${randomBytes(3).toString('hex')}@example.test`;
    made.push(email);
    return email;
  };
  /** A documentation-range (2001:db8::/32) address no other case, or run, uses. */
  const run = randomBytes(4).toString('hex');
  let ipCounter = 0;
  const freshIp = () => `2001:db8:${run.slice(0, 4)}:${run.slice(4)}::${(++ipCounter).toString(16)}`;

  const post = (path: string, body: unknown, opts: { token?: string; ip?: string } = {}) =>
    app.inject({
      method: 'POST',
      url: path,
      payload: body as Record<string, unknown>,
      remoteAddress: opts.ip ?? freshIp(),
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    });
  const session = (token: string) =>
    app.inject({ method: 'GET', url: '/v1/auth/session', headers: { authorization: `Bearer ${token}` } });

  /** The secret from the newest mail to `to` whose link points at `path`. */
  const linkFrom = (to: string, path: string): string => {
    const mail = [...sent].reverse().find((m) => m.to === to && m.text.includes(path));
    if (!mail) throw new Error(`no ${path} mail to ${to}; sent: ${sent.map((m) => `${m.to}:${m.subject}`).join(', ')}`);
    const match = mail.text.match(/token=([^\s&]+)/);
    return decodeURIComponent(match![1]!);
  };

  const register = async (email: string, password = 'a-decent-password') => {
    const res = await post('/v1/auth/register', { email, password });
    expect(res.statusCode).toBe(201);
    return res.json() as { token: string; user: { userId: string; emailVerified: boolean } };
  };

  beforeAll(async () => {
    process.env.WEB_PUBLIC_URL ??= 'http://127.0.0.1:3000';
    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();

    const mailer = await import('./mailer.js');
    restoreMailer = mailer.setMailerForTesting({
      send: async (message) => {
        sent.push(message);
      },
    });
    settleMail = (await import('./account-mail.js')).settleMailForTesting;

    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    sent = [];
  });

  afterAll(async () => {
    await settleMail?.();
    restoreMailer?.();
    if (made.length) await admin.query('DELETE FROM users WHERE email = ANY($1)', [made]);
    await admin.end();
    await app?.close();
  });

  /* ── 1.2.c Sessions end, and can be ended ──────────────────────────────── */

  describe('sessions', () => {
    it('a session token works, and stops working once signed out', async () => {
      const { token } = await register(freshEmail('signout'));
      expect((await session(token)).statusCode).toBe(200);

      const out = await post('/v1/auth/sign-out', {}, { token });
      expect(out.statusCode).toBe(204);

      const after = await session(token);
      expect(after.statusCode).toBe(401);
      expect(after.json()).toMatchObject({ error: 'session_expired' });
    });

    it('signing out a token that is already dead still answers 204', async () => {
      expect((await post('/v1/auth/sign-out', {}, { token: 'not.a-token' })).statusCode).toBe(204);
      expect((await post('/v1/auth/sign-out', {})).statusCode).toBe(204);
    });

    it('stores only a hash of the session secret, never the token', async () => {
      const { token, user } = await register(freshEmail('hashonly'));
      const { rows } = await admin.query<{ token_hash: Buffer }>(
        'SELECT token_hash FROM user_sessions WHERE user_id = $1',
        [user.userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token_hash.length).toBe(32);
      expect(token.includes(rows[0]!.token_hash.toString('base64url'))).toBe(false);
    });

    it('an ABSOLUTE expiry ends a session however recently it was used', async () => {
      const { token, user } = await register(freshEmail('absolute'));
      await admin.query(
        `UPDATE user_sessions SET created_at = now() - interval '31 days', expires_at = now() - interval '1 minute'
          WHERE user_id = $1`,
        [user.userId],
      );
      expect((await session(token)).statusCode).toBe(401);
    });

    it('an IDLE expiry ends a session nobody has used for 14 days — and use keeps it alive', async () => {
      const idle = await register(freshEmail('idle'));
      const active = await register(freshEmail('active'));
      await admin.query(
        `UPDATE user_sessions SET last_seen_at = now() - interval '14 days 1 minute' WHERE user_id = $1`,
        [idle.user.userId],
      );
      await admin.query(
        `UPDATE user_sessions SET last_seen_at = now() - interval '13 days' WHERE user_id = $1`,
        [active.user.userId],
      );

      expect((await session(idle.token)).statusCode).toBe(401);
      expect((await session(active.token)).statusCode).toBe(200);

      // The use moved the idle clock: last seen is now, not 13 days ago.
      const { rows } = await admin.query<{ fresh: boolean }>(
        `SELECT last_seen_at > now() - interval '1 minute' AS fresh FROM user_sessions WHERE user_id = $1`,
        [active.user.userId],
      );
      expect(rows[0]!.fresh).toBe(true);
    });

    it('opens sessions with the stated lifetimes: 30 days absolute, 14 days idle', async () => {
      const { user } = await register(freshEmail('lifetimes'));
      const { rows } = await admin.query<{ days: number; idle: number }>(
        `SELECT round(extract(epoch FROM expires_at - created_at) / 86400)::int AS days,
                idle_timeout_seconds / 86400 AS idle
           FROM user_sessions WHERE user_id = $1`,
        [user.userId],
      );
      expect(rows[0]).toEqual({ days: 30, idle: 14 });
    });

    it('a correctly SIGNED token with no session row behind it is refused', async () => {
      // What every pre-0036 token now is, and what a leaked TOKEN_SECRET
      // alone would let someone make: the signature is not enough.
      const { user } = await register(freshEmail('rowless'));
      const { signSessionToken } = await import('../tokens.js');
      const forged = signSessionToken(user.userId, 'never-stored', Math.floor(Date.now() / 1000) + 3600);
      expect((await session(forged)).statusCode).toBe(401);
    });

    it("a session cannot be replayed as another user's, even with the right secret", async () => {
      const a = await register(freshEmail('owner-a'));
      const b = await register(freshEmail('owner-b'));
      const { readSession, signSessionToken } = await import('../tokens.js');
      const claim = readSession(a.token)!;
      const swapped = signSessionToken(b.user.userId, claim.secret, claim.expiresAt);
      expect((await session(swapped)).statusCode).toBe(401);
    });

    it('sign-out-everywhere ends every session of that user, and nobody else’s', async () => {
      const email = freshEmail('everywhere');
      const first = await register(email);
      const second = await post('/v1/auth/password/sign-in', { email, password: 'a-decent-password' });
      expect(second.statusCode).toBe(200);
      const bystander = await register(freshEmail('bystander'));

      const res = await post('/v1/auth/sign-out-everywhere', {}, { token: first.token });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ revoked: 2 });

      expect((await session(first.token)).statusCode).toBe(401);
      expect((await session(second.json().token)).statusCode).toBe(401);
      expect((await session(bystander.token)).statusCode).toBe(200);
    });

    it('housekeeping deletes sessions 30 days after they ended, and keeps everything younger', async () => {
      const old = await register(freshEmail('housekeep-old'));
      const recent = await register(freshEmail('housekeep-recent'));
      const live = await register(freshEmail('housekeep-live'));
      await admin.query(
        `UPDATE user_sessions SET revoked_at = now() - interval '31 days', revoked_reason = 'sign_out' WHERE user_id = $1`,
        [old.user.userId],
      );
      await admin.query(
        `UPDATE user_sessions SET revoked_at = now() - interval '29 days', revoked_reason = 'sign_out' WHERE user_id = $1`,
        [recent.user.userId],
      );

      const { authHousekeeping } = await import('./sessions.js');
      expect(await authHousekeeping()).toBeGreaterThanOrEqual(1);

      const { rows } = await admin.query<{ user_id: string }>(
        'SELECT user_id FROM user_sessions WHERE user_id = ANY($1)',
        [[old.user.userId, recent.user.userId, live.user.userId]],
      );
      expect(rows.map((r) => r.user_id).sort()).toEqual([recent.user.userId, live.user.userId].sort());
      expect((await session(live.token)).statusCode).toBe(200);
    });

    it('the application role cannot read the session table at all', async () => {
      const app_ = new Client({ connectionString: url });
      await app_.connect();
      try {
        await expect(app_.query('SELECT 1 FROM user_sessions LIMIT 1')).rejects.toThrow(/permission denied/);
        await expect(app_.query('SELECT 1 FROM auth_email_tokens LIMIT 1')).rejects.toThrow(/permission denied/);
      } finally {
        await app_.end();
      }
    });
  });

  /* ── 1.2.a Password reset ──────────────────────────────────────────────── */

  describe('password reset', () => {
    it('answers an unknown address EXACTLY as a known one — and mails only the known one', async () => {
      const known = freshEmail('reset-known');
      await register(known);
      const unknown = freshEmail('reset-unknown');
      made.pop();
      sent = [];

      const a = await post('/v1/auth/password/reset/request', { email: known });
      const b = await post('/v1/auth/password/reset/request', { email: unknown });
      await settleMail();

      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(a.statusCode);
      expect(b.body).toBe(a.body);
      expect(Object.keys(a.headers).sort()).toEqual(Object.keys(b.headers).sort());

      expect(sent.map((m) => m.to)).toEqual([known]);
      expect(sent[0]!.subject).toBe('Reset your Snap Apps password');
    });

    it('does not wait for the mail: a hung SMTP server cannot make a real account answer slower', async () => {
      const email = freshEmail('reset-hung');
      await register(email);
      const { setMailerForTesting } = await import('./mailer.js');
      let release!: () => void;
      const hung = new Promise<void>((resolve) => (release = resolve));
      const restore = setMailerForTesting({ send: () => hung });
      try {
        const started = Date.now();
        const res = await post('/v1/auth/password/reset/request', { email });
        expect(res.statusCode).toBe(200);
        // The send is still pending — the response did not wait for it.
        expect(Date.now() - started).toBeLessThan(5_000);
      } finally {
        release();
        await settleMail();
        restore();
      }
    });

    it('a reset sets the new password, revokes EVERY session, proves the address, and mails a notice', async () => {
      const email = freshEmail('reset-flow');
      const victim = await register(email, 'the-old-password');
      const otherDevice = await post('/v1/auth/password/sign-in', { email, password: 'the-old-password' });
      expect(otherDevice.statusCode).toBe(200);

      await post('/v1/auth/password/reset/request', { email });
      await settleMail();
      const secret = linkFrom(email, '/reset-password');

      const res = await post('/v1/auth/password/reset/confirm', { token: secret, newPassword: 'the-new-password' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.emailVerified).toBe(true);
      await settleMail();
      expect(sent.some((m) => m.to === email && m.subject === 'Your Snap Apps password was changed')).toBe(true);

      // Every earlier session is gone; the fresh one works.
      expect((await session(victim.token)).statusCode).toBe(401);
      expect((await session(otherDevice.json().token)).statusCode).toBe(401);
      expect((await session(body.token)).statusCode).toBe(200);

      // Old password refused, new one accepted.
      expect((await post('/v1/auth/password/sign-in', { email, password: 'the-old-password' })).statusCode).toBe(401);
      expect((await post('/v1/auth/password/sign-in', { email, password: 'the-new-password' })).statusCode).toBe(200);
    });

    it('a reset link works ONCE', async () => {
      const email = freshEmail('reset-once');
      await register(email);
      await post('/v1/auth/password/reset/request', { email });
      await settleMail();
      const secret = linkFrom(email, '/reset-password');

      const ip = freshIp();
      const first = await post('/v1/auth/password/reset/confirm', { token: secret, newPassword: 'first-new-password' }, { ip });
      const second = await post('/v1/auth/password/reset/confirm', { token: secret, newPassword: 'second-new-password' }, { ip });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(401);
      expect((await post('/v1/auth/password/sign-in', { email, password: 'first-new-password' })).statusCode).toBe(200);
    });

    it('two simultaneous redemptions of one link: exactly one wins', async () => {
      const email = freshEmail('reset-race');
      await register(email);
      await post('/v1/auth/password/reset/request', { email });
      await settleMail();
      const secret = linkFrom(email, '/reset-password');
      const results = await Promise.all([
        post('/v1/auth/password/reset/confirm', { token: secret, newPassword: 'racer-one-password' }),
        post('/v1/auth/password/reset/confirm', { token: secret, newPassword: 'racer-two-password' }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
    });

    it('a reset link EXPIRES (30 minutes) and an expired one is refused like a forged one', async () => {
      const email = freshEmail('reset-expired');
      const { user } = await register(email);
      await post('/v1/auth/password/reset/request', { email });
      await settleMail();
      const secret = linkFrom(email, '/reset-password');

      const { rows } = await admin.query<{ minutes: number }>(
        `SELECT round(extract(epoch FROM expires_at - created_at) / 60)::int AS minutes
           FROM auth_email_tokens WHERE user_id = $1 AND purpose = 'password_reset'`,
        [user.userId],
      );
      expect(rows[0]!.minutes).toBe(30);

      await admin.query(
        `UPDATE auth_email_tokens SET created_at = now() - interval '31 minutes', expires_at = now() - interval '1 minute'
          WHERE user_id = $1`,
        [user.userId],
      );
      const expired = await post('/v1/auth/password/reset/confirm', { token: secret, newPassword: 'too-late-password' });
      const forged = await post('/v1/auth/password/reset/confirm', {
        token: randomBytes(32).toString('base64url'),
        newPassword: 'too-late-password',
      });
      expect(expired.statusCode).toBe(401);
      expect(expired.body).toBe(forged.body);
      expect((await post('/v1/auth/password/sign-in', { email, password: 'too-late-password' })).statusCode).toBe(401);
    });

    it('a newer request supersedes the older link', async () => {
      const email = freshEmail('reset-supersede');
      await register(email);
      await post('/v1/auth/password/reset/request', { email });
      await settleMail();
      const older = linkFrom(email, '/reset-password');
      await post('/v1/auth/password/reset/request', { email });
      await settleMail();
      const newer = linkFrom(email, '/reset-password');
      expect(newer).not.toBe(older);

      expect((await post('/v1/auth/password/reset/confirm', { token: older, newPassword: 'older-link-password' })).statusCode).toBe(401);
      expect((await post('/v1/auth/password/reset/confirm', { token: newer, newPassword: 'newer-link-password' })).statusCode).toBe(200);
    });

    it('a weak new password is refused without spending the link', async () => {
      const email = freshEmail('reset-weak');
      await register(email);
      await post('/v1/auth/password/reset/request', { email });
      await settleMail();
      const secret = linkFrom(email, '/reset-password');
      expect((await post('/v1/auth/password/reset/confirm', { token: secret, newPassword: 'short' })).statusCode).toBe(400);
      expect((await post('/v1/auth/password/reset/confirm', { token: secret, newPassword: 'long-enough-now' })).statusCode).toBe(200);
    });

    it('stores only a hash of the link secret', async () => {
      const email = freshEmail('reset-hash');
      const { user } = await register(email);
      await post('/v1/auth/password/reset/request', { email });
      await settleMail();
      const secret = linkFrom(email, '/reset-password');
      const { rows } = await admin.query<{ token_hash: Buffer }>(
        `SELECT token_hash FROM auth_email_tokens WHERE user_id = $1 AND purpose = 'password_reset'`,
        [user.userId],
      );
      expect(rows[0]!.token_hash.toString('base64url')).not.toBe(secret);
      expect(rows[0]!.token_hash.length).toBe(32);
    });

    it('is the way a passwordless (magic-link) account adopts a password now', async () => {
      const email = freshEmail('reset-adopt');
      const repo = await import('../repo.js');
      await repo.upsertUserByEmail(email, 'Link Person');
      await post('/v1/auth/password/reset/request', { email });
      await settleMail();
      const secret = linkFrom(email, '/reset-password');
      expect((await post('/v1/auth/password/reset/confirm', { token: secret, newPassword: 'adopted-password' })).statusCode).toBe(200);
      expect((await post('/v1/auth/password/sign-in', { email, password: 'adopted-password' })).statusCode).toBe(200);
    });

    it('limits requests to 3 per address — the same for an address with no account', async () => {
      const known = freshEmail('limit-known');
      await register(known);
      const unknown = freshEmail('limit-unknown');
      made.pop();
      for (const email of [known, unknown]) {
        const codes: number[] = [];
        // A fresh IP each time, so only the per-address limit is in play.
        for (let i = 0; i < 4; i++) codes.push((await post('/v1/auth/password/reset/request', { email })).statusCode);
        expect(codes).toEqual([200, 200, 200, 429]);
      }
      await settleMail();
    });

    it('limits requests to 10 per IP across addresses', async () => {
      const ip = freshIp();
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) {
        const email = freshEmail(`limit-ip-${i}`);
        made.pop();
        codes.push((await post('/v1/auth/password/reset/request', { email }, { ip })).statusCode);
      }
      expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
      expect(codes[10]).toBe(429);
    });
  });

  /* ── Password change ───────────────────────────────────────────────────── */

  describe('password change', () => {
    it('needs the current password; revokes the OTHER sessions and keeps this one', async () => {
      const email = freshEmail('change');
      const here = await register(email, 'current-password');
      const there = (await post('/v1/auth/password/sign-in', { email, password: 'current-password' })).json();

      const wrong = await post(
        '/v1/auth/password/change',
        { currentPassword: 'not-the-password', newPassword: 'changed-password' },
        { token: here.token },
      );
      expect(wrong.statusCode).toBe(401);
      // A wrong current password must not sign the caller out.
      expect((await session(here.token)).statusCode).toBe(200);

      const ok = await post(
        '/v1/auth/password/change',
        { currentPassword: 'current-password', newPassword: 'changed-password' },
        { token: here.token },
      );
      expect(ok.statusCode).toBe(200);
      await settleMail();
      expect(sent.some((m) => m.to === email && m.subject === 'Your Snap Apps password was changed')).toBe(true);

      expect((await session(here.token)).statusCode).toBe(200);
      expect((await session(there.token)).statusCode).toBe(401);
      expect((await post('/v1/auth/password/sign-in', { email, password: 'changed-password' })).statusCode).toBe(200);
    });

    it('limits attempts to 5 per account, so a stolen session cannot brute-force the password', async () => {
      const { token } = await register(freshEmail('change-limit'), 'current-password');
      const codes: number[] = [];
      for (let i = 0; i < 6; i++) {
        codes.push(
          (
            await post(
              '/v1/auth/password/change',
              { currentPassword: `guess-number-${i}`, newPassword: 'changed-password' },
              { token },
            )
          ).statusCode,
        );
      }
      expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    });
  });

  /* ── 1.2.b Email verification ──────────────────────────────────────────── */

  describe('email verification', () => {
    it('a password sign-up is unverified, is mailed a link, and the link verifies it once', async () => {
      const email = freshEmail('verify');
      const { token, user } = await register(email);
      expect(user.emailVerified).toBe(false);
      await settleMail();
      const secret = linkFrom(email, '/verify-email');

      const ip = freshIp();
      const ok = await post('/v1/auth/email/verification/confirm', { token: secret }, { ip });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ verified: true, email });
      expect((await session(token)).json().user.emailVerified).toBe(true);

      expect((await post('/v1/auth/email/verification/confirm', { token: secret }, { ip })).statusCode).toBe(401);
    });

    it('an unverified account may NOT accept an invitation or invite — a verified one gets past the guard', async () => {
      const email = freshEmail('verify-gate');
      const { token } = await register(email);

      const refused = await post('/v1/workspaces/invitations/accept', { token: 'no-such-invitation' }, { token });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: 'email_unverified' });

      await settleMail();
      await post('/v1/auth/email/verification/confirm', { token: linkFrom(email, '/verify-email') });

      // Past the guard now: the bogus invitation itself is what is refused.
      const allowed = await post('/v1/workspaces/invitations/accept', { token: 'no-such-invitation' }, { token });
      expect(allowed.statusCode).toBe(404);
    });

    it('an unverified account can still sign in and use its own account', async () => {
      const email = freshEmail('verify-use');
      await register(email);
      const signIn = await post('/v1/auth/password/sign-in', { email, password: 'a-decent-password' });
      expect(signIn.statusCode).toBe(200);
      expect(signIn.json().user.emailVerified).toBe(false);
      expect((await session(signIn.json().token)).statusCode).toBe(200);
    });

    it('resend replaces the earlier link, and says so when there is nothing to send', async () => {
      const email = freshEmail('verify-resend');
      const { token } = await register(email);
      await settleMail();
      const first = linkFrom(email, '/verify-email');

      const res = await post('/v1/auth/email/verification/resend', {}, { token });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ alreadyVerified: false });
      await settleMail();
      const second = linkFrom(email, '/verify-email');
      expect(second).not.toBe(first);

      expect((await post('/v1/auth/email/verification/confirm', { token: first })).statusCode).toBe(401);
      expect((await post('/v1/auth/email/verification/confirm', { token: second })).statusCode).toBe(200);

      // The session's user is read fresh, so the next resend knows.
      const again = await post('/v1/auth/email/verification/resend', {}, { token });
      expect(again.json()).toEqual({ alreadyVerified: true });
    });

    it('limits resends to 3 per account', async () => {
      const { token } = await register(freshEmail('verify-limit'));
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        codes.push((await post('/v1/auth/email/verification/resend', {}, { token })).statusCode);
      }
      expect(codes).toEqual([200, 200, 200, 429]);
      await settleMail();
    });

    it('a verification link expires after 24 hours', async () => {
      const email = freshEmail('verify-expired');
      const { user } = await register(email);
      await settleMail();
      const secret = linkFrom(email, '/verify-email');
      await admin.query(
        `UPDATE auth_email_tokens SET created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
          WHERE user_id = $1 AND purpose = 'email_verification'`,
        [user.userId],
      );
      expect((await post('/v1/auth/email/verification/confirm', { token: secret })).statusCode).toBe(401);
    });

    it('a magic link proves the address — and evicts a password nobody had proven (pre-hijacking)', async () => {
      // The attacker registers the victim's address with a password of their
      // own, and is signed in. The victim later arrives by magic link.
      const email = freshEmail('prehijack');
      const attacker = await register(email, 'attackers-password');

      const { issueMagicLinkToken } = await import('../tokens.js');
      const { token: magic } = issueMagicLinkToken(email);
      const victim = await post('/v1/auth/magic-link/consume', { token: magic });
      expect(victim.statusCode).toBe(200);
      expect(victim.json().user.emailVerified).toBe(true);

      // The attacker's session is gone and their password no longer works.
      expect((await session(attacker.token)).statusCode).toBe(401);
      expect((await post('/v1/auth/password/sign-in', { email, password: 'attackers-password' })).statusCode).toBe(401);
      // The victim's own session is the one that survives.
      expect((await session(victim.json().token)).statusCode).toBe(200);
    });

    it('a magic link on an ALREADY verified account leaves its password alone', async () => {
      const email = freshEmail('proven-keep');
      await register(email, 'my-own-password');
      await settleMail();
      await post('/v1/auth/email/verification/confirm', { token: linkFrom(email, '/verify-email') });

      const { issueMagicLinkToken } = await import('../tokens.js');
      await post('/v1/auth/magic-link/consume', { token: issueMagicLinkToken(email).token });
      expect((await post('/v1/auth/password/sign-in', { email, password: 'my-own-password' })).statusCode).toBe(200);
    });
  });
});
