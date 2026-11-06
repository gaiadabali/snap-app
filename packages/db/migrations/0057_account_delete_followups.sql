-- ---------------------------------------------------------------------------
-- 0057 — Account deletion follow-ups (group task 8.3.g, from 8.3.a's review)
--
--   L4  step-up. A person with no password to re-type (YourTal, Google, an
--       emailed link) must have signed in within the last N seconds. The API
--       decides WHO is passwordless and passes N (NULL = no step-up); the
--       session's own created_at, which only a sign-in sets, is the clock.
--   L5  staff. An account holding an unrevoked platform_staff row cannot delete
--       itself through the endpoint: the cascade would drop its staff row, with
--       nobody to grant it back. Ask another admin to revoke you first. (The
--       emailed-request script calls account_delete_queue directly: a person at
--       the root shell decides that.)
--   R1  a PARENT's deletion ends each teen space through teen_space_end, whose
--       teen notice promises "your parent can invite you again and the space
--       comes back". That cannot happen: the parent's erasure clears
--       teen_spaces.parent_user_id, and a restore needs the same parent (0047).
--       The notice now gets its own outcome, `teen_ended_parent_deleted`, with
--       no such promise. The outcome is swapped in teen_space_notice while the
--       transaction-local setting app.parent_deleting is on (set and cleared
--       around the one call, like app.user_id in 0055).
--       The PARENT's own notice ('teen_ended_parent', "invite them again and the
--       space comes back") is not queued at all in that case: the parent is being
--       erased, and the worker could mail it before it does (8.3.g review G6).
--
-- Replaces identity_account_delete_request(bytea) with (bytea, integer) that
-- answers a status instead of a boolean; same owner and grants. Everything else
-- is CREATE OR REPLACE of an existing function.
-- ---------------------------------------------------------------------------

-- L5 reads exactly the two columns 0039 gave app_identity.
GRANT SELECT (user_id, revoked_at) ON platform_staff TO app_teen;

DROP FUNCTION identity_account_delete_request(bytea);

-- 'queued' | 'no_session' | 'staff' | 'sign_in_again'. The user still comes
-- from the live session only (see 0055).
CREATE FUNCTION identity_account_delete_request(p_session_token_hash bytea, p_fresh_within_seconds integer)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user    uuid;
  v_created timestamptz;
BEGIN
  SELECT s.user_id, s.created_at INTO v_user, v_created FROM user_sessions s
   WHERE s.token_hash = p_session_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now();
  IF v_user IS NULL THEN
    RETURN 'no_session';
  END IF;
  IF EXISTS (SELECT 1 FROM platform_staff ps WHERE ps.user_id = v_user AND ps.revoked_at IS NULL) THEN
    RETURN 'staff';
  END IF;
  IF p_fresh_within_seconds IS NOT NULL AND v_created < now() - make_interval(secs => p_fresh_within_seconds) THEN
    RETURN 'sign_in_again';
  END IF;
  PERFORM account_delete_queue(v_user);
  RETURN 'queued';
END $fn$;

-- R1: the teen's notice, swapped while a parent's own deletion is ending the space.
CREATE OR REPLACE FUNCTION teen_space_notice(p_to uuid, p_outcome text, p_about uuid, p_date timestamptz)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  INSERT INTO jobs (id, tenant_id, kind, payload, max_attempts)
  SELECT gen_random_uuid(), NULL, 'erasure_notice',
         jsonb_strip_nulls(jsonb_build_object(
           'to', u.email,
           'outcome', CASE WHEN p_outcome = 'teen_ended_teen' AND current_setting('app.parent_deleting', true) = 'on'
                           THEN 'teen_ended_parent_deleted' ELSE p_outcome END,
           'name', (SELECT a.display_name FROM users a WHERE a.id = p_about),
           'date', p_date)),
         10
    FROM users u
   WHERE u.id = p_to AND u.email IS NOT NULL
     AND NOT (p_outcome = 'teen_ended_parent' AND current_setting('app.parent_deleting', true) IS NOT DISTINCT FROM 'on'); -- unset is NULL: never read as "skip"
$fn$;

-- The helper gains p_parent_deleting (true only for the parent's own deletion).
CREATE FUNCTION account_delete_end_teen_space(p_tenant uuid, p_parent uuid, p_parent_deleting boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_done boolean := false;
BEGIN
  IF p_parent_deleting THEN
    PERFORM set_config('app.parent_deleting', 'on', true);
  END IF;
  IF p_parent IS NOT NULL THEN
    PERFORM set_config('app.user_id', p_parent::text, true);
    BEGIN
      PERFORM teen_space_end(p_tenant);
      v_done := true;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL; -- the parent is not a YourTal account: the plain hold below
    END;
  END IF;
  IF NOT v_done THEN
    PERFORM teen_space_hold(p_tenant, 'infinity');
  END IF;
  PERFORM set_config('app.parent_deleting', 'off', true);
END $fn$;

CREATE OR REPLACE FUNCTION account_delete_queue(p_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_space teen_spaces%ROWTYPE;
BEGIN
  -- A teen is withdrawing: the same hold as "teen removed SnapApp"; the hold sweep
  -- (teen_space_erase_next) erases space and account after 30 days.
  SELECT t.* INTO v_space FROM teen_spaces t WHERE t.teen_user_id = p_user FOR UPDATE;
  IF FOUND THEN
    IF v_space.access_ended_at IS NULL THEN
      PERFORM account_delete_end_teen_space(v_space.tenant_id, v_space.parent_user_id, false);
    END IF;
  ELSE
    -- A parent: each live teen space ends first (invite ended at YourTal, hold, notices).
    FOR v_space IN
      SELECT t.* FROM teen_spaces t
       WHERE t.parent_user_id = p_user AND t.access_ended_at IS NULL
       ORDER BY t.tenant_id
         FOR UPDATE
    LOOP
      PERFORM account_delete_end_teen_space(v_space.tenant_id, p_user, true);
    END LOOP;

    INSERT INTO jobs (id, tenant_id, kind, payload, max_attempts)
    VALUES (gen_random_uuid(), NULL, 'account_delete', jsonb_build_object('userId', p_user), 10);
  END IF;

  UPDATE user_sessions s SET revoked_at = now(), revoked_reason = 'sign_out_everywhere'
   WHERE s.user_id = p_user AND s.revoked_at IS NULL;
END $fn$;

DROP FUNCTION account_delete_end_teen_space(uuid, uuid);

REVOKE EXECUTE ON FUNCTION identity_account_delete_request(bytea, integer)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION account_delete_end_teen_space(uuid, uuid, boolean)     FROM PUBLIC;
ALTER FUNCTION identity_account_delete_request(bytea, integer)        OWNER TO app_teen;
ALTER FUNCTION account_delete_end_teen_space(uuid, uuid, boolean)     OWNER TO app_teen;
GRANT EXECUTE ON FUNCTION identity_account_delete_request(bytea, integer) TO app_rw;

DO $$
BEGIN
  IF has_function_privilege('app_rw', 'account_delete_end_teen_space(uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('app_rw', 'account_delete_queue(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('app_rw', 'identity_account_delete_request(bytea,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'identity_account_delete_request is app_rw''s only; its helpers are internal';
  END IF;
  IF has_function_privilege('app_rw', 'teen_space_notice(uuid,text,uuid,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'teen_space_notice must stay internal';
  END IF;
END $$;
