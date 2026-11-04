-- ---------------------------------------------------------------------------
-- 0045 — Teen spaces: a parent invites their teen (group 3.10.a, b, c, e)
--
-- yourtal/docs/26 §3.3 and §5 ("Teens (3.10)"). A parent signed in with
-- YourTal asks YourTal for an invite; the teen signs in with their YourTal
-- teen account through the join link; YourTal confirms the inviter is the
-- guardian; SnapApp then gives the teen their own space.
--
-- THE SPACE is an ordinary personal workspace with a `teen_spaces` row:
--   - the teen is its OWNER (docs/29: erasing the teen erases it, as for
--     anyone who runs a workspace alone);
--   - the inviting parent is a `readonly` member (the role exists since 0002),
--     and withTenantAs makes that member's transactions READ ONLY there;
--   - its membership is locked: the only rows it may ever hold are the teen
--     as owner and the parent as readonly, nobody leaves or changes role, and
--     the teen belongs to no other workspace (a trigger, below);
--   - it has no credits of its own: no grant, no purchase, no invitation can
--     be inserted for it (a trigger). Its scans spend a credit from the
--     parent's workspace the invite was made from (`funding_tenant_id`),
--     recorded in `teen_space_spends`, and only while the parent still owns
--     that workspace;
--   - ending access (the parent) stamps `access_ended_at` and `erase_after`
--     (30 days on, founder 2026-10-20, F111) and ends the teen's sessions.
--     Erasing at `erase_after` is 3.10.f; nothing here deletes the space.
--
-- A TEEN IS NEVER LINKED BY EMAIL. `teen_sign_in_email_taken` lets the API
-- refuse a teen whose YourTal email belongs to an account here before 0039's
-- one-time email link could bind it to the teen.
--
-- THE SIGN-IN FLOW carries its invite (`yourtal_sign_in_flows.teen_invite_id`),
-- so two openings of one link each keep it, and the space is joined through
-- the flow that YourTal confirmed.
--
-- WHY `teen_space_spends` HAS NO tenant_id. A teen's scan is a capture in the
-- teen space paid from a grant in the parent's. A row with a tenant_id that
-- points across workspaces makes 0043's erase_workspace refuse both of them
-- (its spill-over guard reads every id-only FK between tenant tables), so the
-- money record sits outside that rule, reached only by the functions below.
-- It outlives the teen's capture (SET NULL) and goes with the parent's workspace. The capture's own `credit_spends` row stays in the teen
-- space with no grant and paid = false, so the receipt never earns points.
--
-- WHO MAY DO WHAT. Every write goes through a SECURITY DEFINER function owned
-- by `app_teen` (NOLOGIN, BYPASSRLS, granted only what they touch). The API
-- reads `teen_spaces` and `teen_invites` under RLS: a teen sees their space,
-- a parent the spaces and invites they made, a workspace its own row.
--
-- ADD-ONLY apart from one widened CHECK (user_sessions_reason gains
-- 'teen_access_ended') and one new nullable column on yourtal_sign_in_flows.
-- ---------------------------------------------------------------------------

-- ── The owner of the teen functions ──────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_teen') THEN
    CREATE ROLE app_teen NOLOGIN BYPASSRLS;
  END IF;
END $$;

ALTER ROLE app_teen NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

COMMENT ON ROLE app_teen IS
  'Owns the teen-space functions (0045). NOLOGIN: a privilege set, never an account. BYPASSRLS because a teen''s scan spends the parent''s credit in another workspace.';

-- ── Tables ───────────────────────────────────────────────────────────────────

-- An invite a parent made and nobody has joined with yet. Deleted when the
-- teen joins (the space keeps the invite id).
CREATE TABLE IF NOT EXISTS teen_invites (
  /* YourTal's inviteId. */
  id                uuid PRIMARY KEY,
  parent_user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  /* The parent's workspace whose credits the teen's scans will spend. */
  funding_tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  /* sha256 of the join code. The code itself is never stored. */
  code_sha256       bytea NOT NULL UNIQUE,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT teen_invites_code_sha256 CHECK (octet_length(code_sha256) = 32)
);

CREATE INDEX IF NOT EXISTS teen_invites_parent ON teen_invites (parent_user_id);

-- The invite a sign-in started with (its code was in the join link).
ALTER TABLE yourtal_sign_in_flows ADD COLUMN IF NOT EXISTS teen_invite_id uuid;

CREATE TABLE IF NOT EXISTS teen_spaces (
  tenant_id         uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  /* One space per teen, and a teen is in no other workspace. */
  teen_user_id      uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  parent_user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  funding_tenant_id uuid REFERENCES tenants (id) ON DELETE SET NULL,
  /* YourTal's inviteId: re-read at each teen sign-in, and ended by the parent. */
  invite_id         uuid NOT NULL UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  access_ended_at   timestamptz,
  /* YourTal confirmed the invite ended: the `teen_invite_end` job has nothing left to do. */
  yourtal_ended_at  timestamptz,
  /* 3.10.f erases the space from here (access_ended_at + 30 days). */
  erase_after       timestamptz,

  CONSTRAINT teen_spaces_ended CHECK ((access_ended_at IS NULL) = (erase_after IS NULL))
);

CREATE INDEX IF NOT EXISTS teen_spaces_parent      ON teen_spaces (parent_user_id);
CREATE INDEX IF NOT EXISTS teen_spaces_erase_after ON teen_spaces (erase_after) WHERE erase_after IS NOT NULL;

-- The credit a teen's scan took from the parent's workspace. See the header
-- for why there is no tenant_id.
CREATE TABLE IF NOT EXISTS teen_space_spends (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* The teen's capture. NULL once it is gone: the money record outlives it. */
  capture_id        uuid UNIQUE REFERENCES captures (id) ON DELETE SET NULL,
  funding_tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  /* NULL when the parent had no credit left (the scan still goes ahead, as
     everywhere until 7.1.b), or once the grant is deleted. */
  grant_id          uuid REFERENCES usage_grants (id) ON DELETE SET NULL,
  spent_at          timestamptz NOT NULL DEFAULT now(),
  refunded_at       timestamptz
);

CREATE INDEX IF NOT EXISTS teen_space_spends_by_grant ON teen_space_spends (grant_id) WHERE grant_id IS NOT NULL;

-- ── RLS and grants ───────────────────────────────────────────────────────────

ALTER TABLE teen_invites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE teen_invites      FORCE  ROW LEVEL SECURITY;
ALTER TABLE teen_spaces       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teen_spaces       FORCE  ROW LEVEL SECURITY;
ALTER TABLE teen_space_spends ENABLE ROW LEVEL SECURITY;
ALTER TABLE teen_space_spends FORCE  ROW LEVEL SECURITY;

CREATE POLICY teen_invites_parent_read ON teen_invites
  FOR SELECT
  USING (parent_user_id = current_user_id());

CREATE POLICY teen_spaces_read ON teen_spaces
  FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    OR teen_user_id = current_user_id()
    OR parent_user_id = current_user_id()
  );

-- The default ACL (0010) gives app roles rights on every new table: revoke,
-- then grant exactly what is meant.
REVOKE ALL ON teen_invites, teen_spaces, teen_space_spends FROM app_rw, app_worker, app_readonly;
GRANT SELECT ON teen_invites TO app_rw;
GRANT SELECT ON teen_spaces  TO app_rw, app_readonly;

GRANT USAGE ON SCHEMA public TO app_teen;
GRANT SELECT, INSERT, UPDATE, DELETE ON teen_invites, teen_spaces, teen_space_spends TO app_teen;
GRANT SELECT                 ON users, captures, credit_purchases TO app_teen;
GRANT SELECT, INSERT         ON tenants, memberships TO app_teen;
GRANT SELECT, UPDATE         ON usage_grants, user_sessions TO app_teen;
GRANT SELECT (id, consumed_at, teen_invite_id), UPDATE (teen_invite_id) ON yourtal_sign_in_flows TO app_teen;
GRANT SELECT, INSERT         ON jobs TO app_teen;

-- ── A new reason a session ends ──────────────────────────────────────────────
ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS user_sessions_reason;
ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_reason CHECK (
  revoked_reason IS NULL OR revoked_reason IN
    ('sign_out', 'sign_out_everywhere', 'password_changed', 'password_reset', 'email_proven',
     'yourtal_linked', 'yourtal_event', 'teen_access_ended')
);

-- ── The locks: membership, credits, invitations ──────────────────────────────
--
-- SQLSTATE TS001; the API answers it 403 `teen_space`.

CREATE OR REPLACE FUNCTION teen_space_memberships_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Depth 1 is a DELETE on memberships itself. A cascade from deleting the
    -- workspace or the person (erasure) runs deeper and is allowed.
    IF pg_trigger_depth() = 1 AND EXISTS (SELECT 1 FROM teen_spaces t WHERE t.tenant_id = OLD.tenant_id) THEN
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
                          OR (NEW.user_id = t.parent_user_id AND NEW.role = 'readonly'))) THEN
    RAISE EXCEPTION 'The people in a teen''s space cannot be changed.' USING ERRCODE = 'TS001';
  END IF;
  IF EXISTS (SELECT 1 FROM teen_spaces t WHERE t.teen_user_id = NEW.user_id AND t.tenant_id <> NEW.tenant_id) THEN
    RAISE EXCEPTION 'A teen account can only use its own space.' USING ERRCODE = 'TS001';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER memberships_teen_space_guard
  BEFORE INSERT OR UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION teen_space_memberships_guard();

CREATE OR REPLACE FUNCTION teen_space_refuse_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM teen_spaces t WHERE t.tenant_id = NEW.tenant_id) THEN
    IF TG_TABLE_NAME = 'invitations' THEN
      RAISE EXCEPTION 'Nobody can be invited to a teen''s space.' USING ERRCODE = 'TS001';
    END IF;
    RAISE EXCEPTION 'A teen''s space has no credits of its own: its scans use the parent''s.'
      USING ERRCODE = 'TS001';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER usage_grants_teen_space_refuse
  BEFORE INSERT ON usage_grants FOR EACH ROW EXECUTE FUNCTION teen_space_refuse_insert();
CREATE TRIGGER credit_purchases_teen_space_refuse
  BEFORE INSERT ON credit_purchases FOR EACH ROW EXECUTE FUNCTION teen_space_refuse_insert();
CREATE TRIGGER invitations_teen_space_refuse
  BEFORE INSERT ON invitations FOR EACH ROW EXECUTE FUNCTION teen_space_refuse_insert();

-- ── The parent: record an invite YourTal made ────────────────────────────────

CREATE OR REPLACE FUNCTION teen_invite_record(
  p_invite_id uuid, p_funding_tenant uuid, p_code_sha256 bytea, p_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user uuid := current_user_id();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'teen_invite_record: app.user_id is not set' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m
                  WHERE m.tenant_id = p_funding_tenant AND m.user_id = v_user AND m.role = 'owner')
     OR EXISTS (SELECT 1 FROM teen_spaces t WHERE t.tenant_id = p_funding_tenant OR t.teen_user_id = v_user) THEN
    RAISE EXCEPTION 'teen_invite_record: only the owner of an ordinary workspace can invite a teen'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO teen_invites (id, parent_user_id, funding_tenant_id, code_sha256, expires_at)
  VALUES (p_invite_id, v_user, p_funding_tenant, p_code_sha256, p_expires_at)
  ON CONFLICT (id) DO NOTHING;
END $fn$;

-- ── The teen's sign-in ───────────────────────────────────────────────────────

-- At start, with no session: the sign-in flow carries this code's invite.
-- Returns the invite id, or NULL for a code this server never issued or one
-- past its expiry. The code is 128 random bits, so there is nothing to guess.
CREATE OR REPLACE FUNCTION teen_invite_attach_flow(p_code_sha256 bytea, p_flow_id uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  UPDATE yourtal_sign_in_flows f SET teen_invite_id = i.id
    FROM teen_invites i
   WHERE i.code_sha256 = p_code_sha256 AND i.expires_at > now()
     AND f.id = p_flow_id AND f.consumed_at IS NULL
  RETURNING i.id;
$fn$;

-- At finish (the flow is taken by then), before any account is made: the
-- invite to check with YourTal. The teen's standing space first (later
-- sign-ins need no code), else the invite this sign-in started with.
CREATE OR REPLACE FUNCTION teen_invite_for_sign_in(p_flow_id uuid, p_subject text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE(
    (SELECT t.invite_id FROM teen_spaces t JOIN users u ON u.id = t.teen_user_id
      WHERE u.subject = p_subject AND t.access_ended_at IS NULL),
    (SELECT f.teen_invite_id FROM yourtal_sign_in_flows f WHERE f.id = p_flow_id)
  );
$fn$;

-- Before any account is made: a teen whose `sub` is new here, and whose email
-- an account here already holds. 0039 would link that account to the teen by
-- email (and close its other doors); a teen is never linked, so the API refuses.
CREATE OR REPLACE FUNCTION teen_sign_in_email_taken(p_subject text, p_email citext) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT NOT EXISTS (SELECT 1 FROM users u WHERE u.subject = p_subject)
     AND EXISTS (SELECT 1 FROM users u WHERE u.email = p_email);
$fn$;

-- After YourTal confirmed the flow's invite: the teen's space, made on first
-- use. The teen is app.user_id. `created` is true only the first time.
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
  IF FOUND THEN
    IF v_space.access_ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'Your access to SnapApp has ended.' USING ERRCODE = 'TS002';
    END IF;
    RETURN QUERY SELECT v_space.tenant_id, false;
    RETURN;
  END IF;

  SELECT i.* INTO v_inv FROM teen_invites i
    JOIN yourtal_sign_in_flows f ON f.teen_invite_id = i.id
   WHERE f.id = p_flow_id
     FOR UPDATE OF i;
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

-- ── The parent ends access ───────────────────────────────────────────────────
-- After YourTal's end answered 200. The parent is app.user_id. Idempotent:
-- returns false when access had already ended.
-- In ONE transaction: the teen's sessions end, the hold starts, and a
-- `teen_invite_end` job (no tenant: it must outlive either workspace) is
-- queued for the worker, so YourTal's invite is ended even if the request
-- dies before the API reaches YourTal. A retry on an ended space only makes
-- sure that job exists while YourTal has not confirmed. Returns true when
-- access ended just now.
CREATE OR REPLACE FUNCTION teen_space_end(p_tenant uuid, p_parent_sub text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_space teen_spaces%ROWTYPE;
BEGIN
  SELECT * INTO v_space FROM teen_spaces t
   WHERE t.tenant_id = p_tenant AND t.parent_user_id = current_user_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'teen_space_end: not your teen''s space' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_space.yourtal_ended_at IS NULL AND NOT EXISTS (
       SELECT 1 FROM jobs j
        WHERE j.kind = 'teen_invite_end' AND j.completed_at IS NULL
          AND j.payload->>'inviteId' = v_space.invite_id::text) THEN
    INSERT INTO jobs (id, tenant_id, kind, payload, max_attempts)
    VALUES (gen_random_uuid(), NULL, 'teen_invite_end',
            jsonb_build_object('inviteId', v_space.invite_id, 'parentSub', p_parent_sub), 20);
  END IF;

  IF v_space.access_ended_at IS NOT NULL THEN
    RETURN false;
  END IF;
  UPDATE teen_spaces t SET access_ended_at = now(), erase_after = now() + interval '30 days'
   WHERE t.tenant_id = p_tenant;
  UPDATE user_sessions s SET revoked_at = now(), revoked_reason = 'teen_access_ended'
   WHERE s.user_id = v_space.teen_user_id AND s.revoked_at IS NULL;
  RETURN true;
END $fn$;

-- Whether YourTal still has to be told (the worker, before calling it). True
-- when the space is gone too: the invite may still be live at YourTal.
CREATE OR REPLACE FUNCTION teen_invite_end_needed(p_invite uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT NOT EXISTS (SELECT 1 FROM teen_spaces t WHERE t.invite_id = p_invite AND t.yourtal_ended_at IS NOT NULL);
$fn$;

-- YourTal confirmed the end. The inviting parent (the API, inline) records it
-- through this one; the worker through the next, which only it may call.
CREATE OR REPLACE FUNCTION teen_invite_yourtal_ended(p_invite uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  UPDATE teen_spaces t SET yourtal_ended_at = now()
   WHERE t.invite_id = p_invite AND t.access_ended_at IS NOT NULL AND t.yourtal_ended_at IS NULL
     AND t.parent_user_id = current_user_id();
$fn$;

CREATE OR REPLACE FUNCTION teen_invite_yourtal_ended_by_worker(p_invite uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  UPDATE teen_spaces t SET yourtal_ended_at = now()
   WHERE t.invite_id = p_invite AND t.access_ended_at IS NOT NULL AND t.yourtal_ended_at IS NULL;
$fn$;

-- Whether a teen's scan can be paid now (POST /v1/captures asks before it
-- stores anything): NULL outside a teen space.
CREATE OR REPLACE FUNCTION teen_space_funded() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN t.tenant_id IS NULL THEN NULL ELSE
    t.funding_tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.tenant_id = t.funding_tenant_id AND m.user_id = t.parent_user_id AND m.role = 'owner') END
    FROM (SELECT current_tenant_id() AS id) c
    LEFT JOIN teen_spaces t ON t.tenant_id = c.id;
$fn$;

-- YourTal's access-ended with erase_data (the guardian withdrew, the teen
-- removed SnapApp, the inviter's account went; docs/26 §2.2): the worker
-- starts the same hold. The events endpoint already ended the sessions.
CREATE OR REPLACE FUNCTION teen_space_end_for_subject(p_sub text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH ended AS (
    UPDATE teen_spaces t SET access_ended_at = now(), erase_after = now() + interval '30 days'
      FROM users u
     WHERE u.id = t.teen_user_id AND u.subject = 'yourtal|' || p_sub AND t.access_ended_at IS NULL
    RETURNING t.tenant_id
  )
  SELECT EXISTS (SELECT 1 FROM ended);
$fn$;

-- ── Credits: a teen's scan spends the parent's ───────────────────────────────

-- Inside the teen's own tenant transaction (enqueueExtraction). Takes one
-- credit from the funding workspace, in spend.ts's order (free first, the
-- signup bonus first among them, then bought; oldest first), under the same
-- per-workspace advisory lock, so it serialises with the parent's own scans.
-- `teen_space` is false outside a teen space, and nothing is taken.
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
  -- Five picks at most, for the same reason as spend.ts: a grant emptied
  -- between the pick and the update is passed over, not given up on.
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

-- The worker, when a teen's scan ends with no document (spend.ts's refund):
-- gives the credit back to the parent's grant, once.
CREATE OR REPLACE FUNCTION teen_space_refund_credit(p_capture uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_grant uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM captures c WHERE c.id = p_capture AND c.tenant_id = current_tenant_id()) THEN
    RETURN false;
  END IF;
  UPDATE teen_space_spends s SET refunded_at = now()
   WHERE s.capture_id = p_capture AND s.refunded_at IS NULL
  RETURNING s.grant_id INTO v_grant;
  IF v_grant IS NULL THEN
    RETURN false;
  END IF;
  UPDATE usage_grants g SET remaining = g.remaining + 1 WHERE g.id = v_grant AND g.remaining < g.amount;
  RETURN FOUND;
END $fn$;

-- What the teen's scans can still spend: the funding workspace's live scan
-- credits. NULL outside a teen space.
CREATE OR REPLACE FUNCTION teen_space_credits() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN t.tenant_id IS NULL THEN NULL ELSE COALESCE((
    SELECT sum(g.remaining)::int FROM usage_grants g
     WHERE g.tenant_id = t.funding_tenant_id AND g.metric = 'scans' AND g.remaining > 0
       AND (g.expires_at IS NULL OR g.expires_at > now())), 0) END
    FROM (SELECT current_tenant_id() AS id) c
    LEFT JOIN teen_spaces t ON t.tenant_id = c.id;
$fn$;

-- ── Who may call these ───────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION teen_space_memberships_guard()                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_refuse_insert()                             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_invite_record(uuid, uuid, bytea, timestamptz)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_invite_attach_flow(bytea, uuid)                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_invite_for_sign_in(uuid, text)                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_sign_in_email_taken(text, citext)                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_invite_end_needed(uuid)                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_invite_yourtal_ended(uuid)                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_invite_yourtal_ended_by_worker(uuid)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_funded()                                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_join(uuid, text, text)                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_end(uuid, text)                                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_end_for_subject(text)                       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_take_credit(uuid)                           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_refund_credit(uuid)                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION teen_space_credits()                                   FROM PUBLIC;

ALTER FUNCTION teen_space_memberships_guard()                     OWNER TO app_teen;
ALTER FUNCTION teen_space_refuse_insert()                         OWNER TO app_teen;
ALTER FUNCTION teen_invite_record(uuid, uuid, bytea, timestamptz) OWNER TO app_teen;
ALTER FUNCTION teen_invite_attach_flow(bytea, uuid)               OWNER TO app_teen;
ALTER FUNCTION teen_invite_for_sign_in(uuid, text)                OWNER TO app_teen;
ALTER FUNCTION teen_sign_in_email_taken(text, citext)             OWNER TO app_teen;
ALTER FUNCTION teen_invite_end_needed(uuid)                      OWNER TO app_teen;
ALTER FUNCTION teen_invite_yourtal_ended(uuid)                    OWNER TO app_teen;
ALTER FUNCTION teen_invite_yourtal_ended_by_worker(uuid)          OWNER TO app_teen;
ALTER FUNCTION teen_space_funded()                                OWNER TO app_teen;
ALTER FUNCTION teen_space_join(uuid, text, text)                  OWNER TO app_teen;
ALTER FUNCTION teen_space_end(uuid, text)                             OWNER TO app_teen;
ALTER FUNCTION teen_space_end_for_subject(text)                   OWNER TO app_teen;
ALTER FUNCTION teen_space_take_credit(uuid)                       OWNER TO app_teen;
ALTER FUNCTION teen_space_refund_credit(uuid)                     OWNER TO app_teen;
ALTER FUNCTION teen_space_credits()                               OWNER TO app_teen;

GRANT EXECUTE ON FUNCTION teen_invite_record(uuid, uuid, bytea, timestamptz) TO app_rw;
GRANT EXECUTE ON FUNCTION teen_invite_attach_flow(bytea, uuid)               TO app_rw;
GRANT EXECUTE ON FUNCTION teen_invite_for_sign_in(uuid, text)                TO app_rw;
GRANT EXECUTE ON FUNCTION teen_sign_in_email_taken(text, citext)             TO app_rw;
GRANT EXECUTE ON FUNCTION teen_invite_yourtal_ended(uuid)                    TO app_rw;
GRANT EXECUTE ON FUNCTION teen_invite_yourtal_ended_by_worker(uuid)          TO app_worker;
GRANT EXECUTE ON FUNCTION teen_invite_end_needed(uuid)                       TO app_worker;
GRANT EXECUTE ON FUNCTION teen_space_funded()                                TO app_rw;
GRANT EXECUTE ON FUNCTION teen_space_join(uuid, text, text)                  TO app_rw;
GRANT EXECUTE ON FUNCTION teen_space_end(uuid, text)                             TO app_rw;
GRANT EXECUTE ON FUNCTION teen_space_take_credit(uuid)                       TO app_rw;
GRANT EXECUTE ON FUNCTION teen_space_credits()                               TO app_rw;
GRANT EXECUTE ON FUNCTION teen_space_refund_credit(uuid)                     TO app_worker;
GRANT EXECUTE ON FUNCTION teen_space_end_for_subject(text)                   TO app_worker;

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad FROM pg_class c
   WHERE c.relname IN ('teen_invites', 'teen_spaces', 'teen_space_spends')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled+forced on %', bad;
  END IF;

  SELECT string_agg(grantee || ':' || table_name || ':' || privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE table_name IN ('teen_invites', 'teen_spaces', 'teen_space_spends')
     AND grantee IN ('app_rw', 'app_worker', 'app_readonly', 'snap_app', 'snap_worker')
     AND NOT (privilege_type = 'SELECT' AND table_name IN ('teen_invites', 'teen_spaces'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'application roles may only read teen_invites and teen_spaces: %', bad;
  END IF;
END $$;
