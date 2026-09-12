-- 0011_firms
-- Practices: the accounting/bookkeeping firm that owns many client tenants.
--
-- The practice channel is the primary revenue line (docs/MONETISATION.md), which
-- needs a level above `tenants`: somewhere to bill a firm, list its clients, and
-- give its staff access to them.
--
-- WHAT THIS DOES *NOT* DO: it does not touch tenant RLS. `current_tenant_id()`
-- stays the one isolation mechanism. Whether a given firm user may act as tenant
-- X is an authorisation question the API answers (against firm_memberships)
-- before it ever calls set_config. Pushing firm logic into every tenant policy
-- would make 20 policies more complex and give the isolation boundary two
-- moving parts instead of one.

CREATE TYPE firm_role AS ENUM ('owner', 'admin', 'staff');

CREATE TABLE firms (
  id                 uuid PRIMARY KEY,
  name               text NOT NULL,
  abn                char(11),
  abn_valid          boolean GENERATED ALWAYS AS (abn_is_valid(abn)) STORED,
  /* Tax Practitioners Board registration. An accountant will ask whose number
     stands behind the BAS figures; this is where it lives. */
  tax_agent_number   text,
  country            country_code NOT NULL DEFAULT 'AU',
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

-- A client tenant may belong to a firm, or stand alone (direct plan).
ALTER TABLE tenants
  ADD COLUMN firm_id uuid REFERENCES firms(id) ON DELETE SET NULL;
CREATE INDEX tenants_firm_idx ON tenants (firm_id) WHERE firm_id IS NOT NULL;

CREATE TABLE firm_memberships (
  firm_id     uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        firm_role NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firm_id, user_id)
);
CREATE INDEX firm_memberships_user_idx ON firm_memberships (user_id);

-- ---------------------------------------------------------------------------
-- Billing rolls up to the firm; metering stays per client tenant.
-- A subscription belongs to exactly one of the two, never both and never neither.
-- ---------------------------------------------------------------------------
ALTER TABLE subscriptions
  ALTER COLUMN tenant_id DROP NOT NULL,
  ADD COLUMN firm_id uuid REFERENCES firms(id) ON DELETE CASCADE,
  ADD COLUMN seats int,
  ADD CONSTRAINT subscriptions_one_owner CHECK (
    (tenant_id IS NOT NULL AND firm_id IS NULL)
    OR (tenant_id IS NULL AND firm_id IS NOT NULL)
  );

-- The existing partial unique index only covers tenant-owned subscriptions;
-- firm-owned ones need the same "at most one live" guarantee.
CREATE UNIQUE INDEX subscriptions_one_live_firm_idx ON subscriptions (firm_id)
  WHERE firm_id IS NOT NULL AND status IN ('trialing', 'active', 'past_due');

-- Practice plans, priced per client seat. 10-client minimum is enforced in the
-- application, not here: a firm mid-migration can legitimately dip below it.
INSERT INTO plans (id, code, name, price_cents, scan_quota, seat_limit, realtime, retention_months, features) VALUES
  (gen_random_uuid(), 'practice',      'Practice',      1900, 200, 1, true, 60,
     '{"xero":true,"bas_pack":true,"tax_pack":true,"ledger":"full","per_client_seat":true}'),
  (gen_random_uuid(), 'practice_plus', 'Practice Plus', 2900, 600, 1, true, 84,
     '{"xero":true,"myob":true,"quickbooks":true,"api":true,"bas_pack":true,"tax_pack":true,"ledger":"full","multi_entity":true,"white_label":true,"per_client_seat":true}'),
  (gen_random_uuid(), 'sole_trader',   'Sole Trader',   2900, 150, 1, true, 60,
     '{"xero":true,"bas_pack":true,"tax_pack":true,"ledger":"full"}');

-- ---------------------------------------------------------------------------
-- A firm's client list, with each client's live usage. This is the practice
-- dashboard's only query.
-- ---------------------------------------------------------------------------
CREATE VIEW v_firm_clients WITH (security_invoker = true) AS
SELECT
  f.id                                    AS firm_id,
  t.id                                    AS tenant_id,
  t.name                                  AS client_name,
  t.abn,
  t.abn_valid,
  t.gst_registered,
  t.gst_basis,
  t.occupation_profile_id,
  COALESCE(uc.used, 0)                    AS scans_used_this_period,
  (SELECT count(*) FROM review_tasks r
    WHERE r.tenant_id = t.id AND r.resolved_at IS NULL) AS open_review_tasks,
  (SELECT count(*) FROM documents d
    WHERE d.tenant_id = t.id
      AND d.deleted_at IS NULL
      AND d.review_status = 'needs_review')            AS documents_needing_review,
  t.created_at
FROM firms f
JOIN tenants t ON t.firm_id = f.id AND t.deleted_at IS NULL
LEFT JOIN usage_counters uc
       ON uc.tenant_id = t.id
      AND uc.metric = 'scans'
      AND uc.period_start = date_trunc('month', now())::date
WHERE f.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- RLS for the new firm-scoped tables.
--
-- `app.firm_id` is a second, separate session setting. A firm user's session
-- sets it once; acting on a specific client still requires app.tenant_id, so the
-- two boundaries compose rather than replacing one another.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_firm_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.firm_id', true), '')::uuid
$$;

ALTER TABLE firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE firms FORCE  ROW LEVEL SECURITY;
CREATE POLICY firm_self ON firms
  FOR ALL
  USING (id = current_firm_id())
  WITH CHECK (id = current_firm_id());

ALTER TABLE firm_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_memberships FORCE  ROW LEVEL SECURITY;
CREATE POLICY firm_memberships_scoped ON firm_memberships
  FOR ALL
  USING (firm_id = current_firm_id())
  WITH CHECK (firm_id = current_firm_id());

-- A firm subscription is visible to that firm; a tenant subscription to that
-- tenant. The pre-existing tenant_isolation policy is FOR ALL with a tenant_id
-- predicate, so firm-owned rows (tenant_id IS NULL) need their own permissive
-- policy — policies OR together.
CREATE POLICY subscriptions_firm ON subscriptions
  FOR ALL
  USING (firm_id = current_firm_id())
  WITH CHECK (firm_id = current_firm_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON firms, firm_memberships TO app_rw;
GRANT SELECT ON firms, firm_memberships TO app_readonly;
