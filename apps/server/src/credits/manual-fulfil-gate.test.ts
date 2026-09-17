/**
 * The manual credit-fulfilment gate must FAIL CLOSED in production.
 *
 * `POST /v1/credits/purchases/:id/fulfil` marks a purchase paid and inserts
 * the `usage_grants` row. It is guarded by `requireAdmin`, which reads like a
 * control and is not one: creating a workspace makes you its `owner`
 * (`workspaces.controller.ts`), so every self-service signup satisfies it for
 * their own tenant. Start a purchase, fulfil it, and credits appear with no
 * money involved.
 *
 * That was honest while nothing could be bought — the endpoint is a stand-in
 * for a processor webhook and says so. Credits are now the entire commercial
 * model, so the same two calls are the revenue model with a hole in it, and it
 * would never have looked like a new bug because the code would not have
 * changed.
 *
 * So this asserts the REFUSAL, not the happy path. The sign-in bypass in
 * `auth.controller.ts` carried "must not ship" in a comment for a long time
 * with nothing enforcing it; a comment is not a control, and neither is a
 * config function that no test ever calls with production settings.
 */
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  DEMO_ENV: process.env.DEMO_ENV,
  CREDITS_MANUAL_FULFIL: process.env.CREDITS_MANUAL_FULFIL,
};

/*
 * `config()` validates the WHOLE environment, so the two required fields have
 * to be present even though this gate reads neither. Same approach as
 * `tokens.test.ts`: supply them, and only if the real environment has not.
 */
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

/** Re-import with a fresh module registry so `config()`'s cache is rebuilt. */
async function gateWith(env: Record<string, string | undefined>): Promise<boolean> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import('../config.js');
  return mod.isManualCreditFulfilmentEnabled();
}

beforeEach(() => {
  delete process.env.DEMO_ENV;
  delete process.env.CREDITS_MANUAL_FULFIL;
});

afterAll(() => {
  vi.resetModules();
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('manual credit fulfilment — the gate', () => {
  it('is OFF in a plain production deployment', async () => {
    expect(await gateWith({ NODE_ENV: 'production' })).toBe(false);
  });

  it('stays OFF in production even when the opt-in is set', async () => {
    // The opt-in alone must not be enough. Someone copying an env file from a
    // demo host to production must not thereby enable free credits.
    expect(
      await gateWith({ NODE_ENV: 'production', CREDITS_MANUAL_FULFIL: 'true' }),
    ).toBe(false);
  });

  it('stays OFF on the staging host until the opt-in is ALSO set', async () => {
    // Marking a deployment "this is the demo host" and "this host may mint
    // paid credits for free" are two decisions, so DEMO_ENV alone does nothing.
    expect(await gateWith({ NODE_ENV: 'production', DEMO_ENV: 'staging' })).toBe(false);
  });

  it('is ON for the staging host with both signals', async () => {
    expect(
      await gateWith({
        NODE_ENV: 'production',
        DEMO_ENV: 'staging',
        CREDITS_MANUAL_FULFIL: 'true',
      }),
    ).toBe(true);
  });

  it('is OFF in development unless the opt-in is set', async () => {
    // Not merely "not production": a developer has to ask for it too, so the
    // demo behaviour is never what you get by accident while building.
    expect(await gateWith({ NODE_ENV: 'development' })).toBe(false);
  });

  it('is ON in development with the opt-in', async () => {
    expect(
      await gateWith({ NODE_ENV: 'development', CREDITS_MANUAL_FULFIL: 'true' }),
    ).toBe(true);
  });

  it('treats any value other than the exact string "true" as off', async () => {
    for (const v of ['1', 'yes', 'TRUE', '']) {
      expect(await gateWith({ NODE_ENV: 'development', CREDITS_MANUAL_FULFIL: v })).toBe(false);
    }
  });
});
