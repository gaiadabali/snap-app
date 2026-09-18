-- ---------------------------------------------------------------------------
-- 0033 — goal_contributions can now be grounded (0030's deferred half).
--
-- docs/STATEMENTS.md §5.3.1 "What grounds a goal contribution", Lane R
-- ticket R5f-1. The owner's own framing is the reason this exists at all:
-- savings goals need to be able to "understand money in from statements ...
-- so not really direct addition where system cannot proof the addition."
-- 0030 built `goal_contributions` with `source_statement_line_id` already on
-- the table, deliberately NULL-only, because Lane T (statement ingestion)
-- did not exist yet: "When Lane T ships, that CHECK is replaced (not the
-- column) with one requiring the pointer whenever source = 'statement_line',
-- and the FK is added." Lane T shipped (0031); 0032 (R5a) added the enum
-- member this file is the first BARE use of, per 0023's rule that
-- `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that adds
-- it. This is that later migration, doing exactly what 0030 promised.
--
-- WHAT "GROUNDED" MEANS, so the trigger below reads as an enforcement of a
-- sentence rather than an arbitrary rule: a grounded contribution is a claim
-- that a specific `statement_lines` row — an observed bank movement, not a
-- typed number — put money into this goal. Two things make that claim
-- honest rather than merely plausible:
--
--   1. The line has to be money IN. `amount_signed > 0` is 0031/0032's own
--      reading of 0006 for an asset-backed `financial_accounts` row (see
--      `apps/server/src/statements/csv-import.ts#rowAmount`'s header: a
--      deposit is positive, a withdrawal is negative). A goal cannot be
--      funded by a purchase leaving the account.
--   2. The contributions grounded in one line can never, in total, exceed
--      what that line says arrived. Two savings goals cannot each claim the
--      full amount of one $500 deposit — that would let the app assert more
--      money moved than the bank observed, which is the exact "tracking
--      messy" failure this ticket exists to prevent, just moved from a
--      duplicate CLAIM to a duplicate GROUNDED claim.
--
-- A grounded contribution is NOT an `event_observations` row (§5.3.1: "the
-- line's economic event is a transfer or a deposit and belongs to the
-- ledger; 'this counts toward the holiday' is an allocation on top of it").
-- Nothing here touches `event_observations` or `match_candidates` — those
-- are for merging TWO OBSERVATIONS OF ONE EVENT (R5a-R5e); this is a second,
-- independent fact layered on top of an event that already happened.
-- ---------------------------------------------------------------------------

-- ── The CHECK 0030 promised, replacing the one that forced NULL ───────────
-- Both directions at once, per docs/STATEMENTS.md's own framing: the pointer
-- exists exactly when the source claims it does. 'manual' and
-- 'opening_balance' rows are refused a pointer (same as before); a
-- 'statement_line' row is refused the absence of one (new).
ALTER TABLE goal_contributions DROP CONSTRAINT goal_contributions_no_statement_line_yet;

ALTER TABLE goal_contributions
  ADD CONSTRAINT goal_contributions_statement_line_grounded
    CHECK ((source = 'statement_line') = (source_statement_line_id IS NOT NULL));

-- ON DELETE RESTRICT, not CASCADE: a statement is evidence and is not
-- deleted in the ordinary run of the app, and a contribution that names a
-- line refuses to outlive it silently — the cascade `statements` already
-- carries (documents -> statements -> statement_lines, 0031) would otherwise
-- take a grounded contribution's only evidence out from under it with no
-- refusal at all.
ALTER TABLE goal_contributions
  ADD CONSTRAINT goal_contributions_statement_line_fk
    FOREIGN KEY (source_statement_line_id) REFERENCES statement_lines(id) ON DELETE RESTRICT;

CREATE INDEX goal_contributions_line_idx ON goal_contributions (source_statement_line_id)
  WHERE source_statement_line_id IS NOT NULL;

-- ── The grounding trigger ───────────────────────────────────────────────────
-- An ordinary (non-deferred) AFTER trigger, unlike 0032's pair: this
-- invariant is single-table (goal_contributions re-reading statement_lines,
-- never the other way around) and there is no legitimate multi-step sequence
-- that needs COMMIT-time slack the way a supersede does. AFTER, not BEFORE,
-- so the SELECT SUM(...) below sees this row's own just-written amount as
-- part of the total it is judging, with nothing added back by hand.
--
-- Fires on INSERT and on UPDATE of the three columns that can change what is
-- being claimed (amount, source, or which line). WHEN restricts it to rows
-- actually claiming grounding — a manual or opening_balance row never pays
-- for this check. DELETE is not a trigger event: removing a contribution can
-- only shrink the sum grounded in a line, never push it over.
CREATE OR REPLACE FUNCTION assert_goal_contribution_grounded() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_line_amount  money_amount;
  v_grounded_sum money_amount;
BEGIN
  -- FOR UPDATE: serialises two contributions racing to ground themselves in
  -- the same line, so the sum this transaction judges against cannot be
  -- stale by the time it commits — the same reason `recordPayment` locks its
  -- invoice row before comparing to `amount_due`.
  SELECT amount_signed INTO v_line_amount
    FROM statement_lines WHERE id = NEW.source_statement_line_id FOR UPDATE;

  -- The FK already guarantees the row exists by the time this fires (AFTER,
  -- same transaction); this NULL check is only reachable if that FK were
  -- ever weakened, and failing loudly here is cheaper than a confusing
  -- downstream NULL comparison.
  IF v_line_amount IS NULL THEN
    RAISE EXCEPTION 'goal_contributions: source_statement_line_id % does not resolve to a real statement line',
      NEW.source_statement_line_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_line_amount <= 0 THEN
    RAISE EXCEPTION 'goal_contributions: statement line % is not money in (amount_signed = %) and cannot ground a savings contribution',
      NEW.source_statement_line_id, v_line_amount
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_grounded_sum
    FROM goal_contributions
   WHERE source_statement_line_id = NEW.source_statement_line_id
     AND source = 'statement_line';

  IF v_grounded_sum > v_line_amount THEN
    RAISE EXCEPTION 'goal_contributions: % grounded in statement line % exceeds the line''s own amount of %',
      v_grounded_sum, NEW.source_statement_line_id, v_line_amount
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_goal_contribution_grounded
  AFTER INSERT OR UPDATE OF amount, source, source_statement_line_id ON goal_contributions
  FOR EACH ROW
  WHEN (NEW.source = 'statement_line')
  EXECUTE FUNCTION assert_goal_contribution_grounded();
