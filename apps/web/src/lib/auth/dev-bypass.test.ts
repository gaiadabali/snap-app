import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `config.devAuthBypass` (apps/web/src/lib/config.ts) is a plain object
 * property computed once, at module load, from `process.env` — so each case
 * below sets both variables and THEN dynamically imports a fresh copy of the
 * module (`vi.resetModules()` first), rather than mutating `process.env`
 * after some earlier import already baked in a value. This is the same
 * ordering discipline `apps/server/src/tokens.test.ts` uses for `config()`.
 *
 * This is the test for "the dev bypass is unreachable when
 * NODE_ENV=production" — both the page (which reads this to decide whether
 * to render the form) and `devBypassSignInAction` (which reads it again
 * before doing anything) go through this one function, so proving it here
 * proves both call sites.
 */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function isDevBypassAvailableWith(nodeEnv: string, flag: string | undefined): Promise<boolean> {
  vi.resetModules();
  // `vi.stubEnv` rather than a direct assignment: `@types/node` marks
  // `process.env.NODE_ENV` read-only, and vitest's stub is the supported way
  // to override it (and everything else in `process.env`) per-test anyway.
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('SNAP_DEV_AUTH_BYPASS', flag ?? '');
  const mod = await import('./dev-bypass.js');
  return mod.isDevBypassAvailable();
}

describe('isDevBypassAvailable', () => {
  it('is available in development with the explicit opt-in', async () => {
    expect(await isDevBypassAvailableWith('development', 'true')).toBe(true);
  });

  it('is UNAVAILABLE in production, even with the opt-in flag set — the critical negative case', async () => {
    expect(await isDevBypassAvailableWith('production', 'true')).toBe(false);
  });

  it('is unavailable in development WITHOUT the explicit opt-in', async () => {
    expect(await isDevBypassAvailableWith('development', undefined)).toBe(false);
  });

  it('is unavailable in test without the opt-in, and in production regardless', async () => {
    expect(await isDevBypassAvailableWith('test', undefined)).toBe(false);
    expect(await isDevBypassAvailableWith('production', undefined)).toBe(false);
  });

  it('requires the flag to be exactly "true" — not "1", not "yes", not truthy-by-JS-coercion', async () => {
    expect(await isDevBypassAvailableWith('development', '1')).toBe(false);
    expect(await isDevBypassAvailableWith('development', 'yes')).toBe(false);
    expect(await isDevBypassAvailableWith('development', 'True')).toBe(false);
  });
});
