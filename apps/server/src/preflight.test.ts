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
    DEMO_ENV: undefined,
    GOOGLE_SIGNIN_SIMULATOR: false,
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

  it('REFUSES to start when nobody can sign in at all', () => {
    // The dev bypass is 404 in production by design, so with no Google, no
    // mail provider and no simulator there is NO way in. The site would
    // deploy, look healthy, and refuse every human who visited it — a total
    // outage of the front door that presents as "the login button does
    // nothing". Fatal, not a warning: a server nobody can enter is not
    // serving.
    delete process.env.MAILER_PROVIDER;
    delete process.env.SMTP_URL;

    const result = evaluatePreflight(settings({ GOOGLE_CLIENT_ID: undefined }), safe);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/no usable sign-in method/i);
  });

  it('names every option, because someone reads this at 2am mid-deploy', () => {
    // "Refused to start" without the remedy is a worse outcome than the
    // bypass it replaced.
    delete process.env.MAILER_PROVIDER;
    delete process.env.SMTP_URL;

    const message = evaluatePreflight(settings({ GOOGLE_CLIENT_ID: undefined }), safe).failures.join(
      ' ',
    );
    expect(message).toMatch(/GOOGLE_CLIENT_ID/);
    expect(message).toMatch(/MAILER_PROVIDER|SMTP_URL/);
    expect(message).toMatch(/GOOGLE_SIGNIN_SIMULATOR/);
  });

  it('a demo host boots on the simulator alone, and says so', () => {
    // This is what lets a staging host run before real credentials exist. A
    // genuine production host never sets DEMO_ENV, so it cannot reach this.
    delete process.env.MAILER_PROVIDER;
    delete process.env.SMTP_URL;

    const result = evaluatePreflight(
      settings({
        GOOGLE_CLIENT_ID: undefined,
        DEMO_ENV: 'staging',
        GOOGLE_SIGNIN_SIMULATOR: true,
      }),
      safe,
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/SIMULATOR/);
  });

  it('a mail provider alone is enough', () => {
    process.env.MAILER_PROVIDER = 'resend';
    try {
      const result = evaluatePreflight(settings({ GOOGLE_CLIENT_ID: undefined }), safe);
      expect(result.ok).toBe(true);
    } finally {
      delete process.env.MAILER_PROVIDER;
    }
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

/**
 * `docs/INTEGRATIONS.md` ticket X2. The boot half of gate G-SIM.
 *
 * Every case passes its environment explicitly. Reading the real
 * `process.env` here would make these tests pass or fail depending on the
 * developer's shell, which is the one thing a boot gate must not do.
 */
describe('the five simulated integrations, at boot', () => {
  const clean = { NODE_ENV: 'production' } as const;

  it('is silent when no simulator is asked for', () => {
    // The positive control. Without it, the refusals below could be passing
    // because the check fires unconditionally.
    const result = evaluatePreflight(settings(), safe, clean);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('REFUSES to start when production asks for a simulator without DEMO_ENV', () => {
    // The operator believes Stripe is taking payments. What actually happens
    // is that the integration resolves to ABSENT and the buy button quietly
    // says card payments are not connected — discoverable only from a ticket
    // about missing revenue.
    const result = evaluatePreflight(settings(), safe, {
      NODE_ENV: 'production',
      STRIPE_SIMULATOR: 'true',
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('STRIPE_SIMULATOR');
    expect(result.failures.join('\n')).toContain('DEMO_ENV=staging');
  });

  it('names EVERY refused simulator, not just the first', () => {
    const result = evaluatePreflight(settings(), safe, {
      NODE_ENV: 'production',
      STRIPE_SIMULATOR: 'true',
      XERO_SIMULATOR: 'true',
      KMS_SIMULATOR: 'true',
    });
    expect(result.ok).toBe(false);
    const text = result.failures.join('\n');
    for (const name of ['STRIPE_SIMULATOR', 'XERO_SIMULATOR', 'KMS_SIMULATOR']) {
      expect(text).toContain(name);
    }
  });

  it('BOOTS a demo host running simulators, and warns once per simulator', () => {
    // A demo host with four simulators running is correctly configured and
    // must still start. The warnings are what stop "simulated" from being
    // forgotten.
    const result = evaluatePreflight(settings({ DEMO_ENV: 'staging' }), safe, {
      NODE_ENV: 'production',
      DEMO_ENV: 'staging',
      STRIPE_SIMULATOR: 'true',
      XERO_SIMULATOR: 'true',
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.warnings.filter((w) => w.includes('SIMULATED')).length).toBe(2);
  });

  it('says nothing about a simulator that real credentials have overridden', () => {
    // Real credentials win by design. Warning about a stale flag at every
    // boot would train operators to ignore this whole section.
    const result = evaluatePreflight(settings(), safe, {
      NODE_ENV: 'production',
      DEMO_ENV: 'staging',
      STRIPE_SIMULATOR: 'true',
      STRIPE_SECRET_KEY: 'sk_live_not_a_real_key',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join('\n')).not.toContain('Stripe');
  });

  it('counts a SIMULATED mailer as a way in, and a real one as the real thing', () => {
    // Check 2 is "somebody can sign in at all". A simulated mailer delivers
    // to an in-process sink, so it is a way for a DEMO to sign in — exactly
    // as the Google simulator is — and it is not a way for a customer to.
    const demo = evaluatePreflight(
      settings({ GOOGLE_CLIENT_ID: undefined, DEMO_ENV: 'staging' }),
      safe,
      { NODE_ENV: 'production', DEMO_ENV: 'staging', MAILER_SIMULATOR: 'true' },
    );
    expect(demo.ok).toBe(true);

    const real = evaluatePreflight(settings({ GOOGLE_CLIENT_ID: undefined }), safe, {
      NODE_ENV: 'production',
      SMTP_URL: 'smtps://mail.example:465',
    });
    expect(real.ok).toBe(true);
    // A real mailer is not a simulator, so it draws no simulator warning.
    expect(real.warnings.join('\n')).not.toContain('SIMULATED');
  });

  it('an EMPTY mailer credential is not a mailer', () => {
    // How a compose file spells "unset" by accident. The old check read this
    // as a configured mailer and would have let a server boot with no way in.
    const result = evaluatePreflight(settings({ GOOGLE_CLIENT_ID: undefined }), safe, {
      NODE_ENV: 'production',
      SMTP_URL: '',
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('No usable sign-in method');
  });
});
