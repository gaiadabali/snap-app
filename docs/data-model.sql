-- =============================================================================
-- Snap Apps — annotated data model sketch
-- Target: PostgreSQL 17+ (uuidv7() is native in 18+; generate in Go otherwise)
-- Market: Australia. Semantic alignment: PINT A-NZ / EN 16931 business terms (BT-xx).
--
-- THIS IS A DESIGN SKETCH, NOT A MIGRATION. Phase 0 turns it into ordered,
-- reversible migrations. Reviewed shape first, then migrations.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid, digest
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy supplier-name matching
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email

-- -----------------------------------------------------------------------------
-- 1. Domains — money is NUMERIC, never float, and currency always sits beside it
-- -----------------------------------------------------------------------------
CREATE DOMAIN money_amount  AS NUMERIC(19,4);  -- totals, tax amounts, split amounts
CREATE DOMAIN unit_price    AS NUMERIC(19,6);  -- fuel at $1.899/L, produce per kg
CREATE DOMAIN quantity      AS NUMERIC(19,6);
CREATE DOMAIN tax_rate      AS NUMERIC(6,4);   -- 10.0000
CREATE DOMAIN currency_code AS CHAR(3)
  CONSTRAINT currency_code_iso4217 CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN confidence    AS NUMERIC(4,3)
  CONSTRAINT confidence_range CHECK (VALUE >= 0 AND VALUE <= 1);
CREATE DOMAIN country_code  AS CHAR(2)
  CONSTRAINT country_code_iso3166 CHECK (VALUE ~ '^[A-Z]{2}$');

-- -----------------------------------------------------------------------------
-- 2. Enums
-- -----------------------------------------------------------------------------
CREATE TYPE capture_status    AS ENUM ('received','processing','extracted','failed','quarantined');
CREATE TYPE doc_type          AS ENUM ('tax_invoice','invoice','receipt','credit_note','statement','unknown');
CREATE TYPE review_status     AS ENUM ('auto_accepted','needs_review','reviewed','rejected');
CREATE TYPE extraction_engine AS ENUM ('claude_vision','claude_text','ocr_llm','manual','import');
CREATE TYPE run_status        AS ENUM ('queued','running','succeeded','failed','superseded');
CREATE TYPE account_type      AS ENUM ('asset','liability','equity','income','expense');
CREATE TYPE txn_status        AS ENUM ('draft','posted','void');
CREATE TYPE txn_source        AS ENUM ('scan','manual','import','bank_feed','recurring');
CREATE TYPE gst_basis         AS ENUM ('cash','accrual');

-- -----------------------------------------------------------------------------
-- 3. Helper functions
-- -----------------------------------------------------------------------------

-- ABN checksum (ABR modulus-89). Subtract 1 from the first digit, apply weights,
-- sum, and the total must divide evenly by 89. IMMUTABLE so it can back a
-- generated column.
CREATE OR REPLACE FUNCTION abn_is_valid(p_abn text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  w int[] := ARRAY[10,1,3,5,7,9,11,13,15,17,19];
  d text;
  s int := 0;
  i int;
BEGIN
  IF p_abn IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(p_abn, '[^0-9]', '', 'g');
  IF length(d) <> 11 THEN RETURN false; END IF;
  s := (substr(d,1,1)::int - 1) * w[1];
  FOR i IN 2..11 LOOP
    s := s + substr(d,i,1)::int * w[i];
  END LOOP;
  RETURN s % 89 = 0;
END $$;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- -----------------------------------------------------------------------------
-- 4. Tenancy & identity
-- -----------------------------------------------------------------------------
CREATE TABLE tenants (
  id              uuid PRIMARY KEY,
  name            text NOT NULL,
  abn             char(11),
  abn_valid       boolean GENERATED ALWAYS AS (abn_is_valid(abn)) STORED,
  gst_registered  boolean NOT NULL DEFAULT false,
  gst_basis       gst_basis NOT NULL DEFAULT 'cash',
  simpler_bas     boolean NOT NULL DEFAULT true,   -- < $10M turnover: G1, 1A, 1B only
  country         country_code NOT NULL DEFAULT 'AU',
  base_currency   currency_code NOT NULL DEFAULT 'AUD',
  financial_year_start_month smallint NOT NULL DEFAULT 7,  -- AU FY starts July
  -- Drives profile-aware categorisation: which deduction labels this taxpayer can claim.
  -- Values are @snap/tax-engine profile ids: 'truckie_long', 'tradie', 'nurse', 'sole', ...
  occupation_profile_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE users (
  id          uuid PRIMARY KEY,
  subject     text NOT NULL UNIQUE,   -- external IdP subject; we never store passwords
  email       citext,
  display_name text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','admin','bookkeeper','member','readonly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE api_clients (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  key_prefix  text NOT NULL,          -- searchable, non-secret
  key_hash    bytea NOT NULL,         -- argon2id of the full key
  scopes      text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key_prefix)
);

-- -----------------------------------------------------------------------------
-- 5. Capture layer — IMMUTABLE. The original is the legal record.
--
-- The ATO accepts electronic copies only where they are a "true and clear
-- reproduction" of the original. original_storage_key is written once and never
-- modified; normalised_storage_key holds the derivative we send to the model.
-- -----------------------------------------------------------------------------
CREATE TABLE captures (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  uploaded_by            uuid REFERENCES users(id),

  original_storage_key   text NOT NULL,
  original_mime_type     text NOT NULL,
  original_byte_size     bigint NOT NULL CHECK (original_byte_size > 0),
  original_sha256        bytea NOT NULL,
  normalised_storage_key text,        -- derivative: deskewed, EXIF-stripped, <=1568px

  phash                  bigint,      -- perceptual hash for near-duplicate detection
  page_count             int NOT NULL DEFAULT 1,

  captured_at            timestamptz, -- device clock
  received_at            timestamptz NOT NULL DEFAULT now(),

  device_meta            jsonb NOT NULL DEFAULT '{}',
  legibility_score       confidence,  -- pre-flight quality gate result

  status                 capture_status NOT NULL DEFAULT 'received',
  retention_until        date,        -- mirrors the document; originals are undeletable before this

  -- Exact re-upload of the same bytes is idempotent, not an error.
  CONSTRAINT captures_sha_unique UNIQUE (tenant_id, original_sha256)
);
CREATE INDEX captures_tenant_received_idx ON captures (tenant_id, received_at DESC);
CREATE INDEX captures_phash_idx           ON captures (tenant_id, phash) WHERE phash IS NOT NULL;
CREATE INDEX captures_status_idx          ON captures (status) WHERE status <> 'extracted';

-- -----------------------------------------------------------------------------
-- 6. Extraction layer — versioned and replayable
-- -----------------------------------------------------------------------------
CREATE TABLE extraction_runs (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  capture_id     uuid NOT NULL REFERENCES captures(id) ON DELETE CASCADE,

  engine         extraction_engine NOT NULL,
  model_id       text,                -- e.g. 'claude-haiku-4-5'
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  tier           smallint NOT NULL DEFAULT 1,

  status         run_status NOT NULL DEFAULT 'queued',
  error          text,

  started_at     timestamptz,
  finished_at    timestamptz,
  latency_ms     int,

  -- Per-scan cost accounting. Without this you cannot answer "what does a scan cost".
  input_tokens   int,
  output_tokens  int,
  cached_tokens  int,
  cost_micros    bigint,

  raw_response   jsonb,               -- exact model output, for audit and replay
  validator_report jsonb,             -- which deterministic checks passed/failed

  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX extraction_runs_capture_idx ON extraction_runs (capture_id, created_at DESC);
CREATE INDEX extraction_runs_cost_idx    ON extraction_runs (tenant_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 7. Parties (supplier / buyer master)
-- -----------------------------------------------------------------------------
CREATE TABLE parties (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  legal_name       text NOT NULL,          -- BT-27 / BT-44
  trading_name     text,                   -- BT-28 / BT-45
  name_normalised  text NOT NULL,          -- lowercased, punctuation-stripped, for matching

  abn              char(11),
  abn_valid        boolean GENERATED ALWAYS AS (abn_is_valid(abn)) STORED,
  abn_verified_at  timestamptz,            -- set only after an ABR Lookup call
  abn_status       text,                   -- 'Active' / 'Cancelled' from ABR
  gst_registered   boolean,                -- from ABR; affects credit eligibility
  acn              char(9),

  address_line1    text,                   -- BG-5 / BG-8
  address_line2    text,
  city             text,
  state            text,
  postcode         text,
  country          country_code NOT NULL DEFAULT 'AU',

  email            text,
  phone            text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parties_abn_idx  ON parties (tenant_id, abn) WHERE abn IS NOT NULL;
CREATE INDEX parties_name_trgm ON parties USING gin (name_normalised gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 8. Document layer — curated, one current per capture, Peppol-shaped
-- -----------------------------------------------------------------------------
CREATE TABLE documents (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  capture_id            uuid NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  current_run_id        uuid REFERENCES extraction_runs(id),

  -- Internal classification vs Peppol code vs ATO validity: three different things.
  -- In AU a supermarket receipt often IS a tax invoice; Peppol has no "receipt".
  doc_type              doc_type NOT NULL DEFAULT 'unknown',
  document_type_code    text,          -- BT-3, UNCL1001 (380 invoice, 381 credit note); NULL when not Peppol-exportable
  is_tax_invoice        boolean NOT NULL DEFAULT false,  -- set by validators; GATES GST CREDIT CLAIMS
  ato_compliance        jsonb NOT NULL DEFAULT '{}',     -- which of the 7 required elements were found

  document_number       text,          -- BT-1
  issue_date            date,          -- BT-2
  due_date              date,          -- BT-9
  currency              currency_code NOT NULL DEFAULT 'AUD',  -- BT-5

  supplier_id           uuid REFERENCES parties(id),
  buyer_id              uuid REFERENCES parties(id),

  line_extension_amount money_amount,  -- BT-106  sum of line net amounts
  tax_exclusive_amount  money_amount,  -- BT-109
  tax_amount            money_amount,  -- BT-110  total GST
  tax_inclusive_amount  money_amount,  -- BT-112
  rounding_amount       money_amount NOT NULL DEFAULT 0,  -- BT-114; AU cash rounds to 5c
  payable_amount        money_amount,  -- BT-115

  payment_method        text,
  card_last4            char(4),       -- masked PAN only. Never store a full PAN (PCI scope).
  card_brand            text,

  review_status         review_status NOT NULL DEFAULT 'needs_review',
  confidence_overall    confidence,
  field_provenance      jsonb NOT NULL DEFAULT '{}',  -- {"supplier.abn": {"conf":0.98,"bbox":[...]}}

  dedup_group_id        uuid,          -- business-key fingerprint group; flag, never auto-merge
  retention_until       date,          -- issue_date + 5 years (ATO)

  -- Human review (see section 15). locked_fields holds the field paths a person has
  -- confirmed or edited; a later re-extraction MUST NOT overwrite them.
  locked_fields         text[] NOT NULL DEFAULT '{}',
  reviewed_by           uuid REFERENCES users(id),
  reviewed_at           timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT documents_capture_unique UNIQUE (capture_id)
);
CREATE INDEX documents_tenant_issue_idx ON documents (tenant_id, issue_date DESC);
CREATE INDEX documents_review_idx       ON documents (tenant_id, review_status) WHERE review_status = 'needs_review';
CREATE INDEX documents_supplier_idx     ON documents (tenant_id, supplier_id);
CREATE INDEX documents_dedup_idx        ON documents (tenant_id, dedup_group_id) WHERE dedup_group_id IS NOT NULL;
CREATE INDEX documents_provenance_idx   ON documents USING gin (field_provenance);
CREATE INDEX documents_retention_idx    ON documents (retention_until) WHERE deleted_at IS NULL;

CREATE TABLE document_lines (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  line_number      int NOT NULL,       -- BT-126
  description      text,               -- BT-153
  item_code        text,               -- BT-155 seller's item identifier
  quantity         quantity,           -- BT-129
  unit_code        text,               -- BT-130, UN/ECE Rec 20: EA, LTR, KGM, HUR
  unit_price       unit_price,         -- BT-146
  line_net_amount  money_amount,       -- BT-131
  discount_amount  money_amount NOT NULL DEFAULT 0,

  gst_category_code text,              -- BT-151, UNCL5305: S standard, Z GST-free, E exempt, O out of scope
  gst_rate         tax_rate,           -- BT-152
  gst_amount       money_amount,

  category_id      uuid,               -- set by user/rules, FK added below
  line_confidence  confidence,

  UNIQUE (document_id, line_number)
);
CREATE INDEX document_lines_document_idx ON document_lines (document_id);

-- Peppol BG-23. A TABLE, not a column: a grocery receipt legitimately mixes
-- GST-free fresh food with taxable packaged goods, and one total cannot say that.
CREATE TABLE document_tax_subtotals (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  category_code   text NOT NULL,       -- BT-118
  rate            tax_rate NOT NULL,   -- BT-119
  taxable_amount  money_amount NOT NULL,  -- BT-116
  tax_amount      money_amount NOT NULL,  -- BT-117
  UNIQUE (document_id, category_code, rate)
);

-- Sparse: only records human edits, so the review queue is queryable without EAV sprawl.
CREATE TABLE document_field_corrections (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_path    text NOT NULL,        -- 'supplier.abn', 'lines[3].unit_price'
  old_value     text,
  new_value     text,
  from_run_id   uuid REFERENCES extraction_runs(id),
  corrected_by  uuid REFERENCES users(id),
  corrected_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dfc_document_idx ON document_field_corrections (document_id);
-- Every correction is training signal. Mine this table before touching the prompt.
CREATE INDEX dfc_field_idx    ON document_field_corrections (tenant_id, field_path);

-- -----------------------------------------------------------------------------
-- 9. Chart of accounts, categories, tax codes
-- -----------------------------------------------------------------------------
CREATE TABLE accounts (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          text NOT NULL,         -- '6-1200'
  name          text NOT NULL,
  account_type  account_type NOT NULL,
  parent_id     uuid REFERENCES accounts(id),
  is_capital    boolean NOT NULL DEFAULT false,  -- capital assets drive BAS G10 vs G11
  external_refs jsonb NOT NULL DEFAULT '{}',     -- {"xero":"...","myob":"..."}
  is_archived   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE categories (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                text NOT NULL,
  parent_id           uuid REFERENCES categories(id),
  default_account_id  uuid REFERENCES accounts(id),
  default_tax_code_id uuid,                       -- FK added after tax_codes
  -- @snap/tax-engine target, not free text: 'D1.logbook.fuel', 'D3.laundry', 'D2.meals.dinner'.
  -- This is what lets a scan land in the exact worksheet row the engine expects.
  engine_row_id       text,
  ato_deduction_code  text,                       -- D1-D14 label
  UNIQUE (tenant_id, name)
);
ALTER TABLE document_lines
  ADD CONSTRAINT document_lines_category_fk
  FOREIGN KEY (category_id) REFERENCES categories(id);

-- Industry-standard tax codes, mirroring Xero/MYOB. Each declares its BAS labels,
-- which turns BAS reporting into a GROUP BY and export into a lookup.
CREATE TABLE tax_codes (
  id              uuid PRIMARY KEY,
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = system-seeded
  code            text NOT NULL,
  name            text NOT NULL,
  rate            tax_rate NOT NULL,
  purchase_labels text[] NOT NULL DEFAULT '{}',   -- e.g. {G11,1B}
  sale_labels     text[] NOT NULL DEFAULT '{}',   -- e.g. {G1,1A}
  claims_credit   boolean NOT NULL DEFAULT false, -- true => needs a valid tax invoice to claim
  external_refs   jsonb NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, code)
);
ALTER TABLE categories
  ADD CONSTRAINT categories_tax_code_fk
  FOREIGN KEY (default_tax_code_id) REFERENCES tax_codes(id);

INSERT INTO tax_codes (id, tenant_id, code, name, rate, purchase_labels, sale_labels, claims_credit) VALUES
  (gen_random_uuid(), NULL, 'GST',         'GST on non-capital purchases', 10.0000, '{G11,1B}', '{}',      true),
  (gen_random_uuid(), NULL, 'CAP',         'GST on capital purchases',     10.0000, '{G10,1B}', '{}',      true),
  (gen_random_uuid(), NULL, 'GSTONINCOME', 'GST on sales',                 10.0000, '{}',       '{G1,1A}', false),
  (gen_random_uuid(), NULL, 'FRE',         'GST-free',                      0.0000, '{G11}',    '{G1}',    false),
  (gen_random_uuid(), NULL, 'INP',         'Input-taxed',                   0.0000, '{G11}',    '{G1}',    false),
  (gen_random_uuid(), NULL, 'EXP',         'Export sale',                   0.0000, '{}',       '{G1}',    false),
  (gen_random_uuid(), NULL, 'N-T',         'Not reportable',                0.0000, '{}',       '{}',      false);

-- -----------------------------------------------------------------------------
-- 10. The ledger — double-entry, provably balanced
--
-- Sign convention: DEBITS POSITIVE, CREDITS NEGATIVE.
-- Assets and expenses increase positive; liabilities, equity and income
-- increase negative. Splits of a posted transaction must sum to exactly zero.
-- -----------------------------------------------------------------------------
CREATE TABLE transactions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  txn_date       date NOT NULL,
  settled_date   date,                 -- cash-basis GST filters on this
  payee_id       uuid REFERENCES parties(id),
  memo           text,
  reference      text,
  currency       currency_code NOT NULL DEFAULT 'AUD',

  status         txn_status NOT NULL DEFAULT 'draft',
  source         txn_source NOT NULL DEFAULT 'manual',
  document_id    uuid REFERENCES documents(id),   -- evidence; kept for the record's life

  posted_at      timestamptz,
  posted_by      uuid REFERENCES users(id),
  voided_at      timestamptz,
  void_reason    text,

  external_refs  jsonb NOT NULL DEFAULT '{}',     -- {"xero":{"id":"...","synced_at":"..."}}

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT txn_posted_has_timestamp CHECK (status <> 'posted' OR posted_at IS NOT NULL)
);
CREATE INDEX transactions_tenant_date_idx ON transactions (tenant_id, txn_date DESC);
CREATE INDEX transactions_document_idx    ON transactions (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX transactions_status_idx      ON transactions (tenant_id, status);

CREATE TABLE transaction_splits (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  line_number    int NOT NULL,

  account_id     uuid NOT NULL REFERENCES accounts(id),
  amount         money_amount NOT NULL,     -- signed; debit +, credit -

  -- tax_code_id NOT NULL  => this is a BAS-reportable line and gst_amount is its GST.
  -- tax_code_id IS NULL   => this is the GST control-account posting (or a transfer leg);
  --                          excluded from BAS aggregation so GST is never double-counted.
  tax_code_id    uuid REFERENCES tax_codes(id),
  gst_amount     money_amount NOT NULL DEFAULT 0,

  category_id    uuid REFERENCES categories(id),
  document_line_id uuid REFERENCES document_lines(id),
  description    text,

  UNIQUE (transaction_id, line_number),
  CONSTRAINT split_gst_needs_tax_code CHECK (gst_amount = 0 OR tax_code_id IS NOT NULL)
);
CREATE INDEX splits_txn_idx     ON transaction_splits (transaction_id);
CREATE INDEX splits_account_idx ON transaction_splits (tenant_id, account_id);
CREATE INDEX splits_taxcode_idx ON transaction_splits (tenant_id, tax_code_id) WHERE tax_code_id IS NOT NULL;

-- The invariant, enforced by the database rather than by application discipline.
-- DEFERRABLE INITIALLY DEFERRED => checked once at COMMIT, so a client can insert
-- the header and all splits in any order. Drafts and voids are exempt, which is
-- what lets half-built entries be edited and deleted freely.
CREATE OR REPLACE FUNCTION assert_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_txn    uuid;
  v_status txn_status;
  v_sum    money_amount;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    v_txn := COALESCE(NEW.id, OLD.id);
  ELSE
    v_txn := COALESCE(NEW.transaction_id, OLD.transaction_id);
  END IF;

  SELECT status INTO v_status FROM transactions WHERE id = v_txn;
  IF v_status IS DISTINCT FROM 'posted' THEN
    RETURN NULL;                       -- drafts and voids need not balance
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_sum
  FROM transaction_splits WHERE transaction_id = v_txn;

  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'transaction % is not balanced: splits sum to %', v_txn, v_sum
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_splits_balanced
  AFTER INSERT OR UPDATE OR DELETE ON transaction_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();

CREATE CONSTRAINT TRIGGER trg_txn_balanced_on_post
  AFTER INSERT OR UPDATE OF status ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();

-- -----------------------------------------------------------------------------
-- 11. BAS reporting
--
-- G1  total sales incl GST         1A GST on sales
-- G10 capital purchases incl GST   1B GST on purchases (credit-claimable only)
-- G11 non-capital purchases incl GST
--
-- Simpler BAS (turnover < $10M) reports only G1, 1A, 1B.
-- 1A ~= G1/11 and 1B ~= (G10+G11)/11 are shipped as sanity checks on the report.
--
-- THE CRITICAL RULE: a GST input credit may only be claimed where a valid tax
-- invoice is held. So a credit-claiming split contributes to 1B only when its
-- evidence document has is_tax_invoice = true. Everything else becomes the
-- "unclaimable GST" figure the app surfaces to the user.
-- -----------------------------------------------------------------------------
CREATE VIEW v_bas_lines AS
SELECT
  t.tenant_id,
  t.id                                   AS transaction_id,
  COALESCE(t.settled_date, t.txn_date)   AS cash_date,
  t.txn_date                             AS accrual_date,
  s.id                                   AS split_id,
  tc.code                                AS tax_code,
  tc.purchase_labels,
  tc.sale_labels,
  tc.claims_credit,
  abs(s.amount)                          AS net_amount,
  s.gst_amount,
  abs(s.amount) + s.gst_amount           AS gross_amount,
  COALESCE(d.is_tax_invoice, false)      AS has_valid_tax_invoice,
  (tc.claims_credit AND NOT COALESCE(d.is_tax_invoice, false)) AS gst_unclaimable
FROM transaction_splits s
JOIN transactions t  ON t.id = s.transaction_id
JOIN tax_codes    tc ON tc.id = s.tax_code_id      -- NULL tax_code => not reportable
LEFT JOIN documents d ON d.id = t.document_id
WHERE t.status = 'posted';

-- -----------------------------------------------------------------------------
-- 12. Operations: review queue, audit, jobs, idempotency, webhooks
-- -----------------------------------------------------------------------------
CREATE TABLE review_tasks (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES transactions(id) ON DELETE CASCADE,
  reason      text NOT NULL,          -- 'gst_arithmetic_failed', 'abn_invalid', 'possible_duplicate'
  detail      jsonb NOT NULL DEFAULT '{}',
  priority    smallint NOT NULL DEFAULT 5,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_open_idx ON review_tasks (tenant_id, priority) WHERE resolved_at IS NULL;

-- Append-only. INSERT granted; UPDATE and DELETE granted to nobody.
-- This is what makes scoping a notifiable breach possible at all.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid,
  actor_type  text NOT NULL,          -- 'user','api_client','system'
  actor_id    uuid,
  action      text NOT NULL,          -- 'document.corrected','transaction.posted','export.xero'
  entity_type text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  request_id  text,
  ip          inet,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_at_idx ON audit_log (tenant_id, at DESC);
CREATE INDEX audit_entity_idx    ON audit_log (entity_type, entity_id);

CREATE TABLE jobs (
  id           uuid PRIMARY KEY,
  tenant_id    uuid REFERENCES tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL,         -- 'extract','xero_push','purge','export_pack'
  payload      jsonb NOT NULL DEFAULT '{}',
  run_after    timestamptz NOT NULL DEFAULT now(),
  attempts     int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- Worker: SELECT ... WHERE completed_at IS NULL AND run_after <= now()
--         ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT n
CREATE INDEX jobs_ready_idx ON jobs (kind, run_after) WHERE completed_at IS NULL;

CREATE TABLE idempotency_keys (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key           text NOT NULL,
  request_hash  bytea NOT NULL,
  response_code int,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE webhook_endpoints (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url         text NOT NULL,
  secret      bytea NOT NULL,        -- HMAC signing key, encrypted at rest
  events      text[] NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id           uuid PRIMARY KEY,
  endpoint_id  uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event        text NOT NULL,
  payload      jsonb NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  status_code  int,
  delivered_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- External accounting connections. Xero limits: 60 calls/min, 5,000/day,
-- 5 concurrent per second, PER TENANT TOKEN. Push must go through a queue.
CREATE TABLE accounting_connections (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('xero','myob','quickbooks')),
  external_tenant_id text NOT NULL,
  access_token      bytea NOT NULL,   -- AEAD ciphertext, KMS-wrapped DEK
  refresh_token     bytea NOT NULL,
  expires_at        timestamptz,
  scopes            text[] NOT NULL DEFAULT '{}',
  connected_by      uuid REFERENCES users(id),
  revoked_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_tenant_id)
);

-- -----------------------------------------------------------------------------
-- 13. Row-level security
--
-- Applied to every tenant-scoped table. FORCE so the table owner is not exempt.
-- The API does `SET LOCAL app.tenant_id = $1` per transaction and runs as app_rw.
-- No request path ever uses a BYPASSRLS role.
-- -----------------------------------------------------------------------------
-- Run for each of: captures, extraction_runs, parties, documents, document_lines,
-- document_tax_subtotals, document_field_corrections, accounts, categories,
-- transactions, transaction_splits, review_tasks, jobs, idempotency_keys,
-- webhook_endpoints, accounting_connections, memberships, api_clients
--
--   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE <t> FORCE  ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON <t>
--     USING (tenant_id = current_tenant_id())
--     WITH CHECK (tenant_id = current_tenant_id());
--
-- tax_codes needs a variant allowing system rows to be read by everyone:
--   CREATE POLICY tax_codes_read ON tax_codes
--     USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
--
-- audit_log is append-only:
--   REVOKE UPDATE, DELETE ON audit_log FROM app_rw;
--   CREATE POLICY audit_insert ON audit_log FOR INSERT
--     WITH CHECK (tenant_id = current_tenant_id());
--   CREATE POLICY audit_read   ON audit_log FOR SELECT
--     USING (tenant_id = current_tenant_id());

-- Roles
--   CREATE ROLE app_rw       LOGIN;  -- every request; RLS enforced
--   CREATE ROLE app_migrate  LOGIN;  -- DDL only
--   CREATE ROLE app_readonly LOGIN;  -- analytics; RLS enforced

-- -----------------------------------------------------------------------------
-- 14. Plans, subscriptions & usage metering
--
-- AI cost scales with SCANS, not users, so scans are what gets metered. Quota is
-- tenant-level with seats as a separate limit (the shape Dext uses: 250 docs / 5 users).
--
-- Two rules encoded here:
--   * Soft cap, not a wall. At quota, offer a top-up (usage_grants) rather than
--     refusing the scan.
--   * NEVER drop a capture. If quota is gone and the user declines a top-up, the
--     image is still stored and extraction runs later. Losing a receipt is
--     unforgivable in a product whose promise is not losing receipts.
-- -----------------------------------------------------------------------------
CREATE TYPE sub_status       AS ENUM ('trialing','active','past_due','canceled','paused');
CREATE TYPE billing_provider AS ENUM ('stripe','apple','google','manual');

CREATE TABLE plans (
  id               uuid PRIMARY KEY,
  code             text NOT NULL UNIQUE,           -- 'free','sorted','pro'
  name             text NOT NULL,
  price_cents      int NOT NULL,                   -- AUD, GST-INCLUSIVE (consumer convention)
  currency         currency_code NOT NULL DEFAULT 'AUD',
  scan_quota       int,                            -- per billing period; NULL = unmetered
  seat_limit       int NOT NULL DEFAULT 1,
  realtime         boolean NOT NULL DEFAULT true,  -- false => batch tier: slower, never less accurate
  retention_months int NOT NULL DEFAULT 60,        -- ATO minimum is 5 years = 60
  features         jsonb NOT NULL DEFAULT '{}',
  is_active        boolean NOT NULL DEFAULT true,
  CONSTRAINT plans_price_nonneg CHECK (price_cents >= 0)
);

INSERT INTO plans (id, code, name, price_cents, scan_quota, seat_limit, realtime, retention_months, features) VALUES
  (gen_random_uuid(),'free',  'Free',     0,  20,  1, false, 12,
     '{"xero":false,"api":false,"tax_pack":false,"ledger":"read_only"}'),
  (gen_random_uuid(),'sorted','Sorted', 999, 150,  3, true,  60,
     '{"xero":true,"api":false,"tax_pack":true,"ledger":"full"}'),
  (gen_random_uuid(),'pro',   'Pro',   2499, 600, 10, true,  84,
     '{"xero":true,"myob":true,"quickbooks":true,"api":true,"tax_pack":true,"ledger":"full","multi_entity":true}');

CREATE TABLE subscriptions (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id              uuid NOT NULL REFERENCES plans(id),
  status               sub_status NOT NULL DEFAULT 'trialing',
  provider             billing_provider NOT NULL,
  external_id          text,  -- Stripe sub id / Apple original_transaction_id / Play purchaseToken
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancel_at            timestamptz,
  canceled_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sub_period_ordered CHECK (current_period_end > current_period_start)
);
-- At most one live subscription per tenant.
CREATE UNIQUE INDEX subscriptions_one_live_idx ON subscriptions (tenant_id)
  WHERE status IN ('trialing','active','past_due');
CREATE UNIQUE INDEX subscriptions_external_idx ON subscriptions (provider, external_id)
  WHERE external_id IS NOT NULL;

-- Fast pre-flight counter. extraction_runs stays the source of truth, so this is
-- always rebuildable from it and never authoritative on its own.
CREATE TABLE usage_counters (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  metric       text NOT NULL,                      -- 'scans'
  used         int  NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period_start, metric),
  CONSTRAINT usage_used_nonneg CHECK (used >= 0)
);

-- Top-up packs and goodwill credits. Consumed only after the plan quota.
CREATE TABLE usage_grants (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric     text NOT NULL DEFAULT 'scans',
  amount     int  NOT NULL CHECK (amount > 0),
  remaining  int  NOT NULL CHECK (remaining >= 0),
  source     text NOT NULL,                        -- 'topup_pack','referral','support_credit'
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT grant_remaining_le_amount CHECK (remaining <= amount)
);
CREATE INDEX usage_grants_live_idx ON usage_grants (tenant_id, metric) WHERE remaining > 0;

-- The single place the API asks: may this tenant scan right now, and how fast?
CREATE VIEW v_tenant_entitlement AS
SELECT
  t.id                   AS tenant_id,
  p.code                 AS plan_code,
  s.status               AS sub_status,
  p.realtime,
  p.seat_limit,
  (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id) AS seats_used,
  p.scan_quota,
  COALESCE(uc.used, 0)   AS scans_used,
  COALESCE(g.granted, 0) AS topup_remaining,
  CASE WHEN p.scan_quota IS NULL THEN NULL
       ELSE p.scan_quota + COALESCE(g.granted,0) - COALESCE(uc.used,0)
  END                    AS scans_remaining,
  p.retention_months,
  p.features
FROM tenants t
LEFT JOIN subscriptions s
       ON s.tenant_id = t.id AND s.status IN ('trialing','active','past_due')
LEFT JOIN plans p
       ON p.id = COALESCE(s.plan_id, (SELECT id FROM plans WHERE code = 'free'))
LEFT JOIN usage_counters uc
       ON uc.tenant_id = t.id
      AND uc.metric = 'scans'
      AND uc.period_start = date_trunc('month', now())::date
LEFT JOIN (
  SELECT tenant_id, sum(remaining) AS granted
  FROM usage_grants
  WHERE metric = 'scans' AND remaining > 0
    AND (expires_at IS NULL OR expires_at > now())
  GROUP BY tenant_id
) g ON g.tenant_id = t.id
WHERE t.deleted_at IS NULL;

-- Cost guardrail. Catches both abuse and a runaway escalation loop by comparing a
-- tenant's real inference spend this period against what they actually pay.
CREATE VIEW v_tenant_cost_vs_price AS
SELECT
  e.tenant_id,
  date_trunc('month', e.created_at)::date AS period_start,
  count(*)                                AS runs,
  sum(e.cost_micros) / 1000000.0          AS cost_aud,
  max(p.price_cents) / 100.0              AS plan_price_aud,
  CASE WHEN max(p.price_cents) > 0
       THEN (sum(e.cost_micros) / 10000.0) / max(p.price_cents)
  END                                     AS cost_ratio
FROM extraction_runs e
JOIN tenants t ON t.id = e.tenant_id
LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status IN ('trialing','active','past_due')
LEFT JOIN plans p ON p.id = COALESCE(s.plan_id, (SELECT id FROM plans WHERE code='free'))
WHERE e.status = 'succeeded'
GROUP BY e.tenant_id, date_trunc('month', e.created_at);

-- RLS: subscriptions, usage_counters and usage_grants are tenant-scoped (same policy
-- as section 13). plans is a public read, like tax_codes.

-- -----------------------------------------------------------------------------
-- 15. Human review: edit, confirm, save
--
-- The reviewer is part of the data model, not a UI afterthought. Three guarantees:
--
--   1. WHAT THE MODEL SAID IS NEVER LOST. extraction_runs.raw_response keeps the
--      exact model output; document_field_corrections records every human edit as
--      (field_path, old_value, new_value, corrected_by, corrected_at).
--
--   2. A HUMAN EDIT OUTRANKS ANY LATER MACHINE RUN. Re-extraction (a better model,
--      a new prompt) flips documents.current_run_id — and would otherwise silently
--      overwrite a field a person had already fixed. documents.locked_fields holds
--      the field paths a human has confirmed or edited; the merge step on
--      re-extraction MUST skip them and raise a review_task where the new run
--      disagrees, instead of clobbering.
--
--   3. CONFIRMATION IS THE DRAFT -> POSTED TRANSITION. Editing a document changes
--      data; confirming it posts a balanced transaction to the ledger. They are
--      separate acts, separately audited, and only the second one moves the books.
-- -----------------------------------------------------------------------------

-- Enforce guarantee 2 in the database rather than trusting the merge code:
-- once a field is locked, a machine run cannot quietly unlock it. Only a human
-- action (review_status -> 'reviewed'/'rejected') may change locked_fields.
CREATE OR REPLACE FUNCTION assert_locked_fields_respected() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  removed text[];
BEGIN
  SELECT array_agg(f) INTO removed
  FROM unnest(OLD.locked_fields) AS f
  WHERE f <> ALL (COALESCE(NEW.locked_fields, '{}'));

  IF removed IS NOT NULL AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at THEN
    RAISE EXCEPTION
      'locked fields % cannot be released by a machine run on document %; a human review must release them',
      removed, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_documents_locked_fields
  BEFORE UPDATE OF locked_fields ON documents
  FOR EACH ROW EXECUTE FUNCTION assert_locked_fields_respected();

-- =============================================================================
-- Phase 0 open items before this becomes migrations:
--   1. Confirm PG version => uuidv7() native, or generate UUIDv7 in Go.
--   2. citext extension for users.email (used above).
--   3. Decide materialised account_balances vs on-the-fly SUM (start on-the-fly).
--   4. PowerSync sync rules must reuse the same tenant_id predicate as RLS —
--      it is a second authorisation surface and the one most likely to leak.
--   5. Partition captures / extraction_runs by month if volume warrants.
-- =============================================================================
