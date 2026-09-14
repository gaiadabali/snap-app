import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `config.googleSignInSimulatorAvailable` (apps/web/src/lib/config.ts) is a
 * plain object property computed once, at module load, from `process.env` —
 * same ordering discipline as `dev-bypass.test.ts`: set every variable with
 * `vi.stubEnv`, THEN `vi.resetModules()` and dynamically import a fresh copy,
 * rather than mutating `process.env` after some earlier import already baked
 * in a value.
 *
 * This is the negative-case suite for "the simulator is unreachable when
 * NODE_ENV=production" and "the real Google flow always takes precedence" —
 * both the sign-in page (which renders the button, or not, from this) and
 * `googleSimulatorSignInAction` (which checks it again before doing anything)
 * go through this one function, so proving it here proves both call sites.
 */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function isAvailableWith(env: {
  nodeEnv: string;
  demoEnv?: string;
  simulatorFlag?: string;
  googleClientId?: string;
  googleClientSecret?: string;
}): Promise<boolean> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', env.nodeEnv);
  vi.stubEnv('DEMO_ENV', env.demoEnv ?? '');
  vi.stubEnv('GOOGLE_SIGNIN_SIMULATOR', env.simulatorFlag ?? '');
  vi.stubEnv('GOOGLE_CLIENT_ID', env.googleClientId ?? '');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', env.googleClientSecret ?? '');
  const mod = await import('./google-simulator.js');
  return mod.isGoogleSignInSimulatorAvailable();
}

describe('isGoogleSignInSimulatorAvailable', () => {
  it('is available in plain development with the explicit opt-in', async () => {
    expect(await isAvailableWith({ nodeEnv: 'development', simulatorFlag: 'true' })).toBe(true);
  });

  it('is available on the demo host: NODE_ENV=production, DEMO_ENV=staging, opted in', async () => {
    expect(
      await isAvailableWith({ nodeEnv: 'production', demoEnv: 'staging', simulatorFlag: 'true' }),
    ).toBe(true);
  });

  it('is UNAVAILABLE on a plain production build — no DEMO_ENV, no flag — the critical negative case', async () => {
    expect(await isAvailableWith({ nodeEnv: 'production' })).toBe(false);
  });

  it('is UNAVAILABLE in production with the opt-in flag but WITHOUT DEMO_ENV=staging', async () => {
    // Proves NODE_ENV=production cannot be satisfied by the simulator flag
    // alone — DEMO_ENV is a genuinely separate, required signal.
    expect(await isAvailableWith({ nodeEnv: 'production', simulatorFlag: 'true' })).toBe(false);
  });

  it('is UNAVAILABLE in production with DEMO_ENV=staging but WITHOUT the opt-in flag', async () => {
    expect(await isAvailableWith({ nodeEnv: 'production', demoEnv: 'staging' })).toBe(false);
  });

  it('is UNAVAILABLE the moment real Google credentials are configured, even with both other flags set', async () => {
    // The real flow always takes precedence — this is what proves it rather
    // than merely asserting it in a comment.
    expect(
      await isAvailableWith({
        nodeEnv: 'production',
        demoEnv: 'staging',
        simulatorFlag: 'true',
        googleClientId: 'real-client-id.apps.googleusercontent.com',
        googleClientSecret: 'real-secret',
      }),
    ).toBe(false);
  });

  it('is unavailable outside production without the explicit opt-in', async () => {
    expect(await isAvailableWith({ nodeEnv: 'development' })).toBe(false);
    expect(await isAvailableWith({ nodeEnv: 'test' })).toBe(false);
  });

  it('requires the flag to be exactly "true" — not "1", not "yes", not truthy-by-JS-coercion', async () => {
    expect(await isAvailableWith({ nodeEnv: 'development', simulatorFlag: '1' })).toBe(false);
    expect(await isAvailableWith({ nodeEnv: 'development', simulatorFlag: 'yes' })).toBe(false);
    expect(await isAvailableWith({ nodeEnv: 'development', simulatorFlag: 'True' })).toBe(false);
  });

  it('rejects an invalid DEMO_ENV value rather than treating it as staging', async () => {
    expect(
      await isAvailableWith({ nodeEnv: 'production', demoEnv: 'not-staging', simulatorFlag: 'true' }),
    ).toBe(false);
  });
});
