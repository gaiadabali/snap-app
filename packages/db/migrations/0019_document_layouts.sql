-- ---------------------------------------------------------------------------
-- 0019 — document_layouts (Phase 1b, lane H)
--
-- WHY THIS EXISTS
--
-- `docs/contracts/phase1b-shadow-stage.md` §2 adds an OCR stage
-- (`docs/OCR.md` §4.4) that runs alongside today's VLM extraction and emits a
-- DocDOM: pages/blocks/lines/spans, with a bbox and confidence on every node
-- (`docs/OCR.md` §4.6). That structure is megabytes for a long document — it
-- does not belong in a row a list screen selects — so it is written to object
-- storage as versioned JSON, and this table is the pointer plus a small index
-- (`docs/OCR.md` §5.7): "what read this, how much of it, how well" without
-- ever fetching the JSON.
--
-- SEVERAL LAYOUTS PER CAPTURE, ON PURPOSE
--
-- No uniqueness constraint on capture_id. A re-run produces another layout,
-- and keeping both is the same replayability argument `extraction_runs`
-- already makes for the semantic layer: history is evidence, not clutter, and
-- `latestLayout` (packages/db + apps/server/src/repo.ts) is how a caller gets
-- "the current one" without the table pretending only one ever existed.
--
-- SHADOW, AND HOW IT STOPS BEING
--
-- `shadow` defaults true because every layout produced today is advisory: the
-- OCR stage runs beside the real VLM extraction and changes nothing about the
-- resulting document (the contract's central rule). The column exists so that
-- sentence has an expiry date recorded in the schema rather than in a comment
-- somewhere — the day a layout actually feeds a real document, that row (and
-- only that row) is written with shadow = false. Nothing in this migration
-- flips the default; that is a later, deliberate change to the write path.
-- ---------------------------------------------------------------------------

CREATE TABLE document_layouts (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  capture_id        uuid NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  extraction_run_id uuid REFERENCES extraction_runs(id) ON DELETE SET NULL,
  storage_key       text NOT NULL,
  docdom_version    text NOT NULL,
  page_count        int  NOT NULL CHECK (page_count >= 1),
  -- Which engines contributed, for "what read this" without fetching the JSON.
  engine_ids        text[] NOT NULL DEFAULT '{}',
  span_count        int  NOT NULL DEFAULT 0,
  unreadable_count  int  NOT NULL DEFAULT 0,
  -- Shadow runs are advisory. A layout that fed a real document is not.
  shadow            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- `latestLayout(userId, tenantId, captureId)` orders by created_at DESC within
-- one capture; this is that query's index, tenant-first so it is also the
-- natural index for "every layout this tenant has" if that is ever needed.
CREATE INDEX document_layouts_capture_idx
  ON document_layouts (tenant_id, capture_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS — identical shape to capture_pages (0018) and the tenant_tables loop in
-- 0010_rls.sql. Not added to that loop directly for the same reason 0018
-- wasn't: 0010 has already run everywhere this schema is deployed, and
-- editing an applied migration changes nothing there while silently
-- diverging a fresh database from every environment that already ran the old
-- text.
--
-- The worker is an ORDINARY app_rw member here, exactly as the contract
-- demands ("the worker is an ordinary member and goes through the same
-- policies, no bypass") and exactly as capture_pages already established.
-- Unlike `jobs`, document_layouts gets no `TO app_worker ... USING (true)`
-- policy — it carries per-tenant document content, not a cross-tenant queue,
-- and the worker must set tenant context from the job it is processing
-- before it can write here, same as any other tenant table.
-- ---------------------------------------------------------------------------
ALTER TABLE document_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_layouts FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_layouts
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- No explicit GRANT here: 0010's `ALTER DEFAULT PRIVILEGES IN SCHEMA public`
-- already covers every table created afterward by the same migration role.
