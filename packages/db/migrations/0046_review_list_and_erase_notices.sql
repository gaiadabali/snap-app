-- ---------------------------------------------------------------------------
-- 0046 — Review list for staff, and erasure clean-ups
--
-- Group tasks 3.6.c (the manual review list) and 3.7.c (S2 review follow-ups).
--
-- 3.6.c. `yourtal_sign_in_reviews` (0039) is written by
-- identity_yourtal_review, and nothing read it: RLS is forced, there is no
-- policy, and no application role has a grant. Two SECURITY DEFINER functions,
-- owned by app_identity (the table's owner, BYPASSRLS), are the only way in:
--   admin_yourtal_review_list     the cases, open first, the email MASKED
--                                 (`k••••@example.com`); the YourTal `sub` is
--                                 never returned;
--   admin_yourtal_review_resolve  closes one case that is still open, with a
--                                 written resolution, and audits it.
-- Both check the `manage_operations` capability themselves, from inside
-- Postgres (the 0021 idiom), and are executable by app_rw (the admin API) only.
--
-- SECURITY-RELEVANT GRANTS, all to app_identity (NOLOGIN, owns the functions):
--   - EXECUTE on staff_has_capability (0021), for that check;
--   - INSERT on audit_log and USAGE on its sequence, for the audit row (kind and the resolution's length, never its free text).
--
-- 3.7.c(a). erase_person also deletes the OPEN `erasure_notice` jobs addressed
-- to the erased person's email (the worker already empties a finished one).
-- SECURITY-RELEVANT: app_erasure gets SELECT, DELETE on `jobs` (it had INSERT
-- only), to find and delete those rows. Same body as 0043 apart from that
-- statement; same owner and grants.
--
-- ADD-ONLY apart from erase_person's body.
-- ---------------------------------------------------------------------------

-- ── erase_person: also the open notices addressed to the person ──────────────

GRANT SELECT, DELETE ON jobs TO app_erasure;

CREATE OR REPLACE FUNCTION erase_person(p_user_id uuid)
RETURNS TABLE (workspace_id uuid, outcome text, notify_emails text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_email  citext;
  v_tenant uuid;
  v_role   text;
  v_heir   uuid;
  v_notify text[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'erase_person: user id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The person first, then their workspaces in id order: two erasures that
  -- share a workspace queue behind each other instead of deadlocking, and the
  -- second sees the first's membership gone.
  SELECT u.email INTO v_email FROM users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM 1 FROM tenants t
   WHERE t.id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = p_user_id)
   ORDER BY t.id
     FOR UPDATE;

  FOR v_tenant, v_role IN
    SELECT m.tenant_id, m.role FROM memberships m WHERE m.user_id = p_user_id ORDER BY m.tenant_id
  LOOP
    -- Hold the workspace's memberships still while deciding.
    PERFORM 1 FROM memberships m WHERE m.tenant_id = v_tenant ORDER BY m.user_id FOR UPDATE;

    IF v_role IN ('owner', 'admin') AND NOT EXISTS (
         SELECT 1 FROM memberships o
          WHERE o.tenant_id = v_tenant AND o.user_id <> p_user_id AND o.role IN ('owner', 'admin'))
    THEN
      SELECT COALESCE(array_agg(u.email::text ORDER BY u.email::text), '{}') INTO v_notify
        FROM memberships o JOIN users u ON u.id = o.user_id
       WHERE o.tenant_id = v_tenant AND o.user_id <> p_user_id AND u.email IS NOT NULL;
      PERFORM erase_workspace(v_tenant);
      RETURN QUERY SELECT v_tenant, 'erased'::text, v_notify;

    ELSIF v_role = 'owner' AND NOT EXISTS (
         SELECT 1 FROM memberships o
          WHERE o.tenant_id = v_tenant AND o.user_id <> p_user_id AND o.role = 'owner')
    THEN
      -- An admin remains (else the branch above): the earliest becomes owner.
      SELECT o.user_id INTO v_heir FROM memberships o
       WHERE o.tenant_id = v_tenant AND o.user_id <> p_user_id AND o.role = 'admin'
       ORDER BY o.created_at, o.user_id
       LIMIT 1;
      UPDATE memberships m SET role = 'owner' WHERE m.tenant_id = v_tenant AND m.user_id = v_heir;
      SELECT COALESCE(array_agg(u.email::text), '{}') INTO v_notify FROM users u WHERE u.id = v_heir AND u.email IS NOT NULL;
      RETURN QUERY SELECT v_tenant, 'handed_over'::text, v_notify;
    END IF;
  END LOOP;

  IF v_email IS NOT NULL THEN
    DELETE FROM mail_deliveries d WHERE lower(d.recipient) = lower(v_email::text);
    -- Notices still waiting to go to their address (0046): the address must
    -- not outlive them in a queue row. A finished one was emptied by the worker.
    DELETE FROM jobs j
     WHERE j.kind = 'erasure_notice' AND j.completed_at IS NULL
       AND lower(j.payload ->> 'to') = lower(v_email::text);
  END IF;
  -- Invitations the person accepted carry their email into shared workspaces.
  -- Pending ones someone else typed are that workspace's own data.
  DELETE FROM invitations i WHERE i.accepted_by = p_user_id;

  -- Sessions, links, outbox, memberships, staff row and points ledger
  -- cascade; attribution in shared workspaces becomes NULL.
  DELETE FROM users u WHERE u.id = p_user_id;
END;
$fn$;

COMMENT ON FUNCTION erase_person(uuid) IS
  'Erases a person: workspaces they run alone (with a storage_purge job each), handover of a shared workspace they solely own to its earliest admin, mail records and open erasure_notice jobs addressed to them, then the user (attribution elsewhere becomes NULL). Idempotent; one transaction. Executable by app_worker only. 0043, 0046, docs/29 §6.';

-- ── The staff review list ────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION staff_has_capability(platform_capability) TO app_identity;
GRANT INSERT ON audit_log TO app_identity;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO app_identity;

CREATE OR REPLACE FUNCTION admin_yourtal_review_list(p_open_only boolean DEFAULT true)
RETURNS TABLE (
  id uuid, kind text, email_masked text, user_id uuid, other_user_id uuid, attempts integer,
  first_seen_at timestamptz, last_seen_at timestamptz,
  resolved_at timestamptz, resolved_by uuid, resolution text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_operations') THEN
    RAISE EXCEPTION 'missing capability: manage_operations' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT r.id, r.kind,
         CASE WHEN r.email IS NULL THEN NULL
              ELSE left(r.email::text, 1) || '••••' || COALESCE(substring(r.email::text from '@.*$'), '') END,
         r.user_id, r.other_user_id, r.attempts, r.first_seen_at, r.last_seen_at,
         r.resolved_at, r.resolved_by, r.resolution
    FROM yourtal_sign_in_reviews r
   WHERE NOT COALESCE(p_open_only, true) OR r.resolved_at IS NULL
   ORDER BY (r.resolved_at IS NOT NULL), r.last_seen_at DESC, r.id
   LIMIT 200;
END $fn$;

COMMENT ON FUNCTION admin_yourtal_review_list(boolean) IS
  'Staff (manage_operations): the Sign in with YourTal review cases, open first, email masked, no sub. 0046.';

CREATE OR REPLACE FUNCTION admin_yourtal_review_resolve(p_id uuid, p_resolution text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_text text := btrim(p_resolution);
  v_kind text;
BEGIN
  IF NOT staff_has_capability('manage_operations') THEN
    RAISE EXCEPTION 'missing capability: manage_operations' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_text IS NULL OR length(v_text) = 0 OR length(v_text) > 500 THEN
    RAISE EXCEPTION 'a resolution of 1 to 500 characters is required' USING ERRCODE = 'check_violation';
  END IF;

  -- Only while open: a second resolution never overwrites the first.
  UPDATE yourtal_sign_in_reviews r
     SET resolved_at = now(), resolved_by = current_user_id(), resolution = v_text
   WHERE r.id = p_id AND r.resolved_at IS NULL
   RETURNING r.kind INTO v_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such open review case' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES ('platform_staff', current_user_id(), 'admin_yourtal_review_resolve', 'yourtal_sign_in_review', p_id,
          -- The length, not the text: the log is append-only and outlives the person erased.
          jsonb_build_object('kind', v_kind, 'resolution_length', length(v_text)));
  RETURN true;
END $fn$;

COMMENT ON FUNCTION admin_yourtal_review_resolve(uuid, text) IS
  'Staff (manage_operations): closes one OPEN Sign in with YourTal review case with a written resolution; audited. 0046.';

REVOKE EXECUTE ON FUNCTION admin_yourtal_review_list(boolean)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_yourtal_review_resolve(uuid, text)   FROM PUBLIC;
ALTER FUNCTION admin_yourtal_review_list(boolean)       OWNER TO app_identity;
ALTER FUNCTION admin_yourtal_review_resolve(uuid, text) OWNER TO app_identity;
GRANT EXECUTE ON FUNCTION admin_yourtal_review_list(boolean)       TO app_rw;
GRANT EXECUTE ON FUNCTION admin_yourtal_review_resolve(uuid, text) TO app_rw;

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('app_readonly', 'admin_yourtal_review_list(boolean)', 'EXECUTE')
     OR has_function_privilege('app_readonly', 'admin_yourtal_review_resolve(uuid, text)', 'EXECUTE')
     OR NOT has_function_privilege('app_rw', 'admin_yourtal_review_list(boolean)', 'EXECUTE')
     OR NOT has_function_privilege('app_rw', 'admin_yourtal_review_resolve(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the review functions must be executable by app_rw, not app_readonly';
  END IF;
  IF has_table_privilege('app_rw', 'yourtal_sign_in_reviews', 'SELECT')
     OR has_table_privilege('app_worker', 'yourtal_sign_in_reviews', 'SELECT') THEN
    RAISE EXCEPTION 'application roles must still have no grant on yourtal_sign_in_reviews';
  END IF;
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'admin_yourtal_review_resolve(uuid, text)'::regprocedure) <> 'app_identity' THEN
    RAISE EXCEPTION 'the review functions must be owned by app_identity';
  END IF;
  IF NOT has_table_privilege('app_erasure', 'jobs', 'DELETE') THEN
    RAISE EXCEPTION 'erase_person needs DELETE on jobs';
  END IF;
END $$;
