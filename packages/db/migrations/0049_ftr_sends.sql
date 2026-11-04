-- ---------------------------------------------------------------------------
-- 0049 — ftr_sends: SnapApp sends a deduction bundle to Free Tax Returns
--
-- Group task 4.8.a, ticket S1 (yourtal/docs/30-snapapp-to-ftr-direct-send.md
-- §6). One row per "Send to Free Tax Returns" a person starts. S2 adds the
-- endpoints; this is the table, the sign-in flow's link to it, and the policy
-- the worker's hourly sweep needs.
--
-- THE BUNDLE IS HELD ONLY WHILE THE SEND IS OPEN. `bundle` is the exact JSON
-- text whose SHA-256 is `bundle_sha256`: YourTal's assertion is bound to that
-- hash, so the bytes posted to FTR must be the ones hashed at the start, and
-- the person is away at YourTal in between. A CHECK keeps it NULL in every
-- status but `started`, so the finish clears it in the same UPDATE that closes
-- the row, and the worker's sweep expires any send still open after an hour.
-- It is tax data in a workspace-scoped, forced-RLS table, and app_readonly
-- (reporting) gets no grant on the table at all.
--
-- RLS: the workspace policy of 0010/0014 (tenant_isolation, FORCE) for the
-- API. The worker has no tenant context in its sweep, so it gets two narrow
-- policies (SELECT and UPDATE) on sends older than an hour; the UPDATE only
-- reaches open ones and may only leave them expired with no bundle. app_worker inherits app_rw's
-- table grants, so the policy, not a column grant, is what narrows it.
--
-- ERASURE (0043). Both foreign keys cascade, so erase_person and
-- erase_workspace need no change: the tenant's rows go with the workspace, a
-- person's with the person. `yourtal_sign_in_flows.ftr_send_id` cascades too,
-- so a flow never outlives its send. That is a foreign key from a table with
-- no tenant_id to one with it, which 0043's pinned-FK test lists on purpose.
--
-- ADD-ONLY: a table, a nullable column, indexes, policies, grants.
-- Reverse: DROP TABLE ftr_sends CASCADE (drops the flow FK, not the column);
-- ALTER TABLE yourtal_sign_in_flows DROP COLUMN ftr_send_id.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ftr_sends (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  /* '2025-26' */
  financial_year      text NOT NULL,
  line_count          integer NOT NULL,
  /* SHA-256 of `bundle` exactly as posted, lowercase hex. */
  bundle_sha256       char(64) NOT NULL,
  /* The bundle JSON text. NULL unless status = 'started' (see above). */
  bundle              text,
  /* YourTal's transfer id; set once the transfer is opened there. */
  yourtal_transfer_id text,
  status              text NOT NULL DEFAULT 'started',
  /* A fixed error code (never free text from FTR or YourTal). */
  error               text,
  /* FTR's pending import, once it accepted the bundle. */
  ftr_import_id       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,

  CONSTRAINT ftr_sends_year CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT ftr_sends_lines CHECK (line_count >= 0),
  CONSTRAINT ftr_sends_hash CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ftr_sends_status CHECK (status IN ('started', 'sent', 'cancelled', 'failed', 'expired')),
  /* The FTR bundle cap is 2 MB (4.6); a longer string is refused here too. */
  CONSTRAINT ftr_sends_bundle_open_only CHECK (
    bundle IS NULL OR (status = 'started' AND length(bundle) <= 2097152)
  ),
  CONSTRAINT ftr_sends_finished CHECK ((status = 'started') = (finished_at IS NULL)),
  CONSTRAINT ftr_sends_import_when_sent CHECK (ftr_import_id IS NULL OR status = 'sent'),
  CONSTRAINT ftr_sends_error_len CHECK (error IS NULL OR length(error) <= 100)
);

-- The per-person rate limit (S2: 5 per 15 minutes) and the user cascade.
CREATE INDEX IF NOT EXISTS ftr_sends_by_user   ON ftr_sends (user_id, created_at DESC);
-- The tenant cascade (and 0014's `*_tenant_idx` idiom).
CREATE INDEX IF NOT EXISTS ftr_sends_by_tenant ON ftr_sends (tenant_id);
-- The sweep: open sends only, oldest first.
CREATE INDEX IF NOT EXISTS ftr_sends_open      ON ftr_sends (created_at) WHERE status = 'started';

ALTER TABLE yourtal_sign_in_flows
  ADD COLUMN IF NOT EXISTS ftr_send_id uuid REFERENCES ftr_sends (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS yourtal_sign_in_flows_ftr_send
  ON yourtal_sign_in_flows (ftr_send_id) WHERE ftr_send_id IS NOT NULL;

-- ── RLS and grants ───────────────────────────────────────────────────────────

ALTER TABLE ftr_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftr_sends FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON ftr_sends;
CREATE POLICY tenant_isolation ON ftr_sends
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The sweep (security-relevant: the only cross-tenant access to this table).
-- It may see and expire an open send older than an hour. Postgres also checks
-- an UPDATE's NEW row against the SELECT policy, so that policy must admit the
-- expired row too (no bundle by then); it admits nothing else.
DROP POLICY IF EXISTS ftr_sends_worker_sweep_read ON ftr_sends;
CREATE POLICY ftr_sends_worker_sweep_read ON ftr_sends
  FOR SELECT TO app_worker
  USING (status IN ('started', 'expired') AND created_at < now() - interval '1 hour');

DROP POLICY IF EXISTS ftr_sends_worker_sweep ON ftr_sends;
CREATE POLICY ftr_sends_worker_sweep ON ftr_sends
  FOR UPDATE TO app_worker
  USING (status = 'started' AND created_at < now() - interval '1 hour')
  WITH CHECK (status = 'expired' AND bundle IS NULL);

-- 0010's default ACL gives app_rw arwd on every new table: revoke, then grant
-- what is meant. Nothing deletes a send except the cascades. No reporting
-- access (tax data).
REVOKE ALL ON ftr_sends FROM app_rw, app_readonly;
GRANT SELECT, INSERT, UPDATE ON ftr_sends TO app_rw;
