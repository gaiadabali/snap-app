"""Box geometry and detection IoU.

`Box` mirrors `packages/docai/src/docdom.ts` exactly (x, y, width, height, in
ORIGINAL page pixel coordinates, origin top-left) so a box read out of a real
DocDOM JSON document needs no translation before it reaches this module —
translation at the boundary is where coordinate bugs live (contract §4), and
that applies to the scorer's own boundary as much as the sidecar's.

Deliberately NOT importing docdom.ts (it is TypeScript, and this is the
Python bench lane) — this is a structural, duck-typed re-statement of the
same four fields, read from JSON. If the shape in docdom.ts ever changes,
this comment is the tripwire for whoever changes it next.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    width: float
    height: float

    @property
    def x2(self) -> float:
        return self.x + self.width

    @property
    def y2(self) -> float:
        return self.y + self.height

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    @staticmethod
    def from_dict(d: dict) -> 'Box':
        return Box(x=float(d['x']), y=float(d['y']), width=float(d['width']), height=float(d['height']))


def iou(a: Box, b: Box) -> float:
    """Intersection-over-union of two boxes in the same coordinate space.

    0.0 for non-overlapping boxes (including a degenerate zero-area box on
    either side, which is a malformed detection, not a partial credit case).
    """
    ix1, iy1 = max(a.x, b.x), max(a.y, b.y)
    ix2, iy2 = min(a.x2, b.x2), min(a.y2, b.y2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0.0:
        return 0.0
    union = a.area + b.area - inter
    if union <= 0.0:
        return 0.0
    return inter / union


def containment_ratio(inner: Box, outer: Box) -> float:
    """What fraction of `inner`'s area lies inside `outer`. 1.0 when `inner`
    is entirely within `outer`, 0.0 for no overlap. Deliberately asymmetric
    (unlike IoU) -- this is the right predicate for "does this word-level
    span belong to that region-level truth box", where the span is small and
    the region is large, and plain IoU on a 1-word-vs-1-region pair would
    always be tiny even for a perfect containment (see the 45-spans-vs-6-
    regions defect this function exists to fix)."""
    ix1, iy1 = max(inner.x, outer.x), max(inner.y, outer.y)
    ix2, iy2 = min(inner.x2, outer.x2), min(inner.y2, outer.y2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0.0 or inner.area <= 0.0:
        return 0.0
    return inter / inner.area


def union_box(boxes: list[Box]) -> Box | None:
    """The smallest box containing all of them. Mirrors
    `packages/docai/src/docdom.ts`'s `unionBox` (same reasoning: several
    small spans grouped under one truth region need one rectangle to compare
    against that region's box for coverage)."""
    if not boxes:
        return None
    x = min(b.x for b in boxes)
    y = min(b.y for b in boxes)
    x2 = max(b.x2 for b in boxes)
    y2 = max(b.y2 for b in boxes)
    return Box(x=x, y=y, width=x2 - x, height=y2 - y)


def group_by_containment(
    truth_boxes: list[Box], pred_boxes: list[Box], containment_threshold: float = 0.5
) -> tuple[dict[int, list[int]], list[int]]:
    """Assign each PREDICTED box to at most one ground-truth region, by
    containment rather than 1:1 IoU.

    This is the grouping fix, not matching: an engine that emits word-level
    spans against region-level ground truth will never clear a 1:1 IoU
    threshold (a single word's box has almost no area in common with an
    8-word region, so its IoU against that region is tiny even though the
    word is entirely inside it and correctly read). Containment asks the
    right question instead -- "is this prediction's box (mostly) inside that
    truth region" -- and groups everything that answers yes, so CER/WER can
    be scored on the concatenation rather than on a single doomed pairing.

    Each predicted box goes to the truth region it is MOST contained by, if
    that ratio clears the threshold; a predicted box that is not
    well-contained by any truth region is a genuine miss (background text --
    a label, a header -- or a real false positive), reported separately as
    unassigned rather than forced into the nearest region.

    Returns (assignment, unassigned_pred_idx) where `assignment` maps
    truth_idx -> list of pred_idx, IN THE ORDER THEY WERE PASSED IN. Reading
    order is the caller's responsibility (DocDOM's own block/line `order`,
    not raster position -- see docdom_json.py) and is preserved here only
    because iteration order is preserved; this function does no reordering
    of its own.
    """
    assignment: dict[int, list[int]] = {}
    unassigned: list[int] = []
    for pi, p in enumerate(pred_boxes):
        best_ti, best_ratio = None, 0.0
        for ti, t in enumerate(truth_boxes):
            ratio = containment_ratio(p, t)
            if ratio > best_ratio:
                best_ti, best_ratio = ti, ratio
        if best_ti is not None and best_ratio >= containment_threshold:
            assignment.setdefault(best_ti, []).append(pi)
        else:
            unassigned.append(pi)
    return assignment, unassigned


def greedy_match(truth_boxes: list[Box], pred_boxes: list[Box], iou_threshold: float = 0.5) -> tuple[
    list[tuple[int, int, float]], list[int], list[int]
]:
    """Greedy IoU matching, highest-IoU-first (a lightweight stand-in for the
    Hungarian algorithm, adequate at the region counts a page produces — tens,
    not thousands).

    Returns (matches, unmatched_truth_idx, unmatched_pred_idx) where matches
    is a list of (truth_idx, pred_idx, iou), each index used at most once,
    and only pairs with iou >= iou_threshold are matched at all. A truth
    region with no prediction above threshold is a MISS (contract §6's
    "did we find the text at all"), not a low-IoU match.
    """
    candidates = []
    for ti, t in enumerate(truth_boxes):
        for pi, p in enumerate(pred_boxes):
            score = iou(t, p)
            if score >= iou_threshold:
                candidates.append((score, ti, pi))
    candidates.sort(key=lambda c: c[0], reverse=True)

    matched_t: set[int] = set()
    matched_p: set[int] = set()
    matches: list[tuple[int, int, float]] = []
    for score, ti, pi in candidates:
        if ti in matched_t or pi in matched_p:
            continue
        matched_t.add(ti)
        matched_p.add(pi)
        matches.append((ti, pi, score))

    unmatched_truth = [i for i in range(len(truth_boxes)) if i not in matched_t]
    unmatched_pred = [i for i in range(len(pred_boxes)) if i not in matched_p]
    return matches, unmatched_truth, unmatched_pred


@dataclass
class DetectionSummary:
    n_truth: int
    n_pred: int
    n_matched: int
    mean_iou_matched: float | None  # None when nothing matched — do not report 0.0, that overstates a null result
    recall_at_threshold: float | None
    precision_at_threshold: float | None
    iou_threshold: float


def detection_summary(truth_boxes: list[Box], pred_boxes: list[Box], iou_threshold: float = 0.5) -> DetectionSummary:
    matches, unmatched_t, _ = greedy_match(truth_boxes, pred_boxes, iou_threshold)
    n_truth, n_pred = len(truth_boxes), len(pred_boxes)
    mean_iou = (sum(m[2] for m in matches) / len(matches)) if matches else None
    recall = (len(matches) / n_truth) if n_truth else None
    precision = (len(matches) / n_pred) if n_pred else None
    return DetectionSummary(
        n_truth=n_truth, n_pred=n_pred, n_matched=len(matches),
        mean_iou_matched=mean_iou, recall_at_threshold=recall,
        precision_at_threshold=precision, iou_threshold=iou_threshold,
    )
