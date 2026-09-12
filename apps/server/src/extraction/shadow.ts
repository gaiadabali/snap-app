import { randomUUID } from 'node:crypto';

import { withTenantAs } from '@snap/db';
import {
  DOCDOM_VERSION,
  PdfTextEngine,
  SidecarEngine,
  groundExtraction,
  read as readDocument,
  type Document,
  type FieldToGround,
  type Page as DocaiPage,
  type PageInput,
} from '@snap/docai';
import { sql } from 'drizzle-orm';

import { config } from '../config.js';
import { getDb } from '../db.js';
import type { CapturePageRow } from '../repo.js';
import { saveFieldGrounding, saveLayout } from '../repo.js';
import { get as readObject, putAt } from '../storage.js';
import type { Extraction } from './types.js';

/**
 * The OCR stage, run in SHADOW alongside the VLM extraction —
 * `docs/contracts/phase1b-shadow-stage.md` §3.
 *
 * **The rule that outranks the feature**: shadow work must never break the
 * real path. Every code path through this function either succeeds quietly
 * or is caught and logged as ONE line; none of them throw. `worker.ts` calls
 * this after the real extraction result is already saved, and nothing below
 * touches that result — this function only reads `capture_pages` and writes
 * to `document_layouts`/object storage, tables the real extraction path does
 * not use.
 *
 * **Absent config means absent feature.** `DOCAI_SIDECAR_URL` unset is
 * checked FIRST and returns before anything else runs — no bytes are read,
 * no engine is constructed, nothing is logged. That is what makes "today's
 * behaviour is unaffected" a provable property (contract §5) rather than an
 * assertion: the function body downstream of that check simply never
 * executes.
 */

/** `capture_pages.source` (text, per `repo.ts`'s `CapturePageRow`) to DocDOM's `Page.source`. */
const SOURCE_MAP: Record<string, DocaiPage['source']> = {
  capture: 'photo',
  pdf_native: 'pdf-native',
  pdf_render: 'pdf-render',
};

/**
 * Builds one `PageInput` per stored page, reading bytes back from object
 * storage exactly as `worker.ts`'s own extraction path does (`readObject` /
 * `storage.get`).
 *
 * `width`/`height` default to 0 when a row has neither recorded. That is
 * only possible for a `source = 'capture'` row from a single-photo upload
 * predating dimension tracking (every demuxed PDF page — the case this round
 * is built for — has both, from the render step). 0 is a safe placeholder:
 * the only place a page's declared width/height is read downstream is
 * `pipeline.ts`'s "no engine available" fallback box, and this stage always
 * registers the sidecar engine, which is permitted under every profile it
 * runs in — so that fallback is not expected to be exercised in practice.
 */
function toPageInputs(rows: CapturePageRow[]): PageInput[] {
  return rows.map((row) => ({
    bytes: new Uint8Array(readObject(row.storage_key)),
    mimeType: row.mime_type,
    page: {
      number: row.page_number,
      width: row.width ?? 0,
      height: row.height ?? 0,
      dpi: null,
      source: SOURCE_MAP[row.source] ?? 'photo',
      restoration: [],
    },
  }));
}

/** Every distinct engine id that actually produced a node in `doc`, sorted for a stable row. */
function engineIdsOf(doc: Document): string[] {
  const ids = new Set<string>();
  for (const b of doc.blocks) {
    ids.add(b.provenance.engine);
    for (const l of b.lines) for (const s of l.spans) ids.add(s.provenance.engine);
  }
  for (const t of doc.tables) ids.add(t.provenance.engine);
  for (const f of doc.figures) ids.add(f.provenance.engine);
  for (const f of doc.fields) ids.add(f.provenance.engine);
  return [...ids].sort();
}

function spanCountOf(doc: Document): number {
  let n = 0;
  for (const b of doc.blocks) for (const l of b.lines) n += l.spans.length;
  return n;
}

/**
 * The extraction run `worker.ts` just recorded for this capture, if any.
 *
 * `saveExtraction` (repo.ts) generates and inserts its own run id internally
 * but does not return it, and this lane does not touch repo.ts — so the run
 * just written is looked up the same way any other reader would, through the
 * worker's own ordinary tenant membership. Best-effort: `saveLayout`'s
 * `extractionRunId` is nullable precisely because a layout is still useful
 * evidence without it, so a failure here is swallowed to `null` rather than
 * failing the whole shadow attempt over a link that is a courtesy, not a
 * requirement.
 */
async function latestExtractionRunId(
  workerUserId: string,
  tenantId: string,
  captureId: string,
): Promise<string | null> {
  return withTenantAs(getDb(), workerUserId, tenantId, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      select id from extraction_runs
       where capture_id = ${captureId}
       order by started_at desc
       limit 1
    `);
    return rows.rows[0]?.id ?? null;
  });
}

/**
 * Contract §3, step 1 — the fixed field list, built from the values THIS
 * extraction run produced. Deliberately NOT a read of `documents`/`parties`,
 * even though both hold columns with the same names — an earlier version of
 * this function did exactly that, and it was wrong.
 *
 * `parties` is a shared master record: `saveExtraction` (repo.ts) dedupes
 * suppliers across every capture from the same business and upserts its ABN
 * with `coalesce(excluded.abn, parties.abn)`, so the value sitting there right
 * now may be one a human corrected by hand, or one carried over from a
 * completely different capture on a completely different day. Grounding that
 * value answers "does the page support what the database ended up storing",
 * which is not a question anyone asked. `documents` has the same problem for
 * the same reason: a human can edit a document's fields after the fact.
 *
 * Grounding exists to check what THE MODEL said about THESE pixels, so it is
 * fed `extraction`'s own fields — `supplierName.value`, `supplierAbn.value`,
 * and so on — exactly as the model wrote them, before any merge or human
 * correction touched them. On the real two-page test capture this is the
 * difference between a measured rate of 100% (reading the corrected
 * `parties.abn`) and the correct 80% (reading what the model actually wrote,
 * which misread the ABN's last three digits) — the whole point of the
 * feature is that second number, not the first. Do not switch this back to a
 * `documents`/`parties` read.
 */
function fieldsToGround(extraction: Extraction): FieldToGround[] {
  return [
    { path: 'header.supplier', kind: 'text', value: extraction.supplierName.value },
    { path: 'header.supplier_abn', kind: 'abn', value: extraction.supplierAbn.value },
    { path: 'header.issue_date', kind: 'date', value: extraction.issueDate.value },
    { path: 'header.payable_amount', kind: 'money', value: extraction.payableAmount.value },
    { path: 'header.tax_amount', kind: 'money', value: extraction.taxAmount.value },
  ];
}

/**
 * Races `promise` against a hard deadline. On timeout the returned promise
 * rejects; `promise` itself is not cancelled (nothing below threads an
 * `AbortSignal` through `@snap/docai`'s `read()`), but every network call
 * inside it is already bounded by `SidecarEngine`'s own per-attempt timeout,
 * so an abandoned attempt still winds down on its own rather than hanging
 * forever in the background.
 */
function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Runs the OCR stage in shadow over one capture's pages and records the
 * result. See the file header for the safety contract; see
 * `docs/contracts/phase1b-shadow-stage.md` §3 for what it builds.
 *
 * `pageRows` must be the SAME `capture_pages` rows the extraction just read
 * (`worker.ts` passes the exact array it fetched for that purpose). When that
 * array is empty — a capture predating `capture_pages`, which falls back to
 * the single original file instead — there is nothing here matching "the
 * same pages extraction read", so this returns having done nothing. That is
 * a data-shape precondition, not a failure, and is not logged as one.
 *
 * `extraction` is the `ValidatedExtraction.extraction` the worker just passed
 * to `saveExtraction` for this same job — the model's own output, before any
 * dedup merge or human correction. See `fieldsToGround`'s comment for why
 * grounding reads from here and never from `documents`/`parties`. Grounding
 * is stored, never acted on: no finding, no `review_status`, no
 * `ato_compliance` change touches the document this run produced (contract
 * §3's other rule) — `extraction` is read here, never written to or through.
 */
export async function runShadowOcr(
  workerUserId: string,
  tenantId: string,
  captureId: string,
  extraction: Extraction,
  pageRows: CapturePageRow[],
): Promise<void> {
  const sidecarUrl = config().DOCAI_SIDECAR_URL;
  if (!sidecarUrl) return; // absent config, absent feature: no attempt, no log, no row.

  if (pageRows.length === 0) return; // nothing extraction read from capture_pages to shadow.

  const budgetMs = config().DOCAI_SHADOW_TIMEOUT_MS;
  const startedAt = Date.now();

  try {
    await withDeadline(
      (async () => {
        const pageInputs = toPageInputs(pageRows);
        const engines = [
          new PdfTextEngine(),
          new SidecarEngine({
            baseUrl: sidecarUrl,
            // Derived from the budget, with a floor and deliberately NO
            // ceiling. An earlier version capped this at 10s so one slow page
            // could not starve the rest — reasonable in the abstract, and
            // wrong by a factor of two in practice: PP-OCRv5 on CPU takes
            // ~20s on a full-page PDF render, so every call aborted client
            // side while the sidecar went on to finish work nobody was
            // waiting for. The symptom was a layout with zero spans and the
            // page marked unreadable, next to a sidecar log full of 200s.
            //
            // The outer `withDeadline` is the real backstop, as the rest of
            // this comment always said — so let it be, rather than second
            // guessing it with a number picked before anyone had measured a
            // page.
            timeoutMs: Math.max(5_000, Math.floor(budgetMs / 2)),
          }),
        ];

        const doc = await readDocument(pageInputs, engines, 'cloud-au');

        const runId = randomUUID();
        const storageKey = `${tenantId}/layouts/${captureId}/${runId}.json`;
        putAt(storageKey, Buffer.from(JSON.stringify(doc)));

        const extractionRunId = await latestExtractionRunId(workerUserId, tenantId, captureId).catch(
          () => null,
        );

        const { layoutId } = await saveLayout(workerUserId, tenantId, {
          captureId,
          extractionRunId,
          storageKey,
          docdomVersion: DOCDOM_VERSION,
          pageCount: doc.pages.length,
          engineIds: engineIdsOf(doc),
          spanCount: spanCountOf(doc),
          unreadableCount: doc.unreadable.length,
          shadow: true,
        });

        // Contract §3, steps 1-4. Grounds the extraction the worker just
        // saved against the DocDOM just stored above, and persists the
        // result — advisory only, per `packages/docai/src/grounding.ts`'s
        // header and contract §2: `enforced` stays false, and nothing here
        // can raise a finding, change `review_status`, or touch
        // `ato_compliance`.
        //
        // Its own try/catch, deliberately separate from the one around this
        // whole function: by this point `saveLayout` has already succeeded,
        // so a grounding failure must never be reported as "OCR shadow stage
        // failed" (misleading — the OCR stage did not fail, the DocDOM is
        // already stored) and must never stop that success from standing. One
        // line, on failure, same discipline as the outer catch, just its own
        // line rather than a borrowed one.
        try {
          const fields = fieldsToGround(extraction);
          const report = groundExtraction(doc, fields);
          await saveFieldGrounding(
            workerUserId,
            tenantId,
            fields.map((f) => {
              const g = report.fields[f.path]!;
              return {
                captureId,
                layoutId,
                fieldPath: f.path,
                value: g.value,
                grounded: g.grounded,
                spanIds: g.spanIds,
                box: g.box,
                page: g.page,
                confidence: g.confidence,
              };
            }),
          );
          const pct = (report.rate * 100).toFixed(0);
          const ungroundedNote =
            report.ungrounded.length > 0 ? ` — ungrounded: ${report.ungrounded.join(', ')}` : '';
          console.log(`capture ${captureId}: grounding ${pct}%${ungroundedNote}`);
        } catch (groundingError) {
          const message =
            groundingError instanceof Error ? groundingError.message : String(groundingError);
          console.warn(`capture ${captureId}: grounding failed after layout ${layoutId} — ${message}`);
        }
      })(),
      budgetMs,
      'OCR shadow stage',
    );
  } catch (error) {
    // One line, on failure, and nothing else. The extraction result this job
    // already saved is untouched — this stage is advisory evidence-gathering,
    // never a gate on the document that already shipped.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `capture ${captureId}: OCR shadow stage failed after ${Date.now() - startedAt}ms — ${message}`,
    );
  }
}
