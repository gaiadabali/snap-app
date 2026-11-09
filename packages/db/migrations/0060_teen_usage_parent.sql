-- ---------------------------------------------------------------------------
-- 0060 — Teen usage lines belong to the inviting parent (7.1 gap after 0056)
--
-- 0056's `teen_space_funded_spends` showed a teen's paid scans to whoever
-- OWNS the funding workspace now, because a spend row did not say whose teen
-- made it (the capture link is lost when the capture is deleted). A workspace
-- handed to a new owner then showed the old owner's teen lines to the new one.
--
-- `teen_space_spends.parent_user_id` (new) records the space's inviting parent
-- when the credit is taken, and the read is scoped to it: the parent sees
-- their teen's lines in the funding workspace whatever their role there now;
-- nobody else does, the new owner included. Erasing the parent nulls it
-- (ON DELETE SET NULL), and the lines go with them.
--
-- BACKFILL, best known parent: the capture's space; else the one parent whose
-- spaces that workspace funds; else the workspace's owner now (the spend could
-- only be taken while the parent owned it, so this is wrong only for a
-- workspace already handed over before this migration).
--
-- Reverse: restore 0056's teen_space_funded_spends and 0047's
-- teen_space_take_credit, then ALTER TABLE teen_space_spends DROP COLUMN parent_user_id.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '5s';
ALTER TABLE teen_space_spends
  ADD COLUMN IF NOT EXISTS parent_user_id uuid REFERENCES users (id) ON DELETE SET NULL;

UPDATE teen_space_spends s SET parent_user_id = t.parent_user_id
  FROM captures c JOIN teen_spaces t ON t.tenant_id = c.tenant_id
 WHERE c.id = s.capture_id AND s.parent_user_id IS NULL;

UPDATE teen_space_spends s SET parent_user_id = p.parent_user_id
  FROM (SELECT funding_tenant_id, min(parent_user_id::text)::uuid AS parent_user_id
          FROM teen_spaces WHERE parent_user_id IS NOT NULL AND funding_tenant_id IS NOT NULL
         GROUP BY funding_tenant_id HAVING count(DISTINCT parent_user_id) = 1) p
 WHERE p.funding_tenant_id = s.funding_tenant_id AND s.parent_user_id IS NULL;

UPDATE teen_space_spends s SET parent_user_id = m.user_id
  FROM memberships m
 WHERE m.tenant_id = s.funding_tenant_id AND m.role = 'owner' AND s.parent_user_id IS NULL;

CREATE INDEX IF NOT EXISTS teen_space_spends_by_parent ON teen_space_spends (parent_user_id);

-- 0047's function, with the parent recorded on the insert (the only change).
CREATE OR REPLACE FUNCTION teen_space_take_credit(p_capture uuid)
RETURNS TABLE (teen_space boolean, grant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_space  teen_spaces%ROWTYPE;
  v_fund   uuid;
  v_grant  uuid;
BEGIN
  SELECT * INTO v_space FROM teen_spaces t WHERE t.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM captures c WHERE c.id = p_capture AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'teen_space_take_credit: not a capture of this space' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT s.grant_id INTO v_grant FROM teen_space_spends s WHERE s.capture_id = p_capture;
  IF FOUND THEN
    RETURN QUERY SELECT true, v_grant;
    RETURN;
  END IF;

  IF v_space.access_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Your access to SnapApp has ended, so your parent''s credits can''t pay for scans.'
      USING ERRCODE = 'TS004';
  END IF;

  -- The parent's credits, so only while the parent still owns that workspace
  -- (F112): one handed over, left or deleted pays for nothing more.
  v_fund := v_space.funding_tenant_id;
  IF v_fund IS NULL OR v_space.parent_user_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM memberships m
        WHERE m.tenant_id = v_fund AND m.user_id = v_space.parent_user_id AND m.role = 'owner') THEN
    RAISE EXCEPTION 'Your scans use your parent''s credits, and their workspace can''t pay for them any more. Ask your parent to invite you again.'
      USING ERRCODE = 'TS004';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('credit_spend'), hashtext(v_fund::text));
  FOR i IN 1..5 LOOP
    UPDATE usage_grants u SET remaining = u.remaining - 1
      FROM (SELECT g.id FROM usage_grants g
             WHERE g.tenant_id = v_fund AND g.metric = 'scans' AND g.remaining > 0
               AND (g.expires_at IS NULL OR g.expires_at > now())
             ORDER BY EXISTS (SELECT 1 FROM credit_purchases cp WHERE cp.grant_id = g.id AND cp.status = 'paid'),
                      (g.source = 'signup_bonus') DESC, g.granted_at, g.id
             LIMIT 1) pick
     WHERE u.id = pick.id AND u.remaining > 0
    RETURNING u.id INTO v_grant;
    EXIT WHEN v_grant IS NOT NULL;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM usage_grants g
                           WHERE g.tenant_id = v_fund AND g.metric = 'scans' AND g.remaining > 0
                             AND (g.expires_at IS NULL OR g.expires_at > now()));
  END LOOP;

  INSERT INTO teen_space_spends (capture_id, funding_tenant_id, grant_id, parent_user_id)
  VALUES (p_capture, v_fund, v_grant, v_space.parent_user_id);
  RETURN QUERY SELECT true, v_grant;
END $fn$;

-- 0056's read, scoped to the parent who invited the teen instead of the owner now.
-- withTenantAs has already checked the caller is a member of this workspace.
CREATE OR REPLACE FUNCTION teen_space_funded_spends(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (id uuid, spent_at timestamptz, refunded boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT s.id, s.spent_at, s.refunded_at IS NOT NULL
    FROM teen_space_spends s
   WHERE s.funding_tenant_id = current_tenant_id() AND s.grant_id IS NOT NULL
     AND s.parent_user_id = current_user_id()
     AND (p_from IS NULL OR s.spent_at >= p_from)
     AND (p_to   IS NULL OR s.spent_at <  p_to);
$fn$;

-- CREATE OR REPLACE keeps owner and grants; asserted as 0056 does.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.proname IN ('teen_space_funded_spends', 'teen_space_take_credit')
     AND p.prosecdef AND p.proconfig::text LIKE '%search_path%'
     AND pg_get_userbyid(p.proowner) = 'app_teen'
     AND p.proacl IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                      WHERE a.grantee = 0 OR pg_get_userbyid(a.grantee) NOT IN ('app_teen', 'app_rw'));
  IF n <> 2 THEN
    RAISE EXCEPTION 'teen_space_funded_spends and teen_space_take_credit must stay definer, pinned, owned by app_teen, executable by app_rw only';
  END IF;
END $$;
