-- ---------------------------------------------------------------------------
-- 0043 — Erasing a person: the erased-sub list, SET NULL attribution, and
--        erase_person()
--
-- Group task 3.7, ticket S1 (yourtal/docs/29-deletion-across-apps.md §6).
-- When someone deletes their YourTal account, YourTal sends `account-deleted`
-- and SnapApp erases what it holds about them within 72 hours. This is the
-- database half; S2 adds the endpoint and the job that call it.
--
-- THIS DESTROYS DATA. What goes and what stays (docs/29 §8, founder Q1, Q2, Q4):
--   - Every workspace the person runs alone is erased in full: receipts and
--     their files, documents, ledgers, statements, goals, credit purchases
--     and voucher redemptions. "Alone" means the person is an owner or admin
--     and no OTHER owner or admin remains, whatever `tenants.kind` says
--     (docs/29 §9). Receipts inside the ATO's five years go too (Q1): the duty
--     to keep them is the taxpayer's.
--   - A shared workspace stays. The person's membership goes and their
--     attribution (uploaded_by, posted_by, ...) becomes NULL: the records are
--     the business's.
--   - The only owner of a shared workspace: its earliest admin becomes owner.
--     With no admin (say only a bookkeeper is left) it is erased (Q2); S2's
--     job emails the remaining members from what erase_person returns.
--   - Then the person: sessions, links, memberships, staff row and points
--     ledger cascade; mail_deliveries to their address are deleted.
--   - Kept: audit_log (staff actions by id, append-only) and the erased `sub`.
--
-- WHY EXPLICIT DELETES BEFORE THE TENANT ROW. `captures.tenant_id` is ON
-- DELETE RESTRICT (0003), `transactions`/`statements`/`event_observations`
-- reference documents with no ON DELETE rule (0006, 0031, 0032), and
-- `goal_contributions` is RESTRICT on statement lines (0033). So a workspace
-- holding receipts cannot be removed by deleting its tenant row; it is taken
-- apart in dependency order, every statement scoped by `tenant_id` to the one
-- workspace being erased, and only then is the tenant row deleted (the rest
-- cascades). Files live under `{tenantId}/`; a `storage_purge` job queued in
-- the same transaction removes the directory (S2's worker).
--
-- WHO MAY CALL IT. erase_person is SECURITY DEFINER, owned by a new
-- `app_erasure` role in the 0015/0021 idiom (NOLOGIN, BYPASSRLS, never a
-- superuser, granted only what these functions touch), and executable ONLY
-- by `app_worker`: S2's job runs it. The API (`app_rw`) cannot.
-- erase_workspace is internal (no grant), for erase_person and later S3.
--
-- ADD-ONLY, with these deliberate changes to existing objects:
--   - six FKs to users re-created ON DELETE SET NULL (they had no rule, so
--     deleting anyone who uploaded or reviewed something failed); all six
--     columns are already nullable. Re-creating them fires
--     `documents_bump_version` when reviewed_by is nulled, which is harmless;
--   - 0036's `user_sessions_reason` CHECK widened by one reason;
--   - the BODY of 0039's `identity_yourtal_sign_in` (same signature, owner and
--     grants): an erased `sub` is refused before rule 1.
-- ---------------------------------------------------------------------------

-- ── yourtal_erased_subjects ──────────────────────────────────────────────────
--
-- A YourTal `sub` whose account YourTal deleted. Sign-in refuses it for ever
-- (docs/26 §2.2: "never recreate this sub"), and after a restore from backup
-- it is how SnapApp knows the person had gone (docs/29 §1). Holds nothing but
-- the opaque pairwise `sub`. Reached only through app_identity's functions.
CREATE TABLE IF NOT EXISTS yourtal_erased_subjects (
  sub        text PRIMARY KEY,
  erased_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT yourtal_erased_subjects_sub CHECK (length(sub) BETWEEN 1 AND 255)
);

ALTER TABLE yourtal_erased_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE yourtal_erased_subjects FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON yourtal_erased_subjects FROM app_rw, app_worker, app_readonly;
GRANT SELECT, INSERT ON yourtal_erased_subjects TO app_identity;

-- ── The six user references with no ON DELETE rule → SET NULL ────────────────

ALTER TABLE captures
  DROP CONSTRAINT IF EXISTS captures_uploaded_by_fkey,
  ADD  CONSTRAINT captures_uploaded_by_fkey
       FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_reviewed_by_fkey,
  ADD  CONSTRAINT documents_reviewed_by_fkey
       FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE document_field_corrections
  DROP CONSTRAINT IF EXISTS document_field_corrections_corrected_by_fkey,
  ADD  CONSTRAINT document_field_corrections_corrected_by_fkey
       FOREIGN KEY (corrected_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_posted_by_fkey,
  ADD  CONSTRAINT transactions_posted_by_fkey
       FOREIGN KEY (posted_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE review_tasks
  DROP CONSTRAINT IF EXISTS review_tasks_resolved_by_fkey,
  ADD  CONSTRAINT review_tasks_resolved_by_fkey
       FOREIGN KEY (resolved_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE accounting_connections
  DROP CONSTRAINT IF EXISTS accounting_connections_connected_by_fkey,
  ADD  CONSTRAINT accounting_connections_connected_by_fkey
       FOREIGN KEY (connected_by) REFERENCES users (id) ON DELETE SET NULL;

-- ── A new reason a session ends ──────────────────────────────────────────────
-- YourTal's account-deleted / access-ended events (S2).
ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS user_sessions_reason;
ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_reason CHECK (
  revoked_reason IS NULL OR revoked_reason IN
    ('sign_out', 'sign_out_everywhere', 'password_changed', 'password_reset', 'email_proven',
     'yourtal_linked', 'yourtal_event')
);

-- ── The erasure owner ────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_erasure') THEN
    CREATE ROLE app_erasure NOLOGIN BYPASSRLS;
  END IF;
END $$;

ALTER ROLE app_erasure NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

COMMENT ON ROLE app_erasure IS
  'Owns erase_person / erase_workspace (0043). NOLOGIN: a privilege set, never an account. BYPASSRLS because erasure spans tenants. Granted only the tables those functions touch; cascades run as the table owner.';

GRANT USAGE ON SCHEMA public TO app_erasure;
-- FOR UPDATE needs UPDATE: the user and workspace rows are locked first.
GRANT SELECT, UPDATE, DELETE ON users, tenants TO app_erasure;
GRANT SELECT, UPDATE         ON memberships  TO app_erasure;
GRANT SELECT, DELETE ON goals, event_observations, match_candidates, review_tasks,
                        transactions, statements, yourtal_voucher_redemptions,
                        documents, captures, mail_deliveries
  TO app_erasure;
-- recompute_goal_saved (0030) runs as the deleting role when contributions
-- cascade from their goal.
GRANT UPDATE ON goals TO app_erasure;
GRANT SELECT ON goal_contributions TO app_erasure;
GRANT INSERT ON jobs TO app_erasure;

-- ── Sign in with YourTal: refuse an erased `sub` ─────────────────────────────
-- 0039's function, unchanged but for step 0.
CREATE OR REPLACE FUNCTION identity_yourtal_sign_in(
  p_sub            text,
  p_email          citext,
  p_email_verified boolean,
  p_name           text,
  p_strong_auth    boolean,
  p_recent_auth    boolean
) RETURNS TABLE (outcome text, user_id uuid, email_flagged boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_subject  text;
  v_name     text := NULLIF(btrim(p_name), '');
  v_user     users%ROWTYPE;
  v_holder   users%ROWTYPE;
  v_other    uuid;
  v_flagged  boolean := false;
  v_new_id   uuid;
  v_staff    boolean;
BEGIN
  -- Opaque, case-sensitive, up to 255 characters (docs/26 §1.2). Refused
  -- rather than trimmed: a `sub` that is not exactly what YourTal sent would
  -- be a different person's key.
  IF p_sub IS NULL OR length(p_sub) = 0 OR length(p_sub) > 255 OR p_sub ~ '[[:cntrl:][:space:]]' THEN
    RAISE EXCEPTION 'identity_yourtal_sign_in: malformed sub' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_subject := 'yourtal|' || p_sub;

  -- Serialise sign-ins for one `sub`, then for one email (always in that
  -- order, so two of these cannot deadlock). Two first sign-ins from the same
  -- person, or two different `sub`s racing for one email, are decided one
  -- after the other: the second sees what the first wrote.
  PERFORM pg_advisory_xact_lock(hashtextextended('yourtal-sub:' || p_sub, 0));
  IF p_email IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('yourtal-email:' || lower(p_email::text), 0));
  END IF;

  -- ── 0. An erased `sub`: never again (0043) ──────────────────────────────────
  -- YourTal said this person deleted their account (docs/29 §4.3). The `sub`
  -- maps to nobody now, so it neither finds the old account nor makes a new
  -- one (docs/26 §2.2: never recreate this `sub`).
  IF EXISTS (SELECT 1 FROM yourtal_erased_subjects e WHERE e.sub = p_sub) THEN
    RETURN QUERY SELECT 'erased'::text, NULL::uuid, false;
    RETURN;
  END IF;

  -- ── 1. A known `sub`: that account, always ─────────────────────────────────
  SELECT * INTO v_user FROM users u WHERE u.subject = v_subject FOR UPDATE;
  IF v_user.id IS NOT NULL THEN
    v_staff := EXISTS (SELECT 1 FROM platform_staff ps WHERE ps.user_id = v_user.id AND ps.revoked_at IS NULL);
    IF v_staff AND NOT COALESCE(p_strong_auth, false) THEN
      RETURN QUERY SELECT 'staff_strong_auth_required'::text, v_user.id, false;
      RETURN;
    END IF;
    IF v_staff AND NOT COALESCE(p_recent_auth, false) THEN
      RETURN QUERY SELECT 'staff_reauth_required'::text, v_user.id, false;
      RETURN;
    END IF;

    -- The email copy. YourTal's latest value wins, unless another account
    -- holds it: then the old copy stays and the case is flagged (docs/26
    -- §1.10: never treat the email copy as unique). The other sign-in routes
    -- do not take the advisory locks, so an account can claim the address
    -- between the look and the write: the unique index catches that, and it
    -- is the same case.
    IF p_email IS NOT NULL AND v_user.email IS DISTINCT FROM p_email THEN
      SELECT u.id INTO v_other FROM users u WHERE u.email = p_email AND u.id <> v_user.id;
      IF v_other IS NULL THEN
        BEGIN
          UPDATE users
             SET email = p_email,
                 email_verified_at = CASE WHEN COALESCE(p_email_verified, false) THEN now() END
           WHERE id = v_user.id;
        EXCEPTION WHEN unique_violation THEN
          SELECT u.id INTO v_other FROM users u WHERE u.email = p_email AND u.id <> v_user.id;
        END;
      END IF;
      IF v_other IS NOT NULL THEN
        v_flagged := true;
        PERFORM identity_yourtal_review('email_collision', p_sub, p_email, v_user.id, v_other);
      END IF;
    ELSIF p_email IS NOT NULL AND COALESCE(p_email_verified, false) AND v_user.email_verified_at IS NULL THEN
      UPDATE users SET email_verified_at = now() WHERE id = v_user.id;
    END IF;

    IF v_name IS NOT NULL THEN
      UPDATE users SET display_name = v_name WHERE id = v_user.id AND display_name IS DISTINCT FROM v_name;
    END IF;
    UPDATE users SET yourtal_linked_at = now() WHERE id = v_user.id AND yourtal_linked_at IS NULL;

    RETURN QUERY SELECT 'signed_in'::text, v_user.id, v_flagged;
    RETURN;
  END IF;

  -- ── 2. A new `sub` and an account with this email ──────────────────────────
  IF p_email IS NOT NULL THEN
    SELECT * INTO v_holder FROM users u WHERE u.email = p_email FOR UPDATE;
  END IF;

  IF v_holder.id IS NOT NULL THEN
    -- Already linked to another `sub` (by either mark): never linked again
    -- (docs/26 §1.10).
    IF identity_yourtal_is_linked(v_holder.subject, v_holder.yourtal_linked_at) THEN
      PERFORM identity_yourtal_review('second_sub', p_sub, p_email, v_holder.id, NULL);
      RETURN QUERY SELECT 'second_sub'::text, NULL::uuid, false;
      RETURN;
    END IF;

    -- The one-time link rests entirely on YourTal having proven the mailbox.
    IF NOT COALESCE(p_email_verified, false) THEN
      RETURN QUERY SELECT 'email_unverified'::text, NULL::uuid, false;
      RETURN;
    END IF;

    -- Only the legacy formats this codebase wrote (see the header).
    IF NOT (v_holder.subject LIKE 'dev|%' OR v_holder.subject LIKE 'pwd|%') THEN
      PERFORM identity_yourtal_review('unlinkable_account', p_sub, p_email, v_holder.id, NULL);
      RETURN QUERY SELECT 'unlinkable_account'::text, NULL::uuid, false;
      RETURN;
    END IF;

    v_staff := EXISTS (SELECT 1 FROM platform_staff ps WHERE ps.user_id = v_holder.id AND ps.revoked_at IS NULL);
    IF v_staff AND NOT COALESCE(p_strong_auth, false) THEN
      RETURN QUERY SELECT 'staff_strong_auth_required'::text, v_holder.id, false;
      RETURN;
    END IF;
    IF v_staff AND NOT COALESCE(p_recent_auth, false) THEN
      RETURN QUERY SELECT 'staff_reauth_required'::text, v_holder.id, false;
      RETURN;
    END IF;

    -- Link, once. From here YourTal is the only door to this account
    -- (docs/26 §1.10), so EVERY other door closes in the same transaction,
    -- whether or not the address was proven before:
    --   - the password goes (the SQL door refuses it anyway; nothing should
    --     keep a credential for a door that no longer exists);
    --   - every session ends, including any a squatter opened with a password
    --     set on an address nobody had proven (0036's pre-hijacking case,
    --     which a verification link alone does not evict);
    --   - every mailed link (reset, verification) stops working.
    -- The person's own new session is opened right after, through YourTal.
    UPDATE users
       SET subject = v_subject,
           yourtal_linked_at = now(),
           display_name = COALESCE(v_name, display_name),
           email_verified_at = COALESCE(email_verified_at, now()),
           password_hash = NULL,
           password_updated_at = CASE WHEN password_hash IS NOT NULL THEN now() ELSE password_updated_at END
     WHERE id = v_holder.id;

    UPDATE user_sessions
       SET revoked_at = now(), revoked_reason = 'yourtal_linked'
     WHERE user_sessions.user_id = v_holder.id AND revoked_at IS NULL;

    UPDATE auth_email_tokens t SET used_at = now()
     WHERE t.user_id = v_holder.id AND t.used_at IS NULL;

    RETURN QUERY SELECT 'linked'::text, v_holder.id, false;
    RETURN;
  END IF;

  -- ── 3. A new person ────────────────────────────────────────────────────────
  -- ON CONFLICT DO NOTHING covers an email taken a moment ago by one of the
  -- other sign-in routes, which do not take the locks above. The person tries
  -- again and lands in rule 2.
  INSERT INTO users (id, subject, email, display_name, email_verified_at, yourtal_linked_at)
  VALUES (gen_random_uuid(), v_subject, p_email,
          COALESCE(v_name, split_part(p_email::text, '@', 1)),
          CASE WHEN COALESCE(p_email_verified, false) THEN now() END,
          now())
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NULL THEN
    RETURN QUERY SELECT 'retry'::text, NULL::uuid, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'created'::text, v_new_id, false;
END;
$fn$;

COMMENT ON FUNCTION identity_yourtal_sign_in(text, citext, boolean, text, boolean, boolean) IS
  'Sign in with YourTal: the account for a verified ID token. An erased sub (yourtal_erased_subjects, 0043) is refused. Else by sub; else a one-time link of a never-linked legacy account with the same verified email (closing its password, sessions and mailed links); else a new account. A second sub for a linked email goes to yourtal_sign_in_reviews. See 0039.';

-- ── YourTal events: the receiver's two calls (S2) ────────────────────────────
--
-- Both take the `sub`, the only key YourTal's events carry. Neither takes a
-- user id: 0036 declined to give the API a way to sign anybody out by id,
-- and a `sub` is a pairwise secret the API cannot list.

-- account-deleted: record the `sub` as erased (sign-in refuses it from now
-- on) and return the account it named, for the erase job. Idempotent.
CREATE OR REPLACE FUNCTION identity_yourtal_subject_erase(p_sub text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user uuid;
BEGIN
  IF p_sub IS NULL OR length(p_sub) = 0 OR length(p_sub) > 255 THEN
    RAISE EXCEPTION 'identity_yourtal_subject_erase: malformed sub' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The same lock sign-in takes: a sign-in in flight either finishes first
  -- (and its session is revoked by the caller) or sees the `sub` erased.
  PERFORM pg_advisory_xact_lock(hashtextextended('yourtal-sub:' || p_sub, 0));
  INSERT INTO yourtal_erased_subjects (sub) VALUES (p_sub) ON CONFLICT (sub) DO NOTHING;
  SELECT u.id INTO v_user FROM users u WHERE u.subject = 'yourtal|' || p_sub;
  RETURN v_user;
END;
$fn$;

COMMENT ON FUNCTION identity_yourtal_subject_erase(text) IS
  'YourTal account-deleted: records the sub in yourtal_erased_subjects (sign-in refuses it for ever) and returns the SnapApp user it named, or NULL. Idempotent. 0043.';

-- Ends the sessions of the account for this `sub` that were opened before
-- p_before: an event's `iat`, so a late retry cannot end a newer session
-- (docs/29 D3). Returns how many.
CREATE OR REPLACE FUNCTION identity_yourtal_sessions_revoke(p_sub text, p_before timestamptz)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_count integer;
BEGIN
  IF p_before IS NULL THEN
    RAISE EXCEPTION 'identity_yourtal_sessions_revoke: before is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE user_sessions s
     SET revoked_at = now(), revoked_reason = 'yourtal_event'
    FROM users u
   WHERE u.subject = 'yourtal|' || p_sub
     AND s.user_id = u.id
     AND s.revoked_at IS NULL
     AND s.created_at < p_before;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION identity_yourtal_sessions_revoke(text, timestamptz) IS
  'YourTal events: revokes the live sessions of the account for this sub opened before p_before (the event''s iat). 0043.';

-- ── erase_workspace (internal) ───────────────────────────────────────────────
--
-- Erases ONE workspace and everything in it, and queues the purge of its
-- files. Decides nothing: the caller has decided this workspace goes. Every
-- statement is scoped by tenant_id = p_tenant_id, so nothing outside it can be
-- touched except through a foreign key, and every key into these rows comes
-- from the same workspace. Returns false when the workspace does not exist.
CREATE OR REPLACE FUNCTION erase_workspace(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM 1 FROM tenants t WHERE t.id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Leaves first. Goals take their contributions (RESTRICT on statement
  -- lines, 0033).
  DELETE FROM goals              x WHERE x.tenant_id = p_tenant_id;
  -- Transactions take their splits and observations with them. Before the
  -- observations on their own: 0032's checks pass for a transaction that is
  -- gone, but not for one that lost its observation.
  DELETE FROM transactions       x WHERE x.tenant_id = p_tenant_id;
  -- The rest of what references a document or a statement line with no rule.
  DELETE FROM event_observations x WHERE x.tenant_id = p_tenant_id;
  DELETE FROM match_candidates   x WHERE x.tenant_id = p_tenant_id;
  DELETE FROM review_tasks       x WHERE x.tenant_id = p_tenant_id;
  DELETE FROM statements         x WHERE x.tenant_id = p_tenant_id;  -- lines cascade
  -- grant_id is NO ACTION (0041): the redemption goes before its grant.
  DELETE FROM yourtal_voucher_redemptions x WHERE x.tenant_id = p_tenant_id;
  -- Documents before captures, so extraction runs are no longer referenced.
  DELETE FROM documents          x WHERE x.tenant_id = p_tenant_id;
  -- Past captures.tenant_id RESTRICT: pages, layouts, runs cascade.
  DELETE FROM captures           x WHERE x.tenant_id = p_tenant_id;
  -- Everything else cascades: accounts, categories, parties, invoices, grants,
  -- credit purchases and spends, memberships, invitations, jobs...
  DELETE FROM tenants            t WHERE t.id = p_tenant_id;

  -- No tenant_id on the job: it would cascade away with the tenant.
  INSERT INTO jobs (id, tenant_id, kind, payload)
  VALUES (gen_random_uuid(), NULL, 'storage_purge', jsonb_build_object('tenantId', p_tenant_id));
  RETURN true;
END;
$fn$;

COMMENT ON FUNCTION erase_workspace(uuid) IS
  'Erases one workspace and everything in it, and queues a storage_purge job for {tenantId}/. Internal: called by erase_person (and later the teen-space sweep). 0043.';

-- ── erase_person ─────────────────────────────────────────────────────────────
--
-- Erases a person (docs/29 §6 S1). One row per workspace whose fate changed:
--   erased       the person ran it alone; notify_emails are the members left
--                (bookkeepers, members, read-only) for S2's email (Q2);
--   handed_over  the person was its only owner; notify_emails is the admin
--                who is owner now.
-- Shared workspaces where nothing changes but the person leaving return no
-- row. A person already gone returns no rows and changes nothing.
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
  END IF;

  -- Sessions, links, outbox, memberships, staff row and points ledger
  -- cascade; attribution in shared workspaces becomes NULL.
  DELETE FROM users u WHERE u.id = p_user_id;
END;
$fn$;

COMMENT ON FUNCTION erase_person(uuid) IS
  'Erases a person: workspaces they run alone (with a storage_purge job each), handover of a shared workspace they solely own to its earliest admin, mail records, then the user (attribution elsewhere becomes NULL). Idempotent; one transaction. Executable by app_worker only. 0043, docs/29 §6.';

-- ── Who may call these ───────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION identity_yourtal_subject_erase(text)                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_yourtal_sessions_revoke(text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION erase_workspace(uuid)                               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION erase_person(uuid)                                  FROM PUBLIC;

ALTER FUNCTION identity_yourtal_subject_erase(text)                OWNER TO app_identity;
ALTER FUNCTION identity_yourtal_sessions_revoke(text, timestamptz) OWNER TO app_identity;
ALTER FUNCTION erase_workspace(uuid)                               OWNER TO app_erasure;
ALTER FUNCTION erase_person(uuid)                                  OWNER TO app_erasure;

-- The events endpoint is in the API.
GRANT EXECUTE ON FUNCTION identity_yourtal_subject_erase(text)                TO app_rw;
GRANT EXECUTE ON FUNCTION identity_yourtal_sessions_revoke(text, timestamptz) TO app_rw;
-- The erase job is the worker's. erase_workspace: no grant (internal).
GRANT EXECUTE ON FUNCTION erase_person(uuid) TO app_worker;

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.yourtal_erased_subjects'::regclass
                  AND c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'RLS not enabled+forced on yourtal_erased_subjects';
  END IF;

  SELECT string_agg(grantee || ':' || privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE table_name = 'yourtal_erased_subjects'
     AND grantee IN ('app_rw', 'app_worker', 'app_readonly', 'snap_app', 'snap_worker');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'application roles hold privileges on yourtal_erased_subjects: %', bad;
  END IF;

  -- Every FK to users now has a delete rule: a person can always be deleted.
  SELECT string_agg(conrelid::regclass || '.' || conname, ', ') INTO bad
    FROM pg_constraint
   WHERE contype = 'f' AND confrelid = 'public.users'::regclass AND confdeltype IN ('a', 'r');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'foreign keys to users with no delete rule: %', bad;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_erasure' AND (rolsuper OR rolcanlogin)) THEN
    RAISE EXCEPTION 'app_erasure must be NOLOGIN and not a superuser';
  END IF;

  IF has_function_privilege('app_rw', 'erase_person(uuid)', 'EXECUTE')
     OR has_function_privilege('app_readonly', 'erase_person(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('app_worker', 'erase_person(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'erase_person must be executable by app_worker only';
  END IF;
  IF has_function_privilege('app_worker', 'erase_workspace(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'erase_workspace is internal';
  END IF;
END $$;
