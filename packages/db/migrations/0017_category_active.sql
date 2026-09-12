-- ---------------------------------------------------------------------------
-- 0017 — a category can be switched off
--
-- A category that is no longer used cannot simply be deleted. It is referenced
-- by `document_lines.category_id` on every receipt it has ever categorised, and
-- those lines are part of a record the ATO requires to be kept for five years.
-- Deleting the row would either fail on the foreign key or, worse, orphan the
-- history behind a claim.
--
-- So it is retired instead: `active = false` stops it being OFFERED for new
-- documents, and changes nothing about the ones that already carry it. Last
-- year's fuel claim keeps saying "Fuel" whatever the user does to the list
-- today, which is the only behaviour that survives an audit.
-- ---------------------------------------------------------------------------

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN categories.active IS
  'False retires the category: it stops being offered for new documents and stays attached to every document that already uses it. Categories are never deleted — they are referenced by records with a five-year retention obligation.';

-- Listing categories always filters on this, and always within one tenant.
CREATE INDEX IF NOT EXISTS categories_tenant_active_idx
  ON categories (tenant_id, active, name);
