-- ---------------------------------------------------------------------------
-- 0056 — Teen scan credits in /v1/usage (7.1 review L3)
--
-- A teen's scan spends a credit from the parent's workspace (0045). That
-- credit is recorded in `teen_space_spends`, which the API roles cannot read
-- (no tenant_id, see 0045's header). So /v1/usage showed every teen scan as 0
-- credits in the teen's space, and left it out of the parent's list although
-- the parent's balance dropped.
--
-- THE TEEN'S SIDE. `credit_spends.parent_funded` (new, default false) is set
-- by the spend code on the teen's own spend row when the parent's credit was
-- taken. The row itself then says "this took a credit", with no link to the
-- parent's record, so it still counts 1 after the teen deletes the capture
-- (both capture_id columns go NULL), the same as the parent's line. It is a
-- display flag only: it earns nothing (`paid` stays false, 0039's insert
-- policy still recomputes it). Existing teen rows are backfilled below.
--
-- THE PARENT'S SIDE. One READ-ONLY SECURITY DEFINER function, owned by
-- app_teen like the other teen functions (it already holds SELECT on
-- teen_space_spends and memberships, so no grant is widened and no table is
-- opened to the API roles):
--
--   teen_space_funded_spends(p_from, p_to)
--     In the funding workspace, and ONLY for its OWNER (the parent who invited
--     the teen must own it, 0045): the credits its teens' scans took, one row
--     each: id, spent_at, refunded. Other members of that workspace get no
--     rows: the teen agreed that their parent sees their scans, not staff. NO
--     capture id, supplier, amount or teen identity. NULL bounds mean
--     unbounded; the range is [p_from, p_to). (The capture link that would
--     name the inviting parent is lost when a capture is deleted, so the
--     owner is the test. A workspace handed to a new owner shows the old
--     lines to that owner.)
--
-- Reads the transaction's tenant and user as the other teen_space_* functions
-- do. SECURITY: new read access across the tenant boundary, limited to the
-- fields above and to the funding workspace's owner.
-- ---------------------------------------------------------------------------

-- credit_spends is busy: give up rather than queue behind live spends (as 0043/0047).
SET LOCAL lock_timeout = '5s';
ALTER TABLE credit_spends ADD COLUMN IF NOT EXISTS parent_funded boolean NOT NULL DEFAULT false;

UPDATE credit_spends cs SET parent_funded = true
  FROM teen_space_spends s
 WHERE s.capture_id = cs.capture_id AND s.grant_id IS NOT NULL AND NOT cs.parent_funded;

-- The month filter and the ON DELETE CASCADE from tenants both look up by funding workspace.
CREATE INDEX IF NOT EXISTS teen_space_spends_by_funding
  ON teen_space_spends (funding_tenant_id, spent_at) WHERE grant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION teen_space_funded_spends(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (id uuid, spent_at timestamptz, refunded boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT s.id, s.spent_at, s.refunded_at IS NOT NULL
    FROM teen_space_spends s
   WHERE s.funding_tenant_id = current_tenant_id() AND s.grant_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM memberships m
                  WHERE m.tenant_id = s.funding_tenant_id AND m.user_id = current_user_id() AND m.role = 'owner')
     AND (p_from IS NULL OR s.spent_at >= p_from)
     AND (p_to   IS NULL OR s.spent_at <  p_to);
$fn$;

REVOKE EXECUTE ON FUNCTION teen_space_funded_spends(timestamptz, timestamptz) FROM PUBLIC;
ALTER FUNCTION teen_space_funded_spends(timestamptz, timestamptz) OWNER TO app_teen;
GRANT EXECUTE ON FUNCTION teen_space_funded_spends(timestamptz, timestamptz) TO app_rw;

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.proname = 'teen_space_funded_spends'
     AND p.prosecdef AND p.provolatile = 's'
     AND p.proconfig::text LIKE '%search_path%'
     AND pg_get_userbyid(p.proowner) = 'app_teen'
     AND p.proacl IS NOT NULL  -- a NULL acl means PUBLIC may execute
     AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                      WHERE a.grantee = 0 OR pg_get_userbyid(a.grantee) NOT IN ('app_teen', 'app_rw'));
  IF n <> 1 THEN
    RAISE EXCEPTION 'teen_space_funded_spends must be definer, stable, pinned, owned by app_teen, executable by app_rw only';
  END IF;
END $$;
