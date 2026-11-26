-- ---------------------------------------------------------------------------
-- 0060 — Spambank mail on SnapApp: phone push tokens and the person's mail settings
--
-- Spambank Stage 1, ticket T11 (spambank/BUILD.md §4.9, §6, §9.2). Two tables,
-- both USER-scoped, for the reason `yourtal_links` and `point_ledger` are: a
-- mailbox belongs to a PERSON, and a workspace means nothing to it.
--
--   push_tokens    one row per phone (Firebase Cloud Messaging registration
--                  token) that asked to be told about new mail. The token is
--                  globally unique: a phone is signed in as one person at a
--                  time, so a token registered by a second account MOVES to it
--                  (mail_push_token_register, below). At most 10 per person;
--                  the oldest go first.
--
--   mail_settings  the one row of choices SnapApp itself keeps about a
--                  person's Spambank mailbox: the workspace mailed statements
--                  are imported into (BUILD.md §4.8 step 1) and whether new-mail
--                  alerts are on. Whether statements are turned on at all lives
--                  at YourTal (`statements_to_snapapp`); this row only names
--                  where they go. If that workspace is erased the choice is
--                  cleared (ON DELETE SET NULL), never left dangling.
--
-- RLS, and who may do what:
--   - the API (app_rw) reads its OWN push tokens and may delete its own, and
--     reads/writes its own mail_settings row. It may NOT insert or update a
--     push token directly: registering one moves it from whoever held it, which
--     RLS would hide from the API, so that one write goes through the
--     SECURITY DEFINER function below, which takes the person from
--     current_user_id() (never from an argument).
--   - the worker (a member of app_rw) reaches both tables only after
--     `asUser(user)`, exactly as it does `yourtal_links`. The one thing it
--     cannot do under RLS is turn a YourTal `sub` (what a `spambank-mail`
--     event names) into a user: mail_push_user_for_sub does that, executable by
--     app_worker ONLY, so the API holds no way to look a person up by `sub`.
--
-- ADD-ONLY: two new tables, their indexes and policies, three functions.
-- Nothing existing is touched. Erasing a person (erase_person, 0043) removes
-- both rows through the foreign keys, which bypass row-level security.
-- ---------------------------------------------------------------------------

-- ── push_tokens ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform     text NOT NULL,
  /* The FCM registration token. A credential of sorts (anyone holding it, plus
     our sender key, can notify the phone), so it is never logged. */
  token        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT push_tokens_platform CHECK (platform IN ('android')),
  CONSTRAINT push_tokens_token_shape CHECK (length(token) BETWEEN 20 AND 4096),
  CONSTRAINT push_tokens_token_unique UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS push_tokens_by_user ON push_tokens (user_id, last_seen_at DESC);

-- ── mail_settings ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mail_settings (
  user_id          uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  import_tenant_id uuid REFERENCES tenants (id) ON DELETE SET NULL,
  alerts           boolean NOT NULL DEFAULT true
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE push_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens   FORCE  ROW LEVEL SECURITY;
ALTER TABLE mail_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_settings FORCE  ROW LEVEL SECURITY;

CREATE POLICY push_tokens_self_read ON push_tokens
  FOR SELECT TO app_rw
  USING (user_id = current_user_id());
CREATE POLICY push_tokens_self_delete ON push_tokens
  FOR DELETE TO app_rw
  USING (user_id = current_user_id());

CREATE POLICY mail_settings_self_read ON mail_settings
  FOR SELECT TO app_rw
  USING (user_id = current_user_id());
CREATE POLICY mail_settings_self_insert ON mail_settings
  FOR INSERT TO app_rw
  WITH CHECK (user_id = current_user_id());
CREATE POLICY mail_settings_self_update ON mail_settings
  FOR UPDATE TO app_rw
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- Grants, narrowed at both layers. The default ACL gives app_rw arwd on every
-- new table (see 0034), so revoke first and grant exactly what is meant.
REVOKE ALL ON push_tokens, mail_settings FROM app_rw;
REVOKE ALL ON push_tokens, mail_settings FROM app_readonly;
GRANT SELECT, DELETE         ON push_tokens   TO app_rw;
GRANT SELECT, INSERT, UPDATE ON mail_settings TO app_rw;
-- The register function's owner (BYPASSRLS, see 0015) writes push_tokens.
GRANT SELECT, INSERT, UPDATE, DELETE ON push_tokens TO app_identity;

-- ── Functions ────────────────────────────────────────────────────────────────

-- The caller's own YourTal `sub`, or NULL when they did not sign in with
-- YourTal. Read from current_user_id(): there is no argument to forge. The
-- API's mail routes call YourTal by `sub`, and `users` is not readable
-- outside a shared workspace (0010), so this is how a user-scoped route (one
-- with no workspace in the request) learns it.
CREATE OR REPLACE FUNCTION mail_yourtal_sub()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT substr(u.subject, length('yourtal|') + 1)
    FROM users u
   WHERE u.id = current_user_id()
     AND u.subject LIKE 'yourtal|_%'
$fn$;

-- Registers (or refreshes) a phone's push token for the caller. A token
-- already held by another account MOVES to the caller: one phone, one person
-- at a time, and the previous holder's row would be hidden from the API by
-- RLS, so this cannot be a plain upsert there. Keeps the newest 10 tokens per
-- person.
CREATE OR REPLACE FUNCTION mail_push_token_register(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user uuid := current_user_id();
BEGIN
  IF v_user IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v_user) THEN
    RAISE EXCEPTION 'mail_push_token_register: no signed-in user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_platform IS DISTINCT FROM 'android' OR p_token IS NULL OR length(p_token) NOT BETWEEN 20 AND 4096 THEN
    RAISE EXCEPTION 'mail_push_token_register: bad token or platform' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO push_tokens (user_id, platform, token)
  VALUES (v_user, p_platform, p_token)
  ON CONFLICT (token) DO UPDATE
     SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now();

  DELETE FROM push_tokens t
   WHERE t.user_id = v_user
     AND t.id NOT IN (SELECT k.id FROM push_tokens k
                       WHERE k.user_id = v_user
                       ORDER BY k.last_seen_at DESC, k.created_at DESC
                       LIMIT 10);
END
$fn$;

-- The SnapApp user a YourTal `sub` names, for the worker's `spambank-mail`
-- handler. Executable by app_worker only.
CREATE OR REPLACE FUNCTION mail_push_user_for_sub(p_sub text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT u.id FROM users u
   WHERE p_sub IS NOT NULL AND length(p_sub) BETWEEN 1 AND 255
     AND u.subject = 'yourtal|' || p_sub
$fn$;

REVOKE EXECUTE ON FUNCTION mail_yourtal_sub()                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mail_push_token_register(text, text)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mail_push_user_for_sub(text)               FROM PUBLIC;
ALTER FUNCTION mail_yourtal_sub()                         OWNER TO app_identity;
ALTER FUNCTION mail_push_token_register(text, text)       OWNER TO app_identity;
ALTER FUNCTION mail_push_user_for_sub(text)               OWNER TO app_identity;
GRANT EXECUTE ON FUNCTION mail_yourtal_sub()                   TO app_rw;
GRANT EXECUTE ON FUNCTION mail_push_token_register(text, text) TO app_rw;
GRANT EXECUTE ON FUNCTION mail_push_user_for_sub(text)         TO app_worker;

-- ── Self-check ───────────────────────────────────────────────────────────────
-- Fails the migration inside db.mjs's transaction rather than shipping tables
-- that are not protected the way this header says.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('push_tokens', 'mail_settings')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled+forced on: %', bad;
  END IF;

  -- app_rw may read and delete its own push tokens, nothing more (a write goes
  -- through mail_push_token_register), and may not delete a settings row.
  SELECT string_agg(table_name || ':' || privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE grantee = 'app_rw'
     AND ((table_name = 'push_tokens'   AND privilege_type NOT IN ('SELECT', 'DELETE'))
       OR (table_name = 'mail_settings' AND privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE')));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'app_rw holds more than intended on the mail tables: %', bad;
  END IF;

  -- Only the worker may turn a `sub` into a user.
  IF has_function_privilege('app_rw', 'mail_push_user_for_sub(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw must not be able to run mail_push_user_for_sub';
  END IF;
  IF has_function_privilege('app_readonly', 'mail_push_user_for_sub(text)', 'EXECUTE')
     OR has_function_privilege('app_readonly', 'mail_push_token_register(text,text)', 'EXECUTE')
     OR has_function_privilege('app_readonly', 'mail_yourtal_sub()', 'EXECUTE') THEN
    RAISE EXCEPTION 'the mail functions must not be executable by PUBLIC (checked as app_readonly)';
  END IF;
END $$;
