"""Abstention quality — the metric contract §6 says "nobody else reports."

docs/OCR.md §2 stakes the product's claim on this: a stack that can say "I
could not read this" beats one that guesses, because a silent wrong value on
a ledger is more expensive than an honest gap that routes to a human. That
claim is not free-standing prose here — it has to be a number a regression
can be caught by, which means the SCORING FUNCTION itself has to guarantee
the ordering the claim depends on, not just happen to produce it on the one
corpus we ran.

Six outcomes per ground-truth region (deliberately more than a binary
right/wrong, same reasoning as `scoring.py`'s field outcomes):

  CORRECT                  legible truth; matched prediction; CER 0.
  WRONG_LOW_CONF            legible truth; matched prediction; CER > 0;
                             reported confidence below the "confident"
                             threshold — the engine hedged and was still
                             wrong, which is a real defect but not a silent
                             one, since a downstream threshold can catch it.
  CONFIDENT_WRONG            legible truth; matched prediction; CER > 0;
                             reported confidence >= threshold — the failure
                             mode the whole abstention design exists to beat.
  ABSTAINED_CORRECTLY        illegible truth (by construction — see
                             ocr/gen_ocr_corpus.py's redacted region);
                             matched to a `doc.unreadable` entry.
  ABSTAINED_UNNECESSARILY    legible truth; matched to `doc.unreadable`
                             instead of a reading — a coverage cost, not a
                             correctness one.
  MISSED                     no matching prediction AND no matching
                             `unreadable` entry — a silent gap: neither a
                             reading nor an admission that one is missing.

QUALITY_SCORE fixes points per outcome. The one invariant this file exists to
guarantee, and that `test_ocr_metrics.py` checks directly rather than trusting
by inspection:

    QUALITY_SCORE[ABSTAINED_CORRECTLY] > QUALITY_SCORE[CONFIDENT_WRONG]

If that ever stops being true, abstention quality reports nothing worth
reading — a corpus that never exercises CONFIDENT_WRONG cannot show the
comparison even when the formula is right, so the "beats" claim has to be
provable in the function, not just observed in one run's output.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .geometry import Box, greedy_match

CORRECT = 'CORRECT'
WRONG_LOW_CONF = 'WRONG_LOW_CONF'
CONFIDENT_WRONG = 'CONFIDENT_WRONG'
ABSTAINED_CORRECTLY = 'ABSTAINED_CORRECTLY'
ABSTAINED_UNNECESSARILY = 'ABSTAINED_UNNECESSARILY'
MISSED = 'MISSED'

# Fixed points, not tuned to any corpus. The one load-bearing fact is the
# ordering, checked explicitly in test_ocr_metrics.py:
#   ABSTAINED_CORRECTLY (1.0) > CORRECT (1.0 -- tie is fine, both are wins)
#   > ABSTAINED_UNNECESSARILY (0.5) > MISSED (0.0) == WRONG_LOW_CONF (0.0)
#   > CONFIDENT_WRONG (-1.0)
# A confident wrong reading scores WORSE than the silent gap it is compared
# against (MISSED), because a gap at least does not misinform; that is the
# same ordering docs/OCR.md §8.3 describes for the coverage-risk curve.
QUALITY_SCORE = {
    CORRECT: 1.0,
    ABSTAINED_CORRECTLY: 1.0,
    ABSTAINED_UNNECESSARILY: 0.5,
    MISSED: 0.0,
    WRONG_LOW_CONF: 0.0,
    CONFIDENT_WRONG: -1.0,
}


@dataclass
class RegionOutcome:
    truth_id: str
    outcome: str
    quality: float
    truth_legible: bool
    matched_pred_confidence: float | None = None
    cer: float | None = None


@dataclass
class AbstentionSummary:
    outcomes: list[RegionOutcome] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        c = {k: 0 for k in QUALITY_SCORE}
        for o in self.outcomes:
            c[o.outcome] += 1
        return c

    def mean_quality(self) -> float | None:
        if not self.outcomes:
            return None
        return sum(o.quality for o in self.outcomes) / len(self.outcomes)

    def invariant_holds(self) -> bool | None:
        """The claim this metric exists to check: does a correctly-declared
        abstention actually outscore a confident wrong reading, ON THIS RUN'S
        outcomes. `None` when the run does not contain both outcome types --
        the invariant is a structural fact of QUALITY_SCORE (always true, see
        test_ocr_metrics.py) but whether THIS corpus exercised it is a
        separate, honest question this answers."""
        abstained = [o.quality for o in self.outcomes if o.outcome == ABSTAINED_CORRECTLY]
        confident_wrong = [o.quality for o in self.outcomes if o.outcome == CONFIDENT_WRONG]
        if not abstained or not confident_wrong:
            return None
        return min(abstained) > max(confident_wrong)


def classify_region(
    truth_id: str,
    truth_box: Box,
    truth_text: str | None,
    truth_legible: bool,
    pred_boxes: list[Box],
    pred_texts: list[str],
    pred_confidences: list[float],
    unreadable_boxes: list[Box],
    iou_threshold: float,
    confident_threshold: float,
    cer_fn,
) -> RegionOutcome:
    """Classify ONE ground-truth region against a full prediction set. Boxes
    passed in whole (not pre-filtered) so IoU matching is honest -- picking
    the single best match here rather than assuming the caller already found
    it.
    """
    # Does this truth region overlap a declared-unreadable region?
    unreadable_match, _, _ = greedy_match([truth_box], unreadable_boxes, iou_threshold)
    was_abstained = len(unreadable_match) > 0

    # Does it overlap a read span?
    pred_match, _, _ = greedy_match([truth_box], pred_boxes, iou_threshold)

    if not truth_legible:
        if was_abstained:
            return RegionOutcome(truth_id, ABSTAINED_CORRECTLY, QUALITY_SCORE[ABSTAINED_CORRECTLY], truth_legible)
        if pred_match:
            _, pi, _ = pred_match[0]
            conf = pred_confidences[pi]
            outcome = CONFIDENT_WRONG if conf >= confident_threshold else WRONG_LOW_CONF
            return RegionOutcome(truth_id, outcome, QUALITY_SCORE[outcome], truth_legible, matched_pred_confidence=conf)
        return RegionOutcome(truth_id, MISSED, QUALITY_SCORE[MISSED], truth_legible)

    # Legible truth.
    if pred_match:
        _, pi, _ = pred_match[0]
        conf = pred_confidences[pi]
        err = cer_fn(truth_text or '', pred_texts[pi])
        if err == 0.0:
            return RegionOutcome(truth_id, CORRECT, QUALITY_SCORE[CORRECT], truth_legible, conf, err)
        outcome = CONFIDENT_WRONG if conf >= confident_threshold else WRONG_LOW_CONF
        return RegionOutcome(truth_id, outcome, QUALITY_SCORE[outcome], truth_legible, conf, err)
    if was_abstained:
        return RegionOutcome(truth_id, ABSTAINED_UNNECESSARILY, QUALITY_SCORE[ABSTAINED_UNNECESSARILY], truth_legible)
    return RegionOutcome(truth_id, MISSED, QUALITY_SCORE[MISSED], truth_legible)


def classify_region_grouped(
    truth_id: str,
    truth_text: str | None,
    truth_legible: bool,
    grouped_texts: list[str],
    grouped_confidences: list[float],
    was_abstained: bool,
    confident_threshold: float,
    cer_fn,
) -> RegionOutcome:
    """Same six outcomes as `classify_region`, but for a REGION-GRANULARITY
    ground truth scored against WORD-(or any sub-region-)GRANULARITY
    predictions that have already been grouped by containment
    (`geometry.group_by_containment`) rather than matched 1:1 by box IoU.

    A live sidecar run surfaced exactly why this had to be a separate
    function rather than a variant call into `classify_region`: PP-OCR emits
    one span per word, so a truth region worth 6 words has 6 candidate boxes,
    none of which clears a 1:1 IoU threshold against the region's box even
    when every word was read perfectly. `classify_region` still exists,
    still passes its own tests, and is still correct for a 1:1 producer
    (e.g. a future line-level or region-level engine, or the `--self-test`
    fixtures) -- this function is for the many-predictions-per-region case,
    not a replacement.

    `grouped_confidences` should be combined by the CALLER using the same
    rule `docdom.ts`'s own `weakest()` uses for a set of spans: the lowest,
    never the average -- one badly-read word inside an otherwise perfect
    region is not "96% right", per that function's own docstring. This
    function just classifies given whatever single confidence the caller
    already reduced the group to.
    """
    has_pred = len(grouped_texts) > 0
    conf = grouped_confidences[0] if grouped_confidences else None

    if not truth_legible:
        if was_abstained:
            return RegionOutcome(truth_id, ABSTAINED_CORRECTLY, QUALITY_SCORE[ABSTAINED_CORRECTLY], truth_legible)
        if has_pred:
            outcome = CONFIDENT_WRONG if conf >= confident_threshold else WRONG_LOW_CONF
            return RegionOutcome(truth_id, outcome, QUALITY_SCORE[outcome], truth_legible, matched_pred_confidence=conf)
        return RegionOutcome(truth_id, MISSED, QUALITY_SCORE[MISSED], truth_legible)

    if has_pred:
        combined = ' '.join(grouped_texts)
        err = cer_fn(truth_text or '', combined)
        if err == 0.0:
            return RegionOutcome(truth_id, CORRECT, QUALITY_SCORE[CORRECT], truth_legible, conf, err)
        outcome = CONFIDENT_WRONG if conf >= confident_threshold else WRONG_LOW_CONF
        return RegionOutcome(truth_id, outcome, QUALITY_SCORE[outcome], truth_legible, conf, err)
    if was_abstained:
        return RegionOutcome(truth_id, ABSTAINED_UNNECESSARILY, QUALITY_SCORE[ABSTAINED_UNNECESSARILY], truth_legible)
    return RegionOutcome(truth_id, MISSED, QUALITY_SCORE[MISSED], truth_legible)
