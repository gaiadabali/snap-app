-- ---------------------------------------------------------------------------
-- 0015 — the identity plane
--
-- WHY THIS EXISTS
--
-- Row-level security scopes everything to `current_tenant_id()`. That is the
-- right rule for every tenant table, and it is unsatisfiable for four
-- operations that necessarily happen BEFORE a tenant context exists:
--
--   1. signing in            — a person exists before they belong to anything
--   2. reading your own row  — the session guard needs it on every request
--   3. creating a workspace  — there is no context until the row exists
--   4. accepting an invite   — the joiner is, by definition, not yet a member
--
-- Until now these ran as `postgres`, and a superuser has `rolbypassrls`, so no
-- policy anywhere was ever evaluated. Every tenant boundary in the database was
-- decorative. The application role is now NOSUPERUSER NOBYPASSRLS, which is
-- correct and which makes all four of the above fail — as they should, because
-- there is no policy that could honestly permit them.
--
-- So they stop being ordinary statements and become four functions. Each one
-- states its whole rule in SQL: which rows, on whose behalf, under what
-- conditions. Nothing else gains any privilege.
--
-- THE OWNER IS DELIBERATELY NOT A SUPERUSER
--
-- A SECURITY DEFINER function runs as its owner. The usual shortcut is to leave
-- that owner as the migration superuser, which means a flaw in any one of these
-- bodies reaches the entire cluster. Instead they are owned by `app_identity`:
-- NOLOGIN (nobody can connect as it), BYPASSRLS (which is the entire point),
-- and granted rights on exactly six tables. That is the blast radius.
--
-- `search_path` is pinned on every function. An unpinned SECURITY DEFINER
-- function can be hijacked by a caller who creates a schema shadowing `public`.
-- ---------------------------------------------------------------------------

-- ── The owner ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_identity') THEN
    CREATE ROLE app_identity NOLOGIN BYPASSRLS;
  END IF;
END $$;

ALTER ROLE app_identity NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

COMMENT ON ROLE app_identity IS
  'Owns the SECURITY DEFINER identity functions. NOLOGIN: it is a privilege set, never an account. BYPASSRLS because the operations it performs precede any tenant context. Granted only the tables those functions touch.';

GRANT USAGE ON SCHEMA public TO app_identity;
GRANT SELECT, INSERT, UPDATE ON users        TO app_identity;
GRANT SELECT, INSERT         ON tenants      TO app_identity;
GRANT SELECT, INSERT         ON memberships  TO app_identity;
GRANT SELECT, UPDATE         ON invitations  TO app_identity;
GRANT SELECT                 ON subscriptions, plans TO app_identity;

-- ── One account per address ────────────────────────────────────────────────
--
-- Sign-in looks a person up by email, so two rows with the same email is not a
-- tidiness problem: it is two accounts for one human, chosen between by
-- whichever the planner happens to return first. NULLs stay distinct in
-- Postgres, so accounts created by an IdP subject with no address are
-- unaffected.

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);

-- ── 1 + 2. Sign in, and read yourself ──────────────────────────────────────

CREATE OR REPLACE FUNCTION identity_sign_in(
  p_subject      text,
  p_email        citext,
  p_display_name text
) RETURNS TABLE (user_id uuid, email text, display_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  -- A single statement, so two simultaneous first sign-ins from the same
  -- address cannot both take a "not found, therefore insert" branch.
  INSERT INTO users (id, subject, email, display_name)
  VALUES (gen_random_uuid(), p_subject, p_email, p_display_name)
  ON CONFLICT (email) DO UPDATE
    -- Never overwrites a name the person has set; only fills a blank one.
    SET display_name = COALESCE(users.display_name, EXCLUDED.display_name)
  RETURNING id, email::text, COALESCE(display_name, email::text);
$fn$;

COMMENT ON FUNCTION identity_sign_in(text, citext, text) IS
  'Finds or creates the account for an email address. The ONLY way the application role can write to users. Authentication happens before this: by the time it is called the address is already proven.';

-- Lookup by id only. There is no function that lists or searches users, so
-- holding this one leaks nothing: you must already know the id, and the only
-- id the API has is the one inside the caller own signed session.
CREATE OR REPLACE FUNCTION identity_user(p_user_id uuid)
RETURNS TABLE (user_id uuid, email text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT u.id, u.email::text, COALESCE(u.display_name, u.email::text)
    FROM users u WHERE u.id = p_user_id;
$fn$;

-- ── 3. Create a workspace ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION workspace_create(
  p_name text,
  p_kind tenant_kind,
  p_abn  text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user uuid := current_user_id();
  v_id   uuid := gen_random_uuid();
BEGIN
  -- Taken from the session, never from an argument. A SECURITY DEFINER
  -- function that accepts "who I am" as a parameter is an impersonation API.
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'workspace_create: app.user_id is not set'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user) THEN
    RAISE EXCEPTION 'workspace_create: no such user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO tenants (id, name, kind, abn, country, base_currency)
  VALUES (v_id, p_name, p_kind, NULLIF(p_abn, ''), 'AU', 'AUD');

  -- Whoever creates it owns it, in the same transaction. A workspace with
  -- nobody who can pay for it or delete it is a support ticket waiting.
  INSERT INTO memberships (tenant_id, user_id, role) VALUES (v_id, v_user, 'owner');

  RETURN v_id;
END $fn$;

-- ── 4. Accept an invitation ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION invitation_accept(p_token_hash bytea)
RETURNS TABLE (tenant_id uuid, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user  uuid := current_user_id();
  v_email citext;
  v_inv   invitations%ROWTYPE;
  v_seats integer;
  v_used  integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'invitation_accept: app.user_id is not set'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT u.email INTO v_email FROM users u WHERE u.id = v_user;

  -- Locked, so two taps on the same link cannot both pass the seat check.
  SELECT * INTO v_inv FROM invitations i
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
   FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'This invitation is no longer valid.'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- The link is a bearer token, so it is also checked against the address it
  -- was issued to. A forwarded invitation does not admit the wrong person.
  IF v_email IS NULL OR v_email <> v_inv.email THEN
    RAISE EXCEPTION 'This invitation was sent to a different address.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Already a member: accept the invitation and change nothing else. Joining
  -- twice must never silently alter a role someone has since been given.
  IF EXISTS (SELECT 1 FROM memberships m
              WHERE m.tenant_id = v_inv.tenant_id AND m.user_id = v_user) THEN
    UPDATE invitations SET accepted_at = now(), accepted_by = v_user WHERE id = v_inv.id;
    RETURN QUERY SELECT m.tenant_id, m.role FROM memberships m
      WHERE m.tenant_id = v_inv.tenant_id AND m.user_id = v_user;
    RETURN;
  END IF;

  SELECT COALESCE(max(p.seat_limit), 1) INTO v_seats
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id
   WHERE s.tenant_id = v_inv.tenant_id AND s.status IN ('active', 'trialing');
  SELECT count(*) INTO v_used FROM memberships m WHERE m.tenant_id = v_inv.tenant_id;

  IF v_used >= v_seats THEN
    RAISE EXCEPTION 'This workspace has no seats left (% of %).', v_used, v_seats
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO memberships (tenant_id, user_id, role)
  VALUES (v_inv.tenant_id, v_user, v_inv.role);
  UPDATE invitations SET accepted_at = now(), accepted_by = v_user WHERE id = v_inv.id;

  RETURN QUERY SELECT v_inv.tenant_id, v_inv.role;
END $fn$;

-- ── Who may call these ─────────────────────────────────────────────────────
--
-- PUBLIC first, because CREATE FUNCTION grants EXECUTE to PUBLIC by default,
-- which on a SECURITY DEFINER function means everyone.

REVOKE EXECUTE ON FUNCTION identity_sign_in(text, citext, text)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_user(uuid)                       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION workspace_create(text, tenant_kind, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION invitation_accept(bytea)                  FROM PUBLIC;

ALTER FUNCTION identity_sign_in(text, citext, text)      OWNER TO app_identity;
ALTER FUNCTION identity_user(uuid)                       OWNER TO app_identity;
ALTER FUNCTION workspace_create(text, tenant_kind, text) OWNER TO app_identity;
ALTER FUNCTION invitation_accept(bytea)                  OWNER TO app_identity;

GRANT EXECUTE ON FUNCTION identity_sign_in(text, citext, text)      TO app_rw;
GRANT EXECUTE ON FUNCTION identity_user(uuid)                       TO app_rw;
GRANT EXECUTE ON FUNCTION workspace_create(text, tenant_kind, text) TO app_rw;
GRANT EXECUTE ON FUNCTION invitation_accept(bytea)                  TO app_rw;
