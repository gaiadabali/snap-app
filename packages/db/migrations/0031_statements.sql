-- ---------------------------------------------------------------------------
-- 0031 — Statements: financial_accounts, statements, statement_lines
--
-- docs/STATEMENTS.md §12 Lane T, ticket T3. The foundation the rest of Lane T
-- (T4 balance check, T5 CSV intake) and Lane R (reconciliation) sit on.
--
-- THE FRAMING THIS HONOURS (§0): "A receipt and a statement line are not two
-- records. They are two observations of one economic event, and each knows
-- something the other does not." `statement_lines` is therefore built to
-- stand as an observation in its own right — a stable id, an immutable
-- `description_raw`, its own signed amount — not as a staging table whose
-- rows get deleted once matched. Lane R's `event_observations` (§5.3, ticket
-- R5) is what will later point AT a statement_line; it is NOT built here.
-- Never merge, never auto-delete, never pick a winner — the same discipline
-- `documents.dedup_group_id`'s own comment states.
--
-- TWO COLUMNS THIS CONNECTS TO WITHOUT WIRING (§2, both currently written by
-- nothing):
--
--  * `documents.dedup_group_id` — a `statements` row is document_id-backed
--    (below), so a statement PDF re-uploaded twice becomes two `documents`
--    rows already flagged into the same dedup group by whatever writes that
--    column (still nobody, per §2) and, downstream, two `statements` rows an
--    operator can see are duplicates. This migration adds no logic for it —
--    that stays "flag, never auto-merge", per the existing comment — but does
--    not create a second, statement-shaped path around it either: a
--    statement's own duplicate detection is the SAME column, not a new one.
--
--  * `transactions.settled_date` — "cash-basis GST filters on this", and per
--    §5.3's merge rule it is the statement line's `posted_date` that will fill
--    it, once R5 builds the write path. `statement_lines.posted_date` is
--    therefore named to be that value directly, with no transformation
--    required when Lane R reads it.
--
-- JURISDICTION (D-S1, both AU and ID from the first commit): no column here
-- assumes a currency, a date order, or a posting-lag window. `currency` is
-- required with no default (tenants.currency defaults 'AUD' elsewhere in this
-- schema; that default is NOT repeated here on purpose). Posting-lag and bank
-- -interest treatment live in `packages/tax-rules/src/contract.ts`'s
-- `StatementRules` and are read by the matching/categorisation code that
-- consumes these tables (Lane R), not encoded as a constraint in SQL.
--
-- MONEY: `money_amount` (NUMERIC(19,4), domain from 0001) throughout — the
-- one convention this schema uses, not a second one for statements.
-- ---------------------------------------------------------------------------

-- ── Enums ────────────────────────────────────────────────────────────────

-- What kind of account this is. Drives which fields a statement for it can
-- plausibly carry (a credit_card statement's "opening_balance" is a debt, not
-- cash) — that interpretation is Lane R/T4's job, not a CHECK here.
DO $$ BEGIN
  CREATE TYPE financial_account_type AS ENUM ('transaction', 'savings', 'credit_card', 'ewallet');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The balance-check verdict (§4, ticket T4). T3 only declares the shape T4
-- writes into: nothing computes this column yet, so every row lands 'pending'
-- until T4 ships the validator. T5 (CSV intake) is the one path documented to
-- write 'unverifiable' — a CSV with no opening/closing balance must NEVER
-- claim 'pass', and that is a T5 test, not a constraint added here.
DO $$ BEGIN
  CREATE TYPE statement_balance_check AS ENUM ('pending', 'pass', 'residual', 'unverifiable');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── financial_accounts: the account a statement belongs to ────────────────

CREATE TABLE IF NOT EXISTS financial_accounts (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- The chart-of-accounts row this financial account IS (§5.1) — what makes
  -- the double-entry side work without a second ledger. One ledger account
  -- models at most one real-world financial account.
  account_id     uuid NOT NULL REFERENCES accounts(id),

  institution    text NOT NULL,          -- 'Commonwealth Bank', 'BCA', ...
  display_name   text,                   -- optional user-given nickname

  -- Masked only — the SAME discipline as documents.card_last4: never a full
  -- account number, never a reconstructable hash. This is a PAN/account-number
  -- argument, not a UX one.
  account_last4  char(4),
  account_type   financial_account_type NOT NULL,
  currency       currency_code NOT NULL,

  -- Closed, not deleted: statements and lines already read must survive an
  -- account being retired. Same shape as accounts.is_archived, categories.active.
  is_archived    boolean NOT NULL DEFAULT false,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT financial_accounts_account_unique UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS financial_accounts_tenant_idx ON financial_accounts (tenant_id)
  WHERE NOT is_archived;

-- ── statements: one row per statement document ─────────────────────────────

CREATE TABLE IF NOT EXISTS statements (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- The statement PDF/CSV is still a `document` and still carries the
  -- immutable original (README principle 1 is untouched). No ON DELETE here,
  -- same as transactions.document_id: a document backing a statement is
  -- evidence and is not cascaded away.
  document_id          uuid NOT NULL REFERENCES documents(id),
  financial_account_id uuid NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,

  period_start         date NOT NULL,
  period_end           date NOT NULL,
  opening_balance       money_amount NOT NULL,
  closing_balance       money_amount NOT NULL,

  -- T4's validator writes both of these; T3 only shapes them. residual is the
  -- signed amount by which closing_balance disagrees with
  -- opening_balance + sum(statement_lines.amount_signed), NULL until computed.
  balance_check        statement_balance_check NOT NULL DEFAULT 'pending',
  balance_residual      money_amount,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- One statement per document — the document IS the statement, same relationship
  -- as documents_capture_unique (0004).
  CONSTRAINT statements_document_unique UNIQUE (document_id),
  CONSTRAINT statements_period_valid CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS statements_account_idx
  ON statements (tenant_id, financial_account_id, period_start DESC);

-- ── statement_lines: one observed movement ──────────────────────────────────

CREATE TABLE IF NOT EXISTS statement_lines (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  statement_id           uuid NOT NULL REFERENCES statements(id) ON DELETE CASCADE,

  line_number            int NOT NULL,   -- position on the statement; what T4 names in a residual report

  -- posted_date and value_date differ, and the difference is exactly what
  -- makes bank-vs-receipt matching hard (§5.1). posted_date is the date this
  -- row is destined to fill transactions.settled_date with (see header note);
  -- value_date is nullable because not every statement prints both.
  posted_date            date NOT NULL,
  value_date             date,

  -- As printed, never normalised — the original is the record. normalised is
  -- derived (lower-cased, whitespace-collapsed) for pg_trgm matching and is a
  -- writer nobody has built yet, same pattern as documents §2: the column and
  -- its index exist so the writer costs nothing structural when it lands.
  description_raw        text NOT NULL,
  description_normalised text,

  -- One signed column, debits positive — the SAME convention as
  -- transaction_splits.amount (0006), not a second one. A matched line
  -- becomes a split with no sign flip.
  amount_signed          money_amount NOT NULL,

  running_balance        money_amount,   -- NULL when the statement doesn't print one
  counterparty_hint       text,           -- a merchant/payee candidate lifted from description_raw
  card_last4              char(4),        -- masked only, same discipline as documents.card_last4

  -- FX rows: the original amount/currency/rate when this line cleared through
  -- a currency conversion. A block, not three top-level columns, because most
  -- rows never populate it and its shape may still grow (Lane R/M).
  foreign_fx              jsonb NOT NULL DEFAULT '{}',

  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT statement_lines_unique_line UNIQUE (statement_id, line_number)
);

CREATE INDEX IF NOT EXISTS statement_lines_tenant_idx ON statement_lines (tenant_id);
CREATE INDEX IF NOT EXISTS statement_lines_date_idx
  ON statement_lines (tenant_id, posted_date DESC);
CREATE INDEX IF NOT EXISTS statement_lines_card_idx
  ON statement_lines (tenant_id, card_last4) WHERE card_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS statement_lines_desc_trgm
  ON statement_lines USING gin (description_normalised gin_trgm_ops)
  WHERE description_normalised IS NOT NULL;

-- ── Row-level security ─────────────────────────────────────────────────────
-- The same policy as every other tenant-scoped table (0010), applied in a
-- loop over an explicit list (0014's idiom) so a security review has one
-- place to look and a table added here cannot be quietly left unprotected.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'financial_accounts', 'statements', 'statement_lines'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        FOR ALL
        USING (tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id())
    $p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_readonly', t);
  END LOOP;
END $$;

-- ── Self-check ───────────────────────────────────────────────────────────
-- There is no data backfill in this migration (these are brand-new tables),
-- so the reversibility idiom 0030 uses on data — RAISE EXCEPTION on a
-- disagreement, inside the same transaction scripts/db.mjs wraps every
-- migration in — is applied here to STRUCTURE instead: if any of the three
-- tables above ends this migration without RLS enabled AND forced, the whole
-- migration fails and leaves nothing behind, rather than shipping a
-- tenant-scoped table that silently is not.
DO $$
DECLARE
  unprotected text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO unprotected
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('financial_accounts', 'statements', 'statement_lines')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled+forced on: %', unprotected;
  END IF;
END $$;
