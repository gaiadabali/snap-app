import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Registration and password sign-in against a REAL database.
 *
 * `passwords.test.ts` covers the hashing in isolation. This covers the part
 * that can only be wrong against Postgres: `users` is under RLS and the
 * application role genuinely cannot read it (migration 0015), so both paths go
 * through SECURITY DEFINER functions. A unit test with a stubbed repo would
 * pass while the real role got "permission denied for table users".
 *
 * The properties that matter most here are refusals:
 *   - a second registration for the same address cannot overwrite a password
 *   - sign-in answers identically for unknown address, no-password account,
 *     and wrong password
 *
 * Skipped without DATABASE_URL, like the other DB suites. CI sets REQUIRE_DB=1.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('password auth — real database', () => {
  let controller: InstanceType<typeof import('./auth.controller.js').AuthController>;
  let admin: Client;
  const made: string[] = [];

  const freshEmail = (tag: string) => {
    const email = `pwtest-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    made.push(email);
    return email;
  };

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.WEB_PUBLIC_URL ??= 'http://127.0.0.1:3000';
    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();
    const mod = await import('./auth.controller.js');
    controller = new mod.AuthController();
  });

  afterAll(async () => {
    if (made.length) {
      await admin.query('DELETE FROM users WHERE email = ANY($1)', [made]);
    }
    await admin.end();
  });

  it('creates an account and returns a usable session', async () => {
    const email = freshEmail('create');
    const result = await controller.register({
      email, password: 'a-decent-password', displayName: 'Pw Tester',
    });
    expect(result.user.email).toBe(email);
    expect(result.user.displayName).toBe('Pw Tester');
    expect(result.token.length).toBeGreaterThan(20);
    // A brand-new account has no workspace yet — the client runs onboarding.
    expect(result.workspaces).toEqual([]);
  });

  it('derives a display name from the address when none is given', async () => {
    const email = freshEmail('jo.smith');
    const result = await controller.register({ email, password: 'a-decent-password' });
    expect(result.user.displayName).toMatch(/^Pwtest Jo Smith/);
  });

  it('signs in with the right password and lands on the SAME account', async () => {
    const email = freshEmail('signin');
    const registered = await controller.register({ email, password: 'a-decent-password' });
    const signedIn = await controller.passwordSignIn({ email, password: 'a-decent-password' });
    expect(signedIn.user.userId).toBe(registered.user.userId);
  });

  it('REFUSES a second registration for an address that already has a password', async () => {
    // Migration 0025: the function returns no row rather than overwriting.
    // An unauthenticated endpoint that can replace a credential is a reset
    // primitive, and there is no email here to confirm one.
    const email = freshEmail('dupe');
    await controller.register({ email, password: 'a-decent-password' });
    await expect(
      controller.register({ email, password: 'a-completely-different-one' }),
    ).rejects.toMatchObject({ status: 409 });

    // And the original password still works — the second attempt changed nothing.
    const after = await controller.passwordSignIn({ email, password: 'a-decent-password' });
    expect(after.user.email).toBe(email);
  });

  it('lets an account created WITHOUT a password adopt one', async () => {
    // A tester who first arrived through a magic link or Google has a NULL
    // hash, and should be able to claim a password without an operator.
    const email = freshEmail('adopt');
    const repo = await import('../repo.js');
    const existing = await repo.upsertUserByEmail(email, 'Existing Person');
    const registered = await controller.register({ email, password: 'a-decent-password' });
    expect(registered.user.userId).toBe(existing.userId);
    // The display name they already had is not overwritten.
    expect(registered.user.displayName).toBe('Existing Person');
  });

  it('answers the SAME for wrong password, unknown address, and no password set', async () => {
    const withPassword = freshEmail('same-a');
    await controller.register({ email: withPassword, password: 'a-decent-password' });

    const repo = await import('../repo.js');
    const noPassword = freshEmail('same-b');
    await repo.upsertUserByEmail(noPassword, 'No Password');

    const unknown = freshEmail('same-c');
    made.pop(); // never created; nothing to clean up

    const failures = await Promise.all(
      [
        { email: withPassword, password: 'wrong-password-here' },
        { email: noPassword, password: 'a-decent-password' },
        { email: unknown, password: 'a-decent-password' },
      ].map((body) => controller.passwordSignIn(body).then(() => null, (e) => e)),
    );

    for (const error of failures) {
      expect(error).not.toBeNull();
      expect(error.status).toBe(401);
      expect(error.message).toBe('Email or password is incorrect.');
    }
    // One message, one status — the three cases are indistinguishable.
    expect(new Set(failures.map((e) => `${e.status}:${e.message}`)).size).toBe(1);
  });

  it('rejects a password below the minimum before touching the database', async () => {
    await expect(
      controller.register({ email: freshEmail('short'), password: 'short' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
