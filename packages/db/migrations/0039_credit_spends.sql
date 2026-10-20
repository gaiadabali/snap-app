-- ---------------------------------------------------------------------------
-- 0039 — a scan spends a credit, an unreadable scan gives it back, and only a
--        scan paid with a BOUGHT credit earns YourTal points
--
-- Group plan 7.1.a, 7.1.c and 2.5.f (founder decisions 0.10.b and 0.11).
-- Until now nothing spent a credit: `usage_grants.remaining` only ever went
-- up. From this migration on, `enqueueExtraction` (apps/server/src/repo.ts)
-- takes one credit in the SAME transaction that inserts the capture's
-- extraction job, and writes one `credit_spends` row saying which grant paid.
--
--   Order: free grants first (the signup bonus first among them), then bought
--   ones; oldest `granted_at` first within each, ties by id.
--
--   No usable grant: the row is still written, with grant_id NULL and paid
--   false, and the job is still queued. Refusing a scan when credits run out
--   is 7.1.b, a later ticket.
--
--   Unreadable: when the capture's extraction job ends for good with no
--   document, the worker marks the spend refunded and adds the credit back
--   to its grant, exactly once.
--
-- PAID. A spend is `paid` when its grant is backed by a `credit_purchases`
-- row with status 'paid' (`credit_purchases.grant_id`): a credit somebody
-- bought. The signup bonus, staff grants ('platform_staff:…'), referral and
-- support credits are not bought, and a spend with no grant is not either.
-- Only a paid, unrefunded spend lets a receipt earn YourTal points; any other
-- is recorded in the outbox as `skipped_free` and never sent.
--
-- ONE ROW PER CAPTURE. `capture_id` is unique (partial: it is set to NULL if
-- the capture is ever deleted, and the money record must outlive it). Calling
-- `enqueueExtraction` twice for a capture must never spend twice; the code
-- checks first, under a per-tenant advisory lock, and this index is the final
-- guard: a second row fails the transaction, and with it the second decrement.
--
-- WHO MAY DO WHAT.
--   - The API (app_rw) SELECTs and INSERTs spends in its own tenant. The
--     insert policy recomputes `paid` and `grant_source` from the grant
--     itself, so the API cannot record a free credit as a bought one, and it
--     cannot insert a row that is already refunded.
--   - The worker (app_worker) may additionally UPDATE two columns,
--     `refunded_at` and `refund_reason`, in the tenant it is working in. It
--     needs nothing across tenants: it enters the job's tenant first.
--   - Nobody but the owner may DELETE a spend: it is the money record.
--
-- HOW THE API SPENDS. `app_rw` already holds UPDATE on `usage_grants`: 0010
-- granted SELECT, INSERT, UPDATE, DELETE on every table that existed then,
-- and `usage_grants` (0008) was one of them; nothing has revoked it. So the
-- decrement is an ordinary UPDATE under the table's tenant RLS, inside the
-- caller's own transaction, and no SECURITY DEFINER function is needed. (One
-- would have to be called inside the same transaction anyway, so it would
-- add a second security surface without narrowing anything the existing
-- grant does not already allow.) The worker's refund increment uses the same
-- grant, inherited through app_rw.
--
-- ALSO HERE: a new outbox status, `skipped_free` — never sent, because the
-- scan was paid with a free credit or with none. The 0037 status CHECK and
-- the `yourtal_outbox_self_insert` policy are replaced by supersets that add
-- only that value; nothing else about them changes.
--
-- ADD-ONLY apart from that superset: one new table, its indexes, policies and
-- grants. No existing row is touched.
-- ---------------------------------------------------------------------------

-- ── credit_spends ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_spends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  /* The capture queued for extraction. NULL only once the capture is gone:
     the spend is a money record and outlives it. */
  capture_id    uuid REFERENCES captures (id) ON DELETE SET NULL,
  /* Who captured it. */
  user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  /* The grant the credit came from. NULL when no credit was available (or,
     later, if the grant row was deleted; `grant_source` still says what it
     was). */
  grant_id      uuid REFERENCES usage_grants (id) ON DELETE SET NULL,
  /* A copy of `usage_grants.source` at spend time: 'signup_bonus',
     'topup_pack', 'platform_staff:…', 'referral', 'support_credit'. */
  grant_source  text,
  /* A BOUGHT credit: the grant is backed by a paid `credit_purchases` row. */
  paid          boolean NOT NULL,
  spent_at      timestamptz NOT NULL DEFAULT now(),
  refunded_at   timestamptz,
  refund_reason text,

  CONSTRAINT credit_spends_grant_has_source CHECK (grant_id IS NULL OR grant_source IS NOT NULL),
  CONSTRAINT credit_spends_paid_has_source CHECK (NOT paid OR grant_source IS NOT NULL),
  CONSTRAINT credit_spends_refund_has_reason CHECK ((refunded_at IS NULL) = (refund_reason IS NULL)),
  CONSTRAINT credit_spends_refund_reason CHECK (refund_reason IS NULL OR refund_reason IN (
    'unreadable',    -- the job's last attempt failed: no model could read it
    'not_extracted'  -- the job finished without a document (a statement
                     -- whose original cannot be re-read, or over the page cap)
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_spends_one_per_capture
  ON credit_spends (capture_id)
  WHERE capture_id IS NOT NULL;

-- ON DELETE SET NULL from usage_grants looks rows up by grant.
CREATE INDEX IF NOT EXISTS credit_spends_by_grant
  ON credit_spends (grant_id)
  WHERE grant_id IS NOT NULL;

-- A workspace's spends, newest first (the usage list, 7.1.e).
CREATE INDEX IF NOT EXISTS credit_spends_by_tenant
  ON credit_spends (tenant_id, spent_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE credit_spends ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_spends FORCE  ROW LEVEL SECURITY;

CREATE POLICY credit_spends_tenant_read ON credit_spends
  FOR SELECT
  USING (tenant_id = current_tenant_id());

-- What the spend code writes, and nothing else. The subqueries run under the
-- caller's RLS, so they only ever see this tenant's grants and purchases.
CREATE POLICY credit_spends_tenant_insert ON credit_spends
  FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND refunded_at IS NULL
    AND refund_reason IS NULL
    AND grant_source IS NOT DISTINCT FROM (
      SELECT g.source FROM usage_grants g WHERE g.id = credit_spends.grant_id
    )
    AND paid = (
      credit_spends.grant_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM credit_purchases cp
         WHERE cp.grant_id = credit_spends.grant_id
           AND cp.status = 'paid'
      )
    )
  );

-- The refund. Column grants below limit it to `refunded_at` and `refund_reason`.
CREATE POLICY credit_spends_worker_refund ON credit_spends
  FOR UPDATE TO app_worker
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Grants, narrowed. The default ACL gives app_rw arwd on every new table
-- (0010), so revoke first and grant exactly what is meant. app_readonly keeps
-- SELECT like every other tenant table; RLS still scopes it.
REVOKE ALL ON credit_spends FROM app_rw;
REVOKE ALL ON credit_spends FROM app_readonly;
GRANT SELECT, INSERT ON credit_spends TO app_rw;
GRANT SELECT ON credit_spends TO app_readonly;
GRANT UPDATE (refunded_at, refund_reason) ON credit_spends TO app_worker;

-- ── yourtal_outbox: skipped_free ─────────────────────────────────────────────
-- The 0037 lists plus 'skipped_free'. Nothing else changes.

ALTER TABLE yourtal_outbox DROP CONSTRAINT yourtal_outbox_status;
ALTER TABLE yourtal_outbox ADD CONSTRAINT yourtal_outbox_status CHECK (status IN (
  'pending',      -- waiting for its next attempt
  'sent',         -- 200, a new report
  'duplicate',    -- 200 with duplicate: true — success, nothing new paid
  'refused',      -- a ledger refusal (velocity_capped, ...): final, logged
  'link_broken',  -- 403 link_revoked / 400 unknown_link: the link is marked broken
  'cancelled',    -- its link was unlinked or broken before it was sent
  'failed',       -- any other 4xx: final, logged, needs a person
  'dead',         -- retries exhausted: kept for a person to requeue
  'skipped_duplicate', -- never sent: a likely re-photo of a receipt already
                       -- reported for this user (founder decision 2026-10-20)
  'skipped_free'  -- never sent: the scan was paid with a free credit, or with
                  -- none (founder decision 0.10.b, group plan 2.5.f)
));

DROP POLICY yourtal_outbox_self_insert ON yourtal_outbox;
CREATE POLICY yourtal_outbox_self_insert ON yourtal_outbox
  FOR INSERT TO app_rw
  WITH CHECK (
    user_id = current_user_id()
    AND status IN ('pending', 'skipped_duplicate', 'skipped_free')
    AND attempts = 0
    AND granted IS NULL AND points IS NULL
    AND locked_at IS NULL AND last_http_status IS NULL
    AND EXISTS (
      SELECT 1 FROM yourtal_links l
       WHERE l.id = link_row_id AND l.user_id = current_user_id()
    )
  );

-- ── Self-check ───────────────────────────────────────────────────────────────
-- Fails the migration inside db.mjs's transaction rather than shipping a table
-- that is not protected the way this header says.
DO $$
DECLARE
  bad text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'credit_spends'
       AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS not enabled+forced on credit_spends';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'credit_spends'
       AND indexname = 'credit_spends_one_per_capture'
  ) THEN
    RAISE EXCEPTION 'credit_spends_one_per_capture was not created';
  END IF;

  -- app_rw: read and insert, never change or remove a spend.
  SELECT string_agg(privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE grantee = 'app_rw' AND table_name = 'credit_spends'
     AND privilege_type NOT IN ('SELECT', 'INSERT');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'app_rw holds more than SELECT, INSERT on credit_spends: %', bad;
  END IF;

  -- app_worker: UPDATE on exactly the two refund columns, and no table-wide UPDATE.
  SELECT string_agg(privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE grantee = 'app_worker' AND table_name = 'credit_spends';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'app_worker holds table-wide privileges on credit_spends: %', bad;
  END IF;
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO bad
    FROM information_schema.column_privileges
   WHERE grantee = 'app_worker' AND table_name = 'credit_spends' AND privilege_type = 'UPDATE';
  IF bad IS DISTINCT FROM 'refund_reason, refunded_at' THEN
    RAISE EXCEPTION 'app_worker UPDATE columns on credit_spends are %, expected refund_reason, refunded_at', bad;
  END IF;

  -- The outbox accepts the new status, from the API too.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'yourtal_outbox_status'
       AND pg_get_constraintdef(oid) LIKE '%skipped_free%'
  ) THEN
    RAISE EXCEPTION 'yourtal_outbox_status does not allow skipped_free';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'yourtal_outbox' AND policyname = 'yourtal_outbox_self_insert'
       AND with_check LIKE '%skipped_free%'
  ) THEN
    RAISE EXCEPTION 'yourtal_outbox_self_insert does not allow skipped_free';
  END IF;
END $$;
