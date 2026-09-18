import type { Block, Document } from '@snap/api-contract/docdom';
import type { PreviewFields } from '@snap/docai-preview';

/**
 * OD-13 — the live quality gate. `docs/ON-DEVICE.md` §11 Stage 2, formally
 * gated on GAPS B3 (calibration), which is gated on GAPS B1 (a real
 * Australian corpus) — and B1 is PARKED by the owner. The owner's instruction
 * for closing it anyway is the reason this file is shaped the way it is, so
 * it is repeated here rather than only in a ticket nobody re-reads:
 *
 *   You may not invent a calibrated threshold. `docs/GAPS.md` already names
 *   `LOW_CONFIDENCE_THRESHOLD = 0.8` in `packages/docai/src/pipeline.ts` as a
 *   number labelled a threshold that nothing calibrated — the engine still
 *   reports `calibrated: false` on every span it produces. Shipping a second
 *   number in that exact shape would be the same defect, twice.
 *
 * So the gate is split by what each case actually needs:
 *
 * ── THRESHOLD-FREE — implemented, LIVE, on by default ──────────────────────
 * Each of these is a fact about what came back, not a score against a guess:
 *
 *   - `no-text`  — the recogniser returned (effectively) no text at all. A
 *     DocDOM with zero blocks, or whose every span is empty/whitespace, is a
 *     fact about what `snap-ocr` produced. Catches the finger-over-the-docket
 *     case and a photo of a blank or unrelated surface.
 *   - `no-total` — the deterministic structurer (`@snap/docai-preview`)
 *     found no `header.payable_amount`. The field is either present or it is
 *     not (§3.4: "No keyword line has an amount" is the only abstention
 *     rule, with no confidence-based fallback) — there is nothing here to
 *     calibrate.
 *
 * These two are the honest core of OD-13: genuinely useful, and they need no
 * gold-set, no calibration curve, no owner sign-off on a number.
 *
 * ── SCORE-BASED — the mechanism exists, and it is OFF ───────────────────────
 * `LOW_CONFIDENCE_GATE_ENABLED` is `false` and `LOW_CONFIDENCE_GATE_THRESHOLD`
 * is `null`. GAPS B3 has not run a coverage–risk curve against real
 * Australian paper, so any number placed here today would be exactly the
 * placeholder `docs/GAPS.md` already calls out as a defect — a plausible
 * guess wearing the name "threshold". When B1/B3 land, someone who has looked
 * at that curve sets `LOW_CONFIDENCE_GATE_THRESHOLD` to a real number and
 * flips the flag. Nothing in this module may do that on their behalf: even
 * with the flag flipped, a `null` threshold fails closed rather than running
 * on a value nobody chose.
 *
 * ── NOT IMPLEMENTED — "no page-like quadrilateral was found" ────────────────
 * No document-boundary / quadrilateral detector exists anywhere in this
 * codebase. `apps/mobile/src/app/(tabs)/capture.tsx`'s own history records
 * the reason this is not faked: an earlier version of that screen showed the
 * static copy *"Document detected · sharp · all four corners in frame"*, and
 * its own removal comment says plainly that nothing ever measured document
 * detection, sharpness or corners — a hardcoded verdict is exactly the
 * failure this ticket exists to not repeat. `DocDOM`'s `Page` type
 * (`packages/api-contract/src/docdom.ts`) carries no quad/corner field, and
 * `snap-ocr`'s recognisers (Vision, ML Kit) report TEXT boxes, not page
 * boundaries — there is no signal to read here without a new native
 * capability, and `apps/mobile/modules/snap-ocr/` is out of scope for this
 * ticket (owned by another session). Left out rather than approximated.
 *
 * ── NEVER THROWS ─────────────────────────────────────────────────────────
 * `docs/ON-DEVICE.md` §9's rule for `readOnDevice` (`./device-read.ts`)
 * applies here verbatim: the capture is the product, and the preview —
 * including this gate — may never cost one. `evaluateQualityGate` catches
 * everything internally and returns `null` rather than propagate, so a
 * caller never needs a try/catch of its own to stay safe, exactly as
 * `readOnDevice` needs none around `recognise`/`structure`. Proven in
 * `quality-gate.test.ts` by handing it a document that throws when read and
 * asserting the result is `null`, not a thrown error.
 */

export type QualityGateReason = 'no-text' | 'no-total' | 'low-confidence';

export type QualityGateWarning = {
  reason: QualityGateReason;
  /** Shown to the person. Never blames the docket; always names the honest next step. */
  copy: string;
};

/**
 * NOT CALIBRATED — see the module comment. Do not set this `true` without a
 * measured coverage–risk curve from GAPS B3 behind the threshold below.
 */
export const LOW_CONFIDENCE_GATE_ENABLED = false;

/**
 * NOT CALIBRATED. Deliberately `null` rather than a plausible-looking number:
 * flipping `LOW_CONFIDENCE_GATE_ENABLED` on without also setting this from
 * measured data fails CLOSED — the gate stays silent — rather than silently
 * running on a guess.
 */
export const LOW_CONFIDENCE_GATE_THRESHOLD: number | null = null;

const RETAKE_COPY: Record<'no-text' | 'no-total', string> = {
  'no-text':
    "This phone couldn't find any text on that photo. Retake it, or continue — the server will read it properly.",
  'no-total':
    "This phone couldn't find a total on that photo. Retake it, or continue — the server will read it properly.",
};

/** Every span in the document, without needing `@snap/docai` (mobile cannot depend on it). */
function* allSpans(doc: Partial<Document>) {
  for (const block of (doc.blocks ?? []) as Block[]) {
    for (const line of block.lines ?? []) {
      for (const span of line.spans ?? []) {
        yield span;
      }
    }
  }
}

function hasReadableText(doc: Partial<Document>): boolean {
  for (const span of allSpans(doc)) {
    if (span.text && span.text.trim().length > 0) return true;
  }
  return false;
}

function weakestConfidence(doc: Partial<Document>): number | null {
  let min: number | null = null;
  for (const span of allSpans(doc)) {
    const c = span.provenance?.confidence;
    if (typeof c === 'number' && (min === null || c < min)) min = c;
  }
  return min;
}

/**
 * Evaluate the gate for one captured page.
 *
 * `document` is the DocDOM `snap-ocr` produced; `fields` is what
 * `@snap/docai-preview`'s `structure()` made of it — both already computed
 * by the time `readOnDevice` calls this, so evaluating the gate does no I/O
 * and recognises nothing itself. Returns `null` when there is nothing to
 * warn about, INCLUDING when anything above throws: see the module comment.
 */
export function evaluateQualityGate(
  document: Partial<Document> | null | undefined,
  fields: PreviewFields | null | undefined,
): QualityGateWarning | null {
  try {
    if (!document) return null;

    // The more fundamental fact first: no text at all subsumes "no total",
    // and deserves its own copy (a docket that failed to focus reads
    // differently from one that focused fine but has no printed total).
    if (!hasReadableText(document)) {
      return { reason: 'no-text', copy: RETAKE_COPY['no-text'] };
    }

    const total = fields?.['header.payable_amount'];
    if (!total || total.value === null) {
      return { reason: 'no-total', copy: RETAKE_COPY['no-total'] };
    }

    // SCORE-BASED, OFF BY DEFAULT. Both conditions below are checked
    // explicitly — flipping the flag with no threshold set must not run this
    // on a coincidental fallback value.
    if (LOW_CONFIDENCE_GATE_ENABLED && LOW_CONFIDENCE_GATE_THRESHOLD !== null) {
      const weakest = weakestConfidence(document);
      if (weakest !== null && weakest < LOW_CONFIDENCE_GATE_THRESHOLD) {
        return {
          reason: 'low-confidence',
          copy: "This phone isn't confident it read that correctly. Retake it, or continue — the server will read it properly.",
        };
      }
    }

    return null;
  } catch {
    // See "NEVER THROWS" above. A gate that fails must fail into silence,
    // not into a broken capture.
    return null;
  }
}
