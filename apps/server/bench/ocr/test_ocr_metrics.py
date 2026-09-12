"""Unit tests for the OCR-stage metrics (contract §6).

Stdlib `unittest` only — this environment does not have `pytest` installed
(checked: `python -c "import pytest"` -> ModuleNotFoundError), and the rest of
`bench/` does not depend on it either (`abn.py`'s own `__main__` block is the
same pattern: a runnable self-check with no test-framework dependency).

Run with:
    python -m unittest ocr.test_ocr_metrics -v
from apps/server/bench/.

These tests construct fixtures by hand — a DocDOM-shaped dict built directly
in Python, not a live engine call — which is the correct use of "invent
nothing" here: the rule forbids inventing a SCORE for a real engine that did
not run. It does not forbid constructing a known input to prove a metric
computes the right output for that input. That is what a unit test is.
"""
from __future__ import annotations

import unittest

from . import abstention as ab
from . import calibration as cal
from .docdom_json import DocDomShapeError, load_document
from .geometry import Box, containment_ratio, detection_summary, greedy_match, group_by_containment, iou, union_box
from .text_metrics import cer, cer_ignoring_whitespace, wer
from .validate_truth import TruthValidationError, validate as validate_truth


# ── geometry ─────────────────────────────────────────────────────────────

class TestIoU(unittest.TestCase):
    def test_identical_boxes(self):
        b = Box(10, 10, 100, 50)
        self.assertAlmostEqual(iou(b, b), 1.0)

    def test_disjoint_boxes(self):
        a = Box(0, 0, 10, 10)
        b = Box(100, 100, 10, 10)
        self.assertEqual(iou(a, b), 0.0)

    def test_partial_overlap_known_value(self):
        # a: [0,0]-[10,10] area 100; b: [5,5]-[15,15] area 100
        # intersection: [5,5]-[10,10] area 25; union = 100+100-25=175
        a = Box(0, 0, 10, 10)
        b = Box(5, 5, 10, 10)
        self.assertAlmostEqual(iou(a, b), 25 / 175)

    def test_zero_area_box_never_matches(self):
        a = Box(0, 0, 10, 10)
        degenerate = Box(5, 5, 0, 10)
        self.assertEqual(iou(a, degenerate), 0.0)


class TestGreedyMatch(unittest.TestCase):
    def test_prefers_higher_iou(self):
        truth = [Box(0, 0, 10, 10)]
        pred = [Box(50, 50, 10, 10), Box(0, 0, 10, 10)]  # second is exact
        matches, unmatched_t, unmatched_p = greedy_match(truth, pred, iou_threshold=0.5)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0][1], 1)  # matched to pred index 1
        self.assertEqual(unmatched_t, [])
        self.assertEqual(unmatched_p, [0])

    def test_below_threshold_is_unmatched(self):
        truth = [Box(0, 0, 10, 10)]
        pred = [Box(9, 9, 10, 10)]  # small overlap
        matches, unmatched_t, unmatched_p = greedy_match(truth, pred, iou_threshold=0.5)
        self.assertEqual(matches, [])
        self.assertEqual(unmatched_t, [0])
        self.assertEqual(unmatched_p, [0])

    def test_detection_summary_reports_none_not_zero_when_nothing_matches(self):
        summary = detection_summary([Box(0, 0, 10, 10)], [], iou_threshold=0.5)
        self.assertIsNone(summary.mean_iou_matched)
        self.assertEqual(summary.recall_at_threshold, 0.0)
        self.assertIsNone(summary.precision_at_threshold)  # n_pred == 0 -> undefined, not 0


class TestContainmentGrouping(unittest.TestCase):
    """The fix for the live-sidecar defect: PP-OCR emits one span per word,
    so word-level predictions must be GROUPED into region-level truth boxes
    by containment, not matched 1:1 by IoU (which fails by construction --
    see ocr_score.py's score_document docstring)."""

    def test_containment_ratio_fully_inside(self):
        word = Box(10, 10, 20, 5)          # small span
        region = Box(0, 0, 200, 40)        # big region containing it
        self.assertAlmostEqual(containment_ratio(word, region), 1.0)

    def test_containment_ratio_no_overlap(self):
        word = Box(500, 500, 20, 5)
        region = Box(0, 0, 200, 40)
        self.assertEqual(containment_ratio(word, region), 0.0)

    def test_containment_ratio_is_asymmetric_unlike_iou(self):
        # A single word inside an 8-word region has near-zero IoU against
        # the region (the region is far bigger) but full containment --
        # this asymmetry is exactly why containment, not IoU, is the right
        # predicate for grouping.
        word = Box(10, 10, 20, 5)
        region = Box(0, 0, 400, 40)
        self.assertAlmostEqual(containment_ratio(word, region), 1.0)
        self.assertLess(iou(word, region), 0.05)

    def test_union_box_of_empty_list_is_none(self):
        self.assertIsNone(union_box([]))

    def test_union_box_spans_all_inputs(self):
        boxes = [Box(0, 0, 10, 10), Box(20, 5, 10, 10)]
        u = union_box(boxes)
        self.assertEqual((u.x, u.y, u.x2, u.y2), (0, 0, 30, 15))

    def test_word_level_predictions_group_into_one_region(self):
        """Reproduces the reported defect at small scale: one region, several
        word-level predictions inside it. 1:1 IoU matching would fail this
        (each word's IoU against the region is tiny); grouping should not."""
        region = Box(0, 0, 300, 40)
        words = [Box(10, 10, 60, 20), Box(80, 10, 50, 20), Box(140, 10, 70, 20)]  # 3 words inside
        outside = Box(500, 500, 40, 20)  # unrelated word elsewhere on the page
        assignment, unassigned = group_by_containment([region], words + [outside], containment_threshold=0.5)
        self.assertEqual(assignment.get(0), [0, 1, 2])  # all 3 words assigned, IN ORDER
        self.assertEqual(unassigned, [3])                # the outside word is not forced into the region

    def test_partially_overlapping_word_below_threshold_is_unassigned(self):
        region = Box(0, 0, 100, 40)
        straddling = Box(90, 10, 40, 20)  # only 1/4 of its area is inside the region
        assignment, unassigned = group_by_containment([region], [straddling], containment_threshold=0.5)
        self.assertEqual(assignment, {})
        self.assertEqual(unassigned, [0])

    def test_reading_order_is_preserved_through_grouping(self):
        # Predictions passed in document reading order must come back out in
        # the same order in the assignment list -- concatenation depends on
        # this, and getting it from geometry (y-then-x) instead would
        # scramble a two-column region.
        region = Box(0, 0, 300, 40)
        # Deliberately NOT sorted left-to-right by x -- reading order can
        # differ from raster order (e.g. a right-to-left script, or two
        # columns), and grouping must not silently re-sort by position.
        out_of_raster_order = [Box(140, 10, 70, 20), Box(10, 10, 60, 20), Box(80, 10, 50, 20)]
        assignment, _ = group_by_containment([region], out_of_raster_order, containment_threshold=0.5)
        self.assertEqual(assignment[0], [0, 1, 2])  # input order preserved, not re-sorted by x


class TestClassifyRegionGrouped(unittest.TestCase):
    def test_correct_when_grouped_words_concatenate_to_truth(self):
        outcome = ab.classify_region_grouped(
            't1', 'hello world', True,
            grouped_texts=['hello', 'world'], grouped_confidences=[0.9],
            was_abstained=False, confident_threshold=0.5, cer_fn=cer,
        )
        self.assertEqual(outcome.outcome, ab.CORRECT)

    def test_confident_wrong_when_concatenation_differs(self):
        outcome = ab.classify_region_grouped(
            't1', 'hello world', True,
            grouped_texts=['hello', 'wrold'], grouped_confidences=[0.9],
            was_abstained=False, confident_threshold=0.5, cer_fn=cer,
        )
        self.assertEqual(outcome.outcome, ab.CONFIDENT_WRONG)

    def test_missed_when_no_predictions_grouped(self):
        outcome = ab.classify_region_grouped(
            't1', 'hello world', True,
            grouped_texts=[], grouped_confidences=[],
            was_abstained=False, confident_threshold=0.5, cer_fn=cer,
        )
        self.assertEqual(outcome.outcome, ab.MISSED)

    def test_abstained_correctly_on_illegible_truth(self):
        outcome = ab.classify_region_grouped(
            't1', None, False,
            grouped_texts=[], grouped_confidences=[],
            was_abstained=True, confident_threshold=0.5, cer_fn=cer,
        )
        self.assertEqual(outcome.outcome, ab.ABSTAINED_CORRECTLY)


# ── text metrics ─────────────────────────────────────────────────────────

class TestCerWer(unittest.TestCase):
    def test_exact_match_is_zero(self):
        self.assertEqual(cer('hello', 'hello'), 0.0)
        self.assertEqual(wer('hello world', 'hello world'), 0.0)

    def test_single_char_substitution(self):
        self.assertAlmostEqual(cer('cat', 'car'), 1 / 3)

    def test_empty_truth_is_undefined_not_zero(self):
        self.assertIsNone(cer('', 'anything'))
        self.assertIsNone(wer('', 'anything'))

    def test_wer_word_level(self):
        # truth 3 words, hyp differs in 1 word -> 1 substitution / 3
        self.assertAlmostEqual(wer('the quick fox', 'the slow fox'), 1 / 3)

    def test_cer_can_exceed_one_on_insertions(self):
        # truth shorter than hyp: rate can be > 1, which is correct (not clamped)
        self.assertGreater(cer('a', 'abcdef'), 1.0)


class TestCerIgnoringWhitespace(unittest.TestCase):
    """Reproduces the real live-sidecar finding: naive single-space joining
    of independently-boxed word spans misplaces spacing around punctuation
    and inside numbers even when every character read is correct. Strict
    `cer()` penalises that; `cer_ignoring_whitespace()` must not."""

    def test_currency_amount_split_across_boxes(self):
        truth = '$1,042.60'
        hyp = '$ 1 , 042.60'  # naive join of 4 independently-detected boxes
        self.assertGreater(cer(truth, hyp), 0.0)
        self.assertEqual(cer_ignoring_whitespace(truth, hyp), 0.0)

    def test_comma_detected_as_its_own_box(self):
        truth = 'Fencing wire, 25kg roll x4'
        hyp = 'Fencing wire , 25kg roll x4'  # comma boxed separately, extra space
        self.assertGreater(cer(truth, hyp), 0.0)
        self.assertEqual(cer_ignoring_whitespace(truth, hyp), 0.0)

    def test_digit_group_merged_across_a_missing_space(self):
        # PP-OCR's detector fused two digit groups into one box -- the
        # DIGITS are all still correct, only the space between them is gone.
        truth = '69 447 119 320'
        hyp = '69 447119 320'
        self.assertEqual(cer_ignoring_whitespace(truth, hyp), 0.0)

    def test_a_genuine_character_error_still_shows_up(self):
        # Ignoring whitespace must not hide an ACTUAL misread digit.
        truth = '69 447 119 320'
        hyp = '69 447 119 321'  # last digit wrong
        self.assertGreater(cer_ignoring_whitespace(truth, hyp), 0.0)


# ── abstention quality ───────────────────────────────────────────────────

class TestAbstentionOrdering(unittest.TestCase):
    """The one invariant contract §6 names explicitly: an unreadable region
    correctly declared must score BETTER than a confident wrong reading.
    This must hold structurally (as a fact about QUALITY_SCORE), independent
    of any particular corpus or run."""

    def test_quality_score_ordering_is_structural(self):
        self.assertGreater(ab.QUALITY_SCORE[ab.ABSTAINED_CORRECTLY], ab.QUALITY_SCORE[ab.CONFIDENT_WRONG])
        # and the full chain the module docstring claims:
        self.assertGreaterEqual(ab.QUALITY_SCORE[ab.CORRECT], ab.QUALITY_SCORE[ab.ABSTAINED_UNNECESSARILY])
        self.assertGreater(ab.QUALITY_SCORE[ab.ABSTAINED_UNNECESSARILY], ab.QUALITY_SCORE[ab.MISSED])
        self.assertGreaterEqual(ab.QUALITY_SCORE[ab.MISSED], ab.QUALITY_SCORE[ab.WRONG_LOW_CONF])
        self.assertGreater(ab.QUALITY_SCORE[ab.WRONG_LOW_CONF], ab.QUALITY_SCORE[ab.CONFIDENT_WRONG])


class TestClassifyRegion(unittest.TestCase):
    truth_box = Box(0, 0, 100, 20)

    def test_correct_reading(self):
        outcome = ab.classify_region(
            't1', self.truth_box, 'hello', True,
            pred_boxes=[Box(0, 0, 100, 20)], pred_texts=['hello'], pred_confidences=[0.9],
            unreadable_boxes=[], iou_threshold=0.5, confident_threshold=0.5, cer_fn=cer,
        )
        self.assertEqual(outcome.outcome, ab.CORRECT)
        self.assertEqual(outcome.quality, 1.0)

    def test_confident_wrong_reading(self):
        outcome = ab.classify_region(
            't1', self.truth_box, 'hello', True,
            pred_boxes=[Box(0, 0, 100, 20)], pred_texts=['goodbye'], pred_confidences=[0.95],
            unreadable_boxes=[], iou_threshold=0.5, confident_threshold=0.5, cer_fn=cer,
        )
        self.assertEqual(outcome.outcome, ab.CONFIDENT_WRONG)
        self.assertLess(outcome.quality, 0)

    def test_low_confidence_wrong_reading(self):
        outcome = ab.classify_region(
            't1', self.truth_box, 'hello', True,
            pred_boxes=[Box(0, 0, 100, 20)], pred_texts=['goodbye'], pred_confidences=[0.1],
            unreadable_boxes=[], iou_threshold=0.5, confident_threshold=0.5, cer_fn=cer,
        )
        self.assertEqual(outcome.outcome, ab.WRONG_LOW_CONF)

    def test_abstained_correctly_on_illegible_truth(self):
        outcome = ab.classify_region(
            't1', self.truth_box, None, False,
            pred_boxes=[], pred_texts=[], pred_confidences=[],
            unreadable_boxes=[Box(0, 0, 100, 20)], iou_threshold=0.5, confident_threshold=0.5, cer_fn=cer,
        )
        self.assertEqual(outcome.outcome, ab.ABSTAINED_CORRECTLY)
        self.assertEqual(outcome.quality, 1.0)

    def test_abstained_unnecessarily_on_legible_truth(self):
        outcome = ab.classify_region(
            't1', self.truth_box, 'hello', True,
            pred_boxes=[], pred_texts=[], pred_confidences=[],
            unreadable_boxes=[Box(0, 0, 100, 20)], iou_threshold=0.5, confident_threshold=0.5, cer_fn=cer,
        )
        self.assertEqual(outcome.outcome, ab.ABSTAINED_UNNECESSARILY)

    def test_confident_wrong_on_illegible_truth_beats_nothing(self):
        # Engine confidently reads the redacted region anyway -- the worst
        # possible behaviour, since the region is provably unreadable.
        outcome = ab.classify_region(
            't1', self.truth_box, None, False,
            pred_boxes=[Box(0, 0, 100, 20)], pred_texts=['J. Whitfield'], pred_confidences=[0.99],
            unreadable_boxes=[], iou_threshold=0.5, confident_threshold=0.5, cer_fn=cer,
        )
        self.assertEqual(outcome.outcome, ab.CONFIDENT_WRONG)

    def test_missed_when_nothing_matches(self):
        outcome = ab.classify_region(
            't1', self.truth_box, 'hello', True,
            pred_boxes=[Box(500, 500, 10, 10)], pred_texts=['elsewhere'], pred_confidences=[0.9],
            unreadable_boxes=[], iou_threshold=0.5, confident_threshold=0.5, cer_fn=cer,
        )
        self.assertEqual(outcome.outcome, ab.MISSED)

    def test_summary_invariant_holds_when_both_outcomes_present(self):
        summary = ab.AbstentionSummary(outcomes=[
            ab.RegionOutcome('a', ab.ABSTAINED_CORRECTLY, ab.QUALITY_SCORE[ab.ABSTAINED_CORRECTLY], False),
            ab.RegionOutcome('b', ab.CONFIDENT_WRONG, ab.QUALITY_SCORE[ab.CONFIDENT_WRONG], True, matched_pred_confidence=0.9),
        ])
        self.assertTrue(summary.invariant_holds())

    def test_summary_invariant_is_none_when_not_exercised(self):
        summary = ab.AbstentionSummary(outcomes=[
            ab.RegionOutcome('a', ab.CORRECT, 1.0, True),
        ])
        self.assertIsNone(summary.invariant_holds())


# ── calibration ──────────────────────────────────────────────────────────

class TestCalibration(unittest.TestCase):
    def test_perfect_positive_correlation(self):
        points = [cal.CalibrationPoint(c, c) for c in (0.1, 0.3, 0.5, 0.7, 0.9)]
        r = cal.pearson_confidence_correctness(points)
        self.assertAlmostEqual(r, 1.0, places=6)

    def test_perfect_negative_correlation(self):
        points = [cal.CalibrationPoint(c, 1 - c) for c in (0.1, 0.3, 0.5, 0.7, 0.9)]
        r = cal.pearson_confidence_correctness(points)
        self.assertAlmostEqual(r, -1.0, places=6)

    def test_constant_confidence_is_undefined(self):
        points = [cal.CalibrationPoint(0.5, c) for c in (0.0, 0.5, 1.0)]
        self.assertIsNone(cal.pearson_confidence_correctness(points))

    def test_fewer_than_two_points_is_undefined(self):
        self.assertIsNone(cal.pearson_confidence_correctness([]))
        self.assertIsNone(cal.pearson_confidence_correctness([cal.CalibrationPoint(0.5, 1.0)]))

    def test_reliability_buckets_cover_range_and_report_empty_honestly(self):
        points = [cal.CalibrationPoint(0.95, 1.0)]  # only the top bucket has data
        buckets = cal.reliability_buckets(points, n_buckets=5)
        self.assertEqual(len(buckets), 5)
        populated = [b for b in buckets if b.n > 0]
        self.assertEqual(len(populated), 1)
        self.assertEqual(populated[0].n, 1)
        empty = [b for b in buckets if b.n == 0]
        for b in empty:
            self.assertIsNone(b.mean_confidence)
            self.assertIsNone(b.mean_correctness)


# ── docdom_json loader ───────────────────────────────────────────────────

def _minimal_doc(spans=None, unreadable=None):
    return {
        'blocks': [{
            'id': 'b1', 'page': 1, 'order': 0,
            'lines': [{'id': 'l1', 'order': 0, 'spans': spans or []}],
        }],
        'unreadable': unreadable or [],
    }


class TestDocDomJsonLoader(unittest.TestCase):
    def test_loads_well_formed_document(self):
        doc = _minimal_doc(spans=[{
            'id': 's1', 'text': 'hello',
            'box': {'x': 0, 'y': 0, 'width': 10, 'height': 10},
            'provenance': {'engine': 'test-engine', 'confidence': 0.8, 'calibrated': False},
        }])
        spans, unreadable = load_document(doc)
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].text, 'hello')
        self.assertEqual(spans[0].confidence, 0.8)
        self.assertFalse(spans[0].calibrated)
        self.assertEqual(unreadable, [])

    def test_missing_blocks_raises_shape_error(self):
        with self.assertRaises(DocDomShapeError):
            load_document({})

    def test_span_missing_box_raises_shape_error(self):
        doc = _minimal_doc(spans=[{'id': 's1', 'text': 'x', 'provenance': {'engine': 'e', 'confidence': 0.5, 'calibrated': False}}])
        with self.assertRaises(DocDomShapeError):
            load_document(doc)

    def test_unreadable_entry_with_empty_reason_raises(self):
        doc = _minimal_doc(unreadable=[{'page': 1, 'box': {'x': 0, 'y': 0, 'width': 10, 'height': 10}, 'reason': ''}])
        with self.assertRaises(DocDomShapeError):
            load_document(doc)

    def test_unreadable_entry_with_real_reason_loads(self):
        doc = _minimal_doc(unreadable=[{'page': 1, 'box': {'x': 0, 'y': 0, 'width': 10, 'height': 10}, 'reason': 'glare'}])
        _, unreadable = load_document(doc)
        self.assertEqual(len(unreadable), 1)
        self.assertEqual(unreadable[0].reason, 'glare')


# ── committed ground truth self-validates ───────────────────────────────

class TestCommittedTruthManifest(unittest.TestCase):
    """Guards the committed ocr_truth_manifest.json itself -- if someone
    hand-edits it later (the exact way the field-level ABN ground truth
    rotted, docs/OCR.md §9), this test starts failing in CI rather than only
    when ocr_score.py happens to be run."""

    def test_committed_manifest_is_valid(self):
        import json
        import os
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ocr_truth_manifest.json')
        with open(path, encoding='utf-8') as f:
            manifest = json.load(f)
        validate_truth(manifest)  # raises TruthValidationError on failure

    def test_deliberately_corrupted_manifest_is_rejected(self):
        """Negative control: prove validate_truth() actually catches
        something, not just that it passes on the one manifest it has always
        seen pass."""
        bad = {
            'page': {'width': 100, 'height': 100},
            'regions': [
                {'id': 'a', 'text': 'x', 'box': {'x': 0, 'y': 0, 'width': 50, 'height': 200}, 'legible': True},
            ],
        }
        with self.assertRaises(TruthValidationError):
            validate_truth(bad)


if __name__ == '__main__':
    unittest.main()
