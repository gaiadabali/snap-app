-- ---------------------------------------------------------------------------
-- 0056 — Read side of teen scan credits, for /v1/usage (7.1 review L3)
--
-- A teen's scan spends a credit from the parent's workspace (0045). That
-- credit is recorded in `teen_space_spends`, which the API roles cannot read
-- (no tenant_id, see 0045's header). So /v1/usage showed every teen scan as 0
-- credits in the teen's space, and left it out of the parent's list although
-- the parent's balance dropped.
--
-- Two READ-ONLY SECURITY DEFINER functions, owned by app_teen like the other
-- teen functions (it already holds SELECT on teen_space_spends and captures,
-- so no grant is widened and no table is opened to the API roles):
--
--   teen_space_paid_captures()
--     In a teen space: the ids of its captures whose scan took a parent
--     credit. Nothing outside the current space: each row is joined to a
--     capture of current_tenant_id(). The teen's own usage list uses it to show
--     1 credit for a paid scan (its credit_spends row has no grant of its own).
--
--   teen_space_funded_spends(p_from, p_to)
--     In the parent's (funding) workspace: the credits its teens' scans took,
--     one row each: id, spent_at, refunded. NO capture id, supplier, amount or
--     teen identity: the parent's list says "Teen scan", and what the receipt
--     held stays in the teen's space under the existing membership rules.
--     NULL bounds mean unbounded; the range is [p_from, p_to).
--
-- Both read the transaction's tenant, as the other teen_space_* functions do.
-- ADD-ONLY: two functions. SECURITY: new read access across the
-- tenant boundary, limited to the fields above.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION teen_space_paid_captures() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT s.capture_id
    FROM teen_space_spends s
    JOIN captures c ON c.id = s.capture_id
   WHERE c.tenant_id = current_tenant_id() AND s.grant_id IS NOT NULL;
$fn$;

CREATE OR REPLACE FUNCTION teen_space_funded_spends(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (id uuid, spent_at timestamptz, refunded boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT s.id, s.spent_at, s.refunded_at IS NOT NULL
    FROM teen_space_spends s
   WHERE s.funding_tenant_id = current_tenant_id() AND s.grant_id IS NOT NULL
     AND (p_from IS NULL OR s.spent_at >= p_from)
     AND (p_to   IS NULL OR s.spent_at <  p_to);
$fn$;

REVOKE EXECUTE ON FUNCTION teen_space_paid_captures()                       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_funded_spends(timestamptz, timestamptz) FROM PUBLIC;
ALTER FUNCTION teen_space_paid_captures()                         OWNER TO app_teen;
ALTER FUNCTION teen_space_funded_spends(timestamptz, timestamptz) OWNER TO app_teen;
GRANT EXECUTE ON FUNCTION teen_space_paid_captures()                         TO app_rw;
GRANT EXECUTE ON FUNCTION teen_space_funded_spends(timestamptz, timestamptz) TO app_rw;

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO bad FROM pg_proc p
   WHERE p.proname IN ('teen_space_paid_captures', 'teen_space_funded_spends')
     AND NOT (p.prosecdef AND p.proconfig::text LIKE '%search_path%'
              AND pg_get_userbyid(p.proowner) = 'app_teen'
              AND NOT has_function_privilege('public', p.oid, 'EXECUTE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'teen usage functions must be definer, pinned, owned by app_teen, not public: %', bad;
  END IF;
END $$;
