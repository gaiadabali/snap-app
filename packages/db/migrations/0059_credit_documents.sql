-- 0059 — receipts and tax invoices for credit purchases (group tasks 7.7.a, 7.7.b, 6.12.b).
--
-- Snap Apps charges GST (founder, 2026-11-11), but the company and its ABN do
-- not exist yet. So everything here works today with NO ABN and flips to real
-- tax invoices purely by configuration: an issuer record (legal name, ABN,
-- address, email, GST registered yes/no) that two admins must agree on.
--
-- ── 1. The issuer: propose, then a SECOND admin approves ─────────────────────
--
-- `invoice_issuer_changes` is one row per proposal; the current issuer is the
-- latest `approved` row. It is a platform table like `platform_settings`
-- (0021): RLS forced with no policy, no grant to app_rw, reachable only through
-- the SECURITY DEFINER functions below, each of which checks the caller's
-- capability (`manage_platform_settings`) from inside Postgres.
--   - the proposer cannot approve their own change: refused in the function
--     (42501) AND by a CHECK, so a future function cannot forget;
--   - one pending proposal at a time (a partial unique index);
--   - a decided row never changes (trigger), so history is the audit trail;
--     each step also writes `audit_log`.
-- `gst_registered` needs a valid ABN, and the ABN uses the real ATO check-digit
-- algorithm (`abn_is_valid`, 0001).
--
-- ── 2. The documents ────────────────────────────────────────────────────────
--
-- `credit_documents`: one row per document, tenant-scoped, RLS like
-- credit_purchases. app_rw can only READ them. They are written by
-- `credit_document_issue`, a SECURITY DEFINER function the purchase code calls
-- INSIDE the transaction that marks the purchase paid (or refunded).
--   - Exactly one per purchase and direction: UNIQUE (purchase_id, direction),
--     and the function returns the existing one first, so a replayed webhook
--     issues nothing new.
--   - Gap-free numbering: one counter row, incremented with UPDATE ... RETURNING
--     in the same transaction as the insert. A rollback rolls the counter back
--     with it, so no number is ever skipped; the row lock makes concurrent
--     issuers queue, which at one purchase at a time is not a cost. (A
--     Postgres SEQUENCE is NOT gap-free: nextval survives a rollback.)
--   - An immutable snapshot of the issuer on each document (`issuer`), so a
--     later setting change never rewrites an old document. A refund follows
--     the ORIGINAL's snapshot and kind: a tax invoice is adjusted by an
--     "Adjustment note", a receipt by a "Refund receipt".
--   - Money is integer cents. GST is 1/11 of the GST-inclusive total, rounded
--     to the cent ((total + 5) / 11 in integer arithmetic; a refund negates the
--     original's GST exactly).
--   - Google Play and Apple purchases get no document: the store issues it.
--
-- ── 3. The GST report ───────────────────────────────────────────────────────
--
-- `admin_gst_report(from, to)` (capability `manage_billing`) returns the
-- documents issued in the range (dates in Australia/Sydney) and, separately,
-- the Play sales, whose GST Google pays.
--
-- Erasure: documents SURVIVE it (the ATO requires tax records kept five years;
-- APP 11.2). tenant_id and purchase_id go NULL; number, amounts, GST, kind, pack,
-- issuer snapshot and buyer fields stay.
--
-- Reverse: DROP the functions, then the tables credit_documents,
-- credit_document_counter, invoice_issuer_changes. Add-only otherwise.

-- ── Issuer changes ──────────────────────────────────────────────────────────

CREATE TABLE invoice_issuer_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name      text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  /* Eleven digits, no spaces; NULL until the company has one. */
  abn             text CHECK (abn IS NULL OR (abn ~ '^[0-9]{11}$' AND abn_is_valid(abn))),
  address         text NOT NULL CHECK (length(btrim(address)) BETWEEN 1 AND 500),
  email           text NOT NULL CHECK (length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  gst_registered  boolean NOT NULL,
  reason          text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  proposed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  proposed_at     timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  CONSTRAINT issuer_gst_needs_abn CHECK (NOT gst_registered OR abn IS NOT NULL),
  CONSTRAINT issuer_decided_consistent CHECK ((status = 'pending') = (decided_at IS NULL)),
  /* Null-safe on purpose: erasing a staff user nulls these (ON DELETE SET NULL). */
  CONSTRAINT issuer_no_self_approval CHECK (status <> 'approved' OR decided_by IS NULL OR proposed_by IS NULL OR decided_by <> proposed_by)
);
CREATE UNIQUE INDEX invoice_issuer_one_pending ON invoice_issuer_changes ((true)) WHERE status = 'pending';
CREATE INDEX invoice_issuer_current_idx ON invoice_issuer_changes (decided_at DESC) WHERE status = 'approved';

CREATE OR REPLACE FUNCTION invoice_issuer_changes_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.legal_name IS DISTINCT FROM OLD.legal_name OR NEW.abn IS DISTINCT FROM OLD.abn
     OR NEW.address IS DISTINCT FROM OLD.address OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.gst_registered IS DISTINCT FROM OLD.gst_registered OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.proposed_at IS DISTINCT FROM OLD.proposed_at THEN
    RAISE EXCEPTION 'invoice_issuer_changes: a proposal cannot be edited' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'pending' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.decided_at IS DISTINCT FROM OLD.decided_at) THEN
    RAISE EXCEPTION 'invoice_issuer_changes: a decided proposal is final' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER invoice_issuer_changes_guard BEFORE UPDATE ON invoice_issuer_changes
  FOR EACH ROW EXECUTE FUNCTION invoice_issuer_changes_guard();

-- ── The gap-free counter ────────────────────────────────────────────────────

CREATE TABLE credit_document_counter (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_number  bigint NOT NULL CHECK (last_number >= 0)
);
INSERT INTO credit_document_counter (id, last_number) VALUES (true, 0);

-- ── The documents ───────────────────────────────────────────────────────────

CREATE TABLE credit_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* NULL once the workspace is erased: the document is the seller's tax record and is kept. */
  tenant_id        uuid REFERENCES tenants(id) ON DELETE SET NULL,
  purchase_id      uuid REFERENCES credit_purchases(id) ON DELETE SET NULL,
  direction        text NOT NULL CHECK (direction IN ('sale', 'refund')),
  kind             text NOT NULL CHECK (kind IN ('tax_invoice', 'receipt', 'adjustment_note', 'refund_receipt')),
  /* The gap-free sequence, shown as SNAP-000001. */
  number           bigint NOT NULL UNIQUE CHECK (number > 0),
  issued_at        timestamptz NOT NULL DEFAULT now(),
  /* A refund names the document it adjusts (NULL for a purchase that had none). */
  original_number  bigint,
  pack_code        text NOT NULL,
  credits          int NOT NULL CHECK (credits > 0),
  /* GST-inclusive, in cents: negative on a refund. */
  total_cents      bigint NOT NULL,
  /* NULL unless the document is a tax invoice or adjustment note. */
  gst_cents        bigint,
  /* Who issued it, as it stood at the time (immutable). NULL when no issuer was approved yet. */
  issuer           jsonb,
  buyer_name       text NOT NULL,
  buyer_email      text,
  provider         text NOT NULL,
  CONSTRAINT credit_documents_kind_direction CHECK (
    (direction = 'sale' AND kind IN ('tax_invoice', 'receipt'))
    OR (direction = 'refund' AND kind IN ('adjustment_note', 'refund_receipt'))),
  CONSTRAINT credit_documents_sign CHECK (
    (direction = 'sale' AND total_cents >= 0 AND (gst_cents IS NULL OR gst_cents >= 0))
    OR (direction = 'refund' AND total_cents <= 0 AND (gst_cents IS NULL OR gst_cents <= 0))),
  CONSTRAINT credit_documents_gst_only_on_tax_kinds CHECK (
    (kind IN ('tax_invoice', 'adjustment_note')) = (gst_cents IS NOT NULL)),
  CONSTRAINT credit_documents_tax_has_issuer CHECK (
    kind NOT IN ('tax_invoice', 'adjustment_note') OR (issuer IS NOT NULL AND issuer->>'abn' IS NOT NULL)),
  CONSTRAINT credit_documents_original_only_on_refund CHECK (direction = 'refund' OR original_number IS NULL)
);
CREATE UNIQUE INDEX credit_documents_one_per_purchase ON credit_documents (purchase_id, direction);
CREATE INDEX credit_documents_tenant_idx ON credit_documents (tenant_id, issued_at DESC);
CREATE INDEX credit_documents_issued_idx ON credit_documents (issued_at);

CREATE OR REPLACE FUNCTION credit_documents_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- The one change allowed: erasing the workspace (or its purchase) detaches the
  -- document (ON DELETE SET NULL). Everything the tax record needs stays.
  IF (NEW.tenant_id IS NULL OR NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id)
     AND (NEW.purchase_id IS NULL OR NEW.purchase_id IS NOT DISTINCT FROM OLD.purchase_id)
     AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.purchase_id IS DISTINCT FROM OLD.purchase_id)
     AND (NEW.id, NEW.direction, NEW.kind, NEW.number, NEW.issued_at, NEW.original_number, NEW.pack_code, NEW.credits,
          NEW.total_cents, NEW.gst_cents, NEW.issuer, NEW.buyer_name, NEW.buyer_email, NEW.provider)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.direction, OLD.kind, OLD.number, OLD.issued_at, OLD.original_number, OLD.pack_code, OLD.credits,
          OLD.total_cents, OLD.gst_cents, OLD.issuer, OLD.buyer_name, OLD.buyer_email, OLD.provider) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'credit_documents: an issued document cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
END $fn$;
CREATE TRIGGER credit_documents_immutable BEFORE UPDATE ON credit_documents
  FOR EACH ROW EXECUTE FUNCTION credit_documents_immutable();

-- ── RLS and grants ──────────────────────────────────────────────────────────

ALTER TABLE invoice_issuer_changes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_issuer_changes  FORCE  ROW LEVEL SECURITY;
ALTER TABLE credit_document_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_document_counter FORCE  ROW LEVEL SECURITY;
ALTER TABLE credit_documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_documents        FORCE  ROW LEVEL SECURITY;

-- Platform tables: no policy at all (as 0021). app_platform bypasses RLS.
-- Tenant table: a workspace reads its own documents and can write none. A document
-- whose workspace was erased has tenant_id NULL and matches no tenant: only the
-- admin GST report (SECURITY DEFINER) reads it.
DROP POLICY IF EXISTS tenant_isolation ON credit_documents;
CREATE POLICY tenant_isolation ON credit_documents
  FOR SELECT
  USING (tenant_id IS NOT NULL AND tenant_id = current_tenant_id());

REVOKE ALL ON invoice_issuer_changes, credit_document_counter, credit_documents FROM app_rw, app_readonly;
GRANT SELECT ON credit_documents TO app_rw;

GRANT SELECT, INSERT, UPDATE ON invoice_issuer_changes TO app_platform;
GRANT SELECT, UPDATE ON credit_document_counter TO app_platform;
GRANT SELECT, INSERT ON credit_documents TO app_platform;
GRANT SELECT ON credit_purchases TO app_platform;

-- erase_workspace's spill-over guard reads both ends of every id-only FK between
-- workspace tables (0043): credit_documents -> credit_purchases is one.
GRANT SELECT ON credit_documents TO app_erasure;

-- ── Issuing a document (called inside the purchase transaction) ─────────────
--
-- The caller (credits.repo.ts) holds the purchase row FOR UPDATE and has just
-- set it paid (direction 'sale') or refunded ('refund'); the unique index is
-- the backstop. Runs as app_platform (BYPASSRLS) but is pinned to the CALLER's
-- workspace: current_tenant_id() must own the purchase.
-- Returns the document number, or NULL when none is due (a store-issued purchase).

CREATE OR REPLACE FUNCTION credit_document_issue(p_purchase_id uuid, p_direction text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tenant  uuid := current_tenant_id();
  p         record;
  iss       record;
  orig      record;
  v_tax     boolean;
  v_total   bigint;
  v_gst     bigint;
  v_kind    text;
  v_num     bigint;
  v_issuer  jsonb;
  v_orig_no bigint;
  v_buyer   text;
  v_email   text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'credit_document_issue needs a workspace' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_direction NOT IN ('sale', 'refund') THEN
    RAISE EXCEPTION 'unknown direction %', p_direction USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO p FROM credit_purchases WHERE id = p_purchase_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such purchase in this workspace' USING ERRCODE = 'no_data_found';
  END IF;

  -- Google Play and Apple issue their own receipt.
  IF p.provider::text IN ('google', 'apple') THEN
    RETURN NULL;
  END IF;
  IF p_direction = 'sale' AND p.status::text <> 'paid' THEN
    RAISE EXCEPTION 'purchase is %, not paid', p.status USING ERRCODE = 'check_violation';
  END IF;
  IF p_direction = 'refund' AND p.status::text <> 'refunded' THEN
    RAISE EXCEPTION 'purchase is %, not refunded', p.status USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotent: a replay returns the document already issued.
  SELECT d.number INTO v_num FROM credit_documents d WHERE d.purchase_id = p_purchase_id AND d.direction = p_direction;
  IF FOUND THEN
    RETURN v_num;
  END IF;

  SELECT t.name::text INTO v_buyer FROM tenants t WHERE t.id = v_tenant;
  SELECT u.email::text INTO v_email FROM users u WHERE u.id = p.purchased_by;

  IF p_direction = 'sale' THEN
    SELECT * INTO iss FROM invoice_issuer_changes WHERE status = 'approved' ORDER BY decided_at DESC, id LIMIT 1;
    v_tax := COALESCE(iss.gst_registered AND iss.abn IS NOT NULL AND abn_is_valid(iss.abn), false);
    v_total := round(p.price_aud * 100)::bigint;
    v_kind := CASE WHEN v_tax THEN 'tax_invoice' ELSE 'receipt' END;
    v_gst := CASE WHEN v_tax THEN (v_total + 5) / 11 ELSE NULL END;
    v_issuer := CASE WHEN iss.id IS NULL THEN NULL ELSE jsonb_build_object(
      'changeId', iss.id, 'legalName', iss.legal_name, 'abn', iss.abn, 'address', iss.address,
      'email', iss.email, 'gstRegistered', iss.gst_registered) END;
    v_orig_no := NULL;
  ELSE
    SELECT * INTO orig FROM credit_documents WHERE purchase_id = p_purchase_id AND direction = 'sale';
    IF FOUND THEN
      -- The refund follows the document it adjusts, whatever the settings say now.
      v_kind := CASE WHEN orig.kind = 'tax_invoice' THEN 'adjustment_note' ELSE 'refund_receipt' END;
      v_total := -orig.total_cents;
      v_gst := -orig.gst_cents;
      v_issuer := orig.issuer;
      v_orig_no := orig.number;
      v_buyer := orig.buyer_name;
      v_email := orig.buyer_email;
    ELSE
      -- Paid before documents existed: a plain refund receipt, no GST statement.
      SELECT * INTO iss FROM invoice_issuer_changes WHERE status = 'approved' ORDER BY decided_at DESC, id LIMIT 1;
      v_kind := 'refund_receipt';
      v_total := -round(p.price_aud * 100)::bigint;
      v_gst := NULL;
      v_issuer := CASE WHEN iss.id IS NULL THEN NULL ELSE jsonb_build_object(
        'changeId', iss.id, 'legalName', iss.legal_name, 'abn', iss.abn, 'address', iss.address,
        'email', iss.email, 'gstRegistered', iss.gst_registered) END;
      v_orig_no := NULL;
    END IF;
  END IF;

  -- The gap-free number: taken in this transaction, so a rollback gives it back.
  UPDATE credit_document_counter SET last_number = last_number + 1 RETURNING last_number INTO v_num;

  INSERT INTO credit_documents (tenant_id, purchase_id, direction, kind, number, original_number, pack_code, credits,
                                total_cents, gst_cents, issuer, buyer_name, buyer_email, provider)
  VALUES (v_tenant, p_purchase_id, p_direction, v_kind, v_num, v_orig_no, p.pack_code, p.credits,
          v_total, v_gst, v_issuer, v_buyer, v_email, p.provider::text);
  RETURN v_num;
END $fn$;

REVOKE EXECUTE ON FUNCTION credit_document_issue(uuid, text) FROM PUBLIC;
ALTER FUNCTION credit_document_issue(uuid, text) OWNER TO app_platform;
GRANT EXECUTE ON FUNCTION credit_document_issue(uuid, text) TO app_rw;

-- ── Issuer: list, propose, decide (capability manage_platform_settings) ─────

CREATE OR REPLACE FUNCTION admin_invoice_issuer_list()
RETURNS TABLE (id uuid, status text, legal_name text, abn text, address text, email text, gst_registered boolean,
               reason text, proposed_by uuid, proposed_by_label text, proposed_at timestamptz,
               decided_by uuid, decided_by_label text, decided_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_platform_settings') THEN
    RAISE EXCEPTION 'missing capability: manage_platform_settings' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT c.id, c.status, c.legal_name, c.abn, c.address, c.email, c.gst_registered, c.reason,
           c.proposed_by, COALESCE(pu.display_name, pu.email)::text, c.proposed_at,
           c.decided_by, COALESCE(du.display_name, du.email)::text, c.decided_at
      FROM invoice_issuer_changes c
      LEFT JOIN users pu ON pu.id = c.proposed_by
      LEFT JOIN users du ON du.id = c.decided_by
     ORDER BY c.proposed_at DESC, c.id
     LIMIT 100;
END $fn$;

CREATE OR REPLACE FUNCTION admin_invoice_issuer_propose(
  p_legal_name text, p_abn text, p_address text, p_email text, p_gst_registered boolean, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id  uuid := gen_random_uuid();
  v_abn text := NULLIF(regexp_replace(COALESCE(p_abn, ''), '[[:space:]]', '', 'g'), '');
BEGIN
  IF NOT staff_has_capability('manage_platform_settings') THEN
    RAISE EXCEPTION 'missing capability: manage_platform_settings' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_abn IS NOT NULL AND NOT (v_abn ~ '^[0-9]{11}$' AND abn_is_valid(v_abn)) THEN
    RAISE EXCEPTION 'That ABN is not valid: its check digits do not match.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_gst_registered AND v_abn IS NULL THEN
    RAISE EXCEPTION 'GST registered needs a valid ABN.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_issuer_changes c WHERE c.status = 'pending') THEN
    RAISE EXCEPTION 'A change is already waiting for approval. Approve or reject it first.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO invoice_issuer_changes (id, legal_name, abn, address, email, gst_registered, reason, proposed_by)
  VALUES (v_id, btrim(p_legal_name), v_abn, btrim(p_address), btrim(p_email), p_gst_registered, btrim(p_reason), current_user_id());

  INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES ('platform_staff', current_user_id(), 'invoice_issuer_proposed', 'invoice_issuer_change', v_id,
          jsonb_build_object('legalName', btrim(p_legal_name), 'abn', v_abn, 'address', btrim(p_address),
                             'email', btrim(p_email), 'gstRegistered', p_gst_registered, 'reason', btrim(p_reason)));
  RETURN v_id;
END $fn$;

CREATE OR REPLACE FUNCTION admin_invoice_issuer_decide(p_id uuid, p_approve boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  c record;
BEGIN
  IF NOT staff_has_capability('manage_platform_settings') THEN
    RAISE EXCEPTION 'missing capability: manage_platform_settings' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM invoice_issuer_changes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such change.' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.status <> 'pending' THEN
    RAISE EXCEPTION 'That change is already %.', c.status USING ERRCODE = 'check_violation';
  END IF;
  -- Two people: whoever proposed it cannot approve it (they can reject, i.e. withdraw, it).
  IF p_approve AND c.proposed_by IS NOT DISTINCT FROM current_user_id() THEN
    RAISE EXCEPTION 'A second admin has to approve your change.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE invoice_issuer_changes
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_by = current_user_id(), decided_at = now()
   WHERE id = p_id;

  INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, after)
  VALUES ('platform_staff', current_user_id(),
          CASE WHEN p_approve THEN 'invoice_issuer_approved' ELSE 'invoice_issuer_rejected' END,
          'invoice_issuer_change', p_id,
          jsonb_build_object('proposedBy', c.proposed_by, 'legalName', c.legal_name, 'abn', c.abn,
                             'gstRegistered', c.gst_registered));
END $fn$;

-- ── GST report (capability manage_billing) ──────────────────────────────────

CREATE OR REPLACE FUNCTION admin_gst_report(p_from date, p_to date)
RETURNS TABLE (section text, number bigint, issued_at timestamptz, kind text, original_number bigint,
               total_cents bigint, gst_cents bigint, ref text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT staff_has_capability('manage_billing') THEN
    RAISE EXCEPTION 'missing capability: manage_billing' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'Give a date range of at most about a year, from before to.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN QUERY
    SELECT 'documents'::text, d.number, d.issued_at, d.kind, d.original_number, d.total_cents, d.gst_cents, NULL::text
      FROM credit_documents d
     WHERE (d.issued_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from AND p_to
     ORDER BY d.number;
  RETURN QUERY
    SELECT 'google'::text, NULL::bigint, cp.paid_at, 'play_sale'::text, NULL::bigint,
           round(cp.price_aud * 100)::bigint, NULL::bigint, cp.id::text
      FROM credit_purchases cp
     WHERE cp.provider::text = 'google' AND cp.paid_at IS NOT NULL AND cp.grant_id IS NOT NULL
       AND (cp.paid_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from AND p_to
     ORDER BY cp.paid_at, cp.id;
END $fn$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_invoice_issuer_list()',
    'admin_invoice_issuer_propose(text, text, text, text, boolean, text)',
    'admin_invoice_issuer_decide(uuid, boolean)',
    'admin_gst_report(date, date)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('ALTER FUNCTION %s OWNER TO app_platform', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_rw', f);
  END LOOP;
END $$;

