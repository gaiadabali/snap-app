-- ---------------------------------------------------------------------------
-- 0042 — Deduction categories (group plan 4.2)
--
-- A receipt can now sit in a category, and a category can say which ATO label
-- and which Free Tax Returns item it feeds, so a personal workspace's receipts
-- can later be exported as a deduction bundle (api-contract deduction-bundle v1).
--
--   categories.private_use_percent   default private share of a receipt in it
--   documents.category_id            the receipt's category (whole receipt)
--   documents.category_source        'user' (a person chose it) or 'supplier'
--                                    (copied from an earlier receipt from the
--                                    same supplier)
--
-- A category's mapping is the pair ato_deduction_code (label) + engine_row_id
-- (FTR item id). The server validates the pair against the bundle spec's
-- ITEM_IDS; the database only holds the part it can know: an item id means
-- nothing without a label.
--
-- WHY NOT "BOTH NULL OR BOTH SET": existing BUSINESS categories (0005 seeds,
-- settings.repo.ts) carry a label and no item, and they are deliberately left
-- alone. A both-or-neither CHECK would reject every later UPDATE of those rows,
-- including retiring one. The server writes the pair together for personal
-- categories and for any label set from now on.
--
-- The backfill seeds the work and rental categories into every existing
-- personal workspace. The list is mirrored by PERSONAL_DEDUCTION_CATEGORIES in
-- apps/server/src/settings/deduction-categories.ts; a test runs the statement
-- between the markers below and compares it with that constant.
-- ---------------------------------------------------------------------------

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS private_use_percent smallint;

ALTER TABLE categories
  DROP CONSTRAINT IF EXISTS categories_private_use_percent_range;
ALTER TABLE categories
  ADD CONSTRAINT categories_private_use_percent_range
  CHECK (private_use_percent IS NULL OR private_use_percent BETWEEN 0 AND 99);

ALTER TABLE categories
  DROP CONSTRAINT IF EXISTS categories_engine_row_needs_label;
ALTER TABLE categories
  ADD CONSTRAINT categories_engine_row_needs_label
  CHECK (engine_row_id IS NULL OR ato_deduction_code IS NOT NULL);

COMMENT ON COLUMN categories.private_use_percent IS
  'Default private share (whole percent, 0-99) for receipts in this category. NULL means none.';
COMMENT ON COLUMN categories.engine_row_id IS
  'Free Tax Returns item id (deduction bundle ITEM_IDS[ato_deduction_code]). Written with the label by the server.';

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id),
  ADD COLUMN IF NOT EXISTS category_source text;

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_category_source_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_category_source_check
  CHECK (category_source IS NULL OR category_source IN ('user', 'supplier'));

COMMENT ON COLUMN documents.category_id IS
  'The whole receipt category. Per-line categories (document_lines.category_id) win where set.';
COMMENT ON COLUMN documents.category_source IS
  'user: a person chose it (never overwritten by a machine). supplier: copied from the last receipt from the same supplier.';

CREATE INDEX IF NOT EXISTS documents_tenant_category_idx
  ON documents (tenant_id, category_id);

-- backfill:start
INSERT INTO categories (id, tenant_id, name, ato_deduction_code, engine_row_id, active)
SELECT gen_random_uuid(), t.id, v.name, v.label, v.item, v.active
  FROM tenants t
 CROSS JOIN (VALUES
  ('Work car: fuel', 'D1', 'fuelReceiptTotal', true),
  ('Work car: servicing', 'D1', 'serviceCost1', true),
  ('Work car: registration', 'D1', 'rego', true),
  ('Work travel', 'D2', 'otherTravel', true),
  ('Work parking and tolls', 'D2', 'tollsTotal', true),
  ('Work clothing and uniforms', 'D3', 'uniforms', true),
  ('Work laundry and dry cleaning', 'D3', 'laundromat', true),
  ('Study for work', 'D4', 'fees', true),
  ('Work tools and equipment', 'D5', 'tools', true),
  ('Work phone and internet', 'D5', 'phoneDevices', true),
  ('Work software and subscriptions', 'D5', 'software', true),
  ('Union and professional fees', 'D5', 'union', true),
  ('Home office equipment (under $300 each)', 'D5', 'homeoffice', true),
  ('Donations', 'D9', 'd9', true),
  ('Tax help and tax agent', 'D10', 'lastReturnFee', true),
  ('Income protection insurance', 'D12', 'd12', true),
  ('Rental: repairs and maintenance', 'RENTAL', 'repairs', false),
  ('Rental: council rates and water', 'RENTAL', 'councilRates', false),
  ('Rental: landlord insurance', 'RENTAL', 'landlordInsurance', false),
  ('Rental: agent fees', 'RENTAL', 'mgmtFees', false),
  ('Rental: loan interest', 'RENTAL', 'loanInterest', false)
 ) AS v(name, label, item, active)
 WHERE t.kind = 'personal'
ON CONFLICT (tenant_id, name) DO NOTHING;
-- backfill:end

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'documents' AND column_name = 'category_id'
  ) THEN
    RAISE EXCEPTION 'documents.category_id is missing';
  END IF;
END $$;
