-- ---------------------------------------------------------------------------
-- 0054 — the admin AI page reads what each run really cost (group plan 7.2).
--
-- The worker now writes `extraction_runs.cost_micros` (AUD micros) for every
-- model call, including failed ones and statement chunks. Two things in 0021
-- hid that cost, and this changes them:
--
--   - `admin_ai_usage_summary` summed cost for SUCCEEDED runs only, so the
--     money spent on failed calls never showed. It sums every run now, and
--     rounds to 4 places: a scan costs about A$0.0005, which round(..., 2) shows
--     as 0.00.
--   - `admin_analytics_overview` made the same succeeded-only, 2-place sum.
--
-- New: `admin_ai_cost_daily`, one row per day for the last 30 days with the
-- cost, the number of scans (distinct captures) and the cost per scan.
--
-- Same discipline as 0021: SECURITY DEFINER, owner app_platform, capability
-- re-checked inside the body, EXECUTE for app_rw only. No table changes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION admin_ai_usage_summary()
RETURNS TABLE (engine extraction_engine, model_id text, runs bigint, succeeded bigint,
               failed bigint, cost_aud numeric, avg_latency_ms numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_ai_config') THEN
    RAISE EXCEPTION 'missing capability: manage_ai_config' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT e.engine, e.model_id, count(*),
         count(*) FILTER (WHERE e.status = 'succeeded'),
         count(*) FILTER (WHERE e.status = 'failed'),
         COALESCE(round(sum(e.cost_micros) / 1000000.0, 4), 0),
         round(avg(e.latency_ms), 1)
    FROM extraction_runs e
   WHERE e.started_at > now() - interval '30 days'
   GROUP BY e.engine, e.model_id
   ORDER BY count(*) DESC;
END $fn$;

CREATE OR REPLACE FUNCTION admin_analytics_overview()
RETURNS TABLE (
  tenant_count            bigint,
  active_tenant_count     bigint,
  user_count              bigint,
  staff_count             bigint,
  document_count          bigint,
  extraction_success_rate numeric,
  cost_aud_30d            numeric,
  revenue_aud_30d         numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('view_analytics') THEN
    RAISE EXCEPTION 'missing capability: view_analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM tenants WHERE deleted_at IS NULL),
    (SELECT count(*) FROM tenants t WHERE t.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM subscriptions s
                    WHERE s.tenant_id = t.id AND s.status IN ('trialing', 'active', 'past_due'))),
    (SELECT count(*) FROM users),
    (SELECT count(*) FROM platform_staff WHERE revoked_at IS NULL),
    (SELECT count(*) FROM documents),
    (SELECT CASE WHEN count(*) FILTER (WHERE status IN ('succeeded', 'failed')) = 0 THEN NULL
                 ELSE round(
                   count(*) FILTER (WHERE status = 'succeeded')::numeric
                   / count(*) FILTER (WHERE status IN ('succeeded', 'failed')), 4)
            END
       FROM extraction_runs WHERE started_at > now() - interval '30 days'),
    (SELECT COALESCE(round(sum(cost_micros) / 1000000.0, 4), 0)
       FROM extraction_runs WHERE finished_at > now() - interval '30 days'),
    (SELECT COALESCE(round(sum(p.price_cents) / 100.0, 2), 0)
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.status IN ('trialing', 'active', 'past_due'));
END $fn$;

CREATE OR REPLACE FUNCTION admin_ai_cost_daily()
RETURNS TABLE (day date, runs bigint, scans bigint, cost_aud numeric, cost_per_scan_aud numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_ai_config') THEN
    RAISE EXCEPTION 'missing capability: manage_ai_config' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A scan is a capture; a failed scan still cost money, so failed runs count.
  -- The day is the UTC day of the run.
  RETURN QUERY
  SELECT (e.started_at AT TIME ZONE 'UTC')::date,
         count(*),
         count(DISTINCT e.capture_id),
         COALESCE(round(sum(e.cost_micros) / 1000000.0, 4), 0),
         COALESCE(round(sum(e.cost_micros) / 1000000.0 / NULLIF(count(DISTINCT e.capture_id), 0), 4), 0)
    FROM extraction_runs e
   WHERE e.started_at > now() - interval '30 days'
   GROUP BY 1
   ORDER BY 1 DESC;
END $fn$;

ALTER FUNCTION admin_ai_cost_daily() OWNER TO app_platform;
REVOKE ALL ON FUNCTION admin_ai_cost_daily() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_ai_cost_daily() TO app_rw;
