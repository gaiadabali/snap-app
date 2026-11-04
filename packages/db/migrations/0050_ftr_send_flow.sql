-- ---------------------------------------------------------------------------
-- 0050 — the sign-in flow of a "Send to Free Tax Returns" (group task 4.8.a, S2)
--
-- 0049 added yourtal_sign_in_flows.ftr_send_id, but app_rw cannot touch the
-- flow table (0039: every access is a SECURITY DEFINER function owned by
-- app_identity), so S2's endpoints need three functions and nothing else:
--
--   identity_yourtal_flow_set_ftr_send  at start: link the open flow to its send
--   identity_yourtal_flow_take_ftr_send at the send's finish: take ONLY a flow
--                                       that carries a send
--   identity_yourtal_flow_take          (replaced) at the sign-in finish: take
--                                       ONLY a flow that carries none
--
-- The last two are each other's complement, so neither finish can burn the
-- other's flow: a send flow handed to the sign-in finish (or the reverse)
-- answers "no flow" and stays usable. Without the extra condition the sign-in
-- finish would consume it, and ID-token claims of a send's confirmation would
-- reach the account-linking function.
--
-- Same shape, owner and grants as 0048. CREATE OR REPLACE keeps the owner and
-- the ACL of identity_yourtal_flow_take. Add-only otherwise: no table changes.
-- Reverse: DROP the two new functions, then re-create identity_yourtal_flow_take
-- from 0039 (without the ftr_send_id condition).
-- ---------------------------------------------------------------------------

-- Link an open flow to its send. False for an unknown, used or expired flow.
-- The caller made the send under the session's own workspace; the finish
-- re-checks that under RLS (a foreign key ignores RLS, see 0049's S2 note).
CREATE OR REPLACE FUNCTION identity_yourtal_flow_set_ftr_send(p_flow_id uuid, p_send_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH u AS (
    UPDATE yourtal_sign_in_flows f
       SET ftr_send_id = p_send_id
     WHERE f.id = p_flow_id AND f.consumed_at IS NULL AND f.expires_at > now()
       AND f.ftr_send_id IS NULL AND f.teen_invite_id IS NULL AND f.move_user_id IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM u);
$fn$;

-- The send finish's take: once, unexpired, and only a flow that carries a send.
CREATE OR REPLACE FUNCTION identity_yourtal_flow_take_ftr_send(p_flow_id uuid)
RETURNS TABLE (client text, state text, nonce text, code_verifier text, return_to text, sign_up boolean, ftr_send_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  UPDATE yourtal_sign_in_flows f
     SET consumed_at = now()
   WHERE f.id = p_flow_id
     AND f.consumed_at IS NULL
     AND f.expires_at > now()
     AND f.ftr_send_id IS NOT NULL
  RETURNING f.client, f.state, f.nonce, f.code_verifier, f.return_to, f.sign_up, f.ftr_send_id;
$fn$;

-- The sign-in finish's take (0039), now refusing a flow that carries a send.
CREATE OR REPLACE FUNCTION identity_yourtal_flow_take(p_flow_id uuid)
RETURNS TABLE (client text, state text, nonce text, code_verifier text, return_to text, sign_up boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  UPDATE yourtal_sign_in_flows f
     SET consumed_at = now()
   WHERE f.id = p_flow_id
     AND f.consumed_at IS NULL
     AND f.expires_at > now()
     AND f.ftr_send_id IS NULL
  RETURNING f.client, f.state, f.nonce, f.code_verifier, f.return_to, f.sign_up;
$fn$;

REVOKE EXECUTE ON FUNCTION identity_yourtal_flow_set_ftr_send(uuid, uuid)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_yourtal_flow_take_ftr_send(uuid)       FROM PUBLIC;
ALTER FUNCTION identity_yourtal_flow_set_ftr_send(uuid, uuid)  OWNER TO app_identity;
ALTER FUNCTION identity_yourtal_flow_take_ftr_send(uuid)       OWNER TO app_identity;
GRANT EXECUTE ON FUNCTION identity_yourtal_flow_set_ftr_send(uuid, uuid)  TO app_rw;
GRANT EXECUTE ON FUNCTION identity_yourtal_flow_take_ftr_send(uuid)       TO app_rw;

DO $$
BEGIN
  IF has_function_privilege('app_readonly', 'identity_yourtal_flow_set_ftr_send(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('app_readonly', 'identity_yourtal_flow_take_ftr_send(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the send-flow functions are not for the read-only role';
  END IF;
END $$;
