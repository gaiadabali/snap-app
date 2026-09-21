import type { Config } from './config.js';
import { evaluateSimulations, simulationMode, type Env } from './integrations/simulation.js';

/**
 * What must be true before this server is allowed to serve production traffic.
 *
 * `config()` already refuses to start over a missing variable. This is the
 * next layer: things that are individually well-formed and collectively wrong.
 * A server that discovers them from a support ticket discovers them late, and
 * two of the checks below correspond to bugs this project has actually
 * shipped.
 *
 * Every check is production-only on purpose. Development connects as whatever
 * is convenient and has no Google credentials, and making local work harder
 * teaches people to bypass the check rather than satisfy it.
 */

export type PreflightProbe = {
  /** The role the pool is actually connected as. */
  databaseRole: string;
  /** Whether that role has `rolbypassrls` or `rolsuper`. */
  bypassesRls: boolean;
};

export type PreflightResult = {
  ok: boolean;
  /** Fatal: the process must not serve traffic. */
  failures: string[];
  /** Non-fatal, but an operator should know. */
  warnings: string[];
};

export function evaluatePreflight(
  settings: Config,
  probe: PreflightProbe,
  /**
   * The environment the five external integrations are read from. A
   * parameter, with the process environment as its default, for the reason
   * `integrations/simulation.ts` gives: that module is deliberately pure so
   * it can also be called from `admin/crypto/kms.ts`, which must not import
   * `config.ts`. Passing it explicitly is also what lets this file's suite
   * drive every combination without mutating `process.env`.
   */
  env: Env = process.env,
): PreflightResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  const production = settings.NODE_ENV === 'production';

  // ── 1. RLS. The one that already happened. ────────────────────────────────
  //
  // The server once connected as `postgres`, which carries `rolbypassrls`, so
  // no policy anywhere was ever evaluated and every tenant boundary silently
  // stopped existing. Nothing about a running system looks different when this
  // is wrong, which is exactly why it survived. It is checked at boot rather
  // than reported on a status endpoint nobody reads.
  if (production && probe.bypassesRls) {
    failures.push(
      `DATABASE_URL connects as "${probe.databaseRole}", which bypasses row-level security. ` +
        'Every tenant boundary in the database is disabled for this connection. ' +
        'Connect as snap_app (NOSUPERUSER NOBYPASSRLS) — `node packages/db/scripts/db.mjs appuser` prints the URL.',
    );
  }

  // ── 2. A working way to sign in. ──────────────────────────────────────────
  //
  // `/v1/auth/sign-in` is correctly 404 in production. That closed an
  // authentication bypass and, on a server with no other method configured,
  // leaves NO way for anyone to sign in at all — the site deploys, looks
  // healthy, and refuses every human who visits it. That is a silent,
  // total outage of the product's front door, and it presents as "the login
  // button does nothing".
  //
  // FATAL, not a warning: a server nobody can enter is not serving. Three
  // methods count, and exactly one of them needs to work —
  //
  //   * real Google OAuth (GOOGLE_CLIENT_ID configured), or
  //   * email magic links, which need a real mailer — `auth/mailer.ts` is a
  //     NoopMailer in production until one is wired, so the deliverability
  //     signal is the env var that configures it, or
  //   * the Google sign-in SIMULATOR, which is the deliberate staging/demo
  //     path and is itself triple-gated (see config#isGoogleSignInSimulatorEnabled).
  //
  // The simulator counting here is the point: it is what makes a demo host
  // legitimately bootable before real credentials exist, while a genuine
  // production host — which never sets DEMO_ENV — still cannot start without
  // a real method.
  if (production) {
    const google = Boolean(settings.GOOGLE_CLIENT_ID);
    // Was `Boolean(process.env.MAILER_PROVIDER ?? process.env.SMTP_URL)`,
    // which read an empty string as a configured mailer — the way a compose
    // file spells "unset" by accident. `simulationMode` treats a blank
    // credential as absent, and distinguishes the real transport from the
    // simulated one, which matters below: a SIMULATED mailer delivers to an
    // in-process sink, so it is a way for a demo to sign in and is not a way
    // for a customer to.
    const mailerMode = simulationMode('mailer', env);
    const mailer = mailerMode === 'real';
    const simulator =
      (settings.DEMO_ENV === 'staging' && settings.GOOGLE_SIGNIN_SIMULATOR === true) ||
      mailerMode === 'simulated';

    if (!google && !mailer && !simulator) {
      failures.push(
        'No usable sign-in method is configured, so nobody can sign in and the deployment is ' +
          'a silent outage. The development bypass is disabled in production by design. ' +
          'Configure ONE of: GOOGLE_CLIENT_ID (real Google OAuth); a mail provider ' +
          '(MAILER_PROVIDER or SMTP_URL) so magic links are actually delivered — ' +
          'auth/mailer.ts is a NoopMailer until then and silently sends nothing; ' +
          'or, for a demo host only, DEMO_ENV=staging together with ' +
          'GOOGLE_SIGNIN_SIMULATOR=true.',
      );
    } else if (!google && !mailer && simulator) {
      warnings.push(
        'Sign-in is served by the SIMULATOR, not real Google, and magic links cannot be ' +
          'delivered (no mail provider configured). Correct for a demo host; never for ' +
          'anything real.',
      );
    }
  }

  // ── 3. CORS. ──────────────────────────────────────────────────────────────
  //
  // An empty allow-list refuses every cross-origin browser request. That is
  // the right DEFAULT for a server that has not been told who its client is,
  // and the wrong state for one serving a website — the failure presents to
  // the user as an unexplained network error, indistinguishable from offline.
  if (production && settings.CORS_ORIGINS.length === 0) {
    warnings.push(
      'CORS_ORIGINS is empty, so every cross-origin browser request will be refused. ' +
        'Set it to the website origin. Harmless if only the native app and a server-side BFF call this API.',
    );
  }

  // A wildcard should be impossible — the config parses a comma-separated
  // allow-list — but an operator can still write one in, and it would let any
  // page the user has open read their financial records.
  if (settings.CORS_ORIGINS.includes('*')) {
    failures.push(
      'CORS_ORIGINS contains "*". These responses carry financial records; the allow-list must name origins.',
    );
  }

  // ── 4. The KMS stand-in. ──────────────────────────────────────────────────
  //
  // `admin/crypto/kms.ts` wraps data keys with a local master key rather than
  // a cloud KMS. WRITING a new key under that provider in production is now a
  // hard refusal at the point of use (`encryptApiKey` throws) rather than
  // only a warning here — this boot-time check stays as a non-fatal, EARLIER
  // signal for an operator (before any staff member even tries to set a key),
  // and because reading an already-stored key deliberately still works under
  // the local provider (see that file's header), so its presence at boot is
  // not itself an error condition worth failing the whole process over.
  // Reads `env` rather than `process.env` directly, as of X2: the two are the
  // same thing at boot, and taking the parameter is what stops this check's
  // own tests from passing or failing according to whether the developer
  // running them happens to have a master key exported.
  if (production && env.ADMIN_KMS_MASTER_KEY && (env.ADMIN_KMS_PROVIDER ?? 'local') === 'local') {
    warnings.push(
      'Admin AI keys are wrapped by the LOCAL KMS stand-in (apps/server/src/admin/crypto/kms.ts), not a cloud KMS. ' +
        'Storing or rotating a key now THROWS in production under this provider — set ADMIN_KMS_PROVIDER to a ' +
        'real KmsProvider before a staff member needs to store one. Reading an already-stored key is unaffected.',
    );
  }

  // ── 5. The five simulated integrations. ───────────────────────────────────
  //
  // `docs/INTEGRATIONS.md` gate G-SIM: no simulator may be what is live by
  // accident. `integrations/simulation.ts` already refuses to SELECT a
  // simulator on a production host that has not declared itself a demo — so
  // by the time this runs, the dangerous case has been prevented. What is
  // left is the case it cannot fix on its own: an operator who set
  // `STRIPE_SIMULATOR=true` on a real production host and now believes
  // payments are being taken, when the truth is that the integration is
  // ABSENT and the buy button says so quietly.
  //
  // That belief is the fatal part, not the flag. A boot that continued would
  // make it discoverable only from a support ticket about missing revenue,
  // which is precisely the "green everywhere except where it matters" shape
  // this project keeps re-learning.
  const simulations = evaluateSimulations(env);
  for (const finding of simulations.refused) failures.push(finding.message);
  // Active simulators are a warning, never a failure: a demo host with four
  // of them running is correctly configured, and it must still be able to
  // boot. One line each, so none of the four is the one nobody mentions.
  for (const finding of simulations.active) warnings.push(finding.message);

  return { ok: failures.length === 0, failures, warnings };
}

/** The SQL the probe runs. Kept here so the check and its query stay together. */
export const PREFLIGHT_ROLE_SQL = `
  select current_user as role,
         (select bool_or(rolbypassrls or rolsuper) from pg_roles
           where rolname = current_user) as bypasses
`;
