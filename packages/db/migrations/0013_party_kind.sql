-- ---------------------------------------------------------------------------
-- 0013 — Parties have a kind, and are unique by name within it
--
-- Two gaps found while wiring the extraction worker, both of which the
-- application had already assumed were closed:
--
--   1. `parties` had no `kind`. The mobile app has listed customers and
--      suppliers separately since the invoicing screens were built, and the
--      distinction matters: a customer has receivables and appears on an
--      invoice; a supplier appears on a receipt and decides a GST credit. The
--      same legal entity can be both — a fuel company you buy from and also
--      cart for — so it is a column with a 'both' value, not two tables.
--
--   2. There was no unique constraint to deduplicate against. The worker
--      upserts a supplier on every extraction, and without a constraint the
--      "insert if absent" is a read-then-write that two concurrent workers
--      both win — producing two suppliers with the same name, one of which
--      silently collects half the spending.
--
-- `name_normalised` is the dedupe key rather than `legal_name`, because
-- "BP Truckstop", "BP TRUCKSTOP" and "Bp  Truckstop." are one supplier and a
-- vision model will return all three spellings across a year of dockets.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE party_kind AS ENUM ('customer', 'supplier', 'both');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS kind party_kind NOT NULL DEFAULT 'supplier';

COMMENT ON COLUMN parties.kind IS
  'customer: you invoice them. supplier: you buy from them. both: either, and '
  'the same entity can legitimately be both.';

-- Deduplication, enforced rather than attempted. A supplier and a customer may
-- share a name — they are different relationships with the same entity — so
-- the kind is part of the key.
CREATE UNIQUE INDEX IF NOT EXISTS parties_unique_name_per_kind
  ON parties (tenant_id, name_normalised, kind);

-- Finding a supplier by name is the worker's hot path: once per extraction.
CREATE INDEX IF NOT EXISTS parties_kind_idx ON parties (tenant_id, kind);
