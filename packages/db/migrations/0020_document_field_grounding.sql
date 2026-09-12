-- ---------------------------------------------------------------------------
-- 0020 — document_field_grounding (Phase 1c, lane J)
--
-- WHY THIS EXISTS
--
-- `docs/contracts/phase1c-grounding.md` §2. `packages/docai/src/grounding.ts`
-- (frozen, lane K's boundary) answers, per field, "does an independent OCR
-- reading of the same pixels actually support this value" — this is where
-- that answer is kept once the shadow stage runs it over a saved layout
-- (0019): the value, whether a span backed it and if so which ones, the box
-- and page they sit on, and how confidently (the WEAKEST supporting span,
-- never an average — `weakest()` in `packages/docai/src/docdom.ts`, because a
-- total whose middle digit is a coin toss is not 96% right).
--
-- ADVISORY, NOT ENFORCING — YET
--
-- Grounding changes nothing about the document it describes this round: no
-- finding, no `review_status`, no `ato_compliance` (the contract's central
-- rule). We have a grounding rate from exactly one document and no
-- false-positive rate, and a review queue full of "unsupported value"
-- warnings on values that were read perfectly is the fastest way to teach a
-- reviewer to ignore warnings — the same trap `lines_do_not_balance` fell
-- into. `enforced` defaults false and is the column that flips, one field at
-- a time, once evidence rather than hope says a value is ready to become a
-- real finding.
--
-- ONE ROW PER (LAYOUT, FIELD) — UPDATE ON REGROUND, NOT ACCUMULATE
--
-- Unlike `document_layouts`, where several rows per capture are the point
-- (history is evidence, per that migration's comment), grounding the same
-- field against the same layout a second time is not a new fact — it is the
-- same OCR output being asked the same question again, and only the latest
-- answer is worth keeping. `UNIQUE (layout_id, field_path)` says so, and
-- `saveFieldGrounding` (apps/server/src/repo.ts) writes to it the way
-- `replaceLines` writes `document_lines`: delete this call's layout(s) worth
-- of rows, then insert the new set, inside one transaction. Real history, if
-- it is ever wanted, already exists one level up — a re-run produces a new
-- `document_layouts` row (a new layout_id), not a second grounding row for
-- the same one.
--
-- THE GROUNDED/BOX INVARIANT IS A CHECK, NOT JUST A COMMENT
--
-- A box is the evidence a grounded value points at
-- (`GroundedField.box`); an ungrounded value is returned unchanged, never
-- deleted, specifically so a human can see what the model said even though
-- nothing on the page backs it up — but it never gets to claim evidence it
-- doesn't have. `groundValue` always produces `page` and `box` together, or
-- neither: never a value with a box but no page, or a page but no box. The
-- CHECK below enforces exactly that pairing so a future writer (a manual
-- override, a different engine) that skips one half of the pair fails loudly
-- at insert time rather than leaving a row nobody can trust.
-- ---------------------------------------------------------------------------

CREATE TABLE document_field_grounding (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  capture_id   uuid NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  layout_id    uuid NOT NULL REFERENCES document_layouts(id) ON DELETE CASCADE,
  -- Schema path, the same vocabulary as `documents.locked_fields`:
  -- `header.payable_amount`, `header.supplier_abn`, and so on.
  field_path   text NOT NULL,
  value        text NOT NULL,
  grounded     boolean NOT NULL,
  -- Null when ungrounded. A box IS the evidence, so there is never one
  -- without a grounding.
  span_ids     text[] NOT NULL DEFAULT '{}',
  box          jsonb,
  page         int,
  -- Weakest supporting span, per DocDOM's `weakest()`. 0 when ungrounded.
  -- NUMERIC(5,4), one digit finer than the shared `confidence` domain
  -- (NUMERIC(4,3), migration 0001) — the frozen contract specifies this
  -- precision directly rather than the domain, and OCR engines report span
  -- confidence to more than three decimals, so a new domain wasn't made for
  -- it; see 0020's Drizzle declaration for the same note.
  confidence   numeric(5,4) NOT NULL DEFAULT 0,
  -- False while grounding is advisory. The switch for §2's decision.
  enforced     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layout_id, field_path),
  -- Extended one column past what the contract asked for (box only): `page`
  -- is set by `groundValue` in lockstep with `box` on every code path today
  -- (both null when ungrounded, both non-null when grounded), so it is the
  -- same invariant, not a second one, and leaving it unenforced would let a
  -- box-without-a-page row (or vice versa) sit in a state no producer ever
  -- intends. `span_ids` is deliberately left out of the CHECK: it is
  -- NOT NULL DEFAULT '{}' rather than nullable, so "empty on ungrounded" is
  -- already the only representable ungrounded state, and constraining its
  -- cardinality on the grounded side would reject a future engine that
  -- legitimately grounds a value against a single span differently than
  -- today's run-matching does.
  CONSTRAINT document_field_grounding_evidence_check CHECK (
    (grounded AND box IS NOT NULL AND page IS NOT NULL) OR
    (NOT grounded AND box IS NULL AND page IS NULL)
  )
);

-- `groundingForLayout` and `saveFieldGrounding`'s delete-then-insert both
-- filter on layout_id alone; the UNIQUE constraint's backing btree already
-- serves that, leading with layout_id. This index is the other lookup shape —
-- "every grounding this tenant has recorded for a capture, across every
-- layout run" — the same reasoning `document_layouts_capture_idx` (0019)
-- gives for its own table.
CREATE INDEX document_field_grounding_capture_idx
  ON document_field_grounding (tenant_id, capture_id);

-- ---------------------------------------------------------------------------
-- RLS — identical shape to capture_pages (0018) and document_layouts (0019).
-- The worker is an ORDINARY app_rw member: grounding rows carry per-tenant
-- document content, not a cross-tenant queue, so — like document_layouts and
-- unlike jobs — there is no `TO app_worker ... USING (true)` policy here. The
-- worker must set tenant context from the job it is processing before it can
-- write here, same as every other tenant table.
-- ---------------------------------------------------------------------------
ALTER TABLE document_field_grounding ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_field_grounding FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_field_grounding
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- No explicit GRANT here: 0010's `ALTER DEFAULT PRIVILEGES IN SCHEMA public`
-- already covers every table created afterward by the same migration role.
