-- ---------------------------------------------------------------------------
-- 0036 — sign-in safety: sessions that end, password reset, email verification
--
-- Task 1.2 (2026-10-20). Three gaps, one migration, because they share the
-- same new primitive — a row that stands for a credential and can be
-- consumed or revoked — and the same owner (`app_identity`, 0015).
--
-- 1. SESSIONS NEVER ENDED. `issueSession` (apps/server/src/tokens.ts) minted
--    a signed token with no expiry and no server-side record. A token copied
--    off a lost phone worked forever, and there was nothing to revoke: no
--    sign-out-everywhere, no "a password change signs out the thief".
--    `user_sessions` is that record. The token now carries a random secret;
--    this table holds only its SHA-256, so a database disclosure does not
--    hand out working sessions (the same reasoning `invitations.token_hash`
--    already follows).
--
-- 2. THERE WAS NO PASSWORD RESET (0025 said so: "the first thing to fix when a
--    provider is wired"). Resend over SMTP is being wired now.
--
-- 3. NOBODY'S ADDRESS WAS PROVEN AT PASSWORD SIGN-UP. Anyone could register
--    any address. Three consequences, all closed here or in the API:
--      a. 0025's `identity_password_register` let an UNAUTHENTICATED caller
--         attach a password to any existing account that had none — every
--         magic-link and Google account — and the API returned a session for
--         it. That is a full account takeover for the price of knowing an
--         email address. Replaced below: registration now only ever creates
--         a NEW account. An existing passwordless account gets a password
--         through the reset flow, which proves the inbox first.
--      b. Pre-hijacking: register victim@x with your own password, wait for
--         the victim to arrive by magic link, keep your password. Closed by
--         `identity_email_proven`: the first proof of the address clears a
--         password nobody had proven and revokes every session it opened.
--      c. `invitation_accept` matches the caller's email against the
--         invitation's. An unproven email must not be enough to join a
--         workspace; the API refuses unverified callers (VerifiedEmailGuard).
--
-- ADD-ONLY. One nullable column on `users`, two new tables, one enum, three
-- enum labels, new functions. The one existing object changed is the BODY of
-- `identity_password_register` (same signature, narrower behaviour) — a
-- tightening, explained at the function.
--
-- NOBODY BUT `app_identity` TOUCHES THE NEW TABLES. They hold credential
-- hashes; the API reaches them only through the SECURITY DEFINER functions
-- below, each of which states its whole rule. RLS is enabled and forced with
-- NO policy at all, and app_rw's default-ACL grants are revoked — the 0034
-- idiom, asserted by the self-check at the bottom.
-- ---------------------------------------------------------------------------

-- ── Enum labels for the new mail ─────────────────────────────────────────────
--
-- Added at the top and referenced only from the API at runtime, never in a
-- statement in this transaction — see 0023's note on `ALTER TYPE ... ADD
-- VALUE` inside a migration transaction.
ALTER TYPE mail_purpose ADD VALUE IF NOT EXISTS 'password_reset';
ALTER TYPE mail_purpose ADD VALUE IF NOT EXISTS 'email_verification';
ALTER TYPE mail_purpose ADD VALUE IF NOT EXISTS 'security_notice';

-- ── users.email_verified_at ──────────────────────────────────────────────────
--
-- NULL means "nobody has proven this address". Set by: a verification link,
-- a password reset (the reset link went to the inbox), a magic-link sign-in,
-- a Google sign-in (Google asserts `email_verified`, google-verify.ts refuses
-- otherwise). Not backfilled: an existing account proves its address the
-- next time it signs in by any of those routes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

COMMENT ON COLUMN users.email_verified_at IS
  'When the owner of this address first proved they receive mail at it. NULL = unproven: the account may sign in, but may not do anything that acts on the address towards other people (invitations, linked accounts).';

-- ── user_sessions ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  /* SHA-256 of the random secret inside the bearer token. Never the secret. */
  token_hash           bytea NOT NULL UNIQUE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  /* Bumped by `identity_session_check`, at most once every five minutes, so
     an idle expiry costs one write per five minutes of use, not one per
     request. */
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  /* The absolute end. Nothing extends it. */
  expires_at           timestamptz NOT NULL,
  /* The idle window this session was opened with. Stored per row so a later
     change of policy applies to new sessions and never silently stretches
     old ones. */
  idle_timeout_seconds integer NOT NULL,
  revoked_at           timestamptz,
  revoked_reason       text,

  CONSTRAINT user_sessions_reason CHECK (
    revoked_reason IS NULL OR revoked_reason IN
      ('sign_out', 'sign_out_everywhere', 'password_changed', 'password_reset', 'email_proven')
  ),
  CONSTRAINT user_sessions_revoked_has_reason CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  /* A ceiling the application cannot talk its way past: whatever a future
     config says, no session outlives ninety days or idles longer than its
     own absolute lifetime. */
  CONSTRAINT user_sessions_bounded CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '90 days'
    AND idle_timeout_seconds > 0
    AND idle_timeout_seconds <= 90 * 86400
  )
);

-- Sign-out-everywhere and password changes revoke by user.
CREATE INDEX IF NOT EXISTS user_sessions_live_by_user
  ON user_sessions (user_id) WHERE revoked_at IS NULL;

-- ── auth_email_tokens ────────────────────────────────────────────────────────
--
-- One row per link mailed: a password reset or an email verification. The
-- link carries 32 random bytes; this holds their SHA-256. Single use is
-- `used_at`, set by the one UPDATE that redeems it, so two simultaneous
-- redemptions cannot both succeed (the second re-reads the row after the
-- first's lock and no longer matches `used_at IS NULL`).

DO $$ BEGIN
  CREATE TYPE auth_email_token_purpose AS ENUM ('password_reset', 'email_verification');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS auth_email_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose     auth_email_token_purpose NOT NULL,
  token_hash  bytea NOT NULL UNIQUE,
  /* The address the link was SENT to. Redemption requires it to still be the
     account's address, so a link cannot prove an address the account no
     longer has. */
  email       citext NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  /* Set on redemption, and also when a newer link of the same purpose
     supersedes this one — either way it no longer works. */
  used_at     timestamptz,

  CONSTRAINT auth_email_tokens_bounded CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '7 days'
  )
);

CREATE INDEX IF NOT EXISTS auth_email_tokens_live_by_user
  ON auth_email_tokens (user_id, purpose) WHERE used_at IS NULL;

-- ── Lock the tables down (0034's idiom) ──────────────────────────────────────

ALTER TABLE user_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions      FORCE  ROW LEVEL SECURITY;
ALTER TABLE auth_email_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_email_tokens  FORCE  ROW LEVEL SECURITY;

-- No policies. The default ACL grants app_rw arwd on every new table (see
-- 0034), so the grants are revoked as well: both layers say no.
REVOKE ALL ON user_sessions, auth_email_tokens FROM app_rw;
REVOKE ALL ON user_sessions, auth_email_tokens FROM app_worker;
REVOKE ALL ON user_sessions, auth_email_tokens FROM app_readonly;

-- The owner of the functions below. BYPASSRLS already (0015).
GRANT SELECT, INSERT, UPDATE ON user_sessions, auth_email_tokens TO app_identity;

-- ── Sessions ─────────────────────────────────────────────────────────────────

-- Open a session for a user the API has just authenticated.
--
-- Takes the user id as an argument, the same trust `identity_sign_in` already
-- extends to the API: by the time this is called the caller has verified a
-- password, a magic link or a Google token. Lifetimes come from the API (one
-- policy, in one TypeScript file) and are bounded by the table's CHECK.
CREATE OR REPLACE FUNCTION identity_session_open(
  p_user_id          uuid,
  p_token_hash       bytea,
  p_absolute_seconds integer,
  p_idle_seconds     integer
) RETURNS TABLE (session_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'identity_session_open: no such user'
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

COMMENT ON FUNCTION identity_session_open(uuid, bytea, integer, integer) IS
  'Records a new session for an already-authenticated user. Stores only the hash of the token secret.';

-- The per-request check. Replaces `identity_user` on the authenticated path.
--
-- Live means: the hash matches, it belongs to the user the signed token names,
-- not revoked, before its absolute end, and used within its idle window.
-- Anything else returns no row, and the API answers every one of those cases
-- with the same 401.
CREATE OR REPLACE FUNCTION identity_session_check(
  p_token_hash bytea,
  p_user_id    uuid
) RETURNS TABLE (session_id uuid, user_id uuid, email text, display_name text, email_verified boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_session user_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM user_sessions s
   WHERE s.token_hash = p_token_hash
     AND s.user_id = p_user_id
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND s.last_seen_at + make_interval(secs => s.idle_timeout_seconds) > now();

  IF v_session.id IS NULL THEN
    RETURN;
  END IF;

  IF v_session.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE user_sessions SET last_seen_at = now() WHERE id = v_session.id;
  END IF;

  RETURN QUERY
    SELECT v_session.id, u.id, u.email::text, COALESCE(u.display_name, u.email::text),
           u.email_verified_at IS NOT NULL
      FROM users u WHERE u.id = v_session.user_id;
END;
$fn$;

COMMENT ON FUNCTION identity_session_check(bytea, uuid) IS
  'Returns the user behind a live session and bumps its idle clock (at most every 5 minutes). No row for unknown, revoked, expired or idle-expired sessions.';

-- Sign out THIS session. Identified by the token alone: whoever holds it may
-- end it, and nobody else can name it.
CREATE OR REPLACE FUNCTION identity_session_revoke(p_token_hash bytea)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH revoked AS (
    UPDATE user_sessions
       SET revoked_at = now(), revoked_reason = 'sign_out'
     WHERE token_hash = p_token_hash AND revoked_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM revoked);
$fn$;

-- Sign out EVERYWHERE. The user is taken from the presented session, never
-- from an argument: a function that accepted a user id here would be a way to
-- sign anybody out.
CREATE OR REPLACE FUNCTION identity_sessions_revoke_all(p_token_hash bytea)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user uuid;
  v_count integer;
BEGIN
  SELECT s.user_id INTO v_user FROM user_sessions s
   WHERE s.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now();
  IF v_user IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE user_sessions
     SET revoked_at = now(), revoked_reason = 'sign_out_everywhere'
   WHERE user_id = v_user AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

-- The account's status, by id: `identity_user` plus whether the address is
-- proven. `identity_user` keeps its shape for existing callers.
CREATE OR REPLACE FUNCTION identity_user_status(p_user_id uuid)
RETURNS TABLE (user_id uuid, email text, display_name text, email_verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT u.id, u.email::text, COALESCE(u.display_name, u.email::text), u.email_verified_at IS NOT NULL
    FROM users u WHERE u.id = p_user_id;
$fn$;

-- ── Registration: create, never adopt ────────────────────────────────────────
--
-- 0025's version attached a password to an existing account that had none.
-- Nothing proved the caller owned that account — the endpoint is
-- unauthenticated — and the API answered with a session for it: anyone could
-- take over any magic-link or Google account by "registering" its address.
--
-- Same signature, narrower rule: a new address gets a new account; ANY
-- existing account returns no row, which the API already answers with 409.
-- Someone who signed up by magic link and now wants a password uses "forgot
-- password", whose link proves the inbox before anything changes.
CREATE OR REPLACE FUNCTION identity_password_register(
  p_email         citext,
  p_display_name  text,
  p_password_hash text
) RETURNS TABLE (user_id uuid, email text, display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  RETURN QUERY
    INSERT INTO users (id, subject, email, display_name, password_hash, password_updated_at)
    VALUES (gen_random_uuid(), 'pwd|' || p_email, p_email, p_display_name, p_password_hash, now())
    ON CONFLICT DO NOTHING
    RETURNING users.id, users.email::text, users.display_name;
END;
$fn$;

COMMENT ON FUNCTION identity_password_register(citext, text, text) IS
  'Creates a NEW account with a password. Returns no row for any address that already has an account (0036): attaching a password to an existing account without proof of the inbox was an unauthenticated takeover.';

-- ── The address has just been proven ─────────────────────────────────────────
--
-- Called after a magic link or a Google sign-in, BEFORE the new session is
-- opened. The first time an account's address is proven:
--   - a password that was set while the address was unproven is cleared,
--     because nothing says the person who set it owns this inbox (the
--     pre-hijacking attack in the header);
--   - every session opened while the address was unproven is revoked, for the
--     same reason.
-- An account already proven is left alone. Returns true when a password was
-- cleared, so the API can say so.
CREATE OR REPLACE FUNCTION identity_email_proven(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM users u WHERE u.id = p_user_id FOR UPDATE;
  IF v_user.id IS NULL OR v_user.email_verified_at IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE users SET email_verified_at = now() WHERE id = p_user_id;

  IF v_user.password_hash IS NULL THEN
    RETURN false;
  END IF;

  UPDATE users SET password_hash = NULL, password_updated_at = now() WHERE id = p_user_id;
  UPDATE user_sessions
     SET revoked_at = now(), revoked_reason = 'email_proven'
   WHERE user_id = p_user_id AND revoked_at IS NULL;
  UPDATE auth_email_tokens SET used_at = now()
   WHERE user_id = p_user_id AND used_at IS NULL;
  RETURN true;
END;
$fn$;

-- ── Password reset ───────────────────────────────────────────────────────────

-- Issue a reset link for an address, if it has an account.
--
-- ONE call whether or not the address exists, so the request endpoint does
-- the same database work either way: no second round trip that only a real
-- account would cost. Returns the account (to address the mail) or no row.
-- A new link supersedes any earlier unused one: only the newest link works.
-- Works for an account with no password too — that is how a magic-link or
-- Google account adopts one now that registration cannot.
CREATE OR REPLACE FUNCTION identity_password_reset_issue(
  p_email       citext,
  p_token_hash  bytea,
  p_ttl_seconds integer
) RETURNS TABLE (user_id uuid, email text, display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM users u WHERE u.email = p_email;
  IF v_user.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE auth_email_tokens t SET used_at = now()
   WHERE t.user_id = v_user.id AND t.purpose = 'password_reset' AND t.used_at IS NULL;

  INSERT INTO auth_email_tokens (user_id, purpose, token_hash, email, expires_at)
  VALUES (v_user.id, 'password_reset', p_token_hash, v_user.email,
          now() + make_interval(secs => p_ttl_seconds));

  RETURN QUERY SELECT v_user.id, v_user.email::text, COALESCE(v_user.display_name, v_user.email::text);
END;
$fn$;

-- Is this reset link still good? Read-only, so the API can refuse a dead link
-- BEFORE spending a scrypt hash on the new password.
CREATE OR REPLACE FUNCTION identity_password_reset_peek(p_token_hash bytea)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM auth_email_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = p_token_hash
       AND t.purpose = 'password_reset'
       AND t.used_at IS NULL
       AND t.expires_at > now()
       AND u.email = t.email
  );
$fn$;

-- Redeem a reset link: one transaction, all or nothing.
--   1. the link is marked used (the single-use guarantee — see the table);
--   2. the password is replaced;
--   3. the address counts as proven (the link went to it);
--   4. EVERY session is revoked — whoever the reset is defending against is
--      signed out — and the API opens one fresh session for the person who
--      just proved the inbox;
--   5. any other outstanding reset link stops working.
CREATE OR REPLACE FUNCTION identity_password_reset_consume(
  p_token_hash    bytea,
  p_password_hash text
) RETURNS TABLE (user_id uuid, email text, display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user  uuid;
  v_email citext;
BEGIN
  UPDATE auth_email_tokens t
     SET used_at = now()
   WHERE t.token_hash = p_token_hash
     AND t.purpose = 'password_reset'
     AND t.used_at IS NULL
     AND t.expires_at > now()
  RETURNING t.user_id, t.email INTO v_user, v_email;

  IF v_user IS NULL THEN
    RETURN;
  END IF;

  -- The link proves the address it was sent to. If the account's address is
  -- no longer that one, it proves nothing about the account.
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v_user AND u.email = v_email) THEN
    RETURN;
  END IF;

  UPDATE users
     SET password_hash = p_password_hash,
         password_updated_at = now(),
         email_verified_at = COALESCE(email_verified_at, now())
   WHERE id = v_user;

  UPDATE user_sessions
     SET revoked_at = now(), revoked_reason = 'password_reset'
   WHERE user_sessions.user_id = v_user AND revoked_at IS NULL;

  UPDATE auth_email_tokens t SET used_at = now()
   WHERE t.user_id = v_user AND t.purpose = 'password_reset' AND t.used_at IS NULL;

  RETURN QUERY
    SELECT u.id, u.email::text, COALESCE(u.display_name, u.email::text) FROM users u WHERE u.id = v_user;
END;
$fn$;

-- Change the password from a signed-in session. The API has already checked
-- the current password. The user comes from the presented session, never an
-- argument; every OTHER session of that user is revoked and the presenting
-- one survives, so the person changing it is not signed out mid-tap.
CREATE OR REPLACE FUNCTION identity_password_change(
  p_session_token_hash bytea,
  p_password_hash      text
) RETURNS TABLE (user_id uuid, email text, display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_session user_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM user_sessions s
   WHERE s.token_hash = p_session_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now();
  IF v_session.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE users SET password_hash = p_password_hash, password_updated_at = now()
   WHERE id = v_session.user_id;

  UPDATE user_sessions
     SET revoked_at = now(), revoked_reason = 'password_changed'
   WHERE user_sessions.user_id = v_session.user_id
     AND revoked_at IS NULL
     AND id <> v_session.id;

  UPDATE auth_email_tokens t SET used_at = now()
   WHERE t.user_id = v_session.user_id AND t.purpose = 'password_reset' AND t.used_at IS NULL;

  RETURN QUERY
    SELECT u.id, u.email::text, COALESCE(u.display_name, u.email::text)
      FROM users u WHERE u.id = v_session.user_id;
END;
$fn$;

-- ── Email verification ───────────────────────────────────────────────────────

-- Issue a verification link for an account. No row when the address is
-- already proven (nothing to send). Supersedes earlier unused links.
CREATE OR REPLACE FUNCTION identity_email_verification_issue(
  p_user_id     uuid,
  p_token_hash  bytea,
  p_ttl_seconds integer
) RETURNS TABLE (email text, display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM users u WHERE u.id = p_user_id;
  IF v_user.id IS NULL OR v_user.email IS NULL OR v_user.email_verified_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE auth_email_tokens t SET used_at = now()
   WHERE t.user_id = v_user.id AND t.purpose = 'email_verification' AND t.used_at IS NULL;

  INSERT INTO auth_email_tokens (user_id, purpose, token_hash, email, expires_at)
  VALUES (v_user.id, 'email_verification', p_token_hash, v_user.email,
          now() + make_interval(secs => p_ttl_seconds));

  RETURN QUERY SELECT v_user.email::text, COALESCE(v_user.display_name, v_user.email::text);
END;
$fn$;

-- Redeem a verification link. Single use; the address must still be the
-- account's. Marks the address proven. Deliberately does NOT clear a
-- password or revoke sessions the way `identity_email_proven` does: this
-- link was requested BY the account (at sign-up or from its own session), so
-- the password on it belongs to whoever registered — and that is exactly who
-- the link now proves owns the inbox.
CREATE OR REPLACE FUNCTION identity_email_verify(p_token_hash bytea)
RETURNS TABLE (user_id uuid, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user  uuid;
  v_email citext;
BEGIN
  UPDATE auth_email_tokens t
     SET used_at = now()
   WHERE t.token_hash = p_token_hash
     AND t.purpose = 'email_verification'
     AND t.used_at IS NULL
     AND t.expires_at > now()
  RETURNING t.user_id, t.email INTO v_user, v_email;

  IF v_user IS NULL THEN
    RETURN;
  END IF;

  UPDATE users u SET email_verified_at = COALESCE(u.email_verified_at, now())
   WHERE u.id = v_user AND u.email = v_email;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_user, v_email::text;
END;
$fn$;

-- ── Housekeeping ─────────────────────────────────────────────────────────────
--
-- Every sign-in adds a session row and every reset or verification adds a
-- link row; without this both tables grow for ever. A row is deleted 30 days
-- after it stopped working (expired, idle-expired, revoked, used) — kept that
-- long so "which devices were signed in when this happened" can still be
-- answered after an incident. Takes no argument and reveals nothing; returns
-- how many rows went.
CREATE OR REPLACE FUNCTION identity_auth_housekeeping()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_sessions integer;
  v_links integer;
BEGIN
  DELETE FROM user_sessions s
   WHERE LEAST(
           s.expires_at,
           s.last_seen_at + make_interval(secs => s.idle_timeout_seconds),
           COALESCE(s.revoked_at, 'infinity'::timestamptz)
         ) < now() - interval '30 days';
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  DELETE FROM auth_email_tokens t
   WHERE LEAST(t.expires_at, COALESCE(t.used_at, 'infinity'::timestamptz)) < now() - interval '30 days';
  GET DIAGNOSTICS v_links = ROW_COUNT;

  RETURN v_sessions + v_links;
END;
$fn$;

GRANT DELETE ON user_sessions, auth_email_tokens TO app_identity;

-- ── Who may call these ───────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION identity_session_open(uuid, bytea, integer, integer)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_session_check(bytea, uuid)                            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_session_revoke(bytea)                                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_sessions_revoke_all(bytea)                            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_user_status(uuid)                                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_password_register(citext, text, text)                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_email_proven(uuid)                                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_password_reset_issue(citext, bytea, integer)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_password_reset_peek(bytea)                            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_password_reset_consume(bytea, text)                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_password_change(bytea, text)                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_email_verification_issue(uuid, bytea, integer)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_email_verify(bytea)                                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_auth_housekeeping()                                   FROM PUBLIC;

ALTER FUNCTION identity_session_open(uuid, bytea, integer, integer)            OWNER TO app_identity;
ALTER FUNCTION identity_session_check(bytea, uuid)                            OWNER TO app_identity;
ALTER FUNCTION identity_session_revoke(bytea)                                 OWNER TO app_identity;
ALTER FUNCTION identity_sessions_revoke_all(bytea)                            OWNER TO app_identity;
ALTER FUNCTION identity_user_status(uuid)                                     OWNER TO app_identity;
ALTER FUNCTION identity_password_register(citext, text, text)                 OWNER TO app_identity;
ALTER FUNCTION identity_email_proven(uuid)                                    OWNER TO app_identity;
ALTER FUNCTION identity_password_reset_issue(citext, bytea, integer)          OWNER TO app_identity;
ALTER FUNCTION identity_password_reset_peek(bytea)                            OWNER TO app_identity;
ALTER FUNCTION identity_password_reset_consume(bytea, text)                   OWNER TO app_identity;
ALTER FUNCTION identity_password_change(bytea, text)                          OWNER TO app_identity;
ALTER FUNCTION identity_email_verification_issue(uuid, bytea, integer)        OWNER TO app_identity;
ALTER FUNCTION identity_email_verify(bytea)                                   OWNER TO app_identity;
ALTER FUNCTION identity_auth_housekeeping()                                   OWNER TO app_identity;

GRANT EXECUTE ON FUNCTION identity_session_open(uuid, bytea, integer, integer)            TO app_rw;
GRANT EXECUTE ON FUNCTION identity_session_check(bytea, uuid)                            TO app_rw;
GRANT EXECUTE ON FUNCTION identity_session_revoke(bytea)                                 TO app_rw;
GRANT EXECUTE ON FUNCTION identity_sessions_revoke_all(bytea)                            TO app_rw;
GRANT EXECUTE ON FUNCTION identity_user_status(uuid)                                     TO app_rw;
GRANT EXECUTE ON FUNCTION identity_password_register(citext, text, text)                 TO app_rw;
GRANT EXECUTE ON FUNCTION identity_email_proven(uuid)                                    TO app_rw;
GRANT EXECUTE ON FUNCTION identity_password_reset_issue(citext, bytea, integer)          TO app_rw;
GRANT EXECUTE ON FUNCTION identity_password_reset_peek(bytea)                            TO app_rw;
GRANT EXECUTE ON FUNCTION identity_password_reset_consume(bytea, text)                   TO app_rw;
GRANT EXECUTE ON FUNCTION identity_password_change(bytea, text)                          TO app_rw;
GRANT EXECUTE ON FUNCTION identity_email_verification_issue(uuid, bytea, integer)        TO app_rw;
GRANT EXECUTE ON FUNCTION identity_email_verify(bytea)                                   TO app_rw;
GRANT EXECUTE ON FUNCTION identity_auth_housekeeping()                                   TO app_rw;

-- ── Self-check ───────────────────────────────────────────────────────────────
-- Fails the migration (inside db.mjs's transaction) rather than shipping a
-- credential table the application role can read.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('user_sessions', 'auth_email_tokens')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled+forced on: %', bad;
  END IF;

  SELECT string_agg(c.relname || '.' || pol.polname, ', ') INTO bad
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname IN ('user_sessions', 'auth_email_tokens');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'credential tables must have no policies (found %): only app_identity functions reach them', bad;
  END IF;

  SELECT string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE table_name IN ('user_sessions', 'auth_email_tokens')
     AND grantee IN ('app_rw', 'app_worker', 'app_readonly', 'snap_app', 'snap_worker');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'application roles hold privileges on credential tables: %', bad;
  END IF;
END $$;
