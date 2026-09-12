-- ---------------------------------------------------------------------------
-- 0018 — multi-page captures
--
-- WHY THIS EXISTS
--
-- Today a "capture" is one photo, and the app already lies about it: it sends
-- `pageCount: n` while uploading only the last shot (`docs/contracts/
-- phase0-multipage.md` §2). A tax invoice that runs to two pages — the second
-- carrying the GST summary — has always been one document; the schema is the
-- thing that has been pretending otherwise.
--
-- `captures` stays the document-level row: one legal record, one dedup hash,
-- one retention clock. `capture_pages` is new and holds the pages that make
-- it up, each with its own bytes, its own content hash and its own place in
-- the page order. A PDF's rendered/native split (§4 of the contract) is also a
-- `capture_pages` concern, via `page_source` below — the capture itself does
-- not need to know whether a page came off a camera or out of a PDF.
--
-- BACKWARD COMPATIBILITY, ON PURPOSE
--
-- `captures.original_storage_key` / `original_mime_type` / `original_byte_size`
-- keep meaning exactly what they meant before: page 1's bytes. Every existing
-- reader of a `captures` row — the image-serving endpoint, the extraction
-- worker's single-page path — keeps working unchanged. `captures.page_count`
-- keeps being the declared count, now genuinely enforced by matching rows in
-- `capture_pages` rather than an unchecked integer.
-- ---------------------------------------------------------------------------

-- Where a page's bytes came from. 'capture' is the ordinary camera path;
-- the other two only exist once a PDF has been demuxed (lane B, §4 of the
-- contract) — a digital-native PDF keeps its embedded text layer as
-- 'pdf_native' AND a rasterisation for the twin (§5 of docs/OCR.md), while a
-- scanned PDF has nothing to read but the render.
CREATE TYPE page_source AS ENUM ('capture', 'pdf_native', 'pdf_render');

CREATE TABLE capture_pages (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  capture_id   uuid NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  page_number  int  NOT NULL CHECK (page_number >= 1),
  storage_key  text NOT NULL,
  mime_type    text NOT NULL,
  byte_size    bigint NOT NULL CHECK (byte_size > 0),
  sha256       bytea NOT NULL,
  width        int,
  height       int,
  source       page_source NOT NULL DEFAULT 'capture',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (capture_id, page_number)
);

-- Content-addressed dedup within a tenant: the same page photographed twice,
-- or reused across two different bundles, is recognised before anything is
-- re-uploaded. The (capture_id, page_number) unique index above already
-- covers "list this capture's pages in order"; this is the other lookup
-- `repo.createCapture` needs, and nothing built the first index would serve it.
CREATE INDEX capture_pages_dedup_idx ON capture_pages (tenant_id, sha256);

COMMENT ON COLUMN captures.original_sha256 IS
  'Capture-level dedup hash, checked against captures_sha_unique. One page: '
  'that page''s own SHA-256 — unchanged from single-page behaviour. More than '
  'one page: SHA-256 of the page hashes, concatenated as lowercase hex text in '
  'page order, then hashed as that text (see repo.ts captureDedupHash). '
  'Computed by the application, not a trigger, because capture_pages rows for '
  'a brand-new capture do not exist yet in the same statement that needs this '
  'value. A PDF later demuxed into a different page count (lane B, §4 of '
  'docs/contracts/phase0-multipage.md) must recompute this the same way, or '
  'the uniqueness constraint stops meaning "the same document".';

-- ---------------------------------------------------------------------------
-- RLS — identical shape to the standard tenant policy in 0010_rls.sql.
--
-- Not added to 0010's table list directly: that migration has already run
-- everywhere this schema is deployed, and editing an applied migration file
-- changes nothing there while silently diverging a fresh database from every
-- environment that already ran the old text. The policy itself is copied
-- verbatim from 0010's tenant_tables loop body, including FORCE, so the
-- worker — an ordinary app_rw member, per 0010's design notes — goes through
-- this exactly like every other tenant table and gets no bypass.
-- ---------------------------------------------------------------------------
ALTER TABLE capture_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_pages FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON capture_pages
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- No explicit GRANT here: 0010's `ALTER DEFAULT PRIVILEGES IN SCHEMA public`
-- already covers every table created afterward by the same migration role,
-- which is how this one is applied too.
