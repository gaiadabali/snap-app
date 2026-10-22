-- ---------------------------------------------------------------------------
-- 0041 — a YourTal voucher redeemed for scan credits, exactly once
--
-- Group plan 2.8 (ticket S1). Agreed design: yourtal/docs/28-snapapp-scans-
-- voucher.md, §3 (the flow) and §5 S1 and S4 (the state machine and the key
-- rules). Founder decisions F128: one voucher, A$5 face = 50 scans; only the
-- SnapApp account linked to the YourTal wallet that holds it may redeem it.
--
-- A person types a voucher code; SnapApp authorizes, captures and (on a
-- mismatch or a failure before capture) voids it through YourTal's MERCHANT
-- voucher API, then adds 50 credits to the workspace as a `usage_grants` row
-- with source 'yourtal_voucher'. Each external call carries an
-- Idempotency-Key, and YourTal stores and replays every answer, so the row
-- holds the three keys from the moment it is written: a retry is the same
-- request, never a new one.
--
-- ONE TABLE, TENANT-SCOPED. Credits belong to the workspace the person
-- redeems in (docs/28 D4: owner or admin only), like `credit_purchases`.
--
--   yourtal_voucher_redemptions   one row per attempt to redeem a code. Never
--                                 deleted: it is the money record that says
--                                 why 50 credits exist, or why they do not.
--
-- THE CODE IS NEVER STORED, only its SHA-256 (D6), the same hash YourTal
-- keeps. At most one row per hash may be in progress or granted at a time
-- (partial unique index); a voided, expired, refused, abandoned or failed
-- attempt frees the hash for a new one, with a new `merchant_order_ref`
-- (YourTal: after a void, a retry needs a new order ref).
--
-- WHAT THE DATABASE GUARANTEES, whoever writes:
--   1. Identity is fixed at insert: who, which workspace, which link, which
--      code, the face value, the currency, the credits, the order ref and the
--      three idempotency keys never change. (`user_id` and `link_row_id` may
--      only become NULL, which is their ON DELETE SET NULL.)
--   2. YourTal's answers are write-once: `authorization_id`, `receipt_id` and
--      `grant_id` go from NULL to a value and never change after.
--   3. Status moves only along the machine in docs/28 §5 S1; the finals
--      (granted, voided, expired, refused, abandoned, failed) never move.
--   4. `granted` <=> `grant_id` is set; `captured` and `granted` need a
--      `receipt_id` (a capture counts only once YourTal has receipted it).
--   5. The grant a redemption points at is a 'yourtal_voucher' grant in the
--      same workspace for exactly the redemption's credits.
--   6. Conversely, a 'yourtal_voucher' grant can only COMMIT if exactly one
--      granted redemption points at it with the same credits (a deferred
--      constraint trigger on `usage_grants`). Nobody can mint voucher credits
--      without a captured, receipted voucher behind them, and no voucher can
--      back two grants (`grant_id` is unique).
--   Every other `usage_grants` source (topup_pack, signup_bonus,
--   platform_staff:…, referral, support_credit) is untouched: the triggers'
--   WHEN clauses skip them before any function runs, and spending or
--   refunding a credit (an UPDATE of `remaining` only) fires nothing.
--
-- WHO MAY DO WHAT.
--   - The API (app_rw) SELECTs and UPDATEs its own workspace's rows: it moves
--     a redemption authorizing → authorized → capturing → captured → granted
--     in the request path. It may INSERT only a fresh `authorizing` row, in
--     its current workspace, for itself, against its own live link, as an
--     owner or admin of that workspace, with no YourTal answer filled in. Its
--     UPDATE is limited by column grants to the progress columns: identity
--     cannot even be named in a SET. Never DELETE.
--   - The worker (app_worker) drains unfinished rows ACROSS workspaces (a
--     queue, the `yourtal_outbox` / `jobs` pattern): a FOR ALL policy, with
--     the privileges it inherits from app_rw. To grant credits it must still
--     enter the row's workspace, because `usage_grants` stays tenant-scoped
--     and guarantee 5 reads the grant under the caller's RLS.
--   - Nobody but the owner may DELETE a redemption. A workspace deleted with
--     its tenant row takes its redemptions with it (CASCADE, as
--     `credit_purchases` does).
--
-- ADD-ONLY: one new table, its indexes, two trigger functions, three
-- triggers (one on this table, two constraint triggers on `usage_grants`
-- that fire only for source 'yourtal_voucher'), policies and grants. No
-- existing row is touched, and no existing policy or grant is changed.
-- ---------------------------------------------------------------------------

-- ── yourtal_voucher_redemptions ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS yourtal_voucher_redemptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* Who typed the code. Kept even if the person later goes (SET NULL): the
     money record outlives them. */
  user_id            uuid REFERENCES users (id) ON DELETE SET NULL,
  /* The workspace the credits go to (D4). */
  tenant_id          uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  /* The YourTal link the ownership read was made under. */
  link_row_id        uuid REFERENCES yourtal_links (id) ON DELETE SET NULL,
  /* SHA-256 of the normalised code, lowercase hex. NEVER the code (D6). */
  code_sha256        char(64) NOT NULL,
  /* The voucher's face value in minor units (cents). D8: only 500. */
  face_minor         integer NOT NULL,
  currency           text NOT NULL DEFAULT 'AUD',
  /* The scans this redemption grants. D8: 500 → 50. */
  credits            integer NOT NULL,
  /* Ours, sent with authorize: `snap-<id>`. One authorization per order on
     YourTal's side, and the key the order lookup resolves. */
  merchant_order_ref text NOT NULL UNIQUE,
  /* One Idempotency-Key per call, written before its first send and reused
     on every retry (S4). */
  authorize_key      uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  capture_key        uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  void_key           uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  /* YourTal's answers. Write-once (the trigger below). */
  authorization_id   text UNIQUE,
  hold_expires_at    timestamptz,
  capture_sent_at    timestamptz,
  receipt_id         text UNIQUE,
  /* The credits. Write-once; NO ACTION on delete, so a voucher grant cannot
     be removed while its redemption names it. */
  grant_id           uuid UNIQUE REFERENCES usage_grants (id),
  status             text NOT NULL DEFAULT 'authorizing',
  /* The drain's bookkeeping, the `yourtal_outbox` shape. */
  attempts           integer NOT NULL DEFAULT 0,
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  locked_at          timestamptz,
  locked_by          text,
  /* What YourTal last said, for an operator. Never a request body, a
     header or the code. */
  last_http_status   integer,
  last_code          text,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,

  CONSTRAINT yourtal_voucher_redemptions_hash CHECK (code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT yourtal_voucher_redemptions_face CHECK (face_minor > 0),
  CONSTRAINT yourtal_voucher_redemptions_currency CHECK (currency = 'AUD'),
  CONSTRAINT yourtal_voucher_redemptions_credits CHECK (credits > 0),
  CONSTRAINT yourtal_voucher_redemptions_order_ref CHECK (length(merchant_order_ref) BETWEEN 1 AND 200),
  CONSTRAINT yourtal_voucher_redemptions_keys_distinct CHECK (
    authorize_key <> capture_key AND authorize_key <> void_key AND capture_key <> void_key
  ),
  CONSTRAINT yourtal_voucher_redemptions_attempts CHECK (attempts >= 0),
  CONSTRAINT yourtal_voucher_redemptions_status CHECK (status IN (
    'authorizing',  -- row written and committed; authorize not yet answered
    'authorized',   -- a live hold for the full face value
    'capturing',    -- capture sent (or about to be); outcome not yet known
    'captured',     -- YourTal receipted the capture; credits not yet granted
    'voiding',      -- void sent (or about to be); outcome not yet known
    'granted',      -- FINAL: the credits exist (grant_id)
    'voided',       -- FINAL: the hold was released; nothing taken
    'expired',      -- FINAL: the hold lapsed; nothing taken
    'refused',      -- FINAL: YourTal refused the authorize
    'abandoned',    -- FINAL: a lost authorize that the lookup never found
    'failed',       -- FINAL: any other refusal, logged
    'needs_review'  -- a person must decide (stuck 3 days, or the grant
                    -- could not be written for 24 h)
  )),
  -- Guarantee 4.
  CONSTRAINT yourtal_voucher_redemptions_granted_has_grant CHECK (
    (status = 'granted') = (grant_id IS NOT NULL)
  ),
  CONSTRAINT yourtal_voucher_redemptions_captured_has_receipt CHECK (
    status NOT IN ('captured', 'granted') OR receipt_id IS NOT NULL
  )
);

-- One redemption in progress or granted per code. The finals that took
-- nothing free the hash for a fresh attempt.
CREATE UNIQUE INDEX IF NOT EXISTS yourtal_voucher_redemptions_one_live_per_code
  ON yourtal_voucher_redemptions (code_sha256)
  WHERE status IN ('authorizing', 'authorized', 'capturing', 'captured', 'voiding', 'granted', 'needs_review');

-- The drain's query: unfinished rows by due time. The predicate is "not
-- final", so a query must say `status NOT IN (<the six finals>)` to use it.
CREATE INDEX IF NOT EXISTS yourtal_voucher_redemptions_due
  ON yourtal_voucher_redemptions (next_attempt_at)
  WHERE status NOT IN ('granted', 'voided', 'expired', 'refused', 'abandoned', 'failed');

-- A workspace's redemptions, newest first (the status endpoint's history).
CREATE INDEX IF NOT EXISTS yourtal_voucher_redemptions_by_tenant
  ON yourtal_voucher_redemptions (tenant_id, created_at DESC);

-- ON DELETE SET NULL from users and yourtal_links looks rows up by these.
CREATE INDEX IF NOT EXISTS yourtal_voucher_redemptions_by_user
  ON yourtal_voucher_redemptions (user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS yourtal_voucher_redemptions_by_link
  ON yourtal_voucher_redemptions (link_row_id)
  WHERE link_row_id IS NOT NULL;

-- ── Guarantees 1, 2, 3 and 5: the row guard ──────────────────────────────────
-- SECURITY INVOKER on purpose: the grant lookup in guarantee 5 runs under the
-- caller's RLS, so it can only ever see fewer grants and fail closed.

CREATE OR REPLACE FUNCTION yourtal_voucher_redemptions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  g_tenant  uuid;
  g_amount  integer;
  g_source  text;
  allowed   text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- 1. Identity.
    IF NEW.id                 IS DISTINCT FROM OLD.id
    OR NEW.tenant_id          IS DISTINCT FROM OLD.tenant_id
    OR NEW.code_sha256        IS DISTINCT FROM OLD.code_sha256
    OR NEW.face_minor         IS DISTINCT FROM OLD.face_minor
    OR NEW.currency           IS DISTINCT FROM OLD.currency
    OR NEW.credits            IS DISTINCT FROM OLD.credits
    OR NEW.merchant_order_ref IS DISTINCT FROM OLD.merchant_order_ref
    OR NEW.authorize_key      IS DISTINCT FROM OLD.authorize_key
    OR NEW.capture_key        IS DISTINCT FROM OLD.capture_key
    OR NEW.void_key           IS DISTINCT FROM OLD.void_key
    OR NEW.created_at         IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'yourtal_voucher_redemptions %: identity columns (tenant, code hash, face, currency, credits, order ref, keys, created_at) never change', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    -- user_id and link_row_id: only their ON DELETE SET NULL.
    IF NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'yourtal_voucher_redemptions %: user_id never changes (it may only become NULL when the user is deleted)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.link_row_id IS DISTINCT FROM OLD.link_row_id AND NEW.link_row_id IS NOT NULL THEN
      RAISE EXCEPTION 'yourtal_voucher_redemptions %: link_row_id never changes (it may only become NULL when the link is deleted)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;

    -- 2. Write-once answers.
    IF OLD.authorization_id IS NOT NULL AND NEW.authorization_id IS DISTINCT FROM OLD.authorization_id THEN
      RAISE EXCEPTION 'yourtal_voucher_redemptions %: authorization_id is write-once', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.receipt_id IS NOT NULL AND NEW.receipt_id IS DISTINCT FROM OLD.receipt_id THEN
      RAISE EXCEPTION 'yourtal_voucher_redemptions %: receipt_id is write-once', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.grant_id IS NOT NULL AND NEW.grant_id IS DISTINCT FROM OLD.grant_id THEN
      RAISE EXCEPTION 'yourtal_voucher_redemptions %: grant_id is write-once', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;

    -- 3. The status machine (docs/28 §5 S1). Staying put is always allowed.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      allowed := CASE OLD.status
        WHEN 'authorizing'  THEN ARRAY['authorized', 'captured', 'voided', 'expired', 'refused', 'abandoned', 'failed']
        WHEN 'authorized'   THEN ARRAY['capturing', 'voiding', 'captured', 'expired']
        WHEN 'capturing'    THEN ARRAY['captured', 'voiding', 'voided', 'expired', 'needs_review']
        WHEN 'captured'     THEN ARRAY['granted', 'needs_review']
        WHEN 'voiding'      THEN ARRAY['voided', 'expired', 'captured']
        WHEN 'needs_review' THEN ARRAY['captured', 'granted', 'voided', 'expired']
        ELSE ARRAY[]::text[]  -- granted, voided, expired, refused, abandoned, failed
      END;
      IF NOT (NEW.status = ANY (allowed)) THEN
        RAISE EXCEPTION 'yourtal_voucher_redemptions %: status may not move from % to %', OLD.id, OLD.status, NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- 5. The grant named is this redemption's: a 'yourtal_voucher' grant in the
  --    same workspace for exactly these credits. Checked whenever grant_id is
  --    first set, on INSERT too (the worker's policy would otherwise let it
  --    insert a row that names any grant).
  IF NEW.grant_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.grant_id IS NULL) THEN
    SELECT g.tenant_id, g.amount, g.source
      INTO g_tenant, g_amount, g_source
      FROM usage_grants g
     WHERE g.id = NEW.grant_id;
    IF NOT FOUND
       OR g_source IS DISTINCT FROM 'yourtal_voucher'
       OR g_tenant IS DISTINCT FROM NEW.tenant_id
       OR g_amount IS DISTINCT FROM NEW.credits
    THEN
      RAISE EXCEPTION 'yourtal_voucher_redemptions %: grant % is not a yourtal_voucher grant of % credits in this workspace', NEW.id, NEW.grant_id, NEW.credits
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS yourtal_voucher_redemptions_guard ON yourtal_voucher_redemptions;
CREATE TRIGGER yourtal_voucher_redemptions_guard
  BEFORE INSERT OR UPDATE ON yourtal_voucher_redemptions
  FOR EACH ROW EXECUTE FUNCTION yourtal_voucher_redemptions_guard();

-- ── Guarantee 6: a voucher grant commits only with its redemption ────────────
-- Deferred to COMMIT, so the grant can be inserted first and the redemption
-- marked granted after it in the same transaction (the FK needs that order).
--
-- It checks the row as the triggering statement left it (NEW), never a
-- re-read: every INSERT and every UPDATE of these columns queues its own
-- check, so the last one always sees the final state, and no re-read can be
-- hidden by RLS into a pass. The redemption count runs under the caller's
-- RLS too, which can only hide rows and so only fail closed.

CREATE OR REPLACE FUNCTION usage_grants_yourtal_voucher_backed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.source = 'yourtal_voucher'
     AND NEW.source IS DISTINCT FROM 'yourtal_voucher' THEN
    RAISE EXCEPTION 'usage_grants %: a yourtal_voucher grant keeps its source', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.source IS DISTINCT FROM 'yourtal_voucher' THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO n
    FROM yourtal_voucher_redemptions r
   WHERE r.grant_id  = NEW.id
     AND r.status    = 'granted'
     AND r.credits   = NEW.amount
     AND r.tenant_id = NEW.tenant_id;

  IF n <> 1 THEN
    RAISE EXCEPTION 'usage_grants %: a yourtal_voucher grant of % credits needs exactly one granted redemption naming it with the same credits (found %)', NEW.id, NEW.amount, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS usage_grants_yourtal_voucher_backed_insert ON usage_grants;
CREATE CONSTRAINT TRIGGER usage_grants_yourtal_voucher_backed_insert
  AFTER INSERT ON usage_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.source = 'yourtal_voucher')
  EXECUTE FUNCTION usage_grants_yourtal_voucher_backed();

-- `remaining` is deliberately not in the column list: spending and refunding
-- a credit fire nothing.
DROP TRIGGER IF EXISTS usage_grants_yourtal_voucher_backed_update ON usage_grants;
CREATE CONSTRAINT TRIGGER usage_grants_yourtal_voucher_backed_update
  AFTER UPDATE OF id, tenant_id, amount, source ON usage_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.source = 'yourtal_voucher' OR NEW.source = 'yourtal_voucher')
  EXECUTE FUNCTION usage_grants_yourtal_voucher_backed();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE yourtal_voucher_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yourtal_voucher_redemptions FORCE  ROW LEVEL SECURITY;

CREATE POLICY yourtal_voucher_redemptions_tenant_read ON yourtal_voucher_redemptions
  FOR SELECT TO app_rw
  USING (tenant_id = current_tenant_id());

-- What step 5 of the flow writes, and nothing else. The subqueries run under
-- the caller's RLS: `yourtal_links` shows only the caller's own links, and
-- `memberships` only this workspace's.
CREATE POLICY yourtal_voucher_redemptions_tenant_insert ON yourtal_voucher_redemptions
  FOR INSERT TO app_rw
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND user_id = current_user_id()
    AND status = 'authorizing'
    AND authorization_id IS NULL
    AND receipt_id IS NULL
    AND grant_id IS NULL
    AND hold_expires_at IS NULL
    AND capture_sent_at IS NULL
    AND attempts = 0
    AND last_http_status IS NULL
    AND last_code IS NULL
    AND last_error IS NULL
    AND finished_at IS NULL
    AND EXISTS (
      SELECT 1 FROM yourtal_links l
       WHERE l.id = link_row_id
         AND l.user_id = current_user_id()
         AND l.revoked_at IS NULL
         AND l.broken_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.tenant_id = current_tenant_id()
         AND m.user_id = current_user_id()
         AND m.role IN ('owner', 'admin')
    )
  );

-- The request path's progress. Column grants below keep it to the progress
-- columns; the guard trigger keeps it to legal moves.
CREATE POLICY yourtal_voucher_redemptions_tenant_update ON yourtal_voucher_redemptions
  FOR UPDATE TO app_rw
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- The drain: every row, because it is a queue consumer.
CREATE POLICY yourtal_voucher_redemptions_worker ON yourtal_voucher_redemptions
  FOR ALL TO app_worker
  USING (true)
  WITH CHECK (true);

-- Grants, narrowed at both layers. The default ACL (0010) gives app_rw arwd
-- and app_readonly SELECT on every new table, so revoke first and grant
-- exactly what is meant. app_worker inherits app_rw's and needs nothing more.
REVOKE ALL ON yourtal_voucher_redemptions FROM app_rw;
REVOKE ALL ON yourtal_voucher_redemptions FROM app_readonly;
REVOKE ALL ON yourtal_voucher_redemptions FROM app_worker;
GRANT SELECT, INSERT ON yourtal_voucher_redemptions TO app_rw;
GRANT UPDATE (
  status,
  authorization_id, hold_expires_at, capture_sent_at, receipt_id, grant_id,
  attempts, next_attempt_at, locked_at, locked_by,
  last_http_status, last_code, last_error, finished_at
) ON yourtal_voucher_redemptions TO app_rw;

-- ── Self-check ───────────────────────────────────────────────────────────────
-- Fails the migration inside db.mjs's transaction rather than shipping a table
-- that is not protected the way this header says.
DO $$
DECLARE
  bad text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'yourtal_voucher_redemptions'
       AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS not enabled+forced on yourtal_voucher_redemptions';
  END IF;

  -- No application role may delete, and only app_rw holds table-wide
  -- privileges: SELECT and INSERT.
  SELECT string_agg(grantee || ':' || privilege_type, ', ') INTO bad
    FROM information_schema.table_privileges
   WHERE table_name = 'yourtal_voucher_redemptions'
     AND grantee IN ('app_rw', 'app_worker', 'app_readonly', 'app_platform', 'app_identity')
     AND NOT (grantee = 'app_rw' AND privilege_type IN ('SELECT', 'INSERT'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'yourtal_voucher_redemptions grants more than intended: %', bad;
  END IF;

  -- app_rw's UPDATE is exactly the progress columns: no identity column, no key.
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO bad
    FROM information_schema.column_privileges
   WHERE grantee = 'app_rw' AND table_name = 'yourtal_voucher_redemptions'
     AND privilege_type = 'UPDATE';
  IF bad IS DISTINCT FROM
     'attempts, authorization_id, capture_sent_at, finished_at, grant_id, hold_expires_at, last_code, last_error, last_http_status, locked_at, locked_by, next_attempt_at, receipt_id, status'
  THEN
    RAISE EXCEPTION 'app_rw UPDATE columns on yourtal_voucher_redemptions are %', bad;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'yourtal_voucher_redemptions'
       AND indexname = 'yourtal_voucher_redemptions_one_live_per_code'
  ) THEN
    RAISE EXCEPTION 'yourtal_voucher_redemptions_one_live_per_code was not created';
  END IF;

  -- The guard, and both deferred constraint triggers on usage_grants.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'yourtal_voucher_redemptions'::regclass
       AND tgname = 'yourtal_voucher_redemptions_guard' AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'yourtal_voucher_redemptions_guard trigger missing or disabled';
  END IF;
  SELECT string_agg(t.name, ', ') INTO bad
    FROM unnest(ARRAY['usage_grants_yourtal_voucher_backed_insert',
                      'usage_grants_yourtal_voucher_backed_update']) AS t(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_trigger tg
      WHERE tg.tgrelid = 'usage_grants'::regclass
        AND tg.tgname = t.name
        AND tg.tgenabled = 'O'
        AND tg.tgconstraint <> 0
        AND tg.tgdeferrable AND tg.tginitdeferred
   );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'deferred constraint triggers missing on usage_grants: %', bad;
  END IF;
END $$;
