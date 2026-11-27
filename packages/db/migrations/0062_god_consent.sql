-- ---------------------------------------------------------------------------
-- 0062 — GOD group consent (god/TASKS.md 9.1.d)
--
-- SnapApp, YourTal and Free Tax Returns belong to the GOD group (Global Omni
-- Data). A person must accept the Group Privacy Notice before any of their
-- data enters GOD. This migration only RECORDS that decision; nothing is
-- collected or sent anywhere yet. The contract is identical in all three apps:
--
--   notice id  `god-group-notice`, version `1.0` (effective 2026-11-27)
--   decision   accepted | declined | withdrawn
--   method     registration | next_sign_in | guardian | request (a withdrawal asked for)
--
-- Two tables, both USER-scoped:
--
--   god_consent_events   the record. APPEND-ONLY: one row per decision, never
--                        updated or deleted by the application (no UPDATE or
--                        DELETE grant to any application role, and a trigger
--                        refuses UPDATE even from the owner). Only erasing the
--                        person (erase_person, through the foreign key)
--                        removes their rows. `guardian_user_id` is the parent
--                        who accepted for a teen; it has NO foreign key on
--                        purpose, so erasing the parent never rewrites the
--                        teen's record (the teen's row then simply stays).
--
--   god_consent_status   the CURRENT answer, one row per person, so "who is
--                        in" is one indexed read (a later task replicates it
--                        to GOD). Maintained only by god_consent_append,
--                        in the same transaction as the event it mirrors.
--
-- Absence of a row means NOT consented. That is the safe default for every
-- existing person, every teen, and anyone who got in by a route that never
-- showed the box.
--
-- RLS, and who may do what:
--   - the API (app_rw) may only READ: its own rows, plus, for a parent, the
--     status rows of teens they accepted for (`guardian_user_id`);
--   - every write goes through a SECURITY DEFINER function owned by app_teen
--     (the teen-space owner: NOLOGIN, BYPASSRLS, and it already reads
--     teen_spaces), which takes the person from current_user_id(), never from
--     an argument, except god_consent_record_for_teen where the parent comes
--     from current_user_id() and the teen from a space THEY invited;
--   - a teen cannot accept for themselves (GC001): only the parent can, and
--     only for a teen space the parent invited (GC003).
--
-- ADD-ONLY: two new tables, indexes, policies, grants, four functions and a
-- trigger. Nothing existing is touched.
-- Reverse: DROP the four functions, then the two tables.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '5s';

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS god_consent_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  notice_id        text NOT NULL DEFAULT 'god-group-notice',
  notice_version   text NOT NULL,
  decision         text NOT NULL,
  method           text NOT NULL,
  /* The parent who accepted (or withdrew) for a teen. No FK: see the header. */
  guardian_user_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT god_consent_events_decision CHECK (decision IN ('accepted', 'declined', 'withdrawn')),
  CONSTRAINT god_consent_events_method   CHECK (method IN ('registration', 'next_sign_in', 'guardian', 'request')),
  CONSTRAINT god_consent_events_notice   CHECK (notice_id = 'god-group-notice'),
  CONSTRAINT god_consent_events_version  CHECK (notice_version ~ '^[0-9]+(\.[0-9]+)*$'),
  -- A parent's decision names the parent, and only a parent's decision does.
  CONSTRAINT god_consent_events_guardian CHECK ((method = 'guardian') = (guardian_user_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS god_consent_events_by_user ON god_consent_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS god_consent_status (
  user_id          uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  notice_id        text NOT NULL DEFAULT 'god-group-notice',
  notice_version   text NOT NULL,
  decision         text NOT NULL,
  method           text NOT NULL,
  guardian_user_id uuid,
  decided_at       timestamptz NOT NULL,
  event_id         uuid NOT NULL,

  CONSTRAINT god_consent_status_decision CHECK (decision IN ('accepted', 'declined', 'withdrawn')),
  CONSTRAINT god_consent_status_method   CHECK (method IN ('registration', 'next_sign_in', 'guardian', 'request'))
);

-- "Who is in right now": a partial index over the only rows that matter to GOD.
CREATE INDEX IF NOT EXISTS god_consent_status_accepted ON god_consent_status (notice_version)
  WHERE decision = 'accepted';
CREATE INDEX IF NOT EXISTS god_consent_status_by_guardian ON god_consent_status (guardian_user_id)
  WHERE guardian_user_id IS NOT NULL;

-- Append-only, even against the table owner: a decision is never edited.
CREATE OR REPLACE FUNCTION god_consent_events_no_update()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'god_consent_events is append-only' USING ERRCODE = 'GC009';
END $fn$;

DROP TRIGGER IF EXISTS god_consent_events_no_update ON god_consent_events;
CREATE TRIGGER god_consent_events_no_update
  BEFORE UPDATE ON god_consent_events
  FOR EACH ROW EXECUTE FUNCTION god_consent_events_no_update();

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE god_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE god_consent_events FORCE  ROW LEVEL SECURITY;
ALTER TABLE god_consent_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE god_consent_status FORCE  ROW LEVEL SECURITY;

CREATE POLICY god_consent_events_self_read ON god_consent_events
  FOR SELECT TO app_rw
  USING (user_id = current_user_id() OR guardian_user_id = current_user_id());
CREATE POLICY god_consent_status_self_read ON god_consent_status
  FOR SELECT TO app_rw
  USING (user_id = current_user_id() OR guardian_user_id = current_user_id());

-- The default ACL gives app_rw arwd on every new table (0034): revoke first,
-- then grant exactly what is meant. Reads only; writes are the functions below.
REVOKE ALL ON god_consent_events, god_consent_status FROM app_rw;
REVOKE ALL ON god_consent_events, god_consent_status FROM app_readonly;
GRANT SELECT ON god_consent_events, god_consent_status TO app_rw;
GRANT SELECT, INSERT         ON god_consent_events TO app_teen;
GRANT SELECT, INSERT, UPDATE ON god_consent_status TO app_teen;

-- ── Functions ───────────────────────────────────────────────────────────────

-- The one place a decision is written: the event and the status it makes
-- current, in one transaction. Not executable by the API.
CREATE OR REPLACE FUNCTION god_consent_append(
  p_user uuid, p_version text, p_decision text, p_method text, p_guardian uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_event uuid;
  v_at    timestamptz := now();
BEGIN
  INSERT INTO god_consent_events (user_id, notice_version, decision, method, guardian_user_id, created_at)
  VALUES (p_user, p_version, p_decision, p_method, p_guardian, v_at)
  RETURNING id INTO v_event;

  INSERT INTO god_consent_status (user_id, notice_version, decision, method, guardian_user_id, decided_at, event_id)
  VALUES (p_user, p_version, p_decision, p_method, p_guardian, v_at, v_event)
  ON CONFLICT (user_id) DO UPDATE
     SET notice_version = EXCLUDED.notice_version, decision = EXCLUDED.decision, method = EXCLUDED.method,
         guardian_user_id = EXCLUDED.guardian_user_id, decided_at = EXCLUDED.decided_at,
         event_id = EXCLUDED.event_id;
END $fn$;

-- The caller's own decision. Returns false when it changes nothing (the same
-- acceptance again, or a withdrawal when they are not in), true when recorded.
--   accepted   registration (finishing sign-up) or next_sign_in (the prompt)
--   declined   next_sign_in only: a new sign-up cannot decline, it must accept
--   withdrawn  `request` only, and from an accepted status only
-- GC001: a teen cannot accept; the parent does (god_consent_record_for_teen).
CREATE OR REPLACE FUNCTION god_consent_record(p_version text, p_decision text, p_method text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user   uuid := current_user_id();
  v_status god_consent_status%ROWTYPE;
BEGIN
  IF v_user IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v_user) THEN
    RAISE EXCEPTION 'god_consent_record: no signed-in user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_decision NOT IN ('accepted', 'declined', 'withdrawn')
     OR p_method NOT IN ('registration', 'next_sign_in', 'request')
     OR p_version IS NULL OR p_version !~ '^[0-9]+(\.[0-9]+)*$'
     OR (p_decision = 'declined'  AND p_method <> 'next_sign_in')
     OR (p_decision = 'withdrawn' AND p_method <> 'request')
     OR (p_method = 'request' AND p_decision <> 'withdrawn') THEN
    RAISE EXCEPTION 'god_consent_record: bad decision, method or version' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_decision = 'accepted' AND EXISTS (SELECT 1 FROM teen_spaces t WHERE t.teen_user_id = v_user) THEN
    RAISE EXCEPTION 'A teen''s parent accepts for them.' USING ERRCODE = 'GC001';
  END IF;

  -- Serialise one person's decisions so a double tap writes one row.
  PERFORM pg_advisory_xact_lock(hashtext('god_consent'), hashtext(v_user::text));
  SELECT * INTO v_status FROM god_consent_status s WHERE s.user_id = v_user;

  IF p_decision = 'withdrawn' AND (NOT FOUND OR v_status.decision <> 'accepted') THEN
    RETURN false;
  END IF;
  IF FOUND AND v_status.decision = p_decision AND v_status.notice_version = p_version THEN
    RETURN false;
  END IF;

  PERFORM god_consent_append(v_user, p_version, p_decision, p_method, NULL);
  RETURN true;
END $fn$;

-- A parent's decision for the teen of a space THEY invited. accepted or
-- withdrawn only (a parent has nothing to decline: no row means "out").
-- GC003: not a teen space of this caller. Accepting needs the access to be
-- live; withdrawing is allowed after access ended (it only ever shrinks GOD).
CREATE OR REPLACE FUNCTION god_consent_record_for_teen(p_tenant uuid, p_version text, p_decision text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_parent uuid := current_user_id();
  v_space  teen_spaces%ROWTYPE;
  v_status god_consent_status%ROWTYPE;
BEGIN
  IF v_parent IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v_parent) THEN
    RAISE EXCEPTION 'god_consent_record_for_teen: no signed-in user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_decision NOT IN ('accepted', 'withdrawn') OR p_version IS NULL OR p_version !~ '^[0-9]+(\.[0-9]+)*$' THEN
    RAISE EXCEPTION 'god_consent_record_for_teen: bad decision or version' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_space FROM teen_spaces t WHERE t.tenant_id = p_tenant AND t.parent_user_id = v_parent;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a teen space you invited.' USING ERRCODE = 'GC003';
  END IF;
  IF p_decision = 'accepted' AND v_space.access_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'This teen''s access has ended.' USING ERRCODE = 'GC003';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('god_consent'), hashtext(v_space.teen_user_id::text));
  SELECT * INTO v_status FROM god_consent_status s WHERE s.user_id = v_space.teen_user_id;

  IF p_decision = 'withdrawn' AND (NOT FOUND OR v_status.decision <> 'accepted') THEN
    RETURN false;
  END IF;
  IF FOUND AND v_status.decision = p_decision AND v_status.notice_version = p_version THEN
    RETURN false;
  END IF;

  PERFORM god_consent_append(v_space.teen_user_id, p_version, p_decision, 'guardian', v_parent);
  RETURN true;
END $fn$;

REVOKE EXECUTE ON FUNCTION god_consent_events_no_update()                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION god_consent_append(uuid, text, text, text, uuid)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION god_consent_record(text, text, text)                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION god_consent_record_for_teen(uuid, text, text)          FROM PUBLIC;
ALTER FUNCTION god_consent_append(uuid, text, text, text, uuid)       OWNER TO app_teen;
ALTER FUNCTION god_consent_record(text, text, text)                   OWNER TO app_teen;
ALTER FUNCTION god_consent_record_for_teen(uuid, text, text)          OWNER TO app_teen;
GRANT EXECUTE ON FUNCTION god_consent_append(uuid, text, text, text, uuid)   TO app_teen;
GRANT EXECUTE ON FUNCTION god_consent_record(text, text, text)               TO app_rw;
GRANT EXECUTE ON FUNCTION god_consent_record_for_teen(uuid, text, text)      TO app_rw;

-- ── Self-check ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('god_consent_events', 'god_consent_status')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled+forced on: %', bad;
  END IF;

  -- The API reads the consent tables and writes nothing: every write is a function.
  SELECT string_agg(table_name || ':' || privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE grantee = 'app_rw' AND table_name IN ('god_consent_events', 'god_consent_status')
     AND privilege_type <> 'SELECT';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'app_rw holds more than SELECT on the consent tables: %', bad;
  END IF;

  -- Nobody holds UPDATE or DELETE on the event log; the status mirror is never deleted.
  SELECT string_agg(grantee || ':' || table_name || ':' || privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE grantee IN ('PUBLIC', 'app_rw', 'app_readonly', 'app_teen')
     AND ((table_name = 'god_consent_events' AND privilege_type IN ('UPDATE', 'DELETE'))
       OR (table_name = 'god_consent_status' AND privilege_type = 'DELETE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'consent tables are not append-only for: %', bad;
  END IF;

  -- The writers are definer, pinned and owned by app_teen; the internal one is not callable by the API.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.proname IN ('god_consent_append', 'god_consent_record', 'god_consent_record_for_teen')
         AND p.prosecdef AND p.proconfig::text LIKE '%search_path%'
         AND pg_get_userbyid(p.proowner) = 'app_teen') <> 3 THEN
    RAISE EXCEPTION 'the god_consent writers must be SECURITY DEFINER, pinned and owned by app_teen';
  END IF;
  IF has_function_privilege('app_rw', 'god_consent_append(uuid,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('app_readonly', 'god_consent_record(text,text,text)', 'EXECUTE')
     OR has_function_privilege('app_readonly', 'god_consent_record_for_teen(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'god_consent_append is internal and the writers must not be executable by PUBLIC';
  END IF;
END $$;
