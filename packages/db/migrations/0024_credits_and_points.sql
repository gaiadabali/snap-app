-- 0024_credits_and_points
--
-- Credits you buy, points you earn, and the ten scans a new account starts with.
--
-- THREE THINGS THAT LOOK SIMILAR AND ARE NOT. Getting these confused is the
-- expensive mistake here, so they are three mechanisms on purpose:
--
--   1. PLAN QUOTA      — what a subscription includes each month. Resets.
--                        Already modelled: `plans.included_scans` + `usage_counters`.
--   2. CREDITS         — bought with money, or granted free at signup. Do NOT
--                        reset; consumed only after the plan quota is spent.
--                        Already modelled: `usage_grants`. This migration adds
--                        the CATALOGUE and the PURCHASE RECORD around it, not a
--                        second balance — two places tracking the same number
--                        is how a customer gets billed for scans they had.
--   3. POINTS          — earned BY scanning, spent in another product entirely.
--                        Genuinely new, and deliberately not a currency: see
--                        the liability note below.
--
-- WHY CREDITS ARE TENANT-SCOPED AND POINTS ARE USER-SCOPED. A credit buys a
-- scan, and a scan happens inside a workspace, so credits follow the workspace
-- and its RLS. A point is earned by a PERSON and redeemed in a different app in
-- the ecosystem, where the workspace has no meaning — so points hang off
-- `users`, the one identity the whole ecosystem shares. That asymmetry is the
-- design, not an oversight.
--
-- POINTS ARE A LIABILITY. The moment a point is redeemable for something of
-- value, outstanding points are an obligation — and in Australia a loyalty
-- scheme that can be varied or cancelled without notice runs into ACL unfair
-- contract terms. The ledger is therefore append-only and every row records WHY
-- it moved, so the outstanding balance is always reconstructible and auditable.
-- No row is ever updated or deleted; a correction is a compensating entry.

-- ── Credit packs: the catalogue ─────────────────────────────────────────────
--
-- A catalogue like `plans`: readable by everyone, written only by migrations.
-- Price is NUMERIC, never a float — this is money, and the same rule that makes
-- the ledger trustworthy applies to the price list.
CREATE TABLE credit_packs (
  code          text PRIMARY KEY,
  credits       int  NOT NULL CHECK (credits > 0),
  price_aud     numeric(12,4) NOT NULL CHECK (price_aud >= 0),
  /* Display order, so the UI is not sorting on price and guessing. */
  sort_order    int  NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Unit price falls as volume rises — the usual shape, and it also gives the
-- larger packs a reason to exist. Figures are GST-inclusive AUD.
--
-- THE MARGIN THESE ASSUME. Measured all-in cost is ~$0.013/scan today:
-- ~$0.011 blended extraction plus ~$0.002 storage across the five-year ATO
-- retention window (docs/MONETISATION.md §4). At $0.015 the smallest pack is
-- therefore ~13% gross, NOT the 3x a $0.005 model cost would suggest — storage
-- does not go away. The margin case rests on the open-weight primary (D18) and
-- on-device preview (D21) bringing the extraction half down; until those are
-- measured, treat these prices as a floor to revisit, not a settled model.
INSERT INTO credit_packs (code, credits, price_aud, sort_order) VALUES
  ('credits_10',   10,   0.1500, 10),
  ('credits_50',   50,   0.7000, 20),
  ('credits_100',  100,  1.3000, 30),
  ('credits_200',  200,  2.4000, 40),
  ('credits_500',  500,  5.5000, 50),
  ('credits_1000', 1000, 10.0000, 60);

-- ── Credit purchases: the money record ──────────────────────────────────────
--
-- Separate from `usage_grants` because they answer different questions.
-- `usage_grants` answers "how many scans are left". This answers "what was
-- paid, by whom, through which processor, and can it be refunded" — and it has
-- to survive the grant being fully consumed.
CREATE TYPE credit_purchase_status AS ENUM ('pending', 'paid', 'failed', 'refunded');

CREATE TABLE credit_purchases (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /* Who clicked buy. Kept even if they later leave the workspace. */
  purchased_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  pack_code      text NOT NULL REFERENCES credit_packs(code),
  credits        int  NOT NULL CHECK (credits > 0),
  /* Captured at purchase time, not read back from the catalogue: the price
     list changes and an old receipt must still say what was actually paid. */
  price_aud      numeric(12,4) NOT NULL CHECK (price_aud >= 0),
  status         credit_purchase_status NOT NULL DEFAULT 'pending',
  provider       billing_provider NOT NULL DEFAULT 'manual',
  /* The processor's own id, for reconciliation and idempotent webhooks. */
  provider_ref   text,
  /* The grant this purchase created, once paid. NULL while pending or failed —
     credits must never exist before the money does. */
  grant_id       uuid REFERENCES usage_grants(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz,
  CONSTRAINT purchase_paid_has_time CHECK ((status = 'paid') = (paid_at IS NOT NULL)),
  CONSTRAINT purchase_paid_has_grant CHECK (status <> 'paid' OR grant_id IS NOT NULL)
);
CREATE INDEX credit_purchases_tenant_idx ON credit_purchases (tenant_id, created_at DESC);
-- One row per processor reference: a webhook delivered twice must not grant
-- the credits twice. Partial, because 'manual' purchases have no reference.
CREATE UNIQUE INDEX credit_purchases_provider_ref_idx
  ON credit_purchases (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

-- ── Points: earned by scanning, spent elsewhere ─────────────────────────────
--
-- Append-only. The balance is a SUM, never a stored column that can drift from
-- its own history — the same reason the ledger has no stored account balance.
CREATE TABLE point_ledger (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  /* Positive earns, negative redeems. No CHECK forcing a non-negative
     running balance here: that is an application invariant enforced at the
     point of redemption, and a constraint trigger over a SUM would serialise
     every write for a rule that only matters at one call site. */
  delta       int  NOT NULL CHECK (delta <> 0),
  /* 'scan', 'signup', 'referral', 'redemption', 'adjustment'. Text rather than
     an enum so a new earning rule does not need a migration — the values are
     summarised in reporting, not branched on in SQL. */
  reason      text NOT NULL,
  /* What caused it: a capture id for a scan, a redemption id from the other
     app. Free-form because the referent lives in different tables, and in a
     different product for redemptions. */
  ref         text,
  /* Which ecosystem app moved it. Points are earned here and spent elsewhere,
     so the ledger has to say which. */
  app         text NOT NULL DEFAULT 'snap-apps',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX point_ledger_user_idx ON point_ledger (user_id, created_at DESC);
-- One point entry per scan, enforced rather than trusted: a retried capture
-- must not pay twice. Partial so redemptions and adjustments are unaffected.
CREATE UNIQUE INDEX point_ledger_scan_once_idx
  ON point_ledger (user_id, ref)
  WHERE reason = 'scan' AND ref IS NOT NULL;

CREATE VIEW v_point_balance AS
SELECT user_id, COALESCE(SUM(delta), 0)::bigint AS balance
  FROM point_ledger
 GROUP BY user_id;

-- ── RLS ─────────────────────────────────────────────────────────────────────

-- Catalogue: readable by all, written by migrations only. Same as `plans`.
ALTER TABLE credit_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_packs FORCE  ROW LEVEL SECURITY;
CREATE POLICY credit_packs_read ON credit_packs FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON credit_packs FROM app_rw;

-- Purchases are tenant data, isolated exactly like every other tenant table.
ALTER TABLE credit_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_purchases FORCE  ROW LEVEL SECURITY;
CREATE POLICY credit_purchases_tenant ON credit_purchases
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Points are USER data, not tenant data — they follow the person across the
-- ecosystem, so `current_tenant_id()` is the wrong predicate entirely. Scoped
-- to the signed-in user instead, the same way `memberships_self` is.
ALTER TABLE point_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_ledger FORCE  ROW LEVEL SECURITY;
CREATE POLICY point_ledger_self ON point_ledger
  AS RESTRICTIVE
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());
CREATE POLICY point_ledger_self_read ON point_ledger
  FOR SELECT USING (user_id = current_user_id());
CREATE POLICY point_ledger_self_write ON point_ledger
  FOR INSERT WITH CHECK (user_id = current_user_id());
-- Append-only, enforced by grant rather than by convention: a loyalty balance
-- that can be quietly rewritten is not auditable, and the ACL exposure above
-- depends on it being reconstructible.
REVOKE UPDATE, DELETE ON point_ledger FROM app_rw;

GRANT SELECT ON credit_packs, v_point_balance TO app_rw;
GRANT SELECT, INSERT, UPDATE ON credit_purchases TO app_rw;
GRANT SELECT, INSERT ON point_ledger TO app_rw;
