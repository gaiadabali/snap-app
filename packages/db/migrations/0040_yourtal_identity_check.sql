-- ---------------------------------------------------------------------------
-- 0040 — YourTal identity check: what a refused receipt was missing
--
-- Group 5.9.c. YourTal answers `403 identity_check_required` with a `missing`
-- list (`verify_email` and/or `use_permanent_email`) when the person has not
-- passed its identity check. SnapApp records the refusal on the outbox row
-- (status 'refused', last_code 'identity_check_required') and keeps `missing`
-- so the status can tell the person what to do.
--
-- ADD-ONLY: one nullable column. Nothing existing is touched.
-- ---------------------------------------------------------------------------

ALTER TABLE yourtal_outbox ADD COLUMN IF NOT EXISTS identity_missing text[];

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'yourtal_outbox' AND column_name = 'identity_missing'
  ) THEN
    RAISE EXCEPTION 'yourtal_outbox.identity_missing was not created';
  END IF;
END $$;
