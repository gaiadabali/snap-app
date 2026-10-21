-- ---------------------------------------------------------------------------
-- 0039 — Sign in with YourTal: sign-in flows, account linking, the review list
--
-- Group task 3.3.a/b. SnapApp becomes an OpenID Connect client of YourTal
-- (yourtal/docs/26-sign-in-with-yourtal.md, the contract). This migration is
-- the database half: where an in-progress sign-in waits between "start" and
-- "finish", the one function that decides which SnapApp account a YourTal
-- person is, and the list of cases a person at SnapApp must look at.
--
-- THE KEY. A YourTal account is known here ONLY by its pairwise `sub`, stored
-- in the existing `users.subject` as `yourtal|<sub>` (docs/26 §1.10: "the sub,
-- as the only key to the person; unique and not null — SnapApp's
-- users.subject already is"). The issuer is not part of the key: if YourTal's
-- issuer ever moves, every `sub` stays the same (docs/26 §1.1).
--
-- LEGACY SUBJECTS. Before this, `users.subject` held one of two formats:
--   dev|<email>   every account made by `identity_sign_in` (0015): the magic
--                 link, Google, the development sign-in, the demo-host Google
--                 simulator, and the seeded demo people (scripts/seed.ts);
--   pwd|<email>   an account registered with a password (0025, 0036).
-- Those, and only those, may be linked to a YourTal `sub` (docs/26 §5,
-- "subject starting dev| or pwd|"). Any other format (test fixtures use
-- `test|`, `idp|`) is never linked automatically: it goes to the review list.
--
-- THE RULES, all inside `identity_yourtal_sign_in`, in one transaction:
--   1. The `sub` is known: that account, always. Its email and name copies
--      are refreshed from the ID token; an email that another account already
--      holds is NOT taken (the copy stays as it was) and the case is flagged.
--   2. The `sub` is new, and an account has the token's email:
--        - the token says email_verified = true,
--        - the account has never been linked to a YourTal `sub`,
--        - its subject is a legacy format above
--      => link it, once. Otherwise it is never linked: a second `sub` for an
--      email that a linked account holds goes to the review list (docs/26
--      §1.10, group task 3.6.c) and the person is refused.
--   3. The `sub` is new and nobody has the email: a new account.
--   Staff (`platform_staff`, not revoked) must have signed in at YourTal with
--   a passkey or two factors (`amr` has `hwk` or `mfa`) within the last 12
--   hours (`auth_time`); the API passes both in and this refuses before
--   writing anything.
--   After rule 1 or 2 has run once, the account is found by `sub` for ever:
--   nothing here looks a linked person up by email again. A link closes every
--   other door at once: password, sessions and mailed links (rule 2).
--
-- THE DOOR IS IN SQL. Once linked (`yourtal|` subject or `yourtal_linked_at`
-- set), SnapApp's own sign-in methods cannot open a session for the account:
-- `identity_session_open` refuses it (YT001), and only
-- `identity_yourtal_session_open` opens one. See "THE DOOR" below.
--
-- ADD-ONLY, with two deliberate exceptions: the BODY of 0036's
-- `identity_session_open` (same signature, narrower: it now refuses linked
-- accounts) and 0036's `user_sessions_reason` CHECK (widened by one reason,
-- `yourtal_linked`). Otherwise: two new tables, one new nullable column
-- (`users.yourtal_linked_at`), new functions, one column-level grant.
-- ---------------------------------------------------------------------------

-- ── yourtal_sign_in_flows ────────────────────────────────────────────────────
--
-- One row per started sign-in: the `state`, `nonce` and PKCE verifier that
-- the finish must match, for ten minutes, once. The verifier is a secret (with
-- a stolen code it redeems the code), so the table is reached only through the
-- functions below: RLS forced with no policy, no grant to any app role.
CREATE TABLE IF NOT EXISTS yourtal_sign_in_flows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client         text NOT NULL,
  state          text NOT NULL,
  nonce          text NOT NULL,
  code_verifier  text NOT NULL,
  /* A same-origin path the website goes to afterwards, checked by the API
     when the flow starts. Never a URL. */
  return_to      text,
  sign_up        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  /* Set by the one UPDATE that takes the flow: single use. */
  consumed_at    timestamptz,

  CONSTRAINT yourtal_sign_in_flows_client CHECK (client IN ('web', 'mobile')),
  CONSTRAINT yourtal_sign_in_flows_bounded CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '15 minutes'
  ),
  CONSTRAINT yourtal_sign_in_flows_return_to CHECK (
    return_to IS NULL OR (return_to LIKE '/%' AND return_to NOT LIKE '//%' AND length(return_to) <= 2048)
  )
);

CREATE INDEX IF NOT EXISTS yourtal_sign_in_flows_expiry ON yourtal_sign_in_flows (expires_at);

-- ── yourtal_sign_in_reviews ──────────────────────────────────────────────────
--
-- The manual review list (group task 3.6.c). A row is a case the code refused
-- to decide on its own:
--   second_sub          a new YourTal `sub` arrived with the email of an
--                       account already linked to another `sub`. docs/26
--                       §1.10: "can only follow a missed deletion event"; it
--                       is never linked, and the person was refused.
--   email_collision     a linked account's email copy would have become an
--                       address another account holds; the old copy was kept.
--   unlinkable_account  a new `sub` arrived with the email of an account whose
--                       subject is not a legacy format this code links.
-- One open row per (kind, sub): a person retrying bumps `attempts` rather
-- than filling the table. Holds the YourTal `sub` and the email because the
-- reviewer needs both; nothing else from YourTal.
CREATE TABLE IF NOT EXISTS yourtal_sign_in_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL,
  yourtal_sub    text NOT NULL,
  email          citext,
  /* second_sub, unlinkable_account: the account that holds the email.
     email_collision: the signed-in (linked) account whose copy was kept. */
  user_id        uuid REFERENCES users (id) ON DELETE CASCADE,
  /* email_collision: the account that holds the address. */
  other_user_id  uuid REFERENCES users (id) ON DELETE CASCADE,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  attempts       integer NOT NULL DEFAULT 1,
  resolved_at    timestamptz,
  resolved_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  resolution     text,

  CONSTRAINT yourtal_sign_in_reviews_kind CHECK (
    kind IN ('second_sub', 'email_collision', 'unlinkable_account')
  ),
  CONSTRAINT yourtal_sign_in_reviews_resolved CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS yourtal_sign_in_reviews_one_open
  ON yourtal_sign_in_reviews (kind, yourtal_sub) WHERE resolved_at IS NULL;

-- ── Lock both tables down (0034 / 0036 idiom) ────────────────────────────────

ALTER TABLE yourtal_sign_in_flows   ENABLE ROW LEVEL SECURITY;
ALTER TABLE yourtal_sign_in_flows   FORCE  ROW LEVEL SECURITY;
ALTER TABLE yourtal_sign_in_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE yourtal_sign_in_reviews FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON yourtal_sign_in_flows, yourtal_sign_in_reviews FROM app_rw;
REVOKE ALL ON yourtal_sign_in_flows, yourtal_sign_in_reviews FROM app_worker;
REVOKE ALL ON yourtal_sign_in_flows, yourtal_sign_in_reviews FROM app_readonly;

GRANT SELECT, INSERT, UPDATE, DELETE ON yourtal_sign_in_flows   TO app_identity;
GRANT SELECT, INSERT, UPDATE         ON yourtal_sign_in_reviews TO app_identity;

-- The staff rule needs to know who is staff. Two columns, read-only: whether
-- a user has a live staff row. app_identity sees nothing else of the admin
-- plane (its role and capabilities stay with app_platform, 0021).
GRANT SELECT (user_id, revoked_at) ON platform_staff TO app_identity;

-- ── users.yourtal_linked_at ──────────────────────────────────────────────────
--
-- When this account was first tied to a YourTal `sub` (by rule 2 or rule 3
-- below). SnapApp's own fact, not a copy of anything from YourTal. "Never
-- linked" is this column being NULL AND the subject not being `yourtal|…`:
-- two independent marks, so neither a subject rewritten by hand nor a
-- restored row can make a linked account linkable again.
ALTER TABLE users ADD COLUMN IF NOT EXISTS yourtal_linked_at timestamptz;

COMMENT ON COLUMN users.yourtal_linked_at IS
  'When this account was first linked to (or created by) Sign in with YourTal. Once set, SnapApp''s own sign-in methods may not open a session for it (identity_session_open, 0039).';

-- ── A new reason a session ends ──────────────────────────────────────────────
-- Linking revokes every session the account had (rule 2 below). Widening the
-- 0036 CHECK is the only change to an existing table constraint here.
ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS user_sessions_reason;
ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_reason CHECK (
  revoked_reason IS NULL OR revoked_reason IN
    ('sign_out', 'sign_out_everywhere', 'password_changed', 'password_reset', 'email_proven', 'yourtal_linked')
);

-- ── Flows ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION identity_yourtal_flow_open(
  p_client        text,
  p_state         text,
  p_nonce         text,
  p_code_verifier text,
  p_return_to     text,
  p_sign_up       boolean,
  p_ttl_seconds   integer
) RETURNS TABLE (flow_id uuid, expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  INSERT INTO yourtal_sign_in_flows (client, state, nonce, code_verifier, return_to, sign_up, expires_at)
  VALUES (p_client, p_state, p_nonce, p_code_verifier, p_return_to, COALESCE(p_sign_up, false),
          now() + make_interval(secs => p_ttl_seconds))
  RETURNING yourtal_sign_in_flows.id, yourtal_sign_in_flows.expires_at;
$fn$;

COMMENT ON FUNCTION identity_yourtal_flow_open(text, text, text, text, text, boolean, integer) IS
  'Records a started Sign in with YourTal: state, nonce and PKCE verifier, for at most 15 minutes (the table CHECK).';

-- Take a flow: once, before it expires. A second take, an expired flow and an
-- unknown id all return no row. Taken BEFORE the API compares `state`, so a
-- finish with the wrong state still burns the flow: a guess gets one try.
CREATE OR REPLACE FUNCTION identity_yourtal_flow_take(p_flow_id uuid)
RETURNS TABLE (client text, state text, nonce text, code_verifier text, return_to text, sign_up boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  UPDATE yourtal_sign_in_flows f
     SET consumed_at = now()
   WHERE f.id = p_flow_id
     AND f.consumed_at IS NULL
     AND f.expires_at > now()
  RETURNING f.client, f.state, f.nonce, f.code_verifier, f.return_to, f.sign_up;
$fn$;

COMMENT ON FUNCTION identity_yourtal_flow_take(uuid) IS
  'Consumes a sign-in flow (single use, unexpired) and returns what the finish must match. No row otherwise.';

-- ── Is this account linked to YourTal? ───────────────────────────────────────

-- The one definition of "linked", used by every function below.
CREATE OR REPLACE FUNCTION identity_yourtal_is_linked(p_subject text, p_linked_at timestamptz)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT p_subject LIKE 'yourtal|%' OR p_linked_at IS NOT NULL;
$fn$;

-- By id: for the API's fast answer. Discloses one bit about an account whose
-- id the caller already holds.
CREATE OR REPLACE FUNCTION identity_yourtal_linked(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM users u
     WHERE u.id = p_user_id AND identity_yourtal_is_linked(u.subject, u.yourtal_linked_at)
  );
$fn$;

-- By address: only so the magic-link request can decline to mail a link to a
-- linked account. Never used to sign anyone in. The request endpoint answers
-- the same either way, so this is not an oracle from outside.
CREATE OR REPLACE FUNCTION identity_yourtal_email_linked(p_email citext)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM users u
     WHERE u.email = p_email AND identity_yourtal_is_linked(u.subject, u.yourtal_linked_at)
  );
$fn$;

-- ── THE DOOR, in SQL ─────────────────────────────────────────────────────────
--
-- docs/26 §1.10: once an account is linked, SnapApp's own sign-in methods
-- (password, magic link, Google, the demo routes, a password reset) must not
-- open a session for it — a weaker door beside YourTal defeats its passkeys.
-- Enforced HERE, where every session is born, not only in TypeScript:
--
--   identity_session_open          0036's function, SAME SIGNATURE, narrower
--                                  body: SnapApp's own door. It refuses a
--                                  linked account with SQLSTATE YT001. Every
--                                  image of the API, older ones included,
--                                  opens sessions through it, so rolling
--                                  back to an image without YourTal cannot
--                                  reopen password, magic link or Google
--                                  for a linked account.
--   identity_yourtal_session_open  the YourTal door: opens a session ONLY for
--                                  a linked account.
--
-- The user row is read FOR SHARE in the same call that inserts the session.
-- A link (rule 2 takes the row FOR UPDATE) and a racing sign-in are
-- therefore ordered: either the sign-in sees the account linked and is
-- refused, or its session exists before the link commits and the link
-- revokes it.
CREATE OR REPLACE FUNCTION identity_session_open(
  p_user_id          uuid,
  p_token_hash       bytea,
  p_absolute_seconds integer,
  p_idle_seconds     integer
) RETURNS TABLE (session_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM users u WHERE u.id = p_user_id FOR SHARE;
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'identity_session_open: no such user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF identity_yourtal_is_linked(v_user.subject, v_user.yourtal_linked_at) THEN
    RAISE EXCEPTION 'use_yourtal: this account signs in with YourTal'
      USING ERRCODE = 'YT001';
  END IF;

  RETURN QUERY
    INSERT INTO user_sessions (user_id, token_hash, expires_at, idle_timeout_seconds)
    VALUES (p_user_id, p_token_hash,
            now() + make_interval(secs => p_absolute_seconds),
            LEAST(p_idle_seconds, p_absolute_seconds))
    RETURNING user_sessions.id, user_sessions.expires_at;
END;
$fn$;

COMMENT ON FUNCTION identity_session_open(uuid, bytea, integer, integer) IS
  'SnapApp''s own sign-in methods: records a new session for an already-authenticated user. Refuses (YT001) an account linked to YourTal (0039). Stores only the hash of the token secret.';

CREATE OR REPLACE FUNCTION identity_yourtal_session_open(
  p_user_id          uuid,
  p_token_hash       bytea,
  p_absolute_seconds integer,
  p_idle_seconds     integer
) RETURNS TABLE (session_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM users u WHERE u.id = p_user_id FOR SHARE;
  IF v_user.id IS NULL OR NOT identity_yourtal_is_linked(v_user.subject, v_user.yourtal_linked_at) THEN
    RAISE EXCEPTION 'identity_yourtal_session_open: not a YourTal account'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    INSERT INTO user_sessions (user_id, token_hash, expires_at, idle_timeout_seconds)
    VALUES (p_user_id, p_token_hash,
            now() + make_interval(secs => p_absolute_seconds),
            LEAST(p_idle_seconds, p_absolute_seconds))
    RETURNING user_sessions.id, user_sessions.expires_at;
END;
$fn$;

COMMENT ON FUNCTION identity_yourtal_session_open(uuid, bytea, integer, integer) IS
  'Sign in with YourTal: records a new session, only for an account linked to YourTal (0039).';

-- ── The review list (internal helper) ───────────────────────────────────────

CREATE OR REPLACE FUNCTION identity_yourtal_review(
  p_kind          text,
  p_sub           text,
  p_email         citext,
  p_user_id       uuid,
  p_other_user_id uuid
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  INSERT INTO yourtal_sign_in_reviews (kind, yourtal_sub, email, user_id, other_user_id)
  VALUES (p_kind, p_sub, p_email, p_user_id, p_other_user_id)
  ON CONFLICT (kind, yourtal_sub) WHERE resolved_at IS NULL DO UPDATE
    SET last_seen_at  = now(),
        attempts      = yourtal_sign_in_reviews.attempts + 1,
        email         = EXCLUDED.email,
        user_id       = EXCLUDED.user_id,
        other_user_id = EXCLUDED.other_user_id;
$fn$;

-- ── Sign in with YourTal: link, find or create ───────────────────────────────
--
-- Called by the API after it has verified the ID token (signature by `kid`,
-- `iss`, `aud`, `nonce`, expiry) and re-checked its claims. Writes nothing
-- for a refusal except a review row. Returns one row:
--
--   outcome      signed_in | linked | created          -> open a session for user_id
--                second_sub | unlinkable_account       -> refused; a review row exists
--                email_unverified                      -> refused (no link without it)
--                staff_strong_auth_required            -> refused: staff, no passkey/2FA
--                staff_reauth_required                 -> refused: staff, sign-in too old
--                retry                                 -> a concurrent sign-in took the
--                                                         email; ask the person to retry
--   user_id      the account, for the first three (and for the staff refusals)
--   email_flagged  true when the email copy was NOT refreshed because another
--                  account holds that address (an email_collision review row)
--
-- p_strong_auth: `amr` has `hwk` or `mfa`. p_recent_auth: `auth_time` within
-- the last 12 hours. Both decided by the API from the verified ID token; they
-- only matter for staff.
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
  'Sign in with YourTal: the account for a verified ID token. By sub; else a one-time link of a never-linked legacy account with the same verified email (closing its password, sessions and mailed links); else a new account. A second sub for a linked email goes to yourtal_sign_in_reviews. See 0039.';

-- ── Housekeeping ─────────────────────────────────────────────────────────────
-- Flows are useless ten minutes after they start; keep a day for debugging.
CREATE OR REPLACE FUNCTION identity_yourtal_flow_housekeeping()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM yourtal_sign_in_flows f WHERE f.expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

-- ── Who may call these ───────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION identity_yourtal_flow_open(text, text, text, text, text, boolean, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_yourtal_flow_take(uuid)                                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_yourtal_linked(uuid)                                            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_yourtal_email_linked(citext)                                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_session_open(uuid, bytea, integer, integer)                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_yourtal_session_open(uuid, bytea, integer, integer)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_yourtal_review(text, text, citext, uuid, uuid)                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_yourtal_sign_in(text, citext, boolean, text, boolean, boolean)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_yourtal_flow_housekeeping()                                     FROM PUBLIC;

ALTER FUNCTION identity_yourtal_is_linked(text, timestamptz)                            OWNER TO app_identity;
ALTER FUNCTION identity_yourtal_flow_open(text, text, text, text, text, boolean, integer) OWNER TO app_identity;
ALTER FUNCTION identity_yourtal_flow_take(uuid)                                         OWNER TO app_identity;
ALTER FUNCTION identity_yourtal_linked(uuid)                                            OWNER TO app_identity;
ALTER FUNCTION identity_yourtal_email_linked(citext)                                    OWNER TO app_identity;
ALTER FUNCTION identity_session_open(uuid, bytea, integer, integer)                     OWNER TO app_identity;
ALTER FUNCTION identity_yourtal_session_open(uuid, bytea, integer, integer)             OWNER TO app_identity;
ALTER FUNCTION identity_yourtal_review(text, text, citext, uuid, uuid)                  OWNER TO app_identity;
ALTER FUNCTION identity_yourtal_sign_in(text, citext, boolean, text, boolean, boolean)  OWNER TO app_identity;
ALTER FUNCTION identity_yourtal_flow_housekeeping()                                     OWNER TO app_identity;

-- The review helper is internal: called only from inside
-- identity_yourtal_sign_in (as its owner), never by the API directly.
-- identity_session_open keeps 0036's grant to app_rw.
GRANT EXECUTE ON FUNCTION identity_yourtal_flow_open(text, text, text, text, text, boolean, integer) TO app_rw;
GRANT EXECUTE ON FUNCTION identity_yourtal_flow_take(uuid)                                         TO app_rw;
GRANT EXECUTE ON FUNCTION identity_yourtal_linked(uuid)                                            TO app_rw;
GRANT EXECUTE ON FUNCTION identity_yourtal_email_linked(citext)                                    TO app_rw;
GRANT EXECUTE ON FUNCTION identity_yourtal_session_open(uuid, bytea, integer, integer)             TO app_rw;
GRANT EXECUTE ON FUNCTION identity_yourtal_sign_in(text, citext, boolean, text, boolean, boolean)  TO app_rw;
GRANT EXECUTE ON FUNCTION identity_yourtal_flow_housekeeping()                                     TO app_rw;

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('yourtal_sign_in_flows', 'yourtal_sign_in_reviews')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled+forced on: %', bad;
  END IF;

  SELECT string_agg(c.relname || '.' || pol.polname, ', ') INTO bad
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname IN ('yourtal_sign_in_flows', 'yourtal_sign_in_reviews');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'sign-in tables must have no policies (found %): only app_identity functions reach them', bad;
  END IF;

  SELECT string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE table_name IN ('yourtal_sign_in_flows', 'yourtal_sign_in_reviews')
     AND grantee IN ('app_rw', 'app_worker', 'app_readonly', 'snap_app', 'snap_worker');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'application roles hold privileges on sign-in tables: %', bad;
  END IF;

  IF has_function_privilege('app_rw', 'identity_yourtal_review(text, text, citext, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw must not call identity_yourtal_review directly';
  END IF;
END $$;
