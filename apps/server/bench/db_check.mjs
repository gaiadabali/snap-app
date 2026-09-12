// Bench-only helper (lane D territory, apps/server/bench/**): counts pending
// `jobs` rows for one capture, scoped through the same RLS the app itself
// goes through.
//
// Why this exists: `bench/e2e.py` originally inferred "exactly one extract
// job per capture" from `work-once.ts`'s "processed N job(s)" line. That
// line counts whatever the worker happened to drain out of the SHARED dev
// `jobs` table in one run — including stale jobs left over from earlier,
// unrelated test runs in the same session (this table accumulated 17 such
// rows during this rewrite). Reading that aggregate count as "how many jobs
// did MY capture produce" is a false signal, not a measurement — it does not
// distinguish "the server queued two jobs for my capture" (a real bug) from
// "the worker also picked up someone else's leftover job in the same batch"
// (test-history noise). This script asks the only question that actually
// answers the contract rule: how many `extract` jobs currently reference
// THIS captureId.
//
// `jobs` carries row-level security (packages/db/migrations/0010_rls.sql):
// a connection that never sets `app.user_id` / `app.tenant_id` sees zero
// rows, not an error, which silently produced "0 jobs" on a first attempt at
// this check — worth recording so nobody re-derives that surprise by hand.
import pg from 'pg';

const [, , captureId, tenantId] = process.argv;
if (!captureId || !tenantId) {
  console.error('usage: node db_check.mjs <captureId> <tenantId>');
  process.exit(2);
}

const client = new pg.Client({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://snap_app:app-dev-password@127.0.0.1:55499/snapapps',
});

await client.connect();
try {
  await client.query('BEGIN');
  // Same two-step session context `withTenantAs` sets (packages/db/src/client.ts)
  // -- the exact user id is irrelevant to this SELECT, only the tenant is.
  await client.query("select set_config('app.user_id', $1, true)", [
    '00000000-0000-4000-8000-000000000000',
  ]);
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
  const r = await client.query(
    "select count(*)::int as n from jobs where kind = 'extract' and payload->>'captureId' = $1",
    [captureId],
  );
  await client.query('COMMIT');
  console.log(r.rows[0].n);
} finally {
  await client.end();
}
