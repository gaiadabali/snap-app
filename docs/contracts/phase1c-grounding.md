# Phase 1c contract — persisting grounding

**Frozen interface.** Two lanes in parallel.
Context: `docs/OCR.md` D16 and §9 Phase 1. `packages/docai/src/grounding.ts`
exists, is tested (48 tests), and has been demonstrated on a real two-page
invoice at 100% grounding — and shown to reject the exact ABN misread
`gemma4:31b` produced on that document.

## The decision: advisory, not enforcing — yet

Grounding runs after the shadow OCR stage, and its results are **stored, not
acted on**. An ungrounded value does **not** become a finding, does **not**
change `review_status`, and does **not** touch the document this round.

Why, when an ungrounded value is exactly the signal we want a human to see: we
have a grounding rate from one document. We do not know the false-positive
rate, and the failure mode of getting this wrong is a review queue full of
"unsupported value" warnings on values that were read perfectly — which is the
fastest way to teach a reviewer to ignore warnings, the same trap
`lines_do_not_balance` fell into. Store first, measure, promote on evidence.

The column that lets it stop being advisory is `enforced`, and it defaults
false.

---

### Measured, 2026-09-16 — `bench/results/grounding/sample-final.json`

The evidence this section asked for. `bench/grounding_score.py` grounds the
corpus's **ground-truth** values — no model involved — so a true value that
fails to ground is exactly a field enforcement would delete.

| Corpus | grounded | false-positive rate of enforcement |
|---|---|---|
| **Tier S (Australian-shaped, 48 values)** | **48 / 48** | **0.0%** |
| Tier P (Indonesian receipts, 20 values) | 13 / 20 | 35.0% |

**On Australian-shaped documents grounding does not delete a single correct
value, at every degradation level from clean to severe.** All seven tier P
failures are the same thing: `grounding.ts`'s money normaliser reads `40.000`
as forty, because in Australia a dot is a decimal point. That is correct for
the documents this product processes and wrong for Indonesian ones, and it is
**not** a defect to fix — widening it would make `110.00` and `11000` compare
equal on an AU docket, which is worse than anything it buys.

**Two defects were found on the way to this number, and both inflated it.**

1. **The OCR stage split printed lines.** `_rows_from_boxes` did not exist;
   detections were sorted by raw `(y, x)`, so `RIVERTON` at y=151 came *after*
   `FRESH MARKET` at y=150 and each detection became its own DocDOM line.
   `groundValue` scans runs *within a line*, so a supplier name spread across
   two of them could never ground. Fixed in `services/docai-engine` by
   assembling detections into printed rows on vertical overlap: 57 lines became
   21 on a docket that has 21, and `header.supplier` went 66.7% → **100%**.
2. **The measurement read page 1 only.** `invoice-multipage` puts its totals on
   page 2 *by construction*, so the instrument reported them ungrounded. A bug
   in the instrument being read as a finding about the engine.

Before both fixes the headline was 19.1%. After, 10.3% overall and 0% on the
corpus that matters.

**This still does not promote `enforced` to true**, and the reason is the one
this document already gives elsewhere: tier S is synthetic, and
`docs/CORPUS.md` §2 records that rendered glyphs make recall optimistic. 0% on
generated paper is a strong signal and not the same as 0% on a photographed
Gundagai docket. **The decision stays blocked on tier R (`docs/GAPS.md` B1)** —
but it is now blocked on one missing corpus rather than on an unknown.

---

## 1. File ownership

| Lane | Owns |
|---|---|
| **J — data** | `packages/db/**`, `apps/server/src/repo.ts` |
| **K — server** | `apps/server/src/extraction/**`, `apps/server/src/worker.ts` |

Nobody edits `packages/docai/**` (frozen), `services/docai-engine/**`, or
`apps/server/bench/**`.

---

## 2. Storage (lane J)

```sql
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
  confidence   numeric(5,4) NOT NULL DEFAULT 0,
  -- False while grounding is advisory. The switch for §2's decision.
  enforced     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layout_id, field_path)
);
```

RLS as the sibling tables; the worker is an ordinary member, no bypass. A
`CHECK` that a grounded row has a box and an ungrounded one does not is
welcome if it reads cleanly — the invariant is real, and the comment above
`span_ids` states it.

Repo functions:

```ts
saveFieldGrounding(userId, tenantId, rows: Array<{
  captureId: string; layoutId: string; fieldPath: string; value: string;
  grounded: boolean; spanIds: string[]; box: unknown | null;
  page: number | null; confidence: number;
}>): Promise<{ saved: number }>

groundingForLayout(userId, tenantId, layoutId): Promise<GroundingRow[]>
```

Write them as a set per layout — they only mean anything together, the same
argument `replaceLines` already makes.

## 3. The worker (lane K)

Inside the existing shadow block, after the DocDOM is stored and
`saveLayout` returns a layout id:

1. Build the field list from the extraction that was just saved:
   `header.supplier` (text), `header.supplier_abn` (abn),
   `header.issue_date` (date), `header.payable_amount` (money),
   `header.tax_amount` (money).
2. Call `groundExtraction(doc, fields)` from `@snap/docai`.
3. Persist every field with `saveFieldGrounding`.
4. Log one line with the rate and any ungrounded paths.

Rules:
- **Inside the shadow stage's existing safety boundary.** Grounding is pure
  and fast, but it must not become the thing that breaks a pipeline the OCR
  stage was carefully kept from breaking.
- **Do not touch the document.** No findings, no `review_status`, no
  `ato_compliance`. That is §2's whole point.
- Absent sidecar means absent DocDOM means absent grounding — no rows, no log.

## 4. Definition of done

- `pnpm -r typecheck`, `pnpm --filter @snap/server test`, `packages/db` tests,
  and `test/boundaries.test.ts` all pass.
- Prove on the real capture `e1bba07b-242a-4ef9-9474-b7f0b5dc8c38` (tenant
  `11111111-1111-4111-8111-111111111111`) that five rows land with boxes, and
  that `documents` is byte-identical before and after.
- Report what you could not verify.
