-- ---------------------------------------------------------------------------
-- 0032 — event_observations, match_candidates, and the enum member 0030 left
-- out.
--
-- docs/STATEMENTS.md §5.3.1 (R5 design, 2026-09-18), Lane R ticket R5a. Builds
-- the register only: no application code reads or writes these tables yet
-- (that is R5b/R5c). §5.3.1's own framing, restated because it is the whole
-- point: a `transaction` is the economic event; each piece of evidence for it
-- (a document, a statement line) is an OBSERVATION of that event, never a
-- winner and never merged away. `event_observations` holds only facts a human
-- (or the posting act itself) has established; `match_candidates` holds
-- hypotheses and their outcomes, kept in a separate table on purpose so no
-- reader can forget to filter on "is this confirmed yet".
--
-- TWO THINGS §5.3.1 SAID THAT §14.1c CHANGED AFTER IT WAS WRITTEN (D-S6, D-S7,
-- both 2026-09-18, second pass) — noted here so this file does not enshrine a
-- superseded position:
--
--  * D-S6: accepting a match IS the act of posting it — one tap, not
--    accept-then-post. Nothing here needs to change for that (the schema
--    never had a two-step shape), but the comments below say "accept posts"
--    rather than "accept, then a separate post confirms".
--
--  * D-S7: a statement line counts as SPENDING the moment it is read; only a
--    human act turns it into a LEDGER TRANSACTION. `event_observations` is
--    what makes "spending = posted transactions PLUS unmatched statement
--    lines, counting nothing twice" an EXACT query rather than an estimate —
--    it is the set of statement lines a posted transaction already accounts
--    for. See the index note near the end of this file: that query is an
--    anti-join, and it is covered by an index this migration already builds
--    for an unrelated reason, so nothing new is added for it.
--
-- WHY TWO DEFERRED CONSTRAINT TRIGGERS, AND WHY THEY ARE THE HARD PART: the
-- 0006 idiom (`DEFERRABLE INITIALLY DEFERRED`, checked once at COMMIT) is used
-- twice so a single database transaction may void one transaction, insert or
-- re-point observation rows, and insert a new transaction, IN ANY ORDER,
-- while still being refused if the final state is wrong. A same-transaction
-- ordering trigger (checked row-by-row, immediately) could not allow that: a
-- supersede voids the old transaction before the new one exists to receive
-- the re-pointed link, which would trip an immediate check that fires before
-- the transaction finishes moving things around. Deferred-to-commit is what
-- makes "void, insert, re-point, post — one `withTenantAs`" (R5b) legal.
--
--   1. A link always points at a live event: a void transaction may carry NO
--      `event_observations` row, checked at commit.
--   2. `transactions.document_id` is a CHECKED duplication of the event's
--      document observation (the 0026 discipline — "two copies of one fact
--      is a CHECKED duplication, not a hope"), for every NON-void
--      transaction. Void transactions are exempt: a superseded transaction's
--      `document_id` is history and its document observation has moved to
--      its successor, which would trip this check on every ordinary
--      supersede if it applied there too.
--
-- Both triggers are pure re-derivations from committed state (a `SELECT`
-- inside the trigger function, not the row values it fired on), so they are
-- correct regardless of how many times a transaction or its observations
-- were touched before commit — only the final state matters.
-- ---------------------------------------------------------------------------

-- ── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE observation_kind       AS ENUM ('document', 'statement_line');
CREATE TYPE match_candidate_status AS ENUM ('suggested', 'accepted', 'rejected', 'unlinked');
CREATE TYPE match_proposer         AS ENUM ('matcher', 'user');

-- 0030 left this out with a comment explaining exactly why: "Lane T ships,
-- adding it is `ALTER TYPE contribution_source ADD VALUE 'statement_line'` —
-- a type change, not a table reshape." Lane T has shipped (0031). This label
-- is referenced NOWHERE in this file, in a bare statement or otherwise — the
-- rule 0023 records: a new enum value cannot be used in the same transaction
-- that adds it except from inside a function/procedure body compiled later,
-- and `scripts/db.mjs` wraps this whole file in one transaction. The CHECK
-- that gives this member a grounding rule (0030's `goal_contributions`) is a
-- BARE use, so it is R5f-1's migration, not this one.
ALTER TYPE contribution_source ADD VALUE 'statement_line';

-- ── match_candidates: hypotheses, and what became of them ──────────────────

CREATE TABLE match_candidates (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  statement_line_id  uuid NOT NULL REFERENCES statement_lines(id) ON DELETE CASCADE,

  -- The other side. Always a document in R5: a candidate references EVIDENCE,
  -- never a transaction, because transaction ids change on every supersede
  -- and document ids do not. R6 makes this nullable and adds a
  -- counterpart_line_id for transfers, with a CHECK requiring exactly one —
  -- a constraint change, not a reshape.
  document_id        uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  status             match_candidate_status NOT NULL DEFAULT 'suggested',
  proposed_by        match_proposer NOT NULL,
  matcher_version    text,             -- which generator proposed it; NULL for a user

  -- FACTS, never a score: {"amount_exact":true,"date_gap_days":2,
  --   "card_last4":"equal"|"absent","merchant_similarity":0.83,
  --   "within_posting_lag":true|false|null}. R7 calibrates a threshold from
  --   these plus `status`; nothing built by R5 reads them to decide anything.
  evidence           jsonb NOT NULL DEFAULT '{}',

  -- A human's account of an amount difference, set only at accept — never
  -- derived by the matcher, which never supplies a variance.
  variance_kind      text CHECK (variance_kind IN ('tip', 'surcharge', 'other')),
  variance_amount    money_amount,

  decided_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT match_candidates_decided       CHECK ((status = 'suggested') = (decided_at IS NULL)),
  CONSTRAINT match_candidates_variance_pair CHECK ((variance_kind IS NULL) = (variance_amount IS NULL)),

  -- One row per pair, for the life of the pair: a rejected pair is never
  -- re-suggested, and re-linking flips this row rather than adding one. (R6
  -- re-declares this NULLS NOT DISTINCT over the widened counterpart set.)
  CONSTRAINT match_candidates_pair_unique UNIQUE (statement_line_id, document_id)
);

CREATE INDEX match_candidates_open_line_idx ON match_candidates (tenant_id, statement_line_id) WHERE status = 'suggested';
CREATE INDEX match_candidates_open_doc_idx  ON match_candidates (tenant_id, document_id)       WHERE status = 'suggested';
CREATE INDEX match_candidates_labels_idx    ON match_candidates (tenant_id, status, decided_at); -- R7's held-out pulls

-- ── event_observations: facts only — a row exists iff established ──────────

CREATE TABLE event_observations (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id     uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  kind               observation_kind NOT NULL,
  document_id        uuid REFERENCES documents(id),        -- no cascade: evidence outlives links
  statement_line_id  uuid REFERENCES statement_lines(id),  -- no cascade: same
  candidate_id       uuid REFERENCES match_candidates(id) ON DELETE SET NULL, -- NULL for the posting-act row
  confirmed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_observations_pointer_matches_kind CHECK (
       (kind = 'document'       AND document_id IS NOT NULL AND statement_line_id IS NULL)
    OR (kind = 'statement_line' AND statement_line_id IS NOT NULL AND document_id IS NULL)),

  -- One evidence row observes at most one LIVE event. Plain UNIQUE is enough
  -- because only live links live here; NULLs are distinct by default, so a
  -- row of the other kind (NULL in this column) never collides.
  CONSTRAINT event_observations_document_once UNIQUE (document_id),
  CONSTRAINT event_observations_line_once     UNIQUE (statement_line_id)
);

-- R5 scope: one document per event. Two documents for one purchase (an
-- EFTPOS docket AND a tax invoice) is dedup's domain (R5e,
-- documents.dedup_group_id) and is NOT joined here. A later lane lifts this
-- index; nothing else has to change.
CREATE UNIQUE INDEX event_observations_one_document_per_event
  ON event_observations (transaction_id) WHERE kind = 'document';
CREATE INDEX event_observations_txn_idx ON event_observations (tenant_id, transaction_id);

-- ── Deferred constraint triggers ────────────────────────────────────────────
-- Both re-derive the invariant from committed state inside the function body
-- (a fresh SELECT, not the firing row's values), so they are correct no
-- matter how many times a transaction or its observations were touched
-- earlier in the same statement/transaction — only the state at COMMIT is
-- ever judged. Both follow 0006's idiom exactly: CONSTRAINT TRIGGER,
-- DEFERRABLE INITIALLY DEFERRED, FOR EACH ROW.

-- 1. A link always points at a live event. Fires on every INSERT/UPDATE of
--    event_observations and every UPDATE OF status on transactions — the two
--    ways a transaction can end up void while still linked. DELETE from
--    event_observations is deliberately not a trigger event here: removing a
--    link can never CREATE this violation.
CREATE OR REPLACE FUNCTION assert_no_observation_on_void() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_txn    uuid;
  v_status txn_status;
  v_cnt    int;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    v_txn := COALESCE(NEW.id, OLD.id);
  ELSE
    v_txn := COALESCE(NEW.transaction_id, OLD.transaction_id);
  END IF;

  SELECT status INTO v_status FROM transactions WHERE id = v_txn;
  -- The transaction itself may be gone (hard delete cascades observations
  -- too, firing their own DELETE — not checked here, see above); nothing to
  -- judge in that case.
  IF v_status IS NULL OR v_status IS DISTINCT FROM 'void' THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_cnt FROM event_observations WHERE transaction_id = v_txn;
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'transaction % is void but still carries % observation(s) — repoint or delete them before voiding', v_txn, v_cnt
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_eo_no_link_on_void
  AFTER INSERT OR UPDATE ON event_observations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_no_observation_on_void();

CREATE CONSTRAINT TRIGGER trg_txn_no_link_on_void
  AFTER UPDATE OF status ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_no_observation_on_void();

-- 2. transactions.document_id agrees with the register, for every non-void
--    transaction touched. Manual transactions (NULL both sides) pass. Fires
--    on every INSERT/UPDATE/DELETE of event_observations (a document
--    observation row can be inserted, re-pointed, or removed) and every
--    INSERT/UPDATE OF document_id, status on transactions.
CREATE OR REPLACE FUNCTION assert_document_id_matches_observation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_txn              uuid;
  v_status           txn_status;
  v_doc_id           uuid;
  v_observed_doc_id  uuid;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    v_txn := COALESCE(NEW.id, OLD.id);
  ELSE
    v_txn := COALESCE(NEW.transaction_id, OLD.transaction_id);
  END IF;

  SELECT status, document_id INTO v_status, v_doc_id FROM transactions WHERE id = v_txn;
  IF v_status IS NULL THEN
    RETURN NULL; -- transaction gone
  END IF;

  -- Void is exempt (see header note): a superseded transaction's document_id
  -- is history, and its document observation has moved to its successor.
  IF v_status = 'void' THEN
    RETURN NULL;
  END IF;

  SELECT document_id INTO v_observed_doc_id FROM event_observations
   WHERE transaction_id = v_txn AND kind = 'document';

  IF v_doc_id IS NOT DISTINCT FROM v_observed_doc_id THEN
    RETURN NULL;
  END IF;

  RAISE EXCEPTION 'transaction % document_id (%) disagrees with its document observation (%)',
    v_txn, v_doc_id, v_observed_doc_id
    USING ERRCODE = 'check_violation';
END $$;

CREATE CONSTRAINT TRIGGER trg_eo_document_matches_txn
  AFTER INSERT OR UPDATE OR DELETE ON event_observations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_document_id_matches_observation();

CREATE CONSTRAINT TRIGGER trg_txn_document_matches_observation
  AFTER INSERT OR UPDATE OF document_id, status ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_document_id_matches_observation();

-- ── Backfill: every existing document-backed transaction gets its evidence ──
-- On the same footing as 0030's: every NON-VOID transaction with a
-- document_id gets exactly one 'document' observation row, confirmed by
-- whoever posted it (falling back to the row's own created_at when there is
-- no posted_at, e.g. a still-draft transaction — drafts are included, per
-- §5.3.1: "a draft's document is its evidence already"). Nothing invents a
-- confirming human where none is known; `confirmed_by` is simply NULL then,
-- same as `posted_by` already is on those rows.
INSERT INTO event_observations (id, tenant_id, transaction_id, kind, document_id, confirmed_by, confirmed_at)
SELECT gen_random_uuid(), t.tenant_id, t.id, 'document', t.document_id, t.posted_by, COALESCE(t.posted_at, t.created_at)
  FROM transactions t
 WHERE t.document_id IS NOT NULL
   AND t.status <> 'void';

-- Self-check: if backfill ever leaves the count disagreeing with its own
-- source query, fail loudly and leave nothing behind, rather than shipping a
-- silent gap on day one. (A transaction whose document_id collides with
-- another transaction's — two non-void rows sharing one document_id, which
-- should never happen but is not prevented anywhere today — fails earlier
-- still, at the INSERT above, via event_observations_document_once; this
-- check is the second line of defence for any other kind of mismatch.)
DO $$
DECLARE
  v_expected int;
  v_actual   int;
BEGIN
  SELECT count(*) INTO v_expected FROM transactions WHERE document_id IS NOT NULL AND status <> 'void';
  SELECT count(*) INTO v_actual   FROM event_observations WHERE kind = 'document';
  IF v_expected <> v_actual THEN
    RAISE EXCEPTION 'event_observations backfill mismatch: % document-backed non-void transaction(s) but % document observation row(s)',
      v_expected, v_actual;
  END IF;
END $$;

-- The backfill INSERT above left both deferred constraint triggers on
-- event_observations with pending, unfired events for this transaction —
-- correct (that is the whole point of DEFERRABLE INITIALLY DEFERRED: a
-- runtime writer may insert/void/re-point in any order and only pay for the
-- check once, at COMMIT). But a table with pending trigger events cannot be
-- the target of ALTER TABLE until those events are resolved, and the RLS
-- block below does exactly that — found by actually running this migration
-- against a seeded database (`node scripts/db.mjs migrate`), not by
-- inspection: it failed with "cannot ALTER TABLE event_observations because
-- it has pending trigger events". SET CONSTRAINTS ALL IMMEDIATE forces both
-- triggers to fire now instead of at COMMIT, which both unblocks the ALTER
-- TABLE below and validates the backfill's own writes early — a stricter
-- check than the plain COMMIT-time default would have given this migration,
-- not a weaker one. Nothing later in this file still needs the deferral.
SET CONSTRAINTS ALL IMMEDIATE;

-- ── Matcher-support indexes ─────────────────────────────────────────────────
-- Cheap now, needed at volume: the candidate generator (R5c) filters on exact
-- amount and excludes an already-matched document, both of which want these.
CREATE INDEX statement_lines_amount_idx ON statement_lines (tenant_id, amount_signed);
CREATE INDEX documents_payable_amount_idx ON documents (tenant_id, payable_amount)
  WHERE deleted_at IS NULL AND doc_type <> 'statement';

-- ── D-S7's query, and whether it wants an index ─────────────────────────────
-- D-S7 (§14.1c, after §5.3.1 was written): the spending view is posted
-- transactions PLUS unmatched statement lines, and event_observations is what
-- makes the subtraction exact — "which lines does a posted transaction
-- already represent" reads as an anti-join:
--
--   SELECT sl.* FROM statement_lines sl
--    WHERE sl.tenant_id = current_tenant_id()
--      AND NOT EXISTS (SELECT 1 FROM event_observations eo
--                        WHERE eo.statement_line_id = sl.id)
--
-- Considered and not added: this needs no new index. The outer scan already
-- has one (0031's statement_lines_date_idx / statement_lines_tenant_idx), and
-- the per-row existence probe is answered by the UNIQUE btree Postgres builds
-- automatically for event_observations_line_once (statement_line_id) above —
-- an O(log n) lookup keyed on exactly the column the anti-join probes, for
-- free, as a side effect of the uniqueness rule the design already requires
-- ("one evidence row observes at most one live event"). Adding a second index
-- over the same column would only cost writes.

-- ── Row-level security ─────────────────────────────────────────────────────
-- The same policy as every other tenant-scoped table (0010), applied in a
-- loop over an explicit list (0014's idiom, followed exactly by 0031) so a
-- security review has one place to look and a table added here cannot be
-- quietly left unprotected. No worker bypass: neither table gets the elevated
-- cross-tenant policy `jobs` carries -- these are ordinary tenant tables.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'match_candidates', 'event_observations'
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
-- If either table ends this migration without RLS enabled AND forced, the
-- whole migration fails and leaves nothing behind, rather than shipping a
-- tenant-scoped table that silently is not -- 0031's own closing check,
-- applied to the two tables this file adds.
DO $$
DECLARE
  unprotected text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO unprotected
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('match_candidates', 'event_observations')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled+forced on: %', unprotected;
  END IF;
END $$;
