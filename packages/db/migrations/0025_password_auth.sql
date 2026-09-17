-- Password sign-in, for an internal build with no mail transport.
--
-- WHAT THIS REVERSES, AND WHY. Migration 0002 says on the `subject` column
-- "external IdP subject; we never store passwords", and that was the right
-- default: a password we do not hold cannot leak. The alternative already in
-- the codebase is the magic link, which needs no password at all.
--
-- It is turned off by reality rather than by preference. `auth/mailer.ts`
-- resolves to `NoopMailer` in production — no provider is configured, so a
-- magic link is generated, logged as NOT SENT, and never reaches anybody.
-- Google sign-in answers 501 without GOOGLE_CLIENT_ID. That left an internal
-- build with no way for a tester to get in except the demo accounts.
--
-- So: passwords, deliberately and with the trade written down. The owner chose
-- this over wiring a mail provider first, knowing the consequence recorded
-- below.
--
-- THE CONSEQUENCE: THERE IS NO PASSWORD RESET. A reset needs a mail transport
-- exactly as much as a magic link does. A tester who forgets their password
-- cannot recover the account without an operator changing it for them. That is
-- a known dead end, accepted for an internal build, and it is the first thing
-- to fix when a provider is wired.
--
-- The hash never leaves this table except through `identity_password_lookup`,
-- which the API needs in order to verify. Format and cost parameters live in
-- `apps/server/src/auth/passwords.ts`; this column stores whatever that module
-- produces, so a later move to argon2id is a code change and a rehash-on-login,
-- not a migration.

ALTER TABLE users
  ADD COLUMN password_hash       text,
  ADD COLUMN password_updated_at timestamptz;

COMMENT ON COLUMN users.password_hash IS
  'Self-describing KDF string from apps/server/src/auth/passwords.ts. NULL for every account that signs in through an IdP or a magic link — most accounts. Never compared in SQL; verification is constant-time in the application.';

-- Register, or set a password on an account that has none.
--
-- Returns no row when the address already HAS a password: that is the "already
-- registered" case and the controller turns it into a conflict. An account
-- created earlier by a magic link or by Google has a NULL hash and may claim
-- one here, which is what lets an existing tester adopt a password without an
-- operator touching the row.
--
-- It cannot CHANGE an existing password. That would be a credential-reset
-- primitive reachable from an unauthenticated endpoint, which is precisely the
-- thing an attacker wants when there is no email to confirm it.
CREATE OR REPLACE FUNCTION identity_password_register(
  p_email         citext,
  p_display_name  text,
  p_password_hash text
) RETURNS TABLE (user_id uuid, email text, display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id uuid;
BEGIN
  SELECT u.id INTO v_id FROM users u WHERE u.email = p_email;

  IF v_id IS NULL THEN
    INSERT INTO users (id, subject, email, display_name, password_hash, password_updated_at)
    VALUES (gen_random_uuid(), 'pwd|' || p_email, p_email, p_display_name, p_password_hash, now())
    RETURNING id INTO v_id;
  ELSE
    UPDATE users u
       SET password_hash = p_password_hash,
           password_updated_at = now(),
           display_name = COALESCE(NULLIF(u.display_name, ''), p_display_name)
     WHERE u.id = v_id
       AND u.password_hash IS NULL;
    IF NOT FOUND THEN
      RETURN;  -- already has a password; the controller answers 409
    END IF;
  END IF;

  RETURN QUERY
    SELECT u.id, u.email::text, u.display_name FROM users u WHERE u.id = v_id;
END;
$fn$;

COMMENT ON FUNCTION identity_password_register(citext, text, text) IS
  'Creates an account with a password, or attaches one to an account that has none. Returns no row when a password already exists — it can never overwrite one, because that would be an unauthenticated credential reset.';

-- The hash, for verification in the application.
--
-- Returns a row for a known address whether or not it carries a password, so
-- the controller can spend the same work and answer the same way either way.
-- A lookup that returned nothing for "no password set" would time differently
-- from one that returned a hash, and that difference is an account-enumeration
-- oracle — the same reasoning `magic-link/request` already follows.
CREATE OR REPLACE FUNCTION identity_password_lookup(p_email citext)
RETURNS TABLE (user_id uuid, email text, display_name text, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT u.id, u.email::text, u.display_name, u.password_hash
    FROM users u
   WHERE u.email = p_email;
$fn$;

COMMENT ON FUNCTION identity_password_lookup(citext) IS
  'Returns the stored hash so the API can verify it in constant time. The ONLY way the application role reads users.password_hash.';

REVOKE EXECUTE ON FUNCTION identity_password_register(citext, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION identity_password_lookup(citext)                FROM PUBLIC;

ALTER FUNCTION identity_password_register(citext, text, text) OWNER TO app_identity;
ALTER FUNCTION identity_password_lookup(citext)                OWNER TO app_identity;

GRANT EXECUTE ON FUNCTION identity_password_register(citext, text, text) TO app_rw;
GRANT EXECUTE ON FUNCTION identity_password_lookup(citext)                TO app_rw;
