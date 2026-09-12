/**
 * `read(pages, engines, profile)` — turn pages into one Document.
 *
 * Two rules from docs/contracts/phase1-ocr-stage.md §5.3 and docs/OCR.md
 * §4.4-4.5 govern everything below:
 *
 *  1. **Cheapest capable engine first, escalate only on failure.** Most of a
 *     page is tier 0 or tier 1 (§4.4) — running a GPU-class engine over text
 *     a PDF already gave us for free is waste, not thoroughness.
 *  2. **Disagreement is data, not noise.** Where two engines read the same
 *     region and disagree, that disagreement is recorded in
 *     `provenance.disputedBy` rather than one reading silently overwriting
 *     the other (§4.5) — it is the calibration signal D20 depends on, and
 *     it is cheaper to compute than anything else that approximates it.
 *
 * What "escalation" means here, concretely, at PAGE granularity (the
 * contract's own phrase: "route each page to the cheapest capable engine"):
 *
 *  - If the cheapest engine THROWS or returns nothing at all (no blocks, no
 *    `unreadable`) — it had nothing to contribute, whether because it hit an
 *    error or because it plainly does not apply (`pdf-text` on a scanned
 *    page has no embedded layer to read) — the next engine in the chain
 *    reads the WHOLE page instead. Both are equally "no coverage"; treating
 *    them alike keeps an engine's decision to abstain quietly from being
 *    punished relative to one that throws loudly for the same reason.
 *  - If the cheapest engine succeeds but leaves some regions in its own
 *    `unreadable` list, the NEXT engine is asked to read only those regions
 *    (`PageInput.region`) — cheaper than re-reading the whole page, and the
 *    reason that field exists in the frozen `PageInput` type.
 *  - If the cheapest engine succeeds with a LOW-CONFIDENCE span, the next
 *    engine is asked to confirm just that span's box. Agreement is dropped
 *    (nothing to record); disagreement is attached to the original span's
 *    `provenance.disputedBy`. This is the one case where two engines
 *    deliberately read the same region on purpose, rather than one filling a
 *    gap the other left.
 *
 * None of this is calibration (D20) — there is no temperature scaling here,
 * and `LOW_CONFIDENCE_THRESHOLD` is a placeholder cutoff, not a calibrated
 * one. It exists so the confirmation pass above has something to trigger on;
 * turning "0.8" into a number backed by evidence is docs/OCR.md §4.5's job,
 * not this file's.
 */

import type { Box, Document, Provenance, Span } from './docdom.js';
import { DOCDOM_VERSION } from './docdom.js';
import type { Capability, Engine, PageInput, Profile } from './registry.js';
import { chain, NoEngineAvailableError } from './registry.js';

/** Below this, a span's own reading is confirmed against the next engine in the chain. Not calibrated — see the file header. */
const LOW_CONFIDENCE_THRESHOLD = 0.8;

export type ReadOptions = {
  /** The capability driving engine order. Defaults to 'recognise': for phase 1's two engines (pdf-text, sidecar) detect and recognise are produced together, so this is the one chain that matters. */
  capability?: Capability;
  lowConfidenceThreshold?: number;
};

function fullPageBox(page: PageInput['page']): Box {
  return { x: 0, y: 0, width: page.width, height: page.height };
}

function normaliseText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function allSpans(partial: Partial<Document>): Span[] {
  return (partial.blocks ?? []).flatMap((b) => b.lines.flatMap((l) => l.spans));
}

/**
 * True once a partial document represents an actual reading — text, a
 * table, a figure, a form field, or a region explicitly declared
 * unreadable. An engine that came back with NONE of these abstained; that
 * is not a reading to keep, and is treated the same as a thrown error for
 * escalation purposes. Every content-bearing field of `Document` has to be
 * checked here, not just `blocks` — a table-only or figure-only result is
 * still a real reading, and the first version of this function dropped it
 * on the floor by only looking at `blocks`.
 */
function hasCoverage(partial: Partial<Document>): boolean {
  return (
    (partial.blocks?.length ?? 0) > 0 ||
    (partial.tables?.length ?? 0) > 0 ||
    (partial.figures?.length ?? 0) > 0 ||
    (partial.fields?.length ?? 0) > 0 ||
    (partial.unreadable?.length ?? 0) > 0
  );
}

/**
 * Tries each engine in order for one `region` of `input`, returning the
 * first one that produces an actual reading (see `hasCoverage`). Engines
 * that throw are skipped, same as in the primary pass — a region-level
 * escalation is not the place to surface a transport error that the primary
 * pass already tolerated for the whole page.
 */
async function readRegion(
  candidates: Engine[],
  input: PageInput,
  region: Box,
): Promise<{ engine: Engine; partial: Partial<Document> } | null> {
  for (const engine of candidates) {
    try {
      const partial = await engine.read({ ...input, region });
      if (hasCoverage(partial)) return { engine, partial };
    } catch {
      // Same tolerance as the primary chain: a region-confirmation call
      // failing does not fail the page, it just leaves the original
      // reading unconfirmed.
    }
  }
  return null;
}

/**
 * Reads every page and merges the result into one Document.
 *
 * `pages` supplies both the metadata (`Page`, for `Document.pages`) and the
 * bytes each engine needs (`PageInput`) — the pipeline does not re-derive
 * either.
 */
export async function read(
  pages: PageInput[],
  engines: Engine[],
  profile: Profile,
  options: ReadOptions = {},
): Promise<Document> {
  const capability = options.capability ?? 'recognise';
  const threshold = options.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;

  const specs = engines.map((e) => e.spec);
  const engineById = new Map(engines.map((e) => [e.spec.id, e]));

  const doc: Document = {
    version: DOCDOM_VERSION,
    pages: [],
    blocks: [],
    tables: [],
    figures: [],
    fields: [],
    unreadable: [],
  };

  for (const input of pages) {
    doc.pages.push(input.page);

    const orderedEngines = chain(specs, capability, profile).map((s) => engineById.get(s.id)!);

    if (orderedEngines.length === 0) {
      doc.unreadable.push({
        page: input.page.number,
        box: fullPageBox(input.page),
        reason: new NoEngineAvailableError(capability, profile).message,
      });
      continue;
    }

    // Primary pass: cheapest-first, skipping an engine that throws OR
    // abstains (see file header) until one actually produces a reading.
    let primary: { engine: Engine; partial: Partial<Document> } | null = null;
    let lastReason = 'no engine was tried';
    let primaryIndex = -1;
    for (let i = 0; i < orderedEngines.length; i++) {
      const engine = orderedEngines[i]!;
      let partial: Partial<Document>;
      try {
        partial = await engine.read(input);
      } catch (err) {
        lastReason = `${engine.spec.id} failed: ${err instanceof Error ? err.message : String(err)}`;
        continue;
      }
      if (!hasCoverage(partial)) {
        lastReason = `${engine.spec.id} produced no reading for this page`;
        continue;
      }
      primary = { engine, partial };
      primaryIndex = i;
      break;
    }

    if (!primary) {
      doc.unreadable.push({ page: input.page.number, box: fullPageBox(input.page), reason: lastReason });
      continue;
    }

    const escalationCandidates = orderedEngines.slice(primaryIndex + 1);

    // Gap-filling: regions the primary engine explicitly abstained on.
    const stillUnreadable: Document['unreadable'] = [];
    for (const gap of primary.partial.unreadable ?? []) {
      const fill = escalationCandidates.length > 0 ? await readRegion(escalationCandidates, input, gap.box) : null;
      if (fill) {
        primary.partial.blocks = [...(primary.partial.blocks ?? []), ...(fill.partial.blocks ?? [])];
      } else {
        stillUnreadable.push(gap);
      }
    }

    // Confirmation: low-confidence spans get a second opinion. Agreement is
    // silent; disagreement is recorded on the ORIGINAL span rather than
    // replacing it — the primary engine's reading stays canonical (it was
    // cheapest-capable and produced a real answer), and the alternate
    // reading is preserved as evidence, per docs/OCR.md §4.5.
    if (escalationCandidates.length > 0) {
      for (const span of allSpans(primary.partial)) {
        if (span.provenance.confidence >= threshold) continue;
        const confirmation = await readRegion(escalationCandidates, input, span.box);
        const altSpan = confirmation ? allSpans(confirmation.partial)[0] : undefined;
        if (!altSpan) continue;
        if (normaliseText(altSpan.text) === normaliseText(span.text)) continue;
        recordDispute(span.provenance, {
          engine: confirmation!.engine.spec.id,
          text: altSpan.text,
          confidence: altSpan.provenance.confidence,
        });
      }
    }

    doc.blocks.push(...(primary.partial.blocks ?? []));
    doc.tables.push(...(primary.partial.tables ?? []));
    doc.figures.push(...(primary.partial.figures ?? []));
    doc.fields.push(...(primary.partial.fields ?? []));
    doc.unreadable.push(...stillUnreadable);
  }

  return doc;
}

function recordDispute(provenance: Provenance, dispute: { engine: string; text: string; confidence: number }): void {
  provenance.disputedBy = [...(provenance.disputedBy ?? []), dispute];
}
