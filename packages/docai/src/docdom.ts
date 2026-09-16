/**
 * DocDOM — what a document IS, once it has been read.
 *
 * The TYPES now live in `@snap/api-contract` (`docs/OCR.md` §3.1) so the mobile
 * app can render overlays without importing this package's reading pipeline.
 * They are re-exported here unchanged, so every existing caller of
 * `@snap/docai` is untouched — and there is still exactly one declaration of
 * `Document` in the workspace.
 *
 * The reading HELPERS stay here, because they are code rather than contract and
 * nothing on the phone calls them.
 *
 * The three properties the shape exists to hold, kept here because they are the
 * reason it looks the way it does:
 *
 *  1. **Every node knows where it is** — a `Box` in ORIGINAL page coordinates,
 *     not those of whatever deskewed derivative the recogniser read. A
 *     highlight right on the derivative and wrong on the original is worse than
 *     no highlight, because the original is the legal record.
 *  2. **Every node knows who said so.** Two engines disagreeing on a region is
 *     the most reliable hallucination signal available, and it cannot be
 *     computed if the reading is anonymous.
 *  3. **Nothing here is a field.** No `total`, no `supplierAbn`. Those are
 *     produced by the semantic layer POINTING at spans (D16). A value that
 *     cannot point at a span is not a value.
 */

export * from '@snap/api-contract/docdom';

import type { Box, Document, Span } from '@snap/api-contract/docdom';

/* ── Reading helpers ─────────────────────────────────────────────────────── */

/** Every span in the document, in reading order. The usual entry point. */
export function spansOf(doc: Document): Span[] {
  return [...doc.blocks]
    .sort((a, b) => a.page - b.page || a.order - b.order)
    .flatMap((b) => [...b.lines].sort((l, r) => l.order - r.order).flatMap((l) => l.spans));
}

/** Look one up by id. Grounding resolves spans constantly, so this is hot. */
export function spanIndex(doc: Document): Map<string, Span> {
  return new Map(spansOf(doc).map((s) => [s.id, s]));
}

/**
 * The smallest box containing all of them, in original coordinates.
 *
 * A grounded field cites several spans — `$1,234.56` may be three — and the
 * review screen needs one rectangle to draw.
 */
export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The confidence of a set of spans: the LOWEST, never the average.
 *
 * A total read as `17519.31` where the `1` is a coin toss is not 96% correct;
 * it is probably wrong. Averaging hides exactly the digit that matters, which
 * is the arithmetic that makes a confident wrong ABN possible.
 */
export function weakest(spans: Span[]): number {
  return spans.length === 0 ? 0 : Math.min(...spans.map((s) => s.provenance.confidence));
}
