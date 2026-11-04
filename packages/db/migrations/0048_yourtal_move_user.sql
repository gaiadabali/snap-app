-- ---------------------------------------------------------------------------
-- 0048 — "Sign in with YourTal to keep your account" must not swap accounts
-- (group 3.6.e follow-up; 3.6/3.7c review finding 2)
--
-- 0039 links by verified email only. A signed-in legacy person who follows the
-- move prompt with a DIFFERENT YourTal email used to land silently in a new,
-- empty account. Now the flow remembers which account asked to move
-- (`move_user_id`, set by the API from the authenticated session, never from
-- the request body), and the finish asks `identity_yourtal_move_mismatch`
-- BEFORE `identity_yourtal_sign_in`: if the sign-in would not resolve to that
-- same account, the API refuses and writes nothing.
--
-- 0039 / 0043's functions are not touched. A flow without `move_user_id`
-- (every ordinary sign-in) behaves exactly as before.
-- ---------------------------------------------------------------------------

ALTER TABLE yourtal_sign_in_flows
  ADD COLUMN IF NOT EXISTS move_user_id uuid REFERENCES users (id) ON DELETE CASCADE;

COMMENT ON COLUMN yourtal_sign_in_flows.move_user_id IS
  'The signed-in account that started this flow from the move prompt (0048). NULL for an ordinary sign-in.';

-- Record who asked to move. False for an unknown, used or expired flow.
CREATE OR REPLACE FUNCTION identity_yourtal_flow_set_move(p_flow_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH u AS (
    UPDATE yourtal_sign_in_flows f
       SET move_user_id = p_user_id
     WHERE f.id = p_flow_id AND f.consumed_at IS NULL AND f.expires_at > now()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM u);
$fn$;

-- True when the flow came from the move prompt and this `sub` / email would
-- NOT resolve to the account that asked. Mirrors identity_yourtal_sign_in's own
-- order: a known `sub` first, else the account holding the email, else (no
-- holder) a new account, which is a mismatch. An erased `sub` is left to the
-- sign-in function's own refusal. Writes nothing.
CREATE OR REPLACE FUNCTION identity_yourtal_move_mismatch(p_flow_id uuid, p_sub text, p_email citext)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_move     uuid;
  v_resolves uuid;
BEGIN
  SELECT f.move_user_id INTO v_move FROM yourtal_sign_in_flows f WHERE f.id = p_flow_id;
  IF v_move IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM yourtal_erased_subjects e WHERE e.sub = p_sub) THEN RETURN false; END IF;

  SELECT u.id INTO v_resolves FROM users u WHERE u.subject = 'yourtal|' || p_sub;
  IF v_resolves IS NULL AND p_email IS NOT NULL THEN
    SELECT u.id INTO v_resolves FROM users u WHERE u.email = p_email;
  END IF;
  RETURN v_resolves IS DISTINCT FROM v_move;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION identity_yourtal_flow_set_move(uuid, uuid)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_yourtal_move_mismatch(uuid, text, citext)    FROM PUBLIC;
ALTER FUNCTION identity_yourtal_flow_set_move(uuid, uuid)         OWNER TO app_identity;
ALTER FUNCTION identity_yourtal_move_mismatch(uuid, text, citext) OWNER TO app_identity;
GRANT EXECUTE ON FUNCTION identity_yourtal_flow_set_move(uuid, uuid)         TO app_rw;
GRANT EXECUTE ON FUNCTION identity_yourtal_move_mismatch(uuid, text, citext) TO app_rw;

DO $$
BEGIN
  IF has_function_privilege('app_readonly', 'identity_yourtal_move_mismatch(uuid,text,citext)', 'EXECUTE')
     OR has_function_privilege('app_readonly', 'identity_yourtal_flow_set_move(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the move functions are not for the read-only role';
  END IF;
END $$;
