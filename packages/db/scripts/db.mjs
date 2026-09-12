#!/usr/bin/env node
/**
 * Local Postgres lifecycle + migration runner.
 *
 * Migrations are plain ordered .sql files, applied inside a transaction each and
 * recorded in `_migrations`. No migration framework: the schema uses domains,
 * plpgsql, deferrable constraint triggers, RLS and security_invoker views, so the
 * SQL is hand-authored and this only needs to apply it in order, once.
 *
 *   node scripts/db.mjs up       start the container
 *   node scripts/db.mjs migrate  apply pending migrations
 *   node scripts/db.mjs reset    drop + recreate + migrate
 *   node scripts/db.mjs down     stop and remove the container
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'migrations');

const CONTAINER = process.env.SNAP_PG_CONTAINER ?? 'snapdb';
const PORT = process.env.SNAP_PG_PORT ?? '55499';
const DB = 'snapapps';
const PASSWORD = 'verify';
export const URL = `postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/${DB}`;

const docker = (args, opts = {}) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe', ...opts });

function up() {
  try {
    const state = docker(['inspect', '-f', '{{.State.Running}}', CONTAINER]).trim();
    if (state === 'true') {
      console.log(`${CONTAINER} already running on ${PORT}`);
      return waitReady();
    }
    docker(['rm', '-f', CONTAINER]);
  } catch {
    /* not present */
  }
  docker([
    'run', '-d', '--name', CONTAINER,
    '-e', `POSTGRES_PASSWORD=${PASSWORD}`,
    '-e', `POSTGRES_DB=${DB}`,
    '-p', `127.0.0.1:${PORT}:5432`,
    'postgres:17-alpine',
  ]);
  console.log(`started ${CONTAINER} on 127.0.0.1:${PORT}`);
  return waitReady();
}

function waitReady() {
  docker([
    'exec', CONTAINER, 'sh', '-c',
    `for i in $(seq 90); do pg_isready -U postgres -d ${DB} >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1`,
  ]);
  console.log('postgres ready');
  console.log(`DATABASE_URL=${URL}`);
}

function psql(sqlText) {
  return docker(
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sqlText },
  );
}

function migrate() {
  psql(`CREATE TABLE IF NOT EXISTS _migrations (
           name text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         );`);

  const applied = new Set(
    docker(
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB, '-tAc',
       'SELECT name FROM _migrations'],
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let ran = 0;
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`  = ${f} (already applied)`);
      continue;
    }
    const body = readFileSync(join(MIGRATIONS, f), 'utf8');
    // Each migration is one transaction: a failure leaves nothing behind.
    psql(`BEGIN;\n${body}\nINSERT INTO _migrations (name) VALUES ('${f}');\nCOMMIT;`);
    console.log(`  + ${f}`);
    ran += 1;
  }
  console.log(ran ? `applied ${ran} migration(s)` : 'nothing to apply');
}

function reset() {
  docker(
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: `DROP DATABASE IF EXISTS ${DB} WITH (FORCE); CREATE DATABASE ${DB};` },
  );
  console.log(`recreated ${DB}`);
  migrate();
}

/**
 * Creates the LOGIN role the application connects as.
 *
 * This exists because of a real failure, not as tidiness. The server was
 * connecting as `postgres`, and a **superuser bypasses row-level security
 * entirely** — `rolbypassrls` is true and no policy is ever evaluated. Every
 * tenant isolation guarantee was therefore resting on the application's own
 * membership check, with the database contributing nothing.
 *
 * It surfaced as a household budget appearing in a business workspace, and
 * alongside it a missing `tenant_id` predicate on an UPDATE that demoted a
 * user in EVERY workspace at once — a bug that only existed because RLS was
 * supposed to scope the statement and was silently absent.
 *
 * `app_rw` is NOLOGIN by design (it is a privilege set, not an account), so a
 * real login role is granted it. Nothing here is a production credential: a
 * deployment creates its own and this password never leaves a dev machine.
 */
function appuser() {
  const password = process.env.APP_DB_PASSWORD || 'app-dev-password';
  psql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'snap_app') THEN
        CREATE ROLE snap_app LOGIN PASSWORD '${password}';
      ELSE
        ALTER ROLE snap_app WITH LOGIN PASSWORD '${password}';
      END IF;
    END $$;

    -- Explicitly NOT a superuser and NOT BYPASSRLS. Stated rather than assumed,
    -- because the default is what caused the problem this role exists to fix.
    ALTER ROLE snap_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

    GRANT app_rw TO snap_app;
    GRANT USAGE ON SCHEMA public TO snap_app;
    -- Sequences, so bigserial columns (audit_log) can be written.
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snap_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO snap_app;

    -- The worker is a SEPARATE account, because it needs one privilege the API
    -- must never have: app_worker carries a policy on \`jobs\` — and only on
    -- \`jobs\` — that spans tenants, so a queue consumer can see work it has no
    -- tenant context for. Having claimed a job it calls withTenant with that
    -- job's own tenant, so the elevated read stays confined to the queue.
    --
    -- If the API connected as this role, every request would be one forgotten
    -- WHERE clause away from reading another tenant's queue.
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'snap_worker') THEN
        CREATE ROLE snap_worker LOGIN PASSWORD '${password}';
      ELSE
        ALTER ROLE snap_worker WITH LOGIN PASSWORD '${password}';
      END IF;
    END $$;

    ALTER ROLE snap_worker NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

    GRANT app_worker TO snap_worker;
    GRANT USAGE ON SCHEMA public TO snap_worker;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snap_worker;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO snap_worker;
  `);
  console.log('created role snap_app    (NOSUPERUSER, NOBYPASSRLS, member of app_rw)');
  console.log('created role snap_worker (NOSUPERUSER, NOBYPASSRLS, member of app_worker)');
  console.log(
    `DATABASE_URL=postgres://snap_app:${password}@127.0.0.1:${PORT}/${DB}`,
  );
  console.log(
    `WORKER_DATABASE_URL=postgres://snap_worker:${password}@127.0.0.1:${PORT}/${DB}`,
  );
}

function down() {
  try {
    docker(['rm', '-f', CONTAINER]);
    console.log(`removed ${CONTAINER}`);
  } catch {
    console.log(`${CONTAINER} not present`);
  }
}

const cmd = process.argv[2];
try {
  if (cmd === 'up') up();
  else if (cmd === 'migrate') migrate();
  else if (cmd === 'appuser') appuser();
  else if (cmd === 'reset') reset();
  else if (cmd === 'down') down();
  else {
    console.error('usage: db.mjs up|migrate|appuser|reset|down');
    process.exit(2);
  }
} catch (err) {
  console.error(err.stderr?.toString?.() || err.message);
  process.exit(1);
}
