import { describe, expect, it } from 'vitest';

import type { Config } from './config.js';
import { evaluatePreflight, type PreflightProbe } from './preflight.js';

/**
 * The preflight exists to refuse a deployment, so every test here asserts a
 * REFUSAL. A check that never fires is indistinguishable from one that is
 * broken, and this file is the only thing that tells them apart.
 */

function settings(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'production',
    CORS_ORIGINS: ['https://snapapps.example'],
    GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    PORT: 4000,
    ...overrides,
  } as Config;
}

const safe: PreflightProbe = { databaseRole: 'snap_app', bypassesRls: false };
const superuser: PreflightProbe = { databaseRole: 'postgres', bypassesRls: true };

describe('production preflight', () => {
  it('passes a correctly configured production server', () => {
    // The positive control. Without it, every refusal below could be passing
    // because the checks fire unconditionally.
    const result = evaluatePreflight(settings(), safe);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('REFUSES to start when the connection bypasses RLS', () => {
    // The bug this project actually shipped: connected as `postgres`, so no
    // policy was ever evaluated and every tenant boundary silently stopped
    // existing. Nothing about a running system looks different when this is
    // wrong, which is why it needs to be fatal at boot.
    const result = evaluatePreflight(settings(), superuser);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/bypasses row-level security/i);
    expect(result.failures.join(' ')).toContain('postgres');
  });

  it('REFUSES a wildcard CORS origin', () => {
    const result = evaluatePreflight(settings({ CORS_ORIGINS: ['*'] }), safe);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/financial records/i);
  });

  it('warns when production has no working sign-in path', () => {
    // The dev bypass is 404 in production by design. Without Google, and
    // absent a deliverable mailer, the site deploys and refuses everyone.
    const result = evaluatePreflight(settings({ GOOGLE_CLIENT_ID: undefined }), safe);
    expect(result.ok).toBe(true); // not fatal — magic links may be configured
    expect(result.warnings.join(' ')).toMatch(/nobody can sign in/i);
  });

  it('warns when CORS is empty in production', () => {
    const result = evaluatePreflight(settings({ CORS_ORIGINS: [] }), safe);
    expect(result.warnings.join(' ')).toMatch(/CORS_ORIGINS is empty/i);
  });

  it('does not police development, even connected as a superuser', () => {
    // Local development connects as whatever is convenient. Making local work
    // harder teaches people to disable the check rather than satisfy it.
    const result = evaluatePreflight(
      settings({ NODE_ENV: 'development', CORS_ORIGINS: [], GOOGLE_CLIENT_ID: undefined }),
      superuser,
    );
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('still refuses a wildcard origin outside production', () => {
    // The one check that is not production-gated: a wildcard is never a
    // reasonable thing to have written, and catching it in staging is the
    // point.
    const result = evaluatePreflight(
      settings({ NODE_ENV: 'development', CORS_ORIGINS: ['*'] }),
      safe,
    );
    expect(result.ok).toBe(false);
  });
});
