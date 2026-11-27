-- ---------------------------------------------------------------------------
-- 0061 — Where each receipt was bought: the merchant's location on the RECEIPT
--
-- Plan task 9.5.i, a follow-up to 9.5.h (#114). 9.5.h stored the merchant
-- address the model read off the docket header on the SUPPLIER (`parties`
-- address_line1 / city / state / postcode). A supplier is deduplicated by
-- normalised name per workspace, so a chain (BP, Woolworths, ...) kept only the
-- address of the FIRST branch a person ever scanned, and every later receipt
-- from another branch silently reported the first one's suburb. The founder
-- approved (2026-11-27) storing the location on each receipt instead, so every
-- receipt records where it was actually bought.
--
-- Four nullable columns on `documents`, named for what they are (`merchant_*`,
-- not `supplier_*`: the supplier is the business, this is the place a sale
-- happened):
--
--   merchant_line1     street line as printed (≤ 80 characters)
--   merchant_city      suburb or town (≤ 40 characters)
--   merchant_state     one of the eight Australian state/territory codes
--   merchant_postcode  exactly four digits, in an Australian range
--
-- The CHECKs repeat the rules of the one normaliser that writes them
-- (apps/server/src/extraction/merchant-address.ts) so the database, not just
-- the application, refuses a value the normaliser would have dropped:
--   - state is NSW/VIC/QLD/WA/SA/TAS/ACT/NT or NULL;
--   - postcode is four digits and one of the ranges Australia Post issues
--     (0200-0299, 0800-0999, 1000-9999); 0000-0199 and 0300-0799 are not;
--   - a location is placeable: a state or a street line on its own, with no
--     suburb and no postcode, is not stored (merchant-address.ts drops it);
--   - length bounds equal to the normaliser's.
-- What the CHECKs deliberately do NOT do is cross-check state against postcode:
-- a few postcode ranges straddle a border (ACT/NSW, NT/SA/WA, NSW/QLD) and that
-- rule lives in one place, the normaliser, which drops a contradictory address
-- whole before it ever reaches a row.
--
-- RLS and grants: nothing to add, and that is the point. `documents` already has
-- its tenant policy (0010) and table-level grants (app_rw read/write,
-- app_readonly read, app_platform read via 0021), none of them column-scoped, so
-- the new columns inherit exactly the isolation of the row they sit on. The
-- migration's test proves a second workspace cannot read them.
--
-- FORWARD-ONLY and ADD-ONLY. No existing row is touched; existing receipts keep
-- NULL here until a re-extraction or the backfill script
-- (apps/server/scripts/backfill-merchant-address.ts) fills them. Nothing is
-- copied from `parties`: a chain supplier's address is the first branch's, which
-- is the very thing this migration exists to stop trusting.
-- ---------------------------------------------------------------------------

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS merchant_line1    text,
  ADD COLUMN IF NOT EXISTS merchant_city     text,
  ADD COLUMN IF NOT EXISTS merchant_state    text,
  ADD COLUMN IF NOT EXISTS merchant_postcode text;

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_merchant_state_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_merchant_state_check
  CHECK (merchant_state IS NULL
         OR merchant_state IN ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'));

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_merchant_postcode_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_merchant_postcode_check
  CHECK (merchant_postcode IS NULL
         OR merchant_postcode ~ '^(0[289][0-9]{2}|[1-9][0-9]{3})$');

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_merchant_length_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_merchant_length_check
  CHECK ((merchant_line1 IS NULL OR char_length(merchant_line1) BETWEEN 3 AND 80)
     AND (merchant_city  IS NULL OR char_length(merchant_city)  BETWEEN 2 AND 40));

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_merchant_placeable_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_merchant_placeable_check
  CHECK ((merchant_line1 IS NULL AND merchant_city IS NULL
          AND merchant_state IS NULL AND merchant_postcode IS NULL)
         OR merchant_city IS NOT NULL
         OR merchant_postcode IS NOT NULL);

COMMENT ON COLUMN documents.merchant_line1 IS
  'Street line of the merchant branch where this receipt was bought, as printed in the docket header (9.5.i). NULL if not read. Never a customer or delivery address.';
COMMENT ON COLUMN documents.merchant_city IS
  'Suburb or town of the merchant branch where this receipt was bought (9.5.i), title case. NULL if not read.';
COMMENT ON COLUMN documents.merchant_state IS
  'Australian state or territory code of the branch where this receipt was bought (9.5.i). NULL if not read.';
COMMENT ON COLUMN documents.merchant_postcode IS
  'Four-digit Australian postcode of the branch where this receipt was bought (9.5.i). NULL if not read.';

-- Anyone reading a merchant location for a receipt should read it from the
-- receipt. The supplier row is one address per business name per workspace.
COMMENT ON COLUMN parties.address_line1 IS
  'For a supplier: the address of the FIRST branch seen (9.5.h). A chain has one row for all its branches, so prefer documents.merchant_* for where a receipt was bought.';
COMMENT ON COLUMN parties.city IS
  'For a supplier: the suburb of the FIRST branch seen (9.5.h). Prefer documents.merchant_city for where a receipt was bought.';
COMMENT ON COLUMN parties.state IS
  'For a supplier: the state of the FIRST branch seen (9.5.h). Prefer documents.merchant_state for where a receipt was bought.';
COMMENT ON COLUMN parties.postcode IS
  'For a supplier: the postcode of the FIRST branch seen (9.5.h). Prefer documents.merchant_postcode for where a receipt was bought.';
