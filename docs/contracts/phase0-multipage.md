# Phase 0 contract — multi-page captures and PDF intake

**Frozen interface.** Four workstreams build against this in parallel. Nobody
changes it unilaterally; if something here is wrong, say so and stop rather
than improvising a different shape.

Context: `docs/OCR.md` §9, Phase 0. Today the app sends `pageCount: n` and
uploads only the last photo, and the server rejects PDFs outright.

---

## 1. File ownership — do not edit outside your lane

| Lane | Owns |
|---|---|
| **A — data** | `packages/db/**`, `packages/api-contract/**`, `apps/server/src/repo.ts` |
| **B — intake** | `apps/server/src/captures/**`, `apps/server/src/extraction/**`, `apps/server/src/worker.ts`, `apps/server/package.json` |
| **C — app** | `apps/mobile/**` |
| **D — eval** | `apps/server/bench/**` |

If you need a change in someone else's lane, write it in your final report.
Do not make it.

---

## 2. Schema (lane A)

New table. Migration number = next unused in `packages/db/migrations/`; verify
rather than assuming, and mirror the file's existing house style (annotated
DDL, reasons in comments).

```sql
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
```

- New enum `page_source`: `'capture' | 'pdf_native' | 'pdf_render'`.
- RLS exactly as the sibling tables in `0010_rls.sql`. The worker is an
  ordinary member and goes through the same policies — no bypass.
- `captures.page_count` stays and remains the declared count.
- `captures.original_storage_key` stays non-null and holds **page 1**, so
  every existing reader keeps working.

**Capture-level dedup hash** — `captures.original_sha256`:

- 1 page → that page's SHA-256. Identical to today's behaviour.
- n > 1 → SHA-256 of the page hashes concatenated **as lowercase hex, in page
  order**. Document this next to the column.

---

## 3. Wire types (lane A owns the file; B and C consume)

```ts
export interface CapturePageInput {
  sha256: string;      // hex, of that page's bytes
  mimeType: string;    // image/* or application/pdf
  byteSize: number;
}

export interface CreateCaptureRequest {
  pages: CapturePageInput[];        // 1..20, in page order. REQUIRED.
  capturedAt?: IsoDateTime;
  legibilityScore?: number;
}

export interface CapturePageUpload {
  pageNumber: number;               // 1-based
  uploadUrl: string;
  alreadyStored: boolean;           // these exact bytes are already held
}

export interface CreateCaptureResponse {
  captureId: string;
  uploads: CapturePageUpload[];
  uploadExpiresAt: IsoDateTime;
  duplicate: boolean;               // the whole document was already captured
  quotaExhausted?: boolean;
  /** @deprecated alias for uploads[0].uploadUrl */
  uploadUrl: string;
}
```

The old single-file `{sha256, mimeType, byteSize, pageCount}` request shape is
**removed, not deprecated** — nothing has shipped against it.

`repo.createCapture` gains a `pages: CapturePageInput[]` parameter and returns
`{ capture, duplicate, pages: Array<{pageNumber, storageKey|null, alreadyStored}> }`.
New: `repo.recordCapturePage(userId, tenantId, {captureId, pageNumber, storageKey, mimeType, byteSize, sha256, width?, height?, source})`
and `repo.listCapturePages(userId, tenantId, captureId)`.

### 3.1 Amendment — stored pages must be readable (added after lane C reported)

My omission, found by lane C: §5 requires the review screen to page through a
multi-page document, but nothing on the wire exposes the *stored* pages. As
written, paging works only for a just-captured document via local URIs, and
reopening it later shows page 1 alone.

- **Lane A:** `DocumentView` gains `pages: Array<{ pageNumber: number; imageUrl: string; source: PageSource }>`,
  ordered by page number. Single-page documents return one entry, so there is
  no special case for a caller to get wrong. `imageUrl` follows whatever
  convention the existing `imageUrl` uses.
- **Lane B:** populate it from `repo.listCapturePages` wherever a document is
  assembled for the wire.
- **Lane C:** already handled — it will consume this when it exists.

---

## 4. Upload (lane B)

- `PUT /v1/uploads/:token` — the token now carries `{captureId, tenantId, pageNumber}`.
  See `src/tokens.ts`; keep the existing TTL and failure semantics (an expired
  and a forged token stay indistinguishable to the caller).
- Accept `image/*` **and `application/pdf`**. Reject anything else, with the
  same tone as the current message.
- Each page is stored under its own content hash and recorded via
  `recordCapturePage`. Extraction is enqueued **once, after the last declared
  page arrives** — never once per page.

### PDF demux

A PDF is uploaded as a single page entry. After upload, expand it into
`capture_pages`:

- Digital-native text layer present → `source = 'pdf_native'`, and keep the
  per-page rasterisation too (the twin needs pixels either way).
- Scanned → render each page, `source = 'pdf_render'`.
- Update `captures.page_count` to the true count.
- The uploaded PDF remains the L0 original and is never rewritten.

Library choice is yours — argue for it in the report. Prefer something that
runs on CPU with no service dependency and a permissive licence; note the
licence in the report, since `docs/OCR.md` D23 sets a floor.

---

## 5. App (lane C)

`apps/mobile/src/app/(tabs)/capture.tsx:128` currently uploads only the last
shot while declaring `pageCount: n`. Fix it properly:

- Hash every page in the tray, send them all in `pages[]`, upload each to its
  own URL, in order, with per-page progress.
- Skip uploads where `alreadyStored` is true.
- A failed page must not orphan the capture — retry that page, do not restart.
- The review screen shows the page count and lets the user page through.
- No hardcoded `legibilityScore: 0.94`. If there is no real measurement, send
  nothing.

---

## 6. Eval (lane D)

`compare.py` today scores **one synthetic image, one run per model**, total
score only — and five of six vision-capable models tie at 8/8, so it can no
longer discriminate. Rebuild it as a real harness:

- Multiple documents, per-field scoring, per-field ground truth in a committed
  manifest.
- Multi-page PDFs in the set from the start — never measured, and the gap
  driving all of this.
- Report **per field**: exact match, normalised match, and abstention
  (null where truth is null — which must count as a success, not a miss).
- Runs repeated, so latency is a median rather than one sample.
- Structured output (JSON + a markdown table) written to a results directory,
  with the model, prompt version and timestamp recorded.
- Pluggable engine adapters behind a flag: the current hosted models, plus
  stubs for **PaddleOCR PP-StructureV3**, **Docling** and **LlamaParse**, each
  skipped cleanly when its dependency or key is absent.

**Invent nothing.** If an engine cannot be run here, the harness must report
"not run" — never an estimated score. A fabricated number in this file is
worse than an empty column, because everything downstream is gated on it.

---

## 7. Definition of done, all lanes

- `pnpm --filter @snap/server test` and `pnpm -r typecheck` pass.
- `test/boundaries.test.ts` still passes — the mobile app must not gain a
  dependency on `@snap/db` or `@snap/tax-engine`.
- Comments explain **why**, matching the register of the surrounding code.
- No secret, key or token in a log line, an error message or a commit.
- Report what you did NOT do, and anything you found that belongs in another
  lane.

---

## 8. Amendment — signed image URLs (Phase 0 follow-up)

Lane C found a pre-existing gap: `DocumentView.imageUrl` has always been a
relative **authenticated** route, and `<Image source={{uri}}>` cannot attach an
`Authorization` header — impossible on web, where `react-native-web` renders a
plain `<img>`. So document images have never rendered against a real backend,
and the new `pages[].imageUrl` inherits the same problem.

**Decision: short-TTL signed URLs**, not a mobile-side authenticated-image
layer. Reasons: `docs/PLAN.md` D12 already commits to "short-TTL presigned URLs
only" for object access, the codebase already does exactly this twice
(`/v1/uploads/:token`, `/v1/downloads/:token`), and it means the client needs
no auth plumbing in a UI component — which keeps the rule that UI only talks
through the `SnapApi` seam.

### Wire shape

- `GET /v1/images/:token` — returns the bytes with the stored content type.
  **No `SessionGuard`**: the token is the credential, exactly as
  `/v1/uploads/:token` and `/v1/downloads/:token` already work.
- Token payload carries `{ tenantId, captureId, pageNumber }` and its own TTL
  (`IMAGE_TTL_SECONDS`, default 900). Reuse `src/tokens.ts` and keep the
  existing rule that expired and forged are indistinguishable to the caller.
- `DocumentView.imageUrl` and every `DocumentView.pages[].imageUrl` become
  `/v1/images/<token>`. The shape of the field does not change — only what is
  in it — so no type change is needed.

### Ownership for this amendment

| Lane | Owns |
|---|---|
| **B — server** | `apps/server/src/**` — the route, the token, both URL emitters |
| **C — app** | `apps/mobile/**` — consume `pages[]`, drop any auth assumptions |

### Rules

- A token must not outlive its usefulness: minted per request, short TTL, never
  stored in a document row.
- A token for one tenant's page must be useless against another's. The existing
  upload token already carries the tenant for this reason.
- The page bytes still come from storage through `repo`/RLS — the token
  authorises the URL, it does not bypass the tenant check.
