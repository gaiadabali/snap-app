# Phase 1b contract — running the OCR stage in shadow

**Frozen interface.** Two lanes in parallel.
Context: `docs/OCR.md` §4.4 and §9 Phase 1. Phase 1's components exist and are
tested; nothing in the running application uses them yet.

## The decision: shadow, not replace

The OCR stage runs **alongside** the existing VLM extraction on real captures,
stores what it produced, and **changes nothing about the resulting document**.

Why not switch over now: we have one measurement, on one synthetic page, of a
recogniser reading printed text. We have none on a creased thermal docket
photographed at 2am, which is the actual job. Shadow mode buys that evidence at
zero risk to the documents people are already relying on — and the corpus it
produces is what makes the switch defensible later rather than hopeful.

**The rule that outranks the feature: shadow work must never break the real
path.** If the sidecar is down, slow, or wrong, extraction proceeds exactly as
it does today and the failure is logged, not raised. A shadow that can take
down the pipeline is worse than no shadow.

---

## 1. File ownership

| Lane | Owns |
|---|---|
| **H — data** | `packages/db/**`, `apps/server/src/repo.ts` |
| **I — server** | `apps/server/src/worker.ts`, `apps/server/src/extraction/**`, `apps/server/src/config.ts`, `apps/server/src/storage.ts`, `apps/server/package.json` |

Nobody edits `packages/docai/**` (frozen this round), `services/docai-engine/**`,
or `apps/server/bench/**`.

---

## 2. Storage (lane H)

A DocDOM for a long document is megabytes. It does not belong in a row that a
list screen selects, so: **JSON in object storage, pointer plus a small index
in Postgres** (`docs/OCR.md` §5.7).

```sql
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
```

RLS exactly as the sibling tables; the worker is an ordinary member and goes
through the same policies. Several layouts per capture are expected and fine —
a re-run produces another, and keeping both is the same replayability argument
`extraction_runs` already makes.

Repo functions:

```ts
saveLayout(userId, tenantId, input: {
  captureId: string; extractionRunId: string | null; storageKey: string;
  docdomVersion: string; pageCount: number; engineIds: string[];
  spanCount: number; unreadableCount: number; shadow: boolean;
}): Promise<{ layoutId: string }>

latestLayout(userId, tenantId, captureId): Promise<LayoutRow | null>
```

## 3. The worker (lane I)

After a successful extraction, and **only** when `DOCAI_SIDECAR_URL` is set:

1. Build `PageInput`s from the same `capture_pages` the extraction read.
2. Call `read()` from `@snap/docai` with the sidecar engine and the tier-0
   PDF-text engine, profile `cloud-au`.
3. Write the DocDOM JSON to object storage under
   `<tenantId>/layouts/<captureId>/<runId>.json`.
4. Record it via `saveLayout(..., shadow: true)`.

Rules:
- **Wrapped in its own try/catch.** Any failure logs one line and returns. The
  extraction result is already saved and must not be touched.
- **Its own timeout**, shorter than the extraction's. A shadow that delays a
  real document has inverted its own priority.
- **Absent config means absent feature.** No `DOCAI_SIDECAR_URL`, no attempt,
  no warning, no partial row.
- Add `@snap/docai` to `apps/server`'s dependencies. It is server-only;
  `test/boundaries.test.ts` must keep passing, so it must never become reachable
  from the mobile app.

Config: `DOCAI_SIDECAR_URL` (optional string), `DOCAI_SHADOW_TIMEOUT_MS`
(default 30000).

## 4. What this is NOT, this round

- Not grounded extraction. Fields still come from the VLM; nothing points at a
  span yet (D16 is a later step).
- Not a change to `documents`, `document_lines`, or any validator.
- Not a user-visible feature. Nothing on the wire, nothing in the app.

## 5. Definition of done

- `pnpm -r typecheck`, `pnpm --filter @snap/server test`, and
  `test/boundaries.test.ts` all pass.
- **With `DOCAI_SIDECAR_URL` unset, behaviour is byte-for-byte what it is
  today.** Prove this, do not assert it.
- With it set and the sidecar deliberately down, extraction still succeeds.
- Comments explain why. Report what you could not verify.
