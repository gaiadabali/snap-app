-- ---------------------------------------------------------------------------
-- 0055 — Deleting your own account from the app: identity_account_delete_request
--
-- Group task 8.3.a (yourtal/docs/29 §6: "8.3.a's in-app delete calls
-- erase_person"). erase_person is the worker's only (0043), so the API cannot
-- run it. It asks THIS function, which resolves the caller and calls
-- account_delete_queue (below), which does three things in ONE transaction:
--
--   1. resolves the caller from their live session itself: the user is never an
--      argument, so no caller (and no bug in the API) can name another person
--      (the idiom of identity_sessions_revoke_all and identity_password_change);
--   2. ends the person's teen spaces through the existing `teen_space_end` (0047),
--      so YourTal's invite is ended, both people are told and the 30-day hold
--      starts (F111):
--        - a PARENT: each live teen space they are the parent of, then their
--          own account is queued for erasure;
--        - a TEEN: their own space only, as a withdrawal. The account is NOT
--          queued: the hold sweep (teen_space_erase_next) erases the space and
--          the account after 30 days, and the teen cannot sign in meanwhile;
--   3. queues one NULL-tenant `account_delete` job ({"userId"}) for the worker,
--      which runs erase_person, and ends every session of the account.
--
-- WHY THE JOB'S USER ID CAN BE TRUSTED. Nothing but this function can write an
-- `account_delete` row with no tenant: 0010's `jobs_tenant` lets app_rw write
-- only rows of its own tenant (the worker refuses any such row of this kind),
-- and 0044's policy admits only kind `yourtal_event`. The function is owned by
-- `app_teen` (NOLOGIN, BYPASSRLS, the role the teen functions already use: it
-- may read users and sessions, update sessions and insert jobs), with its
-- search_path pinned, and executable by app_rw only. The self-check below
-- fails the migration if any app_rw INSERT policy on jobs could admit the kind.
--
-- ADD-ONLY: no existing object changes. (The first line of the header of 0044 gave the API an
-- INSERT policy for `yourtal_event`; this migration adds none.)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION identity_account_delete_request(p_session_token_hash bytea)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user uuid;
BEGIN
  SELECT s.user_id INTO v_user FROM user_sessions s
   WHERE s.token_hash = p_session_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now();
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  PERFORM account_delete_queue(v_user);
  RETURN true;
END $fn$;

-- Internal, and the ONE place the deletion is decided: no grants, so only this
-- file's function above (a signed-in person, for themselves) and a staff member
-- running it as postgres on Helios (an emailed request, docs/DEPLOY.md
-- "Account deletion requests by email") can reach it.
CREATE OR REPLACE FUNCTION account_delete_queue(p_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_space teen_spaces%ROWTYPE;
BEGIN
  -- A teen is withdrawing: the same hold as "teen removed SnapApp". The account is
  -- NOT queued: the hold sweep (teen_space_erase_next) erases space and account after 30 days.
  SELECT t.* INTO v_space FROM teen_spaces t WHERE t.teen_user_id = p_user FOR UPDATE;
  IF FOUND THEN
    IF v_space.access_ended_at IS NULL THEN
      PERFORM account_delete_end_teen_space(v_space.tenant_id, v_space.parent_user_id);
    END IF;
  ELSE
    -- A parent: each live teen space ends first (invite ended at YourTal, hold, notices).
    FOR v_space IN
      SELECT t.* FROM teen_spaces t
       WHERE t.parent_user_id = p_user AND t.access_ended_at IS NULL
       ORDER BY t.tenant_id
         FOR UPDATE
    LOOP
      PERFORM account_delete_end_teen_space(v_space.tenant_id, p_user);
    END LOOP;

    INSERT INTO jobs (id, tenant_id, kind, payload, max_attempts)
    VALUES (gen_random_uuid(), NULL, 'account_delete', jsonb_build_object('userId', p_user), 10);
  END IF;

  UPDATE user_sessions s SET revoked_at = now(), revoked_reason = 'sign_out_everywhere'
   WHERE s.user_id = p_user AND s.revoked_at IS NULL;
END $fn$;

-- Internal: ends one live teen space through teen_space_end, acting as its
-- parent (that function reads the parent from app.user_id, set for this
-- transaction only). With no parent left, or one who cannot end it, the hold
-- starts without the YourTal call: there is nobody to end it for.
CREATE OR REPLACE FUNCTION account_delete_end_teen_space(p_tenant uuid, p_parent uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_parent IS NOT NULL THEN
    PERFORM set_config('app.user_id', p_parent::text, true);
    BEGIN
      PERFORM teen_space_end(p_tenant);
      RETURN;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL; -- the parent is not a YourTal account: fall through to the plain hold
    END;
  END IF;
  PERFORM teen_space_hold(p_tenant, 'infinity');
END $fn$;

REVOKE EXECUTE ON FUNCTION identity_account_delete_request(bytea)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION account_delete_queue(uuid)                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION account_delete_end_teen_space(uuid, uuid)   FROM PUBLIC;
ALTER FUNCTION identity_account_delete_request(bytea)      OWNER TO app_teen;
ALTER FUNCTION account_delete_queue(uuid)                  OWNER TO app_teen;
ALTER FUNCTION account_delete_end_teen_space(uuid, uuid)   OWNER TO app_teen;
GRANT EXECUTE ON FUNCTION identity_account_delete_request(bytea) TO app_rw;

DO $$
BEGIN
  -- (app_worker is a member of app_rw, so it inherits the first: it holds no session to name.)
  IF has_function_privilege('app_rw', 'account_delete_end_teen_space(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('app_rw', 'account_delete_queue(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('app_rw', 'identity_account_delete_request(bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'identity_account_delete_request is app_rw''s only; its helper is internal';
  END IF;
  -- No way for the API to write the job itself.
  IF EXISTS (SELECT 1 FROM pg_policies p
              WHERE p.tablename = 'jobs' AND p.cmd IN ('INSERT', 'ALL')
                AND ('app_rw' = ANY (p.roles::name[]) OR 'public' = ANY (p.roles::name[]))
                AND p.with_check LIKE '%account_delete%') THEN
    RAISE EXCEPTION 'no jobs policy may let app_rw insert an account_delete job';
  END IF;
END $$;
