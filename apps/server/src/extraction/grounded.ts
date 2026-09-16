import { spanIndex, unionBox, weakest, type Box, type Document, type Span } from '@snap/docai';

/**
 * Grounded extraction: the model POINTS, it does not read.
 *
 * `docs/GAPS.md` C1 and `docs/OCR.md` §4.7 state the whole design in one line —
 * *the extractor's job is reduced from reading to pointing.* Instead of handing
 * a vision model a page and asking for JSON, it is handed the page **and the
 * spans an independent recogniser found on it**, and asked which spans carry
 * each field.
 *
 * ── What that buys, and it is not accuracy ──────────────────────────────────
 *
 * A free-reading model can emit `payableAmount: "48.50"` from nowhere. A
 * pointing model can only name spans, and this module derives the value from
 * the span text. **A pointed field cannot be invented** — not "is unlikely to
 * be", cannot. The failure mode changes from *fabricate a number* into *point
 * at the wrong span*, which is checkable by anyone with the overlay, because
 * every answer now has coordinates.
 *
 * That is D16 made structural rather than aspirational, and it is what finally
 * delivers the `bbox` `docs/extraction-schema.json` has promised since the
 * beginning and `types.ts` could never supply.
 *
 * ── C2: no span means null ──────────────────────────────────────────────────
 *
 * A field the model could not point at comes back **null** — not a low
 * confidence, not a guess with a warning. `docs/GAPS.md` C2 is explicit, and it
 * is only affordable because the pointing works: measured 2026-09-16, grounding
 * found 48 of 48 true values on Australian-shaped documents at every
 * degradation level (`docs/contracts/phase1c-grounding.md`). A field with no
 * span is a field the recogniser never read, and asserting a value for it would
 * be asserting something no independent reading supports.
 *
 * ── What is NOT pointed at ──────────────────────────────────────────────────
 *
 * Some fields are judgements about the document rather than values printed on
 * it: whether the words "tax invoice" appear, whether the buyer is identified,
 * whether a line is GST-free. D16 says nothing may be ASSERTED that cannot be
 * pointed at; a boolean about the presence of wording is a different kind of
 * claim from a number, and forcing it through a span reference would be
 * ceremony. Those stay direct answers and are marked `grounded: false` so the
 * distinction survives into storage.
 */

/** A field the model answered by naming spans. */
export type SpanRef = {
  /** Span ids, in reading order, that together carry the value. */
  spans: string[];
  /** The model's own estimate. Advisory — the span confidence is the measured one. */
  confidence?: number;
};

export type GroundedValue = {
  /** Text of the referenced spans, joined. `null` when nothing was pointed at. */
  value: string | null;
  spanIds: string[];
  box: Box | null;
  page: number | null;
  /**
   * The WEAKEST supporting span's confidence, not the model's opinion.
   *
   * A total whose middle digit is a coin toss is not 96% right, which is why
   * `weakest()` exists rather than a mean.
   */
  confidence: number;
  grounded: boolean;
  /** Set when the model named a span that is not on the page. See `resolve`. */
  unknownSpans: string[];
};

/** Spans are only joined across a run this long; beyond it a "match" is a coincidence. */
const MAX_SPAN_RUN = 8;

function pageOf(doc: Document, spanId: string): number | null {
  for (const block of doc.blocks) {
    for (const line of block.lines) {
      if (line.spans.some((s) => s.id === spanId)) return block.page;
    }
  }
  return null;
}

/**
 * Resolve one span reference against the document.
 *
 * Every rejection below produces `grounded: false` and a null value, because
 * the alternative in each case is asserting something the page does not
 * support:
 *
 *  - **No spans named.** The model could not find it. C2.
 *  - **A span id that is not on the page.** The model invented an identifier,
 *    which is the pointing equivalent of inventing a value — and it is the
 *    failure this shape makes *visible* rather than silent. Recorded in
 *    `unknownSpans` so a run can be scored on how often it happens.
 *  - **More spans than `MAX_SPAN_RUN`.** A value assembled from a dozen boxes
 *    is not evidence, it is a coincidence with extra steps.
 */
export function resolve(doc: Document, ref: SpanRef | null | undefined): GroundedValue {
  const empty: GroundedValue = {
    value: null, spanIds: [], box: null, page: null,
    confidence: 0, grounded: false, unknownSpans: [],
  };
  if (!ref || !Array.isArray(ref.spans) || ref.spans.length === 0) return empty;

  const index = spanIndex(doc);
  const unknown = ref.spans.filter((id) => !index.has(id));
  if (unknown.length > 0) return { ...empty, unknownSpans: unknown };
  if (ref.spans.length > MAX_SPAN_RUN) return empty;

  const spans = ref.spans.map((id) => index.get(id) as Span);
  const boxes = spans.map((s) => s.box).filter(Boolean) as Box[];

  return {
    // Joined with a single space and trimmed. The VALUE comes from the page,
    // never from the model — that is the entire guarantee of this module.
    value: spans.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim() || null,
    spanIds: [...ref.spans],
    box: unionBox(boxes),
    page: pageOf(doc, ref.spans[0] as string),
    confidence: weakest(spans),
    grounded: true,
    unknownSpans: [],
  };
}

/** Fields the model points at. Anything not here is a judgement, not a value. */
export const POINTED_FIELDS = [
  'documentNumber',
  'issueDate',
  'supplierName',
  'supplierAbn',
  'taxExclusiveAmount',
  'taxAmount',
  'payableAmount',
] as const;

export type PointedField = (typeof POINTED_FIELDS)[number];

export type GroundedExtraction = {
  fields: Record<PointedField, GroundedValue>;
  /** Every span the model named that does not exist. Empty is the healthy case. */
  unknownSpans: string[];
  /** Pointed fields that resolved / pointed fields the model attempted. */
  groundedRate: number;
};

export function resolveAll(
  doc: Document,
  refs: Partial<Record<PointedField, SpanRef | null>>,
): GroundedExtraction {
  const fields = {} as Record<PointedField, GroundedValue>;
  const unknown: string[] = [];
  let attempted = 0;
  let grounded = 0;

  for (const name of POINTED_FIELDS) {
    const resolved = resolve(doc, refs[name]);
    fields[name] = resolved;
    unknown.push(...resolved.unknownSpans);
    // A field the model declined to point at is an abstention, not a failure:
    // it is the correct answer for a docket that prints no ABN. Only fields it
    // TRIED to point at count towards the rate.
    const tried = Boolean(refs[name]?.spans?.length);
    if (tried) {
      attempted += 1;
      if (resolved.grounded) grounded += 1;
    }
  }

  return {
    fields,
    unknownSpans: unknown,
    groundedRate: attempted === 0 ? 1 : grounded / attempted,
  };
}

/**
 * The span catalogue the model is shown, as compact lines.
 *
 * `id<TAB>text`, one per line, in reading order. Ids are the DocDOM's own, so
 * whatever the model names maps straight back with no translation layer — the
 * Phase 1 sidecar contract's rule applied here: *"the adapter must not have to
 * translate a foreign shape; that translation is where coordinate bugs live."*
 */
export function renderSpanCatalogue(doc: Document, limit = 1200): string {
  const out: string[] = [];
  for (const block of doc.blocks) {
    for (const line of block.lines) {
      const text = line.spans.map((s) => s.text).join(' ').trim();
      if (!text) continue;
      // The line's own text first, so the model can see the phrase, then the
      // individual span ids it must choose among.
      out.push(`# ${text}`);
      for (const span of line.spans) {
        if (!span.text.trim()) continue;
        out.push(`${span.id}\t${span.text}`);
        if (out.length >= limit) return out.join('\n');
      }
    }
  }
  return out.join('\n');
}
