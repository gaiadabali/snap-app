-- 0026_tax_rules
-- The installed tax engine, and jurisdiction-scoped tax codes.
--
-- `tenants.country` has existed since 0002 and defaulted to 'AU', but NOTHING
-- HAS EVER READ IT. It was a stored fact with no behaviour attached, which is
-- why a second jurisdiction was invisible: an Australian constant and a
-- universal constant look identical when there is only one country.
--
-- This migration gives the column something to select. See
-- `docs/INDONESIA.md` §8 for the inventory of what is still hardcoded, and
-- `packages/tax-rules/README.md` for what a rule set is.

-- -----------------------------------------------------------------------------
-- 1. Which engine is installed for this workspace
-- -----------------------------------------------------------------------------

-- The rule set currently installed. NULL means no engine, and that is a REAL state
-- rather than a gap: `@snap/tax-rules` refuses every calculation when nothing
-- is installed, deliberately, because an Indonesian user silently receiving
-- Australian rules would get plausible numbers under the wrong law.
--
-- Nullable and with no default, for the same reason. A default of 'au-2026'
-- would reintroduce exactly the silent fallback the registry refuses to have.
ALTER TABLE tenants ADD COLUMN tax_rules_id text;

-- The version of that rule set, recorded when it was installed.
--
-- README principle 2: extraction is a versioned, replayable function. The same
-- argument applies to a tax figure — a number computed under `2026.1.0` must be
-- re-derivable under `2026.1.0` after the rates move. The interpreter stamps
-- this onto every result it returns; this column is what says which rule set the
-- workspace was actually running when it did.
ALTER TABLE tenants ADD COLUMN tax_rules_version text;

-- A rule set id without its version records half a fact. Either both or neither.
ALTER TABLE tenants ADD CONSTRAINT tenants_tax_rules_complete
  CHECK ((tax_rules_id IS NULL) = (tax_rules_version IS NULL));

COMMENT ON COLUMN tenants.tax_rules_id IS
  'Installed @snap/tax-rules rules, e.g. ''id-2026''. NULL means no engine is installed and every tax calculation refuses — there is deliberately no default, because a fallback to Australia would be invisible when wrong.';
COMMENT ON COLUMN tenants.tax_rules_version IS
  'Version of the installed rules, recorded so a stored figure can be re-derived under the law it was computed with.';

-- -----------------------------------------------------------------------------
-- 2. Tax codes belong to a jurisdiction
-- -----------------------------------------------------------------------------

-- Backfilled to 'AU' because every row that exists today is Australian: the
-- seven codes 0005 seeded carry BAS labels (G1, G10, G11, 1A, 1B).
ALTER TABLE tax_codes ADD COLUMN country country_code NOT NULL DEFAULT 'AU';

-- The old constraint was UNIQUE (tenant_id, code), and it did not do what it
-- reads as doing.
--
-- In Postgres, NULLs in a unique constraint are DISTINCT by default, so two
-- system rows (tenant_id IS NULL) carrying the same code were always permitted
-- — the constraint silently did not apply to precisely the rows it most needed
-- to protect. Nothing had noticed because 0005 inserted each code once.
--
-- Adding Indonesia surfaces it: 'N-T' (not reportable) exists in BOTH the
-- Australian and the Indonesian code sets, and under the old constraint the
-- duplicate would have been accepted and then matched ambiguously at read time.
--
-- NULLS NOT DISTINCT (PG 15+) makes the constraint mean what it says.
ALTER TABLE tax_codes DROP CONSTRAINT tax_codes_tenant_id_code_key;
ALTER TABLE tax_codes ADD CONSTRAINT tax_codes_tenant_country_code_key
  UNIQUE NULLS NOT DISTINCT (tenant_id, country, code);

COMMENT ON COLUMN tax_codes.country IS
  'The jurisdiction this code belongs to. A tenant only ever sees codes for its own country — an Australian BAS label on an Indonesian ledger is meaningless, and the reverse is worse because PPN is not recoverable by a personal taxpayer.';

-- -----------------------------------------------------------------------------
-- 3. Indonesian system tax codes
-- -----------------------------------------------------------------------------
--
-- These mirror `ID_2026.taxCodes` in `packages/tax-rules/src/rules/id-2026.ts`,
-- and the duplication is deliberate: the database must be self-contained and
-- RLS-readable without loading a TypeScript module.
--
-- Two copies of one fact is the shape this repository has been bitten by, so it
-- is a CHECKED duplication — `packages/db/test/tax_rules.test.ts` asserts these
-- rows against the rule set's declarations and fails if either side moves alone.
--
-- Every row is claims_credit = false. A personal Indonesian taxpayer is not a
-- PKP, so input PPN is not recoverable; PPN on a retail docket is not
-- recoverable even by a PKP. docs/INDONESIA.md §4.3. The labels are empty
-- because a personal taxpayer files no SPT Masa PPN — there is no return for
-- these to be labelled against.
INSERT INTO tax_codes (id, tenant_id, country, code, name, rate, purchase_labels, sale_labels, claims_credit) VALUES
  (gen_random_uuid(), NULL, 'ID', 'PPN',       'PPN dibayar (11%)',            11.0000, '{}', '{}', false),
  (gen_random_uuid(), NULL, 'ID', 'PPN-BEBAS', 'Dibebaskan dari PPN',           0.0000, '{}', '{}', false),
  (gen_random_uuid(), NULL, 'ID', 'PB1',       'PBJT / PB1 (pajak daerah)',    10.0000, '{}', '{}', false),
  (gen_random_uuid(), NULL, 'ID', 'NON-PPN',   'Tidak dikenakan PPN',           0.0000, '{}', '{}', false),
  (gen_random_uuid(), NULL, 'ID', 'N-T',       'Tidak dilaporkan',              0.0000, '{}', '{}', false);

-- -----------------------------------------------------------------------------
-- 4. A tenant may only use codes from its own jurisdiction
-- -----------------------------------------------------------------------------
--
-- Not enforceable as a foreign key, because the check spans two tables through
-- a column neither owns. A trigger is the honest mechanism: a split carrying an
-- Australian GST code on an Indonesian workspace would otherwise post cleanly
-- and produce a BAS line for a taxpayer who has never heard of a BAS.
CREATE OR REPLACE FUNCTION tax_code_matches_tenant_country()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_country char(2);
  v_code_country   char(2);
  v_code           text;
BEGIN
  IF NEW.tax_code_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.country INTO v_tenant_country FROM tenants t WHERE t.id = NEW.tenant_id;
  SELECT tc.country, tc.code INTO v_code_country, v_code
    FROM tax_codes tc WHERE tc.id = NEW.tax_code_id;

  IF v_tenant_country IS NULL OR v_code_country IS NULL THEN
    RETURN NEW;  -- referential integrity is the FK's job, not this trigger's
  END IF;

  IF v_tenant_country <> v_code_country THEN
    RAISE EXCEPTION
      'tax code % belongs to % but this workspace is in %',
      v_code, v_code_country, v_tenant_country
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transaction_splits_tax_code_country
  BEFORE INSERT OR UPDATE OF tax_code_id ON transaction_splits
  FOR EACH ROW EXECUTE FUNCTION tax_code_matches_tenant_country();
