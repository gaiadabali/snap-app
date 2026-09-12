-- ---------------------------------------------------------------------------
-- 0023 — four gaps found by wiring the admin console to the real API.
--
-- Follows 0022's discipline exactly (itself following 0021's header): every
-- function here is SECURITY DEFINER, owned by `app_platform`, REVOKE ALL FROM
-- PUBLIC, GRANT EXECUTE TO app_rw, and re-checks the caller's capability
-- INSIDE the function body — never trusted from the Nest guard, which exists
-- only for a clean 403 (`packages/db/test/admin_plane.test.ts` proves the
-- database itself refuses, not just the guard).
--
-- ── GAP 1: audit_log was write-only ─────────────────────────────────────────
--
-- `admin_view_tenant_metadata`, `admin_view_user_metadata`,
-- `admin_impersonated_request`, `admin_impersonation_start`/`_stop`, and every
-- AI-key mutation all write to `audit_log` (0021), but nothing reads it back —
-- the whole point of auditing impersonation is that someone can review it, and
-- a write-only trail defeats that.
--
-- CAPABILITY CHOICE, justified rather than assumed: this migration adds a NEW
-- capability, `audit_review`, rather than reusing an existing one.
--
--   - `view_tenant_metadata` already lets a staff member search tenants and
--     users. Piggy-backing audit-log visibility onto it would mean anyone who
--     can look up a customer can also see every OTHER staff member's full
--     access history — including whose impersonation sessions touched which
--     tenant. That is a materially different, more sensitive power than
--     "can this person find a tenant by name".
--   - `view_analytics` is platform-aggregate numbers with no per-actor detail
--     at all; it answers a different question entirely.
--   - `manage_staff` already carries real oversight power (revoke a staff
--     member, and doing so kills their open impersonation sessions), which
--     makes it tempting to fold "review what staff did" in here too. But
--     `manage_staff` is about deciding WHO is staff and what they may do next,
--     not about surveilling what they already did — conflating the two would
--     force every staff-admin action to also carry blanket read access to
--     every other staff member's history, or force every auditor/compliance
--     reviewer to also be able to add and revoke staff just to read the log.
--
-- 0021's own header states the philosophy this follows: "Granular on
-- purpose... every gate below tests a capability, never a role" — a new,
-- independently grantable `audit_review` is that same philosophy applied to
-- the one action this migration adds, not a shortcut around it.
--
-- `ALTER TYPE ... ADD VALUE` runs alone at the top, and the new label is only
-- ever referenced from inside a plpgsql function body below (a string that is
-- compiled lazily, on first CALL, not at CREATE FUNCTION time) — never in a
-- bare statement in this same transaction — so this is safe inside the single
-- transaction `scripts/db.mjs migrate` wraps each file in. See the Postgres
-- manual on `ALTER TYPE ... ADD VALUE`: a new enum value cannot be used in the
-- same transaction that added it EXCEPT from inside a function/procedure body
-- that is not itself invoked before commit, which is exactly what happens
-- here.
--
-- `audit_log` remains append-only: no function below is a mutation. The read
-- itself is audited too (who reviewed what, with which filters) — reviewing
-- who accessed whose records is sensitive enough that the review itself
-- belongs in the trail.
--
-- ── GAP 2: a live AI key could not be revoked outside the minting session ──
--
-- `admin_ai_provider_list` returned `hasLiveKey`/`keyPrefix`/`keyLast4` but
-- never the key row's own `id`, so `admin_ai_key_revoke` was only reachable
-- immediately after `admin_ai_key_store` returned one in the same response.
-- Fixed by adding `live_key_id` to the list — still never the ciphertext or
-- wrapped DEK, exactly the same "display-safe columns only" guarantee 0021's
-- header makes; a row id is not secret material.
--
-- ── GAP 3: AdminSession had no display name ─────────────────────────────────
--
-- `admin_my_capabilities` returned `{staff_id, role, capability}` with nothing
-- to name the signed-in staff member. Joined to `users` for `display_name`
-- and `email`, exactly the columns `admin_staff_list` (0021) and
-- `admin_user_detail` (0022) already expose about OTHER users — this is the
-- same information about the CALLER themselves, which 0021's own comment on
-- this function already calls "safe to expose broadly... the predicate is
-- always current_user_id(), so it discloses nothing about anyone but the
-- caller."
--
-- ── GAP 4: timestamps were Postgres' default rendering, not ISO 8601 ───────
--
-- Decision: fixed in the REPO LAYER (`apps/server/src/admin/admin.repo.ts`'s
-- `toIso()`), not in SQL, and applied consistently to every timestamp field
-- this migration's functions return too (`occurred_at`, and nothing new here
-- changes the RETURNS TABLE shape of an existing timestamp column). Chosen
-- over an in-SQL `to_char` cast because:
--
--   1. It is ONE place (a single helper) covering every admin timestamp,
--      existing and new, rather than a `to_char(... AT TIME ZONE 'UTC', ...)`
--      expression repeated at every call site across 0021/0022/0023 — and
--      repeating a format string is exactly how one call site quietly drifts
--      from the others.
--   2. It touches no already-shipped function's RETURNS TABLE signature
--      (changing a column from `timestamptz` to `text` requires DROP+CREATE,
--      which this migration already has to do for two OTHER reasons below —
--      adding a fourth reason to redefine every timestamp-returning function
--      from 0021 was a larger, riskier diff for the same outcome).
--   3. `pg`/postgres.js already hand every timestamptz column to Node as a
--      TEXT string in Postgres' own rendering — `new Date(pgText)` parses
--      that exact format correctly (space-separated, explicit numeric
--      offset), so re-serialising through `.toISOString()` is a safe,
--      well-defined normalisation, not a second lenient-parse gamble: the
--      OUTPUT leaving this process over HTTP is always real ISO 8601 with
--      "Z", regardless of how forgiving any downstream parser is.
--
-- `admin_ai_provider_list` and `admin_my_capabilities` are DROPPED and
-- RECREATED below (not `CREATE OR REPLACE`) because Postgres refuses to
-- change a function's output column list in place — this is the same
-- DROP-then-CREATE shape 0022 would have needed had it been extending an
-- existing function instead of adding a new one.
-- ---------------------------------------------------------------------------

-- ── Gap 1a: the new capability ──────────────────────────────────────────────

ALTER TYPE platform_capability ADD VALUE 'audit_review';

-- ── Gap 3: admin_my_capabilities gains display_name/email ───────────────────

DROP FUNCTION IF EXISTS admin_my_capabilities();

CREATE FUNCTION admin_my_capabilities()
RETURNS TABLE (
  staff_id     uuid,
  role         platform_staff_role,
  capability   platform_capability,
  display_name text,
  email        text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT ps.id, ps.role, c.capability, u.display_name, u.email::text
    FROM platform_staff ps
    JOIN users u ON u.id = ps.user_id
    JOIN platform_staff_capabilities c ON c.staff_id = ps.id
   WHERE ps.user_id = current_user_id()
     AND ps.revoked_at IS NULL
$fn$;

ALTER FUNCTION admin_my_capabilities() OWNER TO app_platform;
REVOKE ALL ON FUNCTION admin_my_capabilities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_my_capabilities() TO app_rw;

-- ── Gap 2: admin_ai_provider_list gains the live key's id ────────────────────

DROP FUNCTION IF EXISTS admin_ai_provider_list();

CREATE FUNCTION admin_ai_provider_list()
RETURNS TABLE (
  id             uuid,
  provider       text,
  label          text,
  default_model  text,
  is_active      boolean,
  has_live_key   boolean,
  live_key_id    uuid,
  key_prefix     text,
  key_last4      text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_ai_config') THEN
    RAISE EXCEPTION 'missing capability: manage_ai_config' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Still never selects `ciphertext`/`wrapped_dek` — only the row's own id
  -- (needed so `admin_ai_key_revoke` is reachable from a fresh page load, not
  -- just in the response of the call that just minted it) plus the same
  -- display-safe columns 0021 already exposed.
  RETURN QUERY
  SELECT c.id, c.provider, c.label, c.default_model, c.is_active,
         k.id IS NOT NULL, k.id, k.key_prefix, k.key_last4
    FROM ai_provider_configs c
    LEFT JOIN ai_provider_keys k ON k.provider_config_id = c.id AND k.revoked_at IS NULL
   ORDER BY c.label;
END $fn$;

ALTER FUNCTION admin_ai_provider_list() OWNER TO app_platform;
REVOKE ALL ON FUNCTION admin_ai_provider_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_ai_provider_list() TO app_rw;

-- ── Gap 1b: the paginated, filterable, capability-gated read ─────────────────
--
-- `audit_log` is append-only (0007/0010's own discipline: app_rw holds no
-- UPDATE/DELETE on it, ever). This function is a pure SELECT — there is no
-- companion mutation, and there never should be.

CREATE FUNCTION admin_audit_log_search(
  p_actor_id   uuid DEFAULT NULL,
  p_tenant_id  uuid DEFAULT NULL,
  p_action     text DEFAULT NULL,
  p_since      timestamptz DEFAULT NULL,
  p_until      timestamptz DEFAULT NULL,
  p_limit      int DEFAULT 50,
  p_offset     int DEFAULT 0
)
RETURNS TABLE (
  id          bigint,
  tenant_id   uuid,
  actor_type  text,
  actor_id    uuid,
  action      text,
  entity_type text,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  request_id  text,
  ip          text,
  occurred_at timestamptz
)
-- NOT `STABLE`: unlike a pure read (e.g. `admin_tenant_search`), this
-- function's body does an `INSERT` to audit the review itself (see the
-- migration header — reviewing who accessed whose records is itself
-- sensitive). Postgres refuses a data-modifying statement inside a
-- `STABLE`/`IMMUTABLE` function outright ("INSERT is not allowed in a
-- non-volatile function") — the same reason `admin_tenant_detail` and
-- `admin_user_detail`, which also audit their own reads, are not `STABLE`
-- either, this one just says so explicitly since it is easy to reach for
-- `STABLE` by analogy with the OTHER, unaudited list/search functions.
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('audit_review') THEN
    RAISE EXCEPTION 'missing capability: audit_review' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Reviewing who accessed whose records is itself sensitive (see header) —
  -- the review is audited with the filters used, not with every row id it
  -- happened to match, which would bloat `after` for a broad query without
  -- adding anything a `LIMIT`-bounded, filter-logged read doesn't already
  -- tell a later reviewer.
  INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES ('platform_staff', current_user_id(), 'admin_audit_log_search', 'audit_log', NULL,
          jsonb_build_object(
            'actor_id', p_actor_id, 'tenant_id', p_tenant_id, 'action', p_action,
            'since', p_since, 'until', p_until, 'limit', p_limit, 'offset', p_offset
          ));

  RETURN QUERY
  SELECT a.id, a.tenant_id, a.actor_type, a.actor_id, a.action, a.entity_type, a.entity_id,
         a.before, a.after, a.request_id, a.ip::text, a.at
    FROM audit_log a
   WHERE (p_actor_id  IS NULL OR a.actor_id  = p_actor_id)
     AND (p_tenant_id IS NULL OR a.tenant_id = p_tenant_id)
     AND (p_action    IS NULL OR a.action    = p_action)
     AND (p_since     IS NULL OR a.at >= p_since)
     AND (p_until     IS NULL OR a.at <= p_until)
   ORDER BY a.at DESC, a.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END $fn$;

ALTER FUNCTION admin_audit_log_search(uuid,uuid,text,timestamptz,timestamptz,int,int) OWNER TO app_platform;
REVOKE ALL ON FUNCTION admin_audit_log_search(uuid,uuid,text,timestamptz,timestamptz,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_audit_log_search(uuid,uuid,text,timestamptz,timestamptz,int,int) TO app_rw;
