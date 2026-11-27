-- ---------------------------------------------------------------------------
-- 0062 — Spambank: statements that arrive by mail, imported into SnapApp
--
-- Spambank Stage 1, ticket T12 (spambank/BUILD.md §4.8, §6, §9.2). BUILD.md
-- reserved 0061 for this; 0061 went to the receipt merchant location (9.5.i)
-- first, so this is 0062. One table, USER-scoped like 0060's `mail_settings`:
--
--   mail_statement_imports  one row per (person, mail message, attachment)
--                           YourTal offered in a `spambank-statement` event:
--                           the idempotency key of the import (a retried or
--                           re-delivered event never imports a file twice),
--                           what happened to it, and the list the person sees
--                           under "Imported from Spambank" (`GET /v1/mail/imports`).
--
--   status    pending    claimed by the worker, not finished (a crash leaves
--                        this; the job's retry picks it up again)
--             imported   a CSV read into a statement, or a PDF stored, charged
--                        and queued for the existing statement reader
--             duplicate  the same file is already a capture in that workspace
--             skipped    not imported on purpose: not a statement, a password-
--                        protected PDF, too many pages, no workspace chosen,
--                        out of credits, ...  (`detail` says which)
--             failed     tried and could not: a CSV the importer refused, a
--                        file YourTal no longer offers
--   detail    a short machine code, optionally `code: words` (≤ 500)
--   acked_at  when YourTal was told the outcome (`/statements/ack`); a row that
--             is finished but not acked is acked again on the job's retry.
--
-- Columns beyond BUILD.md §6's list, all for the person's list or the retry:
-- file_name, received_at, acked_at, updated_at.
--
-- RLS, and who may do what:
--   - the API (app_rw) only READS its own rows (user_id = current_user_id()):
--     the list. It cannot write one, so nothing a request carries can invent
--     or rewrite an import.
--   - the worker (app_worker) inserts and updates, and only after
--     `asUser(person)`: the policies check user_id = current_user_id() for it
--     too, so a worker bug cannot file a row under someone else.
--
-- tenant_id is the workspace the file went into (the person's choice in
-- mail_settings at the time); capture_id the capture it became. Both are
-- SET NULL when that workspace or capture is erased: the row stays in the
-- person's history, pointing at nothing. Erasing the person removes the rows
-- (user_id ON DELETE CASCADE). erase_workspace's spill guard (0043) covers
-- capture_id -> captures, a foreign key between two tables with tenant_id,
-- and the two always name the same workspace; its owner (app_erasure) reads
-- this table for that check, as 0043 granted it every such table then.
--
-- ADD-ONLY: one new table, its index, policies and grants.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mail_statement_imports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  /* Stalwart's (JMAP) ids of the message and of the attachment, as YourTal sent them. */
  email_id    text NOT NULL,
  blob_id     text NOT NULL,
  file_name   text,
  received_at timestamptz,
  tenant_id   uuid REFERENCES tenants (id) ON DELETE SET NULL,
  capture_id  uuid REFERENCES captures (id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'pending',
  detail      text,
  acked_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mail_statement_imports_status
    CHECK (status IN ('pending', 'imported', 'duplicate', 'skipped', 'failed')),
  CONSTRAINT mail_statement_imports_ids
    CHECK (email_id ~ '^[A-Za-z0-9_-]{1,255}$' AND blob_id ~ '^[A-Za-z0-9_-]{1,255}$'),
  CONSTRAINT mail_statement_imports_name CHECK (file_name IS NULL OR length(file_name) <= 255),
  CONSTRAINT mail_statement_imports_detail CHECK (detail IS NULL OR length(detail) <= 500),
  CONSTRAINT mail_statement_imports_once UNIQUE (user_id, email_id, blob_id)
);

CREATE INDEX IF NOT EXISTS mail_statement_imports_by_user ON mail_statement_imports (user_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE mail_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_statement_imports FORCE  ROW LEVEL SECURITY;

CREATE POLICY mail_statement_imports_self_read ON mail_statement_imports
  FOR SELECT TO app_rw
  USING (user_id = current_user_id());
CREATE POLICY mail_statement_imports_worker_insert ON mail_statement_imports
  FOR INSERT TO app_worker
  WITH CHECK (user_id = current_user_id());
CREATE POLICY mail_statement_imports_worker_update ON mail_statement_imports
  FOR UPDATE TO app_worker
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- Grants, narrowed at both layers. The default ACL gives app_rw arwd on every
-- new table (see 0034), so revoke first and grant exactly what is meant.
-- app_worker is a member of app_rw and inherits its SELECT.
REVOKE ALL ON mail_statement_imports FROM app_rw;
REVOKE ALL ON mail_statement_imports FROM app_readonly;
REVOKE ALL ON mail_statement_imports FROM app_worker;
GRANT SELECT         ON mail_statement_imports TO app_rw;
GRANT INSERT, UPDATE ON mail_statement_imports TO app_worker;
-- erase_workspace's spill guard (0043) reads every table with a tenant_id
-- foreign key into another such table; 0043 granted the ones that existed.
GRANT SELECT         ON mail_statement_imports TO app_erasure;

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'mail_statement_imports'
                    AND c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'RLS not enabled+forced on mail_statement_imports';
  END IF;

  SELECT string_agg(privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE grantee = 'app_rw' AND table_name = 'mail_statement_imports' AND privilege_type <> 'SELECT';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'app_rw holds more than SELECT on mail_statement_imports: %', bad;
  END IF;

  SELECT string_agg(privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE grantee = 'app_readonly' AND table_name = 'mail_statement_imports';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'app_readonly must hold nothing on mail_statement_imports: %', bad;
  END IF;
END $$;
