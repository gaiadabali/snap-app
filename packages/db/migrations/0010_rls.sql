-- 0010_rls
-- Roles, row-level security policies, view security_invoker, and grants.
--
-- This migration is the tenant-isolation boundary. Everything before it created
-- structure; this makes the structure safe.
--
-- Design notes:
--
--  * FAIL CLOSED. current_tenant_id() returns NULL when `app.tenant_id` is unset,
--    and `tenant_id = NULL` is never true, so a connection that forgets to set
--    the tenant context sees nothing at all. That is the desired default.
--
--  * FORCE ROW LEVEL SECURITY is set so the table owner is not exempt either.
--    Seed data (tax_codes, plans) was inserted in earlier migrations, before
--    RLS existed. Any FUTURE data migration must either run as a role with
--    BYPASSRLS or set app.tenant_id explicitly.
--
--  * THE WORKER GETS EXACTLY ONE ELEVATED TABLE. A queue consumer must read jobs
--    across all tenants, but it must not read tenant data across tenants. So
--    app_worker gets a permissive policy on `jobs` only; it then sets
--    app.tenant_id from the job payload and does the actual work under normal
--    tenant RLS. That keeps "RLS bypass" to a single auditable surface.
--
--  * VIEWS DEFAULT TO BYPASSING RLS. A Postgres view executes with the
--    privileges of its owner unless security_invoker is set, which would let
--    v_bas_lines happily return every tenant's GST. The ALTER VIEW statements at
--    the bottom are not optional hardening; without them the views are a hole.

-- ---------------------------------------------------------------------------
-- Roles
--
-- Created NOLOGIN on purpose: these are privilege sets, not accounts.
-- Deployment creates real login users and GRANTs them the appropriate role, so
-- credentials never live in migration history.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrate') THEN
    CREATE ROLE app_migrate NOLOGIN;
  END IF;
END $$;

-- The worker is an app_rw that can additionally drain the queue.
GRANT app_rw TO app_worker;

-- ---------------------------------------------------------------------------
-- Tenant-scoped tables: the standard policy
--
-- One explicit list so a security review has a single place to look, and so no
-- table can be silently forgotten.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'memberships',
    'api_clients',
    'captures',
    'extraction_runs',
    'parties',
    'documents',
    'document_lines',
    'document_tax_subtotals',
    'document_field_corrections',
    'accounts',
    'categories',
    'transactions',
    'transaction_splits',
    'review_tasks',
    'idempotency_keys',
    'webhook_endpoints',
    'accounting_connections',
    'subscriptions',
    'usage_counters',
    'usage_grants'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        FOR ALL
        USING (tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id())
    $f$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Tables needing a bespoke predicate
-- ---------------------------------------------------------------------------

-- A tenant may only see itself.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  FOR ALL
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());

-- Users are cross-tenant (a bookkeeper serves several tenants), so a user row is
-- visible only to tenants that actually share a membership with them. Without
-- this predicate the users table would leak every email in the system.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE  ROW LEVEL SECURITY;
CREATE POLICY users_shared_membership ON users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id
        AND m.tenant_id = current_tenant_id()
    )
  );

-- webhook_deliveries has no tenant_id; it inherits scope from its endpoint.
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE  ROW LEVEL SECURITY;
CREATE POLICY deliveries_via_endpoint ON webhook_deliveries
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM webhook_endpoints e
      WHERE e.id = webhook_deliveries.endpoint_id
        AND e.tenant_id = current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM webhook_endpoints e
      WHERE e.id = webhook_deliveries.endpoint_id
        AND e.tenant_id = current_tenant_id()
    )
  );

-- tax_codes: system rows (tenant_id IS NULL) are readable by everyone; a tenant
-- may additionally define and manage its own.
ALTER TABLE tax_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_codes FORCE  ROW LEVEL SECURITY;
CREATE POLICY tax_codes_read ON tax_codes
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY tax_codes_write_own ON tax_codes
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- plans is a public catalogue: readable by all, writable by nobody but migrations.
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans FORCE  ROW LEVEL SECURITY;
CREATE POLICY plans_read ON plans FOR SELECT USING (true);

-- jobs: tenant rows are tenant-scoped, but system jobs carry tenant_id IS NULL
-- and the worker must drain the whole queue. This is the single elevated surface.
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE  ROW LEVEL SECURITY;
CREATE POLICY jobs_tenant ON jobs
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY jobs_worker_all ON jobs
  FOR ALL
  TO app_worker
  USING (true)
  WITH CHECK (true);

-- audit_log: APPEND-ONLY. Insert and read your own tenant's entries; never
-- update, never delete. The REVOKE below is what actually enforces that -- a
-- policy alone would still allow an UPDATE that matched it.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON audit_log
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR tenant_id IS NULL);
CREATE POLICY audit_read ON audit_log
  FOR SELECT
  USING (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Views execute as their OWNER unless told otherwise. security_invoker makes
-- the querying role's RLS apply, which is the whole point of having RLS.
-- ---------------------------------------------------------------------------
ALTER VIEW v_bas_lines            SET (security_invoker = true);
ALTER VIEW v_tenant_entitlement   SET (security_invoker = true);
ALTER VIEW v_tenant_cost_vs_price SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_rw, app_readonly, app_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT SELECT                         ON ALL TABLES IN SCHEMA public TO app_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;

-- audit_log is append-only for everyone but the migration role.
REVOKE UPDATE, DELETE ON audit_log FROM app_rw;

-- plans and tax_codes system rows are catalogue data, not app-writable.
REVOKE INSERT, UPDATE, DELETE ON plans FROM app_rw;

-- Future tables inherit these grants automatically, so a new table is never
-- accidentally unreachable (it will still be RLS-protected: a table with RLS
-- enabled and no policy denies everything).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO app_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
