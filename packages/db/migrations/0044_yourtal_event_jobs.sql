-- ---------------------------------------------------------------------------
-- 0044 — The YourTal events endpoint may queue its job
--
-- Group task 3.7, ticket S2 (yourtal/docs/29-deletion-across-apps.md §6).
-- `POST /v1/yourtal/events` (the API, app_rw) stores each verified Security
-- Event Token as a `jobs` row: id = the SET's jti, kind `yourtal_event`, and
-- tenant_id NULL, because the job erases workspaces and a job inside one would
-- cascade away mid-run. 0010's `jobs_tenant` only lets app_rw write rows of
-- the tenant in `app.tenant_id`, so a NULL-tenant row was impossible.
--
-- This adds exactly that one shape for app_rw: INSERT only, tenant_id NULL,
-- kind `yourtal_event`. No SELECT, UPDATE or DELETE, and no other kind. The
-- endpoint's ON CONFLICT DO NOTHING names no conflict target on purpose: with
-- `(id)` Postgres would also apply SELECT policies to the new row. The payload is no
-- trust boundary: the worker re-verifies YourTal's signature on the raw SET
-- before acting, and never reads a user id from the payload.
-- ---------------------------------------------------------------------------

CREATE POLICY jobs_yourtal_event_insert ON jobs
  FOR INSERT
  TO app_rw
  WITH CHECK (tenant_id IS NULL AND kind = 'yourtal_event');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE tablename = 'jobs' AND policyname = 'jobs_yourtal_event_insert'
                    AND cmd = 'INSERT' AND roles = '{app_rw}') THEN
    RAISE EXCEPTION 'jobs_yourtal_event_insert must be INSERT-only, for app_rw';
  END IF;
END $$;
