-- ---------------------------------------------------------------------------
-- 0012 — Collaboration
--
-- A workspace becomes a first-class thing people are invited into, rather than
-- a flag on a row. Four changes, and the third is the important one:
--
--   1. tenants.kind        — business or personal. The mobile app has carried
--                            this distinction client-side; it belongs here,
--                            because it decides whether a workspace has a BAS.
--   2. invitations         — a pending membership with an expiry and a hashed
--                            token. Memberships could previously only be
--                            created directly, which is not a flow a person
--                            can be walked through.
--   3. current_user_id()   — and the two policies that let a caller discover
--      + memberships_self    which tenants they belong to. Until now
--      + tenants_member       `withTenant()` trusted whatever tenant id it was
--                            handed: no check existed that the caller was a
--                            member. That was tolerable when a user had one
--                            tenant. With a workspace switcher it is the
--                            single authorisation decision the product rests
--                            on, so the check moves into the database, where
--                            it cannot be forgotten by a new endpoint.
--   4. attribution         — who captured and confirmed each document, plus a
--                            version for concurrent edits. Corrections already
--                            carried `corrected_by` (0004); documents did not.
--                            In a shared workspace "who changed this" is a
--                            question that will be asked.
-- ---------------------------------------------------------------------------

-- ── 1. Workspace kind ──────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE tenant_kind AS ENUM ('business', 'personal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS kind tenant_kind NOT NULL DEFAULT 'business';

COMMENT ON COLUMN tenants.kind IS
  'business: tracks GST, tax invoices and a BAS. personal: budgets only — the '
  'personal UI never mentions GST, an ABN or a tax invoice.';

-- A personal workspace has no ABN and cannot be registered for GST. Enforced
-- here rather than in the app because it is the difference between a household
-- and an enterprise, and a personal workspace that quietly acquires a BAS
-- position is a compliance problem.
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_personal_has_no_gst;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_personal_has_no_gst
  CHECK (kind = 'business' OR (abn IS NULL AND gst_registered = false));

-- ── 2. Invitations ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invitations (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner','admin','bookkeeper','member','readonly')),
  -- The token is never stored. Only its SHA-256, so a database disclosure does
  -- not hand out working join links — the same reasoning as a password hash.
  token_hash  bytea NOT NULL,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- A join link that never expires is a credential lying around in an inbox.
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  CONSTRAINT invitations_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT invitations_accepted_xor_revoked
    CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

-- One live invitation per address per workspace. Partial, so a revoked or
-- accepted invitation never blocks re-inviting someone later.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_one_pending_per_email
  ON invitations (tenant_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS invitations_tenant_idx ON invitations (tenant_id, created_at DESC);

-- ── 3. Who is asking ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

COMMENT ON FUNCTION current_user_id() IS
  'The signed-in user, set per transaction alongside app.tenant_id. NULL when '
  'unset, which fails closed exactly like current_tenant_id().';

-- A caller may always read their OWN memberships, in any tenant context —
-- including none. This is what makes the membership check possible before a
-- tenant is chosen, and it is also how the workspace switcher gets its list.
-- It exposes nothing about anyone else: the predicate is the caller's own id.
DROP POLICY IF EXISTS memberships_self ON memberships;
CREATE POLICY memberships_self ON memberships
  FOR SELECT
  USING (user_id = current_user_id());

-- Likewise the tenants they belong to, so the switcher can show names.
DROP POLICY IF EXISTS tenants_member_visible ON tenants;
CREATE POLICY tenants_member_visible ON tenants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.tenant_id = tenants.id
        AND m.user_id = current_user_id()
    )
  );

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitations_tenant ON invitations;
CREATE POLICY invitations_tenant ON invitations
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO app_rw;
GRANT SELECT ON invitations TO app_readonly;

-- ── 4. Attribution and concurrency ─────────────────────────────────────────

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  -- Private items still count toward a household total; only their detail is
  -- hidden from other members. Business records are never private to a person.
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'shared'
    CHECK (visibility IN ('shared', 'private')),
  -- Optimistic concurrency. Two people correcting the same extraction with
  -- last-writer-wins silently loses one of the corrections, and these are
  -- money fields.
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION bump_document_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Only a real change counts. A no-op UPDATE must not invalidate someone
  -- else's in-flight edit.
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS documents_bump_version ON documents;
CREATE TRIGGER documents_bump_version
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION bump_document_version();

CREATE INDEX IF NOT EXISTS documents_created_by_idx
  ON documents (tenant_id, created_by);
