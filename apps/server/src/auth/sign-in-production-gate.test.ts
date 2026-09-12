import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The production gate on passwordless sign-in.
 *
 * `POST /v1/auth/sign-in` exchanges an email address for a session with no
 * proof of anything. In development that saves a round trip; anywhere else it
 * is a complete authentication bypass — anyone who can reach the API becomes
 * anyone they name.
 *
 * The controller's header comment claimed since the beginning that "the guard
 * is NODE_ENV". There was no such guard: `isProduction()` covered the
 * demo-account list and the mailer, and nothing covered this. **A comment is
 * not a control**, which is why the control now has a test.
 *
 * These assert the REFUSALS. A test that only proves sign-in works in
 * development would have passed against the vulnerable version too — the same
 * mistake that let a bypass live in a tagged release.
 *
 * The refusal is a 404, not a 403, and that is deliberate: a production server
 * should not advertise that a bypass route exists here at all. Same reasoning
 * as keeping an expired token indistinguishable from a forged one.
 */

const ORIGINAL_ENV = process.env.NODE_ENV;
const ORIGINAL_GOOGLE = process.env.GOOGLE_CLIENT_ID;

beforeEach(() => {
  // `config()` validates the whole environment before any handler runs, so
  // these must be present or the schema throws first and the gate is never
  // reached. Nothing here connects: every assertion below is about a refusal
  // that happens before the database is touched.
  process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV;
  if (ORIGINAL_GOOGLE === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = ORIGINAL_GOOGLE;
  vi.resetModules();
});

describe('passwordless sign-in', () => {
  it('REFUSES in production', async () => {
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { AuthController } = await import('./auth.controller.js');

    await expect(
      new AuthController().signIn({ email: 'anyone@example.com' }),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses before touching the database, so an unknown address is not created either', async () => {
    // The bypass created the user if the address was unknown. A gate that ran
    // after that would still leave a stranger able to provision accounts.
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { AuthController } = await import('./auth.controller.js');

    // No database is configured in this test; reaching one would throw a
    // connection error rather than the refusal we are asserting.
    await expect(
      new AuthController().signIn({ email: 'stranger@example.com' }),
    ).rejects.toThrow(/not found/i);
  });

  it('still works in development, because that is the point of it', async () => {
    process.env.NODE_ENV = 'development';
    vi.resetModules();
    const { AuthController } = await import('./auth.controller.js');
    // Not asserting a successful sign-in here — that needs a database, and
    // `e2e.py` already drives the real thing. What matters is that the refusal
    // above is specific to production rather than a blanket failure, so this
    // fails for some OTHER reason (no database) and never for the gate.
    let message = '';
    try {
      await new AuthController().signIn({ email: 'kate@example.com' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toMatch(/not found/i);
  });
});

describe('refusing to boot without a way in', () => {
  it('REFUSES to start in production when neither Google nor a real mailer can work', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.GOOGLE_CLIENT_ID;
    vi.resetModules();

    const { bootstrap } = await import('../main.js');
    await expect(bootstrap()).rejects.toThrow(/no usable sign-in method/i);
  });

  it('names what is missing, rather than failing with a bare error', async () => {
    // Someone reads this at 2am during a deploy. "Refused to start" without
    // the reason is a worse outcome than the bypass it replaced.
    process.env.NODE_ENV = 'production';
    delete process.env.GOOGLE_CLIENT_ID;
    vi.resetModules();

    const { bootstrap } = await import('../main.js');
    await expect(bootstrap()).rejects.toThrow(/GOOGLE_CLIENT_ID/);
    await expect(bootstrap()).rejects.toThrow(/NoopMailer|email provider/i);
  });
});
