-- ---------------------------------------------------------------------------
-- 0049 — ftr_sends: SnapApp sends a deduction bundle to Free Tax Returns
--
-- Group task 4.8.a, ticket S1 (yourtal/docs/30-snapapp-to-ftr-direct-send.md
-- §6). One row per "Send to Free Tax Returns" a person starts. S2 adds the
-- endpoints; this is the table, the sign-in flow's link to it, and the function
-- the worker's sweep (every 5 minutes) calls.
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
-- API, and nothing else: the worker has NO policy on this table. Its sweep goes through ftr_sends_expire_stale(), a SECURITY DEFINER function
-- owned by app_erasure (0043's idiom) that runs one fixed UPDATE. A policy
-- cannot do that job: WITH CHECK sees only the new row, so a worker policy
-- that lets it expire a send also lets it rewrite tenant_id and every other
-- column in the same statement (found in review of the first draft).
--
-- ERASURE (0043). Both foreign keys cascade, so erase_person and
-- erase_workspace need no change: the tenant's rows go with the workspace, a
-- person's with the person. `yourtal_sign_in_flows.ftr_send_id` cascades too,
-- so a flow never outlives its send. That is a foreign key from a table with
-- no tenant_id to one with it, which 0043's pinned-FK test lists on purpose.
--
-- ADD-ONLY: a table, a nullable column, indexes, a trigger, a function, grants.
-- Reverse: DROP FUNCTION ftr_sends_expire_stale(); DROP TABLE ftr_sends CASCADE
-- (drops the flow FK and the trigger, not the column or its function);
-- DROP FUNCTION ftr_sends_closed_is_final(); ALTER TABLE yourtal_sign_in_flows
-- DROP COLUMN ftr_send_id.
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
  /* The FTR bundle cap is 2 MB (4.6): BYTES, not characters. */
  CONSTRAINT ftr_sends_bundle_open_only CHECK (
    bundle IS NULL OR (status = 'started' AND octet_length(bundle) <= 2097152)
  ),
  /* The bytes held are the bytes hashed: the assertion at YourTal is bound to this hash. */
  CONSTRAINT ftr_sends_bundle_hash CHECK (
    bundle IS NULL OR encode(sha256(convert_to(bundle, 'UTF8')), 'hex') = bundle_sha256
  ),
  CONSTRAINT ftr_sends_finished CHECK ((status = 'started') = (finished_at IS NULL)),
  CONSTRAINT ftr_sends_finished_after_created CHECK (finished_at IS NULL OR finished_at >= created_at),
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

-- A closed send is final. The API (app_rw) holds UPDATE, so without this it
-- could reopen a `sent` send with new bytes. S2 still closes with
-- `UPDATE ... WHERE id = $1 AND status = 'started'` and checks the row count.
CREATE OR REPLACE FUNCTION ftr_sends_closed_is_final() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status <> 'started' THEN
    RAISE EXCEPTION 'ftr_sends: a closed send (%) cannot be changed', OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS ftr_sends_closed_is_final ON ftr_sends;
CREATE TRIGGER ftr_sends_closed_is_final BEFORE UPDATE ON ftr_sends
  FOR EACH ROW EXECUTE FUNCTION ftr_sends_closed_is_final();

-- The worker's sweep (SECURITY-RELEVANT: the only cross-tenant access to this
-- table, and it is write-only for one fixed statement). The first draft gave
-- app_worker two policies; both are dropped (this file is unmerged, the DROP
-- covers a database that applied that draft).
DROP POLICY IF EXISTS ftr_sends_worker_sweep_read ON ftr_sends;
DROP POLICY IF EXISTS ftr_sends_worker_sweep ON ftr_sends;

-- app_erasure is 0043's BYPASSRLS, NOLOGIN owner of the cross-tenant functions.
-- Only the columns the one statement reads and writes.
GRANT SELECT (id, status, created_at), UPDATE (bundle, status, finished_at) ON ftr_sends TO app_erasure;

-- An open send older than an hour loses its bytes and is closed as expired.
-- Idempotent; returns the number expired.
CREATE OR REPLACE FUNCTION ftr_sends_expire_stale() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  n integer;
BEGIN
  UPDATE ftr_sends SET bundle = NULL, status = 'expired', finished_at = now()
   WHERE status = 'started' AND created_at < now() - interval '1 hour';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION ftr_sends_expire_stale() FROM PUBLIC;
ALTER FUNCTION ftr_sends_expire_stale() OWNER TO app_erasure;
GRANT EXECUTE ON FUNCTION ftr_sends_expire_stale() TO app_worker;
COMMENT ON FUNCTION ftr_sends_expire_stale() IS
  'Expires FTR sends still open after an hour and clears their bundle bytes. Executable by app_worker only. 0049, docs/30 section 10.';

-- S2 NOTE (review finding 8): app_identity can set yourtal_sign_in_flows.ftr_send_id
-- to ANY workspace's send (a foreign-key check ignores RLS). So the send finish
-- must load the send as app_rw under the session's tenant and match user_id to
-- the session, never trusting flow.ftr_send_id alone; and refuse a send whose
-- created_at is over an hour old whether or not the sweep has run.

-- 0010's default ACL gives app_rw arwd on every new table: revoke, then grant
-- what is meant. app_worker inherits app_rw's grants but, with no policy and no
-- workspace, sees and changes no row. Nothing deletes a send except the cascades. No reporting
-- access (tax data).
REVOKE ALL ON ftr_sends FROM app_rw, app_readonly;
GRANT SELECT, INSERT, UPDATE ON ftr_sends TO app_rw;
