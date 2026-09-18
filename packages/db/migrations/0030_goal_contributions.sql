-- 0030_goal_contributions
--
-- A savings goal's balance stops being a number nobody can point at.
--
-- Until now `goals.saved` was a bare running total, incremented in place by
-- `business.repo.ts#contributeToGoal`: `update goals set saved = saved + $1`.
-- A $900 balance could not be explained, corrected or undone — there was no
-- row behind it, only the current value. That is exactly what D16 exists to
-- prevent: a number asserted with nothing to point at.
--
-- This migration gives every dollar in a goal's balance a record: who or what
-- put it there, when, and — once statement ingestion exists
-- (docs/STATEMENTS.md Lane T) — which observed bank movement it came from.
-- It does NOT build statement ingestion. `source` and
-- `source_statement_line_id` below are deliberately wider than anything
-- writes today, so Lane T can slot a grounded contribution in later without a
-- second migration reshaping this table.

-- ── The source discriminator ────────────────────────────────────────────────
-- Only 'manual' is legal from the API today — business.controller.ts's
-- ContributeDto has no way to set anything else. 'opening_balance' is written
-- exactly once, below, by this migration itself, to carry forward history
-- that already existed with no contribution behind it. It is never written by
-- the application.
--
-- 'statement_line' is deliberately NOT added yet. docs/STATEMENTS.md is
-- explicit that a grounded contribution needs statement ingestion (Lane T:
-- T1-T3), which is not built, and adding the enum member now with nothing
-- able to produce it would repeat the exact pattern STATEMENTS.md §2
-- catalogues four times over: a documented capability nothing writes. When
-- Lane T ships, adding it is `ALTER TYPE contribution_source ADD VALUE
-- 'statement_line'` — a type change, not a table reshape.
CREATE TYPE contribution_source AS ENUM ('manual', 'opening_balance');

CREATE TABLE goal_contributions (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  goal_id     uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,

  amount      money_amount NOT NULL CHECK (amount > 0),
  occurred_on date NOT NULL,          -- when the money went in, not when this row was typed

  source      contribution_source NOT NULL DEFAULT 'manual',

  -- Nullable and unconstrained by an FK on purpose: the referent
  -- (`statement_lines`, docs/STATEMENTS.md §5.1) does not exist yet — Lane T
  -- is unbuilt. Every row today has this NULL, enforced by the CHECK below.
  -- When Lane T ships, that CHECK is replaced (not the column) with one
  -- requiring the pointer whenever source = 'statement_line', and the FK is
  -- added with `ALTER TABLE ... ADD CONSTRAINT ... REFERENCES
  -- statement_lines(id)` — again a constraint change, not a reshape.
  source_statement_line_id uuid,

  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,

  -- Both sources legal today ('manual', 'opening_balance') carry no statement
  -- evidence. This is the honesty rule made structural rather than a
  -- convention someone has to remember.
  CONSTRAINT goal_contributions_no_statement_line_yet
    CHECK (source_statement_line_id IS NULL)
);

CREATE INDEX goal_contributions_goal_idx   ON goal_contributions (goal_id, occurred_on DESC);
CREATE INDEX goal_contributions_tenant_idx ON goal_contributions (tenant_id);

-- ── Row-level security ─────────────────────────────────────────────────────
-- The same policy as every other tenant-scoped table (0010, extended by 0014).
-- Plain top-level DDL, not a DO block: there is one table here, not a loop
-- over an array of names, so there is no dynamic identifier that would need
-- EXECUTE format(...).
ALTER TABLE goal_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_contributions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON goal_contributions
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON goal_contributions TO app_rw;
GRANT SELECT ON goal_contributions TO app_readonly;

-- ── Honest backfill: one opening contribution per existing goal ─────────────
-- Every row already in `goals` carries a `saved` value with no contribution
-- behind it. Inventing per-transaction history to explain it would be a
-- fabrication — nobody knows what actually built that balance up. Instead:
-- one contribution per non-zero goal, source = 'opening_balance', dated the
-- day the goal itself was created (the earliest date this system can
-- honestly claim), for exactly the amount already on the row. The total
-- still reconciles; the fact that we do not know what composed it stays
-- visible in `source` rather than being papered over as an ordinary,
-- user-made contribution.
INSERT INTO goal_contributions (id, tenant_id, goal_id, amount, occurred_on, source, created_at)
SELECT gen_random_uuid(), g.tenant_id, g.id, g.saved, g.created_at::date, 'opening_balance', g.created_at
  FROM goals g
 WHERE g.saved <> 0;

-- ── goals.saved becomes DERIVED, and cannot drift ───────────────────────────
-- Decision: keep `saved` as a column rather than turn every read (the mobile
-- goals screen, the personal home total) into a join+aggregate — it is read
-- far more often than contributions change, and every existing caller reads
-- it directly. But a cache that can drift from its source is worse than no
-- cache, so two triggers make drift structurally impossible instead of
-- relying on every write path remembering to keep it in sync:
--
--  1. AFTER any change to goal_contributions, recompute the affected goal's
--     `saved` from the contribution rows. This is the path every write goes
--     through today (business.repo.ts never writes `saved` directly anymore).
--  2. BEFORE any INSERT or UPDATE of `goals` itself, recompute `saved` from
--     the same query regardless of what value the statement tried to write —
--     so even a direct `UPDATE goals SET saved = 999999` (bypassing every
--     application code path entirely) is corrected before it is stored. This
--     is the guarantee the test suite proves by attempting exactly that write.
CREATE OR REPLACE FUNCTION goal_contributions_total(p_goal_id uuid) RETURNS money_amount
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(amount), 0)::money_amount
    FROM goal_contributions WHERE goal_id = p_goal_id;
$$;

CREATE OR REPLACE FUNCTION recompute_goal_saved() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE goals SET saved = goal_contributions_total(OLD.goal_id), updated_at = now()
     WHERE id = OLD.goal_id;
    RETURN OLD;
  END IF;

  UPDATE goals SET saved = goal_contributions_total(NEW.goal_id), updated_at = now()
   WHERE id = NEW.goal_id;

  -- Nothing moves a contribution to a different goal today, but if it ever
  -- happens the goal it left must not be left stale.
  IF TG_OP = 'UPDATE' AND OLD.goal_id IS DISTINCT FROM NEW.goal_id THEN
    UPDATE goals SET saved = goal_contributions_total(OLD.goal_id), updated_at = now()
     WHERE id = OLD.goal_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_goal_contributions_recompute
  AFTER INSERT OR UPDATE OR DELETE ON goal_contributions
  FOR EACH ROW EXECUTE FUNCTION recompute_goal_saved();

CREATE OR REPLACE FUNCTION goal_saved_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- On INSERT no contribution can reference this id yet (the FK has nothing
  -- to point at until the row commits), so this is always 0 — correct: a
  -- goal starts unfunded and only ever grows through a recorded contribution.
  NEW.saved := goal_contributions_total(NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_goals_saved_authoritative
  BEFORE INSERT OR UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION goal_saved_before_write();

-- Safety net on the backfill itself: if this ever leaves a goal's `saved`
-- disagreeing with the sum of its own contributions, the migration fails
-- loudly instead of shipping a silent drift on day one.
DO $$
DECLARE mismatched int;
BEGIN
  SELECT count(*) INTO mismatched
    FROM goals g
   WHERE g.saved <> goal_contributions_total(g.id);
  IF mismatched > 0 THEN
    RAISE EXCEPTION '% goal(s) do not reconcile with goal_contributions after backfill', mismatched;
  END IF;
END $$;
