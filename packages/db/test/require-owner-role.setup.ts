import { Client } from 'pg';

/**
 * These suites are the OWNER's. Refuse the application role, with the reason.
 *
 * WHY THIS EXISTS. Run `packages/db` as `snap_app` and you get fourteen
 * failures that impersonate a schema regression: `drift.test.ts` reads
 * `information_schema.tables`, which lists only tables the connecting role
 * holds a privilege on, so the admin-plane tables read as "declared in TS but
 * absent from the database"; and the fixtures insert directly into `tenants`
 * and `tax_codes`, which RLS forbids to the application role.
 *
 * The database is perfectly healthy in that state. It cost two people an
 * afternoon on 2026-09-18 and produced a confident bug report blaming an
 * innocent commit, which is the specific damage this guard prevents — not the
 * lost time, the false accusation.
 *
 * `.github/workflows/ci.yml` already gets this right and the split is easy to
 * miss: THIS package's job runs with `DATABASE_URL=postgres://postgres:...`,
 * while the `apps/server` job runs as `snap_app`. Both are deliberate.
 *
 * SCOPED TO THIS PACKAGE ON PURPOSE. `require-db.setup.ts` is shared with
 * `apps/server`, whose suites MUST connect as the unprivileged `snap_app`
 * because RLS is half of what they prove. Putting this check there broke that
 * run the first time it was written. A rule that is wrong somewhere gets
 * switched off everywhere, so it lives in its own file, referenced only by
 * `packages/db/vitest.config.ts`.
 *
 * Tests that need the unprivileged role still get it, from
 * `SNAP_TEST_APP_DATABASE_URL`.
 */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch {
    // Postgres being down is not this guard's business. The suites already
    // handle an absent database, and turning "cannot connect" into a role
    // error would be the same class of misleading failure this prevents.
    return;
  }

  try {
    const { rows } = await client.query<{ who: string; privileged: boolean }>(
      `select current_user as who, (rolsuper or rolbypassrls) as privileged
         from pg_roles where rolname = current_user`,
    );
    const row = rows[0];
    if (row && !row.privileged) {
      throw new Error(
        `packages/db's suites must connect as the schema OWNER, but DATABASE_URL is the ` +
          `unprivileged role "${row.who}".\n\n` +
          `Nothing is wrong with your database. Run it this way and you get ~14 failures that ` +
          `impersonate a schema regression: drift.test.ts reads information_schema.tables, which ` +
          `hides tables the role has no privilege on, and the fixtures insert into tenants and ` +
          `tax_codes, which RLS forbids to the application role.\n\n` +
          `Use the connection CI uses for this package (.github/workflows/ci.yml):\n` +
          `  DATABASE_URL=postgres://postgres:verify@127.0.0.1:55499/snapapps\n` +
          `  SNAP_TEST_APP_DATABASE_URL=postgres://snap_app:app-dev-password@127.0.0.1:55499/snapapps\n\n` +
          `apps/server's suites are the opposite and must stay as snap_app — RLS is half of ` +
          `what they prove.`,
      );
    }
  } finally {
    await client.end();
  }
}
