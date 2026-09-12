-- ---------------------------------------------------------------------------
-- 0021 — the platform admin plane
--
-- WHY THIS IS DANGEROUS
--
-- `current_tenant_id()` (0010) is THE tenant-isolation mechanism, deliberately
-- kept as the one moving part (0011's header comment). Everything up to now
-- has been designed so that no session ever needs to see more than one
-- tenant. This migration adds the one feature whose entire purpose is to
-- cross that boundary on purpose: a platform operator's console.
--
-- This repo has already shipped the catastrophic version of this bug once —
-- the server connected as `postgres`, which has `rolbypassrls`, so no policy
-- anywhere had ever been evaluated (0015's header). The rule this migration
-- follows, stated once so every function below can be checked against it:
--
--   1. The API's own connection (`app_rw` / `snap_app`) NEVER gets BYPASSRLS
--      and NEVER gets a direct grant on any table declared below. It only
--      ever gets EXECUTE on named functions.
--   2. Every cross-tenant read or write is a SECURITY DEFINER function owned
--      by `app_platform` — NOLOGIN (nobody connects as it), BYPASSRLS (the
--      entire reason it exists), granted table access only on the objects
--      declared in this file plus the small set of existing tables it must
--      read to do its job. Exactly the `app_identity` pattern from 0015,
--      applied to a second, independent set of tables.
--   3. Every function CHECKS THE CALLER'S CAPABILITY ITSELF, by querying
--      `platform_staff` / `platform_staff_capabilities` against
--      `current_user_id()`. It does not trust a capability check performed
--      upstream by a Nest guard — the guard exists only to fail fast with a
--      clean 403 instead of a raised exception, exactly the relationship
--      `MembershipGuard` already has to `withTenantAs` (see
--      `apps/server/src/common/auth.guard.ts`'s own header comment).
--   4. `search_path` is pinned on every function, for the same hijack reason
--      0015 pins it.
--   5. Reading an actual tenant's ROWS (documents, transactions, ...) is
--      NEVER done by a bespoke cross-tenant SELECT living in one of these
--      functions. `read_tenant_records` authorises and audits the access,
--      then the application re-enters through the EXISTING `withTenant`
--      helper (packages/db/src/client.ts) with that one tenant's id, so the
--      actual data read runs under the ordinary, already-reviewed
--      `tenant_isolation` policy, scoped to exactly the one tenant named in
--      the audit row. The cross-tenant decision and the data read are two
--      different code paths on purpose — see 0011's reasoning for keeping
--      firm logic out of tenant policies; this is the same argument.
--
-- CAPABILITIES, NOT A GOD FLAG
--
-- `platform_staff` is its own identity, never a `memberships` row with a
-- magic tenant. What a staff member may DO is a set of rows in
-- `platform_staff_capabilities`, each checked independently — "impersonate"
-- grants nothing about billing, "manage_ai_config" grants nothing about
-- reading a tenant's ledger. A `platform_staff_role` exists for reporting
-- ("who is support, who is a super admin") but confers nothing by itself:
-- every gate below tests a capability row, never a role.
--
-- IMPERSONATION IS A SESSION, NOT A MODE
--
-- Entering a tenant as a user mints a distinct, opaque, single-use-looking
-- bearer token (`impersonation_sessions.token_hash` — the plaintext token
-- itself is generated in Node and never sent to Postgres as a literal, the
-- same discipline `invitations.token_hash` already established in 0012).
-- It has a reason, a start, a hard expiry, and an end. `admin_impersonation_
-- verify` is the only way to redeem it, re-checks the capability on every
-- call (so a revoked staff member's live session dies on its NEXT request,
-- not just future ones), and writes one `audit_log` row per request it
-- authorises — naming both the staff member (`actor_id`) and the subject
-- (`after->>'subject_user_id'`, and `tenant_id` is the subject's tenant).
-- Structurally this bears no resemblance to an ordinary session token
-- (`apps/server/src/tokens.ts`'s HMAC `body.sig` shape): one is verified by
-- signature with no database round trip, the other by a hash lookup against
-- a table that tracks its own expiry and revocation. Neither format
-- satisfies the other's verifier — see `packages/db/test/admin_plane.test.ts`
-- for the negative proof.
--
-- AI KEYS ARE NEVER READABLE BACK
--
-- `ai_provider_keys` stores app-level AEAD ciphertext plus a KMS-wrapped DEK,
-- both opaque `bytea` to Postgres — never `pgcrypto`, for the reason 0011's
-- sibling doc (`docs/PLAN.md` §7) gives for bank details: a key passed as SQL
-- text lands in logs and `pg_stat_statements`. Only a prefix and last four
-- characters are ever selected back out through any function; the ciphertext
-- and wrapped DEK are written once by `admin_ai_key_store` and never read by
-- anything this migration defines. Decrypting one, when the extraction
-- pipeline actually needs the plaintext, is an application-level operation
-- against the KMS — out of this file's reach entirely, by construction.
-- ---------------------------------------------------------------------------

-- ── The owner ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform NOLOGIN BYPASSRLS;
  END IF;
END $$;

ALTER ROLE app_platform NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

COMMENT ON ROLE app_platform IS
  'Owns the SECURITY DEFINER admin-plane functions. NOLOGIN: a privilege set, never an account. BYPASSRLS because its entire job is authorised cross-tenant access. app_rw is NEVER granted this role and NEVER granted direct table access below — only EXECUTE on named functions.';

-- ── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE platform_staff_role AS ENUM ('support', 'billing', 'operations', 'super_admin');

-- Granular on purpose (see header). A role above is descriptive only; every
-- function gate below tests one of these, never the role.
CREATE TYPE platform_capability AS ENUM (
  'view_analytics',
  'view_tenant_metadata',
  'read_tenant_records',
  'impersonate',
  'manage_billing',
  'manage_platform_settings',
  'manage_ai_config',
  'manage_staff',
  'manage_operations'
);

CREATE TYPE impersonation_end_reason AS ENUM ('expired', 'stopped', 'revoked');

-- ── Tables ───────────────────────────────────────────────────────────────

CREATE TABLE platform_staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role        platform_staff_role NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT platform_staff_revoked_consistency
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE TABLE platform_staff_capabilities (
  staff_id    uuid NOT NULL REFERENCES platform_staff(id) ON DELETE CASCADE,
  capability  platform_capability NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (staff_id, capability)
);

-- One row per impersonation session. The bearer token itself never appears
-- here or anywhere else in Postgres — only its SHA-256, minted and hashed in
-- Node exactly like `invitations.token_hash` (0012).
CREATE TABLE impersonation_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reason             text NOT NULL CHECK (length(btrim(reason)) > 0),
  token_hash         bytea NOT NULL UNIQUE,
  started_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  ended_at           timestamptz,
  ended_reason       impersonation_end_reason,
  CONSTRAINT impersonation_expiry_after_start CHECK (expires_at > started_at),
  CONSTRAINT impersonation_ended_consistency
    CHECK ((ended_at IS NULL) = (ended_reason IS NULL))
);
CREATE INDEX impersonation_sessions_subject_tenant_idx ON impersonation_sessions (subject_tenant_id);
CREATE INDEX impersonation_sessions_staff_idx ON impersonation_sessions (staff_user_id);
-- The hot lookup on every impersonated request: live sessions only.
CREATE INDEX impersonation_sessions_live_idx ON impersonation_sessions (token_hash)
  WHERE ended_at IS NULL;

CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE ai_provider_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL,
  label           text NOT NULL UNIQUE,
  default_model   text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL
);

-- The secret itself is app-level AEAD ciphertext under a KMS-wrapped DEK —
-- see the header. Postgres never holds, computes on, or returns a plaintext
-- key: only `key_prefix`/`key_last4` are ever selected by any function here.
CREATE TABLE ai_provider_keys (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_config_id  uuid NOT NULL REFERENCES ai_provider_configs(id) ON DELETE CASCADE,
  key_prefix          text NOT NULL,
  key_last4           text NOT NULL,
  ciphertext          bytea NOT NULL,
  wrapped_dek         bytea NOT NULL,
  kms_key_id          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at          timestamptz,
  revoked_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT ai_provider_keys_revoked_consistency
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
-- At most one live key per provider config: rotation revokes the old one in
-- the same transaction that inserts the new one (`admin_ai_key_store`).
CREATE UNIQUE INDEX ai_provider_keys_one_live_idx ON ai_provider_keys (provider_config_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- RLS: deny-by-default on every table above, even though app_rw is never
-- granted table access on them at all (see the grants section). Belt and
-- braces — if a future migration ever mistakenly grants app_rw a privilege
-- here, FORCE ROW LEVEL SECURITY with no policy still denies every row,
-- exactly like 0010's discipline for every tenant table. app_platform is
-- BYPASSRLS so none of this affects it.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_staff              ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_staff              FORCE  ROW LEVEL SECURITY;
ALTER TABLE platform_staff_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_staff_capabilities FORCE  ROW LEVEL SECURITY;
ALTER TABLE impersonation_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE impersonation_sessions      FORCE  ROW LEVEL SECURITY;
ALTER TABLE platform_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings           FORCE  ROW LEVEL SECURITY;
ALTER TABLE ai_provider_configs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_configs         FORCE  ROW LEVEL SECURITY;
ALTER TABLE ai_provider_keys            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_keys            FORCE  ROW LEVEL SECURITY;
-- No CREATE POLICY statements follow. RLS enabled + forced + zero policies is
-- Postgres for "nobody, not even the owner, unless they bypass RLS entirely."

-- 0010's `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ... TO app_rw,
-- app_readonly` was written so an ordinary tenant table added later is never
-- accidentally unreachable, and it applies here too because migrations run
-- as the same role that issued it. Left alone, `app_rw` would hold a real
-- object-level GRANT on every table above, with RLS as the ONLY thing
-- stopping it — the "zero policies means zero rows" default, same as any
-- tenant table with no matching row. That is not the guarantee this file's
-- header promises. So it is revoked explicitly, the same discipline 0010
-- already applies to `audit_log`'s UPDATE/DELETE: two independent reasons a
-- request from `app_rw` cannot reach these rows (no grant, AND no policy),
-- not one.
REVOKE ALL ON platform_staff, platform_staff_capabilities, impersonation_sessions,
              platform_settings, ai_provider_configs, ai_provider_keys
  FROM app_rw, app_readonly;

-- app_platform needs real table access to do its job. Cross-tenant tables it
-- must read to authorise and to serve analytics; nothing here is granted to
-- app_rw or app_readonly.
GRANT USAGE ON SCHEMA public TO app_platform;
GRANT SELECT, INSERT, UPDATE ON platform_staff, platform_staff_capabilities TO app_platform;
GRANT SELECT, INSERT, UPDATE ON impersonation_sessions TO app_platform;
GRANT SELECT, INSERT, UPDATE ON platform_settings TO app_platform;
GRANT SELECT, INSERT, UPDATE ON ai_provider_configs, ai_provider_keys TO app_platform;
GRANT SELECT ON users, tenants, memberships, subscriptions, plans TO app_platform;
GRANT SELECT, INSERT, UPDATE ON subscriptions TO app_platform;
GRANT SELECT, INSERT ON usage_grants TO app_platform;
GRANT SELECT ON extraction_runs, documents, captures, jobs TO app_platform;
GRANT INSERT ON jobs TO app_platform;
GRANT SELECT, INSERT ON audit_log TO app_platform;
-- `audit_log.id` is bigserial: writing to the table also needs the sequence.
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO app_platform;
GRANT SELECT ON v_tenant_cost_vs_price TO app_platform;

-- ---------------------------------------------------------------------------
-- Internal helper: does the CALLER (never a parameter) hold this capability?
--
-- Every function below that touches something sensitive calls this ITSELF
-- from its own body — that is rule 3 in the header, and it holds regardless
-- of who else calls it, because an owner always retains implicit privilege
-- on its own objects regardless of REVOKE/GRANT. It is ALSO granted to
-- app_rw (see the grants block at the end) so the Nest guard can ask "does
-- this caller hold X" directly, for a clean 403 instead of a raised
-- exception — the same fast-rejection relationship `MembershipGuard` has to
-- `withTenantAs`. Safe to expose broadly either way: the predicate is always
-- `current_user_id()`, so it discloses nothing about anyone but the caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION staff_has_capability(p_capability platform_capability)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM platform_staff ps
      JOIN platform_staff_capabilities c ON c.staff_id = ps.id
     WHERE ps.user_id = current_user_id()
       AND ps.revoked_at IS NULL
       AND c.capability = p_capability
  )
$fn$;

REVOKE EXECUTE ON FUNCTION staff_has_capability(platform_capability) FROM PUBLIC;
ALTER FUNCTION staff_has_capability(platform_capability) OWNER TO app_platform;

-- ── Self-introspection: safe to expose broadly, predicate is the caller ────
--
-- Same reasoning as `identity_user` (0015) and `memberships_self` (0012):
-- the WHERE clause is always the caller's own id, so this discloses nothing
-- about anyone else. The Nest `StaffGuard` calls this once per request in
-- place of trusting anything client-supplied.

CREATE OR REPLACE FUNCTION admin_my_capabilities()
RETURNS TABLE (staff_id uuid, role platform_staff_role, capability platform_capability)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT ps.id, ps.role, c.capability
    FROM platform_staff ps
    JOIN platform_staff_capabilities c ON c.staff_id = ps.id
   WHERE ps.user_id = current_user_id()
     AND ps.revoked_at IS NULL
$fn$;

-- ---------------------------------------------------------------------------
-- Analytics (view_analytics)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION admin_analytics_overview()
RETURNS TABLE (
  tenant_count            bigint,
  active_tenant_count     bigint,
  user_count              bigint,
  staff_count             bigint,
  document_count          bigint,
  extraction_success_rate numeric,
  cost_aud_30d            numeric,
  revenue_aud_30d         numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('view_analytics') THEN
    RAISE EXCEPTION 'missing capability: view_analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM tenants WHERE deleted_at IS NULL),
    (SELECT count(*) FROM tenants t WHERE t.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM subscriptions s
                    WHERE s.tenant_id = t.id AND s.status IN ('trialing', 'active', 'past_due'))),
    (SELECT count(*) FROM users),
    (SELECT count(*) FROM platform_staff WHERE revoked_at IS NULL),
    (SELECT count(*) FROM documents),
    (SELECT CASE WHEN count(*) FILTER (WHERE status IN ('succeeded', 'failed')) = 0 THEN NULL
                 ELSE round(
                   count(*) FILTER (WHERE status = 'succeeded')::numeric
                   / count(*) FILTER (WHERE status IN ('succeeded', 'failed')), 4)
            END
       FROM extraction_runs WHERE started_at > now() - interval '30 days'),
    (SELECT COALESCE(round(sum(cost_micros) / 1000000.0, 2), 0)
       FROM extraction_runs WHERE status = 'succeeded' AND finished_at > now() - interval '30 days'),
    (SELECT COALESCE(round(sum(p.price_cents) / 100.0, 2), 0)
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.status IN ('trialing', 'active', 'past_due'));
END $fn$;

CREATE OR REPLACE FUNCTION admin_queue_stats()
RETURNS TABLE (
  kind             text,
  pending          bigint,
  locked           bigint,
  stalled_at_max   bigint,
  oldest_pending_age interval
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('view_analytics') THEN
    RAISE EXCEPTION 'missing capability: view_analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    j.kind,
    count(*) FILTER (WHERE j.completed_at IS NULL AND j.locked_at IS NULL),
    count(*) FILTER (WHERE j.completed_at IS NULL AND j.locked_at IS NOT NULL),
    count(*) FILTER (WHERE j.completed_at IS NULL AND j.attempts >= j.max_attempts),
    max(now() - j.run_after) FILTER (WHERE j.completed_at IS NULL AND j.locked_at IS NULL)
    FROM jobs j
   GROUP BY j.kind;
END $fn$;

-- ---------------------------------------------------------------------------
-- Tenant / user metadata (view_tenant_metadata)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION admin_tenant_search(p_query text DEFAULT NULL, p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS TABLE (
  tenant_id     uuid,
  name          text,
  kind          tenant_kind,
  plan_code     text,
  member_count  bigint,
  created_at    timestamptz,
  deleted_at    timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('view_tenant_metadata') THEN
    RAISE EXCEPTION 'missing capability: view_tenant_metadata' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT t.id, t.name, t.kind, p.code,
         (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id),
         t.created_at, t.deleted_at
    FROM tenants t
    LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status IN ('trialing', 'active', 'past_due')
    LEFT JOIN plans p ON p.id = s.plan_id
   WHERE p_query IS NULL OR p_query = '' OR t.name ILIKE '%' || p_query || '%' OR t.abn = p_query
   ORDER BY t.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0);
END $fn$;

CREATE OR REPLACE FUNCTION admin_tenant_detail(p_tenant_id uuid)
RETURNS TABLE (
  tenant_id       uuid,
  name            text,
  kind            tenant_kind,
  abn             text,
  country         country_code,
  plan_code       text,
  member_count    bigint,
  created_at      timestamptz,
  deleted_at      timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('view_tenant_metadata') THEN
    RAISE EXCEPTION 'missing capability: view_tenant_metadata' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'no such tenant' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES (p_tenant_id, 'platform_staff', current_user_id(), 'admin_view_tenant_metadata',
          'tenant', p_tenant_id, jsonb_build_object('staff_user_id', current_user_id()));

  RETURN QUERY
  SELECT t.id, t.name, t.kind, t.abn::text, t.country, p.code,
         (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id),
         t.created_at, t.deleted_at
    FROM tenants t
    LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status IN ('trialing', 'active', 'past_due')
    LEFT JOIN plans p ON p.id = s.plan_id
   WHERE t.id = p_tenant_id;
END $fn$;

CREATE OR REPLACE FUNCTION admin_user_search(p_query text DEFAULT NULL, p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS TABLE (user_id uuid, email text, display_name text, created_at timestamptz, tenant_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('view_tenant_metadata') THEN
    RAISE EXCEPTION 'missing capability: view_tenant_metadata' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text, u.display_name, u.created_at,
         (SELECT count(*) FROM memberships m WHERE m.user_id = u.id)
    FROM users u
   WHERE p_query IS NULL OR p_query = '' OR u.email::text ILIKE '%' || p_query || '%'
                                         OR u.display_name ILIKE '%' || p_query || '%'
   ORDER BY u.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0);
END $fn$;

-- ---------------------------------------------------------------------------
-- Reading a tenant's actual RECORDS (read_tenant_records) — see header rule 5.
--
-- This function authorises and audits ONLY. It never selects a document, a
-- transaction, or anything tenant-owned; the application calls `withTenant`
-- immediately afterward with `p_tenant_id`, and the ordinary `tenant_isolation`
-- RLS policy scopes that read to exactly this one tenant. A reason is
-- mandatory: the CHECK on the parameter fails the call outright rather than
-- silently logging an empty string.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION admin_authorize_tenant_records(p_tenant_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('read_tenant_records') THEN
    RAISE EXCEPTION 'missing capability: read_tenant_records' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a reason is required to read a tenant''s records' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'no such tenant' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES (p_tenant_id, 'platform_staff', current_user_id(), 'admin_read_tenant_records',
          'tenant', p_tenant_id,
          jsonb_build_object('staff_user_id', current_user_id(), 'reason', p_reason));
END $fn$;

-- ---------------------------------------------------------------------------
-- Staff management (manage_staff)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION admin_staff_add(p_user_id uuid, p_role platform_staff_role, p_capabilities platform_capability[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_staff_id uuid;
  v_cap platform_capability;
BEGIN
  IF NOT staff_has_capability('manage_staff') THEN
    RAISE EXCEPTION 'missing capability: manage_staff' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'no such user' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO platform_staff (user_id, role, created_by)
  VALUES (p_user_id, p_role, current_user_id())
  RETURNING id INTO v_staff_id;

  FOREACH v_cap IN ARRAY COALESCE(p_capabilities, ARRAY[]::platform_capability[]) LOOP
    INSERT INTO platform_staff_capabilities (staff_id, capability, granted_by)
    VALUES (v_staff_id, v_cap, current_user_id());
  END LOOP;

  INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES ('platform_staff', current_user_id(), 'admin_staff_add', 'platform_staff', v_staff_id,
          jsonb_build_object('user_id', p_user_id, 'role', p_role, 'capabilities', p_capabilities));

  RETURN v_staff_id;
END $fn$;

CREATE OR REPLACE FUNCTION admin_staff_set_capability(p_staff_id uuid, p_capability platform_capability, p_grant boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_staff') THEN
    RAISE EXCEPTION 'missing capability: manage_staff' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_staff WHERE id = p_staff_id) THEN
    RAISE EXCEPTION 'no such staff member' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_grant THEN
    INSERT INTO platform_staff_capabilities (staff_id, capability, granted_by)
    VALUES (p_staff_id, p_capability, current_user_id())
    ON CONFLICT (staff_id, capability) DO NOTHING;
  ELSE
    DELETE FROM platform_staff_capabilities WHERE staff_id = p_staff_id AND capability = p_capability;
  END IF;

  INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES ('platform_staff', current_user_id(), 'admin_staff_set_capability', 'platform_staff', p_staff_id,
          jsonb_build_object('capability', p_capability, 'grant', p_grant));
END $fn$;

CREATE OR REPLACE FUNCTION admin_staff_revoke(p_staff_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_staff') THEN
    RAISE EXCEPTION 'missing capability: manage_staff' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE platform_staff SET revoked_at = now(), revoked_by = current_user_id()
   WHERE id = p_staff_id AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such active staff member' USING ERRCODE = 'no_data_found';
  END IF;

  -- Kill any impersonation sessions this staff member currently holds, so a
  -- revoked staff account cannot keep acting as a customer through a session
  -- minted before the revocation.
  UPDATE impersonation_sessions
     SET ended_at = now(), ended_reason = 'revoked'
   WHERE staff_user_id = (SELECT user_id FROM platform_staff WHERE id = p_staff_id)
     AND ended_at IS NULL;

  INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id)
  VALUES ('platform_staff', current_user_id(), 'admin_staff_revoke', 'platform_staff', p_staff_id);
END $fn$;

CREATE OR REPLACE FUNCTION admin_staff_list()
RETURNS TABLE (staff_id uuid, user_id uuid, email text, display_name text, role platform_staff_role,
               capabilities platform_capability[], created_at timestamptz, revoked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_staff') THEN
    RAISE EXCEPTION 'missing capability: manage_staff' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT ps.id, ps.user_id, u.email::text, u.display_name, ps.role,
         COALESCE(array_agg(c.capability) FILTER (WHERE c.capability IS NOT NULL), ARRAY[]::platform_capability[]),
         ps.created_at, ps.revoked_at
    FROM platform_staff ps
    JOIN users u ON u.id = ps.user_id
    LEFT JOIN platform_staff_capabilities c ON c.staff_id = ps.id
   GROUP BY ps.id, u.email, u.display_name
   ORDER BY ps.created_at DESC;
END $fn$;

-- ---------------------------------------------------------------------------
-- Plan / quota administration (manage_billing)
-- ---------------------------------------------------------------------------

-- `plans` is already a public catalogue (0010: readable by every tenant), so
-- this gate protects nothing that isn't already visible elsewhere — it is
-- here so every function this migration exposes is gated the same way, with
-- no quietly-ungated exception for a reviewer to find later.
CREATE OR REPLACE FUNCTION admin_plan_list()
RETURNS TABLE (plan_id uuid, code text, name text, price_cents integer, scan_quota integer, seat_limit integer, is_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_billing') THEN
    RAISE EXCEPTION 'missing capability: manage_billing' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT id, code, name, price_cents, scan_quota, seat_limit, is_active FROM plans ORDER BY price_cents;
END $fn$;

CREATE OR REPLACE FUNCTION admin_tenant_set_plan(p_tenant_id uuid, p_plan_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_sub_id uuid;
  v_before jsonb;
BEGIN
  IF NOT staff_has_capability('manage_billing') THEN
    RAISE EXCEPTION 'missing capability: manage_billing' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a reason is required to change a tenant''s plan' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM plans WHERE id = p_plan_id) THEN
    RAISE EXCEPTION 'no such plan' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT to_jsonb(s) INTO v_before FROM subscriptions s
   WHERE s.tenant_id = p_tenant_id AND s.status IN ('trialing', 'active', 'past_due')
   LIMIT 1;

  UPDATE subscriptions SET status = 'canceled', canceled_at = now(), updated_at = now()
   WHERE tenant_id = p_tenant_id AND status IN ('trialing', 'active', 'past_due');

  INSERT INTO subscriptions (id, tenant_id, plan_id, status, provider, current_period_start, current_period_end)
  VALUES (gen_random_uuid(), p_tenant_id, p_plan_id, 'active', 'manual', now(), now() + interval '30 days')
  RETURNING id INTO v_sub_id;

  INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, before, after)
  VALUES (p_tenant_id, 'platform_staff', current_user_id(), 'admin_tenant_set_plan', 'subscription', v_sub_id,
          v_before, jsonb_build_object('plan_id', p_plan_id, 'reason', p_reason));

  RETURN v_sub_id;
END $fn$;

CREATE OR REPLACE FUNCTION admin_usage_grant(p_tenant_id uuid, p_metric text, p_amount integer, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT staff_has_capability('manage_billing') THEN
    RAISE EXCEPTION 'missing capability: manage_billing' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a reason is required to grant usage' USING ERRCODE = 'check_violation';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'no such tenant' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source)
  VALUES (v_id, p_tenant_id, p_metric, p_amount, p_amount, 'platform_staff:' || current_user_id());

  INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES (p_tenant_id, 'platform_staff', current_user_id(), 'admin_usage_grant', 'usage_grant', v_id,
          jsonb_build_object('metric', p_metric, 'amount', p_amount, 'reason', p_reason));

  RETURN v_id;
END $fn$;

-- ---------------------------------------------------------------------------
-- Platform settings (manage_platform_settings)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION admin_setting_list()
RETURNS TABLE (key text, value jsonb, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_platform_settings') THEN
    RAISE EXCEPTION 'missing capability: manage_platform_settings' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT s.key, s.value, s.updated_at FROM platform_settings s ORDER BY s.key;
END $fn$;

CREATE OR REPLACE FUNCTION admin_setting_set(p_key text, p_value jsonb, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_before jsonb;
BEGIN
  IF NOT staff_has_capability('manage_platform_settings') THEN
    RAISE EXCEPTION 'missing capability: manage_platform_settings' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a reason is required to change a platform setting' USING ERRCODE = 'check_violation';
  END IF;

  SELECT value INTO v_before FROM platform_settings WHERE key = p_key;

  INSERT INTO platform_settings (key, value, updated_by) VALUES (p_key, p_value, current_user_id())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;

  INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, before, after)
  VALUES ('platform_staff', current_user_id(), 'admin_setting_set', 'platform_setting', NULL,
          jsonb_build_object('key', p_key, 'before', v_before),
          jsonb_build_object('key', p_key, 'value', p_value, 'reason', p_reason));
END $fn$;

-- ---------------------------------------------------------------------------
-- AI provider / model / key configuration (manage_ai_config)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION admin_ai_provider_upsert(p_provider text, p_label text, p_default_model text, p_is_active boolean)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF NOT staff_has_capability('manage_ai_config') THEN
    RAISE EXCEPTION 'missing capability: manage_ai_config' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO ai_provider_configs (id, provider, label, default_model, is_active, created_by)
  VALUES (gen_random_uuid(), p_provider, p_label, p_default_model, COALESCE(p_is_active, true), current_user_id())
  ON CONFLICT (label) DO UPDATE
     SET provider = EXCLUDED.provider, default_model = EXCLUDED.default_model, is_active = EXCLUDED.is_active
  RETURNING id INTO v_id;

  INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES ('platform_staff', current_user_id(), 'admin_ai_provider_upsert', 'ai_provider_config', v_id,
          jsonb_build_object('provider', p_provider, 'label', p_label, 'default_model', p_default_model,
                              'is_active', p_is_active));

  RETURN v_id;
END $fn$;

CREATE OR REPLACE FUNCTION admin_ai_provider_list()
RETURNS TABLE (id uuid, provider text, label text, default_model text, is_active boolean,
               has_live_key boolean, key_prefix text, key_last4 text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_ai_config') THEN
    RAISE EXCEPTION 'missing capability: manage_ai_config' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Never selects `ciphertext` or `wrapped_dek` — see the header. This is the
  -- ONLY function that reads anything out of `ai_provider_keys`, and it reads
  -- only the display-safe columns.
  RETURN QUERY
  SELECT c.id, c.provider, c.label, c.default_model, c.is_active,
         k.id IS NOT NULL, k.key_prefix, k.key_last4
    FROM ai_provider_configs c
    LEFT JOIN ai_provider_keys k ON k.provider_config_id = c.id AND k.revoked_at IS NULL
   ORDER BY c.label;
END $fn$;

-- Stores a key already encrypted by the application (app-level AEAD, KMS-
-- wrapped DEK — see the header). This function never sees, computes on, or
-- could reconstruct plaintext: it only ever writes and reads opaque bytes.
CREATE OR REPLACE FUNCTION admin_ai_key_store(
  p_provider_config_id uuid,
  p_key_prefix text,
  p_key_last4 text,
  p_ciphertext bytea,
  p_wrapped_dek bytea,
  p_kms_key_id text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT staff_has_capability('manage_ai_config') THEN
    RAISE EXCEPTION 'missing capability: manage_ai_config' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ai_provider_configs WHERE id = p_provider_config_id) THEN
    RAISE EXCEPTION 'no such AI provider config' USING ERRCODE = 'no_data_found';
  END IF;

  -- Rotation: the old live key (if any) is revoked in the same transaction
  -- the new one is inserted, so `ai_provider_keys_one_live_idx` never blocks
  -- a legitimate rotation and there is never a moment with two live keys.
  UPDATE ai_provider_keys SET revoked_at = now(), revoked_by = current_user_id()
   WHERE provider_config_id = p_provider_config_id AND revoked_at IS NULL;

  INSERT INTO ai_provider_keys (id, provider_config_id, key_prefix, key_last4, ciphertext, wrapped_dek, kms_key_id, created_by)
  VALUES (v_id, p_provider_config_id, p_key_prefix, p_key_last4, p_ciphertext, p_wrapped_dek, p_kms_key_id, current_user_id());

  -- The audit row names the config and the DISPLAY-SAFE prefix/last4 only.
  -- Never the ciphertext, the wrapped DEK, or anything that could be
  -- combined with them to recover the key.
  INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES ('platform_staff', current_user_id(), 'admin_ai_key_store', 'ai_provider_key', v_id,
          jsonb_build_object('provider_config_id', p_provider_config_id,
                              'key_prefix', p_key_prefix, 'key_last4', p_key_last4));

  RETURN v_id;
END $fn$;

CREATE OR REPLACE FUNCTION admin_ai_key_revoke(p_key_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_ai_config') THEN
    RAISE EXCEPTION 'missing capability: manage_ai_config' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a reason is required to revoke an AI key' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE ai_provider_keys SET revoked_at = now(), revoked_by = current_user_id()
   WHERE id = p_key_id AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such live AI key' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES ('platform_staff', current_user_id(), 'admin_ai_key_revoke', 'ai_provider_key', p_key_id,
          jsonb_build_object('reason', p_reason));
END $fn$;

CREATE OR REPLACE FUNCTION admin_ai_usage_summary()
RETURNS TABLE (engine extraction_engine, model_id text, runs bigint, succeeded bigint,
               failed bigint, cost_aud numeric, avg_latency_ms numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_ai_config') THEN
    RAISE EXCEPTION 'missing capability: manage_ai_config' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT e.engine, e.model_id, count(*),
         count(*) FILTER (WHERE e.status = 'succeeded'),
         count(*) FILTER (WHERE e.status = 'failed'),
         COALESCE(round(sum(e.cost_micros) FILTER (WHERE e.status = 'succeeded') / 1000000.0, 2), 0),
         round(avg(e.latency_ms), 1)
    FROM extraction_runs e
   WHERE e.started_at > now() - interval '30 days'
   GROUP BY e.engine, e.model_id
   ORDER BY count(*) DESC;
END $fn$;

-- ---------------------------------------------------------------------------
-- Operational controls (manage_operations to mutate; view_analytics to read)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION admin_trigger_reextraction(p_tenant_id uuid, p_capture_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_job_id uuid := gen_random_uuid();
BEGIN
  IF NOT staff_has_capability('manage_operations') THEN
    RAISE EXCEPTION 'missing capability: manage_operations' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a reason is required to trigger re-extraction' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM captures WHERE id = p_capture_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'no such capture in that tenant' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO jobs (id, tenant_id, kind, payload)
  VALUES (v_job_id, p_tenant_id, 'extract', jsonb_build_object('captureId', p_capture_id));

  INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES (p_tenant_id, 'platform_staff', current_user_id(), 'admin_trigger_reextraction', 'capture', p_capture_id,
          jsonb_build_object('job_id', v_job_id, 'reason', p_reason));

  RETURN v_job_id;
END $fn$;

CREATE OR REPLACE FUNCTION admin_retention_status()
RETURNS TABLE (tenant_id uuid, name text, oldest_document_issue_date date, retention_months integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('view_analytics') THEN
    RAISE EXCEPTION 'missing capability: view_analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT t.id, t.name, min(d.issue_date), max(p.retention_months)
    FROM tenants t
    JOIN documents d ON d.tenant_id = t.id
    LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status IN ('trialing', 'active', 'past_due')
    LEFT JOIN plans p ON p.id = s.plan_id
   WHERE t.deleted_at IS NULL
   GROUP BY t.id, t.name
   ORDER BY min(d.issue_date) NULLS LAST
   LIMIT 100;
END $fn$;

-- ---------------------------------------------------------------------------
-- Impersonation (impersonate) — see the header for the whole design.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION admin_impersonation_start(
  p_subject_user_id uuid,
  p_subject_tenant_id uuid,
  p_reason text,
  p_token_hash bytea,
  p_ttl_seconds integer DEFAULT 1800
) RETURNS TABLE (session_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id uuid := gen_random_uuid();
  v_ttl integer := LEAST(GREATEST(COALESCE(p_ttl_seconds, 1800), 60), 3600);
  v_expires timestamptz := now() + make_interval(secs => v_ttl);
BEGIN
  IF NOT staff_has_capability('impersonate') THEN
    RAISE EXCEPTION 'missing capability: impersonate' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a reason is required to impersonate' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.user_id = p_subject_user_id AND m.tenant_id = p_subject_tenant_id
  ) THEN
    RAISE EXCEPTION 'that user is not a member of that tenant' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO impersonation_sessions
    (id, staff_user_id, subject_user_id, subject_tenant_id, reason, token_hash, expires_at)
  VALUES (v_id, current_user_id(), p_subject_user_id, p_subject_tenant_id, p_reason, p_token_hash, v_expires);

  INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES (p_subject_tenant_id, 'platform_staff', current_user_id(), 'admin_impersonation_start',
          'impersonation_session', v_id,
          jsonb_build_object('subject_user_id', p_subject_user_id, 'reason', p_reason,
                              'expires_at', v_expires));

  RETURN QUERY SELECT v_id, v_expires;
END $fn$;

-- Returns the row's own `ended_reason` rather than void: `app_rw` has NO
-- grant on `impersonation_sessions` at all (see the REVOKE ALL above), so the
-- caller cannot follow up with a plain SELECT to find out how it ended —
-- this is the only way it can learn that.
CREATE OR REPLACE FUNCTION admin_impersonation_stop(p_session_id uuid)
RETURNS impersonation_end_reason
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_session impersonation_sessions%ROWTYPE;
  v_reason impersonation_end_reason;
BEGIN
  SELECT * INTO v_session FROM impersonation_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'no such impersonation session' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_session.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'that session has already ended' USING ERRCODE = 'check_violation';
  END IF;

  IF v_session.staff_user_id = current_user_id() THEN
    v_reason := 'stopped';
  ELSIF staff_has_capability('manage_staff') THEN
    v_reason := 'revoked';
  ELSE
    RAISE EXCEPTION 'only the staff member who started this session, or manage_staff, may end it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE impersonation_sessions SET ended_at = now(), ended_reason = v_reason WHERE id = p_session_id;

  INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES (v_session.subject_tenant_id, 'platform_staff', current_user_id(), 'admin_impersonation_stop',
          'impersonation_session', p_session_id,
          jsonb_build_object('subject_user_id', v_session.subject_user_id, 'ended_reason', v_reason));

  RETURN v_reason;
END $fn$;

-- Redeems the token on EVERY request made under it: validates, auto-expires,
-- re-checks the capability (a revoked staff member's session dies on its
-- next use, not just future ones), and writes one `audit_log` row naming
-- both principals — `actor_id` is the staff member, `tenant_id` is the
-- subject's tenant, and `after` names the subject explicitly. This is the
-- ONLY function that accepts a token hash as its credential rather than
-- `current_user_id()`; that is safe here for the same reason it is safe in
-- `invitation_accept` (0015) — the value itself is the proof, not a claim
-- about who is asking.
CREATE OR REPLACE FUNCTION admin_impersonation_verify(p_token_hash bytea, p_method text, p_path text)
RETURNS TABLE (session_id uuid, staff_user_id uuid, subject_user_id uuid, subject_tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_session impersonation_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM impersonation_sessions
   WHERE token_hash = p_token_hash AND ended_at IS NULL
   FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN; -- no such live session: empty result, guard treats as unauthenticated
  END IF;

  IF v_session.expires_at <= now() THEN
    UPDATE impersonation_sessions SET ended_at = now(), ended_reason = 'expired' WHERE id = v_session.id;
    RETURN;
  END IF;

  -- Defense in depth: capability revoked mid-session kills it on next use.
  IF NOT EXISTS (
    SELECT 1 FROM platform_staff ps
      JOIN platform_staff_capabilities c ON c.staff_id = ps.id
     WHERE ps.user_id = v_session.staff_user_id AND ps.revoked_at IS NULL AND c.capability = 'impersonate'
  ) THEN
    UPDATE impersonation_sessions SET ended_at = now(), ended_reason = 'revoked' WHERE id = v_session.id;
    RETURN;
  END IF;

  INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES (v_session.subject_tenant_id, 'platform_staff', v_session.staff_user_id, 'admin_impersonated_request',
          'impersonation_session', v_session.id,
          jsonb_build_object('subject_user_id', v_session.subject_user_id, 'method', p_method, 'path', p_path));

  RETURN QUERY SELECT v_session.id, v_session.staff_user_id, v_session.subject_user_id, v_session.subject_tenant_id;
END $fn$;

-- Housekeeping only — `admin_impersonation_verify` already refuses an expired
-- token on its own, so correctness never depends on this running. A periodic
-- caller (e.g. the retention job) keeps the live-session index small and the
-- `ended_reason` accurate for anything that expired without ever being
-- reused.
CREATE OR REPLACE FUNCTION admin_impersonation_sweep_expired()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_count bigint;
BEGIN
  IF NOT staff_has_capability('manage_operations') THEN
    RAISE EXCEPTION 'missing capability: manage_operations' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH expired AS (
    UPDATE impersonation_sessions SET ended_at = now(), ended_reason = 'expired'
     WHERE ended_at IS NULL AND expires_at <= now()
     RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;
  RETURN v_count;
END $fn$;

-- ---------------------------------------------------------------------------
-- Who may call these — PUBLIC first, because CREATE FUNCTION defaults to
-- granting EXECUTE to PUBLIC, which on a SECURITY DEFINER function means
-- everyone (0015's own warning).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'staff_has_capability(platform_capability)',
    'admin_my_capabilities()',
    'admin_analytics_overview()',
    'admin_queue_stats()',
    'admin_tenant_search(text,int,int)',
    'admin_tenant_detail(uuid)',
    'admin_user_search(text,int,int)',
    'admin_authorize_tenant_records(uuid,text)',
    'admin_staff_add(uuid,platform_staff_role,platform_capability[])',
    'admin_staff_set_capability(uuid,platform_capability,boolean)',
    'admin_staff_revoke(uuid)',
    'admin_staff_list()',
    'admin_plan_list()',
    'admin_tenant_set_plan(uuid,uuid,text)',
    'admin_usage_grant(uuid,text,int,text)',
    'admin_setting_list()',
    'admin_setting_set(text,jsonb,text)',
    'admin_ai_provider_upsert(text,text,text,boolean)',
    'admin_ai_provider_list()',
    'admin_ai_key_store(uuid,text,text,bytea,bytea,text)',
    'admin_ai_key_revoke(uuid,text)',
    'admin_ai_usage_summary()',
    'admin_trigger_reextraction(uuid,uuid,text)',
    'admin_retention_status()',
    'admin_impersonation_start(uuid,uuid,text,bytea,int)',
    'admin_impersonation_stop(uuid)',
    'admin_impersonation_verify(bytea,text,text)',
    'admin_impersonation_sweep_expired()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('ALTER FUNCTION %s OWNER TO app_platform', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_rw', fn);
  END LOOP;
END $$;
