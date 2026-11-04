-- ---------------------------------------------------------------------------
-- 0047 — The teen hold, its erasure, and turning 18 (group 3.10.f and 3.10.h)
--
-- yourtal/docs/29 §6 S3 and F111; yourtal/docs/26 §2.2, §2.6 and §3.3.
--
-- 3.10.f THE HOLD. When a teen's access ends (the parent's End access, or
-- YourTal's access-ended with erase_data: guardian withdrew, teen removed
-- SnapApp, inviter deleted), `teen_space_hold` in one transaction:
--   - stamps access_ended_at and erase_after (30 days on), as 0045 did;
--   - ends the teen's sessions, as 0045 did;
--   - REMOVES THE PARENT'S READ ACCESS (3.10 review finding 17, decided here):
--     the parent's `readonly` membership is deleted at end time. docs/26 §3.3
--     tells the parent to "download anything you want to keep first", and
--     after a guardian's withdrawal or the teen's own removal nobody has a
--     reason to keep reading a minor's data for 30 more days;
--   - queues one `erasure_notice` email to the parent and one to the teen,
--     naming the day the space will be deleted.
-- The guard (0045) now lets exactly one DELETE through at depth 1: the
-- parent's own row in a space whose access has ended. It still reads only
-- `teen_spaces`, which no application role can write.
--
-- RESTORE. `teen_space_join` on a held space no longer just refuses: a NEW
-- invite from the SAME parent, joined before erase_after, clears the hold,
-- takes the new invite (and its funding workspace), re-admits the parent as
-- readonly and returns the same space (created = false). Anything else is
-- still TS002.
--
-- ERASURE. `teen_space_erase_next(skip)`, owned by app_erasure
-- (erase_workspace's and erase_person's owner, so erase_workspace stays
-- internal: 0043's self-check), executable by app_worker only. ONE space past
-- erase_after per call, each call its own transaction: erase_workspace (so
-- the spill guard runs), then the teen's account through erase_person (lead
-- ruling, 3.10.f round 1), never recording the sub as erased, so a new invite
-- can still bring the teen back. Any error is reported as `failed: ...` and
-- that space stays held for the next sweep; the worker goes on to the next.
--
-- WHILE HELD: no credit is taken and the owner cannot sign in (round 1).
-- `teen_space_take_credit` raises TS004 and `teen_space_funded` is false for
-- a held space; `teen_space_held_for_sign_in` (app_rw) lets the API refuse a
-- non-teen sign-in to a held account (a teen who turned 18 during the hold).
--
-- LATE EVENTS (docs/29 D3). `restored_at` is stamped by a restore, and
-- `teen_space_end_for_subject(sub, iat)` ignores an access-ended whose iat is
-- not after it, and ends only the sessions opened before iat.
--
-- 3.10.h TURNING 18. `teen_space_became_adult(sub)`, owned by app_teen,
-- executable by app_worker only (the YourTal event job). For a live space it
-- deletes the `teen_spaces` row, which lifts every lock (the guard, the
-- credit and invitation triggers, take_credit, the API's isTeen checks all
-- key off that row), so the space is an ordinary personal workspace the
-- young adult owns, paying with its own credits; then it deletes the
-- parent's membership (no longer guarded) and queues both notices.
-- DURING THE HOLD it changes nothing: the space was already closed to the
-- parent, and its erasure was promised when access ended (by the teen
-- themselves, for teen_removed), so it goes ahead on erase_after.
--
-- SECURITY-RELEVANT:
--   - app_teen gets DELETE on memberships (only its functions use it, and the
--     guard still decides which rows);
--   - app_erasure gets SELECT and UPDATE (tenant_id) on teen_spaces, for the
--     sweep's FOR UPDATE;
--   - existing held spaces lose the parent's membership (below);
--   - app_erasure's teen_space_erase_next calls erase_person for the teen.
--
-- The parent's Family page and End access read the teen's name and their own
-- YourTal sub through `teen_space_for_parent` (app_rw), since they are no
-- longer a member of a held space.
--
-- ADD-ONLY apart from: one new nullable column (teen_spaces.restored_at);
-- five function bodies replaced (same signatures, owner and grants):
-- teen_space_memberships_guard, teen_space_join, teen_space_end,
-- teen_space_funded and teen_space_take_credit; and
-- teen_space_end_for_subject(text) replaced by (text, timestamptz), whose
-- only caller is the worker, deployed with this migration.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '5s';

GRANT DELETE ON memberships TO app_teen;
GRANT SELECT, UPDATE (tenant_id) ON teen_spaces TO app_erasure;

-- When a held space was last brought back by a new invite. An access-ended
-- event from before then (YourTal's iat) belongs to the old access: ignored.
ALTER TABLE teen_spaces ADD COLUMN IF NOT EXISTS restored_at timestamptz;

-- ── The guard: one more DELETE allowed ───────────────────────────────────────

CREATE OR REPLACE FUNCTION teen_space_memberships_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Depth 1 is a DELETE on memberships itself. A cascade from deleting the
    -- workspace or the person (erasure) runs deeper and is allowed. So is the
    -- parent's own row once access has ended (0047: the hold drops it).
    IF pg_trigger_depth() = 1 AND EXISTS (
         SELECT 1 FROM teen_spaces t
          WHERE t.tenant_id = OLD.tenant_id
            -- COALESCE: with the parent erased (NULL), only the cascade may delete.
            AND NOT COALESCE(t.access_ended_at IS NOT NULL AND OLD.user_id = t.parent_user_id, false)) THEN
      RAISE EXCEPTION 'Nobody can be removed from a teen''s space.' USING ERRCODE = 'TS001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (EXISTS (SELECT 1 FROM teen_spaces t WHERE t.tenant_id IN (OLD.tenant_id, NEW.tenant_id))
                           OR EXISTS (SELECT 1 FROM teen_spaces t WHERE t.teen_user_id = NEW.user_id)) THEN
    RAISE EXCEPTION 'The people in a teen''s space cannot be changed.' USING ERRCODE = 'TS001';
  END IF;

  -- An INSERT: in a teen space, only its own two rows; and a teen nowhere else.
  -- No setting or role opens this: the rows are read from teen_spaces itself.
  IF EXISTS (SELECT 1 FROM teen_spaces t WHERE t.tenant_id = NEW.tenant_id)
     AND NOT EXISTS (SELECT 1 FROM teen_spaces t
                      WHERE t.tenant_id = NEW.tenant_id
                        AND ((NEW.user_id = t.teen_user_id AND NEW.role = 'owner')
                          -- The parent only while access stands: a held space is closed to them.
                          OR (NEW.user_id = t.parent_user_id AND NEW.role = 'readonly' AND t.access_ended_at IS NULL))) THEN
    RAISE EXCEPTION 'The people in a teen''s space cannot be changed.' USING ERRCODE = 'TS001';
  END IF;
  IF EXISTS (SELECT 1 FROM teen_spaces t WHERE t.teen_user_id = NEW.user_id AND t.tenant_id <> NEW.tenant_id) THEN
    RAISE EXCEPTION 'A teen account can only use its own space.' USING ERRCODE = 'TS001';
  END IF;
  RETURN NEW;
END $fn$;

-- ── Notices (internal) ───────────────────────────────────────────────────────
-- One `erasure_notice` email (the worker's job, 0043/0046; erase_person drops
-- an open one addressed to a person it erases). `name` is the OTHER person's
-- display name; `date` is erase_after, for the hold notices.
CREATE OR REPLACE FUNCTION teen_space_notice(p_to uuid, p_outcome text, p_about uuid, p_date timestamptz)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  INSERT INTO jobs (id, tenant_id, kind, payload, max_attempts)
  SELECT gen_random_uuid(), NULL, 'erasure_notice',
         jsonb_strip_nulls(jsonb_build_object(
           'to', u.email, 'outcome', p_outcome,
           'name', (SELECT a.display_name FROM users a WHERE a.id = p_about),
           'date', p_date)),
         10
    FROM users u
   WHERE u.id = p_to AND u.email IS NOT NULL;
$fn$;

-- ── The hold (internal) ──────────────────────────────────────────────────────
-- False when access had already ended. See the header. Ends the teen's
-- sessions opened before p_before: all of them for the parent's End
-- ('infinity'), those before the event's iat for YourTal's (docs/29 D3).
CREATE OR REPLACE FUNCTION teen_space_hold(p_tenant uuid, p_before timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v teen_spaces%ROWTYPE;
BEGIN
  UPDATE teen_spaces t SET access_ended_at = now(), erase_after = now() + interval '30 days'
   WHERE t.tenant_id = p_tenant AND t.access_ended_at IS NULL
  RETURNING t.* INTO v;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- The guard lets this one through now that access has ended.
  DELETE FROM memberships m WHERE m.tenant_id = p_tenant AND m.user_id = v.parent_user_id;
  UPDATE user_sessions s SET revoked_at = now(), revoked_reason = 'teen_access_ended'
   WHERE s.user_id = v.teen_user_id AND s.revoked_at IS NULL AND s.created_at < p_before;
  PERFORM teen_space_notice(v.parent_user_id, 'teen_ended_parent', v.teen_user_id, v.erase_after);
  PERFORM teen_space_notice(v.teen_user_id, 'teen_ended_teen', v.parent_user_id, v.erase_after);
  RETURN true;
END $fn$;

-- ── The parent ends access (0045, the hold now through teen_space_hold) ──────
CREATE OR REPLACE FUNCTION teen_space_end(p_tenant uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_space   teen_spaces%ROWTYPE;
  v_subject text;
BEGIN
  SELECT * INTO v_space FROM teen_spaces t
   WHERE t.tenant_id = p_tenant AND t.parent_user_id = current_user_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'teen_space_end: not your teen''s space' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT u.subject INTO v_subject FROM users u WHERE u.id = v_space.parent_user_id;
  IF v_subject IS NULL OR v_subject NOT LIKE 'yourtal|%' THEN
    RAISE EXCEPTION 'teen_space_end: the parent is not signed in with YourTal' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A job that ran out of attempts is dead: a retry queues a fresh one.
  IF v_space.yourtal_ended_at IS NULL AND NOT EXISTS (
       SELECT 1 FROM jobs j
        WHERE j.kind = 'teen_invite_end' AND j.completed_at IS NULL AND j.attempts < j.max_attempts
          AND j.payload->>'inviteId' = v_space.invite_id::text) THEN
    INSERT INTO jobs (id, tenant_id, kind, payload, max_attempts)
    VALUES (gen_random_uuid(), NULL, 'teen_invite_end',
            jsonb_build_object('inviteId', v_space.invite_id, 'parentSub', substr(v_subject, length('yourtal|') + 1)), 20);
  END IF;

  RETURN teen_space_hold(p_tenant, 'infinity');
END $fn$;

-- ── YourTal's access-ended with erase_data (0045, now with the full hold) ────
-- p_iat is the event's (the SET's iat, re-verified by the worker). An event
-- from before the space was last restored ended the OLD access: a late
-- delivery of the End that the restore undid must not hold it again. The
-- one-argument 0045 version is dropped: it could not tell.
DROP FUNCTION IF EXISTS teen_space_end_for_subject(text);
CREATE OR REPLACE FUNCTION teen_space_end_for_subject(p_sub text, p_iat timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v teen_spaces%ROWTYPE;
BEGIN
  IF p_iat IS NULL THEN
    RAISE EXCEPTION 'teen_space_end_for_subject: iat is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT t.* INTO v FROM teen_spaces t JOIN users u ON u.id = t.teen_user_id
   WHERE u.subject = 'yourtal|' || p_sub
   FOR UPDATE OF t;
  -- iat has whole seconds: an event in the restore's own second counts as
  -- after it (holding again fails safe; ignoring a real end would not).
  IF NOT FOUND OR date_trunc('second', v.restored_at) > p_iat THEN
    RETURN false;
  END IF;
  RETURN teen_space_hold(v.tenant_id, p_iat);
END $fn$;

-- ── Joining, or coming back by a new invite (0045 + the restore) ─────────────
CREATE OR REPLACE FUNCTION teen_space_join(p_flow_id uuid, p_name text, p_region text)
RETURNS TABLE (tenant_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user  uuid := current_user_id();
  v_space teen_spaces%ROWTYPE;
  v_inv   teen_invites%ROWTYPE;
  v_id    uuid := gen_random_uuid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'teen_space_join: app.user_id is not set' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_space FROM teen_spaces t WHERE t.teen_user_id = v_user FOR UPDATE;
  IF FOUND AND v_space.access_ended_at IS NULL THEN
    RETURN QUERY SELECT v_space.tenant_id, false;
    RETURN;
  END IF;

  SELECT i.* INTO v_inv FROM teen_invites i
    JOIN yourtal_sign_in_flows f ON f.teen_invite_id = i.id
   WHERE f.id = p_flow_id
     FOR UPDATE OF i;

  IF v_space.tenant_id IS NOT NULL THEN
    -- Held (F111): a new invite from the same parent within the 30 days
    -- brings the space back as it was. Anything else waits for the erasure.
    IF NOT FOUND OR v_inv.parent_user_id IS DISTINCT FROM v_space.parent_user_id
       OR v_space.erase_after <= now() THEN
      RAISE EXCEPTION 'Your access to SnapApp has ended.' USING ERRCODE = 'TS002';
    END IF;
    UPDATE teen_spaces t
       SET access_ended_at = NULL, erase_after = NULL, yourtal_ended_at = NULL, restored_at = now(),
           invite_id = v_inv.id, funding_tenant_id = v_inv.funding_tenant_id
     WHERE t.tenant_id = v_space.tenant_id;
    INSERT INTO memberships (tenant_id, user_id, role)
    VALUES (v_space.tenant_id, v_inv.parent_user_id, 'readonly')
    ON CONFLICT DO NOTHING;
    DELETE FROM teen_invites i WHERE i.id = v_inv.id;
    RETURN QUERY SELECT v_space.tenant_id, false;
    RETURN;
  END IF;

  IF NOT FOUND OR v_inv.parent_user_id = v_user THEN
    RAISE EXCEPTION 'teen_space_join: no such invite' USING ERRCODE = 'TS002';
  END IF;
  IF EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = v_user) THEN
    RAISE EXCEPTION 'This account already uses other SnapApp workspaces, so it cannot join as a teen.'
      USING ERRCODE = 'TS003';
  END IF;

  INSERT INTO tenants (id, name, kind, country, base_currency)
  VALUES (v_id, p_name, 'personal',
          CASE WHEN p_region = 'ID' THEN 'ID' ELSE 'AU' END,
          CASE WHEN p_region = 'ID' THEN 'IDR' ELSE 'AUD' END);
  -- The space's row first: the membership guard admits exactly these two.
  INSERT INTO teen_spaces (tenant_id, teen_user_id, parent_user_id, funding_tenant_id, invite_id)
  VALUES (v_id, v_user, v_inv.parent_user_id, v_inv.funding_tenant_id, v_inv.id);
  INSERT INTO memberships (tenant_id, user_id, role) VALUES
    (v_id, v_user, 'owner'),
    (v_id, v_inv.parent_user_id, 'readonly');

  DELETE FROM teen_invites i WHERE i.id = v_inv.id;
  RETURN QUERY SELECT v_id, true;
END $fn$;

-- ── What the parent still sees of a space they invited ───────────────────────
-- Once the hold drops the parent's membership, users RLS hides the teen's
-- row from them, and the API can no longer enter the space to read their own
-- YourTal sub for End access. Only for the calling parent's own space: the
-- teen's display name (they invited them by it) and their own sub.
CREATE OR REPLACE FUNCTION teen_space_for_parent(p_tenant uuid)
RETURNS TABLE (teen_name text, parent_sub text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT tu.display_name,
         CASE WHEN pu.subject LIKE 'yourtal|%' THEN substr(pu.subject, length('yourtal|') + 1) END
    FROM teen_spaces t
    JOIN users tu ON tu.id = t.teen_user_id
    JOIN users pu ON pu.id = t.parent_user_id
   WHERE t.tenant_id = p_tenant AND t.parent_user_id = current_user_id();
$fn$;

-- ── Turning 18 (3.10.h) ──────────────────────────────────────────────────────
-- The worker, on YourTal's became-adult. 'lifted': the space is now an
-- ordinary workspace; 'held': access had ended, so the erasure stands;
-- 'none': no teen space for this sub. Idempotent (a second call: 'none').
CREATE OR REPLACE FUNCTION teen_space_became_adult(p_sub text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v teen_spaces%ROWTYPE;
BEGIN
  SELECT t.* INTO v FROM teen_spaces t JOIN users u ON u.id = t.teen_user_id
   WHERE u.subject = 'yourtal|' || p_sub
   FOR UPDATE OF t;
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  IF v.access_ended_at IS NOT NULL THEN
    RETURN 'held';
  END IF;
  -- Every lock keys off this row: without it, the guard lets the parent go.
  DELETE FROM teen_spaces t WHERE t.tenant_id = v.tenant_id;
  DELETE FROM memberships m WHERE m.tenant_id = v.tenant_id AND m.user_id = v.parent_user_id;
  PERFORM teen_space_notice(v.parent_user_id, 'teen_adult_parent', v.teen_user_id, NULL);
  PERFORM teen_space_notice(v.teen_user_id, 'teen_adult_teen', v.parent_user_id, NULL);
  RETURN 'lifted';
END $fn$;

-- ── A held space spends nothing, and its owner cannot sign in ───────────────
-- 0045's take_credit and funded, refusing a space whose access has ended: a
-- teen who turned 18 during the hold could otherwise sign in as an adult and
-- spend the parent's credits after the parent ended access. The API also
-- refuses that sign-in (teen_space_held_for_sign_in).

CREATE OR REPLACE FUNCTION teen_space_funded() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN t.tenant_id IS NULL THEN NULL ELSE
    t.access_ended_at IS NULL AND t.funding_tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.tenant_id = t.funding_tenant_id AND m.user_id = t.parent_user_id AND m.role = 'owner') END
    FROM (SELECT current_tenant_id() AS id) c
    LEFT JOIN teen_spaces t ON t.tenant_id = c.id;
$fn$;

CREATE OR REPLACE FUNCTION teen_space_take_credit(p_capture uuid)
RETURNS TABLE (teen_space boolean, grant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_space  teen_spaces%ROWTYPE;
  v_fund   uuid;
  v_grant  uuid;
BEGIN
  SELECT * INTO v_space FROM teen_spaces t WHERE t.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM captures c WHERE c.id = p_capture AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'teen_space_take_credit: not a capture of this space' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT s.grant_id INTO v_grant FROM teen_space_spends s WHERE s.capture_id = p_capture;
  IF FOUND THEN
    RETURN QUERY SELECT true, v_grant;
    RETURN;
  END IF;

  IF v_space.access_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Your access to SnapApp has ended, so your parent''s credits can''t pay for scans.'
      USING ERRCODE = 'TS004';
  END IF;

  -- The parent's credits, so only while the parent still owns that workspace
  -- (F112): one handed over, left or deleted pays for nothing more.
  v_fund := v_space.funding_tenant_id;
  IF v_fund IS NULL OR v_space.parent_user_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM memberships m
        WHERE m.tenant_id = v_fund AND m.user_id = v_space.parent_user_id AND m.role = 'owner') THEN
    RAISE EXCEPTION 'Your scans use your parent''s credits, and their workspace can''t pay for them any more. Ask your parent to invite you again.'
      USING ERRCODE = 'TS004';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('credit_spend'), hashtext(v_fund::text));
  FOR i IN 1..5 LOOP
    UPDATE usage_grants u SET remaining = u.remaining - 1
      FROM (SELECT g.id FROM usage_grants g
             WHERE g.tenant_id = v_fund AND g.metric = 'scans' AND g.remaining > 0
               AND (g.expires_at IS NULL OR g.expires_at > now())
             ORDER BY EXISTS (SELECT 1 FROM credit_purchases cp WHERE cp.grant_id = g.id AND cp.status = 'paid'),
                      (g.source = 'signup_bonus') DESC, g.granted_at, g.id
             LIMIT 1) pick
     WHERE u.id = pick.id AND u.remaining > 0
    RETURNING u.id INTO v_grant;
    EXIT WHEN v_grant IS NOT NULL;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM usage_grants g
                           WHERE g.tenant_id = v_fund AND g.metric = 'scans' AND g.remaining > 0
                             AND (g.expires_at IS NULL OR g.expires_at > now()));
  END LOOP;

  INSERT INTO teen_space_spends (capture_id, funding_tenant_id, grant_id) VALUES (p_capture, v_fund, v_grant);
  RETURN QUERY SELECT true, v_grant;
END $fn$;

-- The API, before any sign-in that is not a teen's: true when this YourTal
-- account's teen space is held. A teen comes back only by a new invite
-- (teen_space_join); anyone else waits for the erasure, after which the
-- account is gone and they can start afresh.
CREATE OR REPLACE FUNCTION teen_space_held_for_sign_in(p_subject text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM teen_spaces t JOIN users u ON u.id = t.teen_user_id
                  WHERE u.subject = p_subject AND t.access_ended_at IS NOT NULL);
$fn$;

-- ── The sweep (3.10.f) ───────────────────────────────────────────────────────
-- Erases ONE held space past erase_after per call (the worker calls it until
-- it answers nothing, each call its own transaction), skipping the ids it
-- has already tried this run. The space goes through erase_workspace, so its
-- spill guard runs; then the teen's account through erase_person (lead
-- ruling: the teen consent screen promises "your SnapApp data is deleted"),
-- WITHOUT recording the sub as erased, so a later invite can bring them back.
-- Any error is caught here and reported as `failed: ...`: the subtransaction
-- has rolled that space back, it stays held, and the next is tried.
-- A space being restored right now is locked and skipped.
CREATE OR REPLACE FUNCTION teen_space_erase_next(p_skip uuid[]) RETURNS TABLE (tenant_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v teen_spaces%ROWTYPE;
BEGIN
  SELECT t.* INTO v FROM teen_spaces t
   WHERE t.erase_after <= now() AND NOT (t.tenant_id = ANY (COALESCE(p_skip, '{}')))
   ORDER BY t.erase_after, t.tenant_id
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  tenant_id := v.tenant_id;
  BEGIN
    PERFORM erase_workspace(v.tenant_id);
    PERFORM 1 FROM erase_person(v.teen_user_id);
    outcome := 'erased';
  EXCEPTION WHEN OTHERS THEN
    outcome := 'failed: ' || SQLERRM;
  END;
  RETURN NEXT;
END $fn$;

-- ── Who may call these ───────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION teen_space_notice(uuid, text, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_hold(uuid, timestamptz)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_end_for_subject(text, timestamptz)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_held_for_sign_in(text)                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_became_adult(text)                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_erase_next(uuid[])                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_for_parent(uuid)                      FROM PUBLIC;

ALTER FUNCTION teen_space_memberships_guard()                    OWNER TO app_teen;
ALTER FUNCTION teen_space_notice(uuid, text, uuid, timestamptz)  OWNER TO app_teen;
ALTER FUNCTION teen_space_hold(uuid, timestamptz)                OWNER TO app_teen;
ALTER FUNCTION teen_space_funded()                               OWNER TO app_teen;
ALTER FUNCTION teen_space_take_credit(uuid)                      OWNER TO app_teen;
ALTER FUNCTION teen_space_held_for_sign_in(text)                 OWNER TO app_teen;
ALTER FUNCTION teen_space_end(uuid)                              OWNER TO app_teen;
ALTER FUNCTION teen_space_end_for_subject(text, timestamptz)     OWNER TO app_teen;
ALTER FUNCTION teen_space_join(uuid, text, text)                 OWNER TO app_teen;
ALTER FUNCTION teen_space_became_adult(text)                     OWNER TO app_teen;
ALTER FUNCTION teen_space_erase_next(uuid[])                     OWNER TO app_erasure;
ALTER FUNCTION teen_space_for_parent(uuid)                       OWNER TO app_teen;

GRANT EXECUTE ON FUNCTION teen_space_became_adult(text) TO app_worker;
GRANT EXECUTE ON FUNCTION teen_space_erase_next(uuid[])            TO app_worker;
GRANT EXECUTE ON FUNCTION teen_space_end_for_subject(text, timestamptz) TO app_worker;
GRANT EXECUTE ON FUNCTION teen_space_held_for_sign_in(text)        TO app_rw;
GRANT EXECUTE ON FUNCTION teen_space_for_parent(uuid)   TO app_rw;

-- ── Spaces already held: the parent's view ends now too ──────────────────────
DELETE FROM memberships m USING teen_spaces t
 WHERE m.tenant_id = t.tenant_id AND m.user_id = t.parent_user_id AND t.access_ended_at IS NOT NULL;

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('teen_space_notice(uuid,text,uuid,timestamp with time zone)'),
      ('teen_space_hold(uuid,timestamp with time zone)'),
      ('teen_space_end_for_subject(text,timestamp with time zone)'),
      ('teen_space_became_adult(text)'),
      ('teen_space_erase_next(uuid[])')) AS f(sig)
  LOOP
    IF has_function_privilege('app_rw', r.sig, 'EXECUTE') OR has_function_privilege('app_readonly', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION '% must not be executable by the API roles', r.sig;
    END IF;
  END LOOP;
  IF has_function_privilege('app_worker', 'teen_space_hold(uuid,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('app_worker', 'teen_space_notice(uuid,text,uuid,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'teen_space_hold and teen_space_notice are internal';
  END IF;
  IF NOT has_function_privilege('app_worker', 'teen_space_became_adult(text)', 'EXECUTE')
     OR NOT has_function_privilege('app_worker', 'teen_space_erase_next(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('app_worker', 'teen_space_end_for_subject(text,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the worker must be able to lift a teen space and run the sweep';
  END IF;
  IF has_function_privilege('app_worker', 'erase_workspace(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'erase_workspace is internal';
  END IF;
  IF has_function_privilege('app_rw', 'erase_person(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'erase_person is the worker''s only';
  END IF;
  IF EXISTS (SELECT 1 FROM memberships m JOIN teen_spaces t ON t.tenant_id = m.tenant_id
              WHERE m.user_id = t.parent_user_id AND t.access_ended_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a held teen space still has the parent as a member';
  END IF;
END $$;
