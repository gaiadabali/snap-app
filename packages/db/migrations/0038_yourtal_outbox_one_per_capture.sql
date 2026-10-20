-- ---------------------------------------------------------------------------
-- 0038 — the YourTal outbox: one report per capture
--
-- Group plan 2.5.e. Until now `external_ref` was the SHA-256 of the stored
-- original, so it never changed for a capture and the one unique constraint of
-- 0037, (user_id, action, external_ref), was also "one row per capture".
-- From now on a receipt that carries a document number is reported under a
-- keyed CONTENT ref (apps/server/src/yourtal/external-ref.ts), and a content
-- ref can change when a re-extraction reads a field differently. The queueing
-- code (outbox.repo.ts) checks the capture first, but the rule that matters is
-- worth holding in the database: a capture is reported to YourTal at most once
-- per user, whatever its ref has become.
--
-- (A skipped re-photo stores its IMAGE ref, not the content ref of the row it
-- repeats, so the 0037 constraint does not collide with the reported row.)
--
-- CANNOT FAIL ON EXISTING DATA. Every row written so far came from the code
-- that existed at 0037, where `external_ref` was the image hash of the
-- capture, stable for a given capture, and that code looked for its own row by
-- that ref before inserting. So a capture has had at most one row per user. The
-- index is partial (capture_id IS NOT NULL): `capture_id` is nullable in 0037,
-- and rows without one are not constrained.
--
-- ADD-ONLY: one new index. Nothing existing is touched. The 0037 unique
-- constraint stays: the same receipt still cannot be queued twice for a user.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS yourtal_outbox_one_per_capture
  ON yourtal_outbox (user_id, action, capture_id)
  WHERE capture_id IS NOT NULL;

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'yourtal_outbox'
       AND indexname = 'yourtal_outbox_one_per_capture'
  ) THEN
    RAISE EXCEPTION 'yourtal_outbox_one_per_capture was not created';
  END IF;
END $$;
