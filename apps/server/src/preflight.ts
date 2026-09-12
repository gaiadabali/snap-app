import type { Config } from './config.js';

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

export function evaluatePreflight(settings: Config, probe: PreflightProbe): PreflightResult {
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
  // `/v1/auth/sign-in` is now correctly 404 in production. That closes an
  // authentication bypass and, on a server with no Google client id, leaves no
  // working sign-in path at all — the site would deploy and simply refuse
  // everyone. Magic links still work if a mailer is configured, so this is a
  // warning rather than a failure.
  if (production && !settings.GOOGLE_CLIENT_ID) {
    warnings.push(
      'GOOGLE_CLIENT_ID is not set, and the development sign-in bypass is disabled in production. ' +
        'Unless email magic links are configured and deliverable, nobody can sign in.',
    );
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
  if (production && process.env.ADMIN_KMS_MASTER_KEY && (process.env.ADMIN_KMS_PROVIDER ?? 'local') === 'local') {
    warnings.push(
      'Admin AI keys are wrapped by the LOCAL KMS stand-in (apps/server/src/admin/crypto/kms.ts), not a cloud KMS. ' +
        'Storing or rotating a key now THROWS in production under this provider — set ADMIN_KMS_PROVIDER to a ' +
        'real KmsProvider before a staff member needs to store one. Reading an already-stored key is unaffected.',
    );
  }

  return { ok: failures.length === 0, failures, warnings };
}

/** The SQL the probe runs. Kept here so the check and its query stay together. */
export const PREFLIGHT_ROLE_SQL = `
  select current_user as role,
         (select bool_or(rolbypassrls or rolsuper) from pg_roles
           where rolname = current_user) as bypasses
`;
