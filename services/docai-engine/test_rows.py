"""Row assembly on a page that is not square (docs/OCR.md §4.4).

Stdlib `unittest` only, and no PaddleOCR: `_page_skew` and `_rows_from_boxes`
are pure geometry, so they are testable without loading a 200MB model.

THE MEASUREMENT THAT PRODUCED THESE NUMBERS. Scoring the structurer over the
300-document tier-S corpus returned 13% wrong-when-shown on the total and 21%
on GST, against a §6.3 ceiling of 3%. The values were not near-misses — the
total came back as `4417` (masked card digits) and GST came back as the total.
Dumping the spans of `gen-cafe-0016` showed why: every right-aligned amount sat
~22px below its own label, proportional to horizontal distance, because the
page is rotated about 3 degrees. Row assembly compared raw axis-aligned `y`, so
each amount joined the row BELOW its label.

The coordinates in `CAFE_0016` are the real ones, read off that document.
"""
from __future__ import annotations

import unittest

from ocr_engine import _page_skew, _rows_from_boxes

# text, x0, x1, y0, y1 -- as detected on gen-cafe-0016, page rotated ~3 degrees.
CAFE_0016 = [
    ('TOTAL', 75, 140, 484, 514),
    ('$ 29.90', 461, 540, 505, 537),
    ('GST INCLUDED', 71, 200, 518, 549),
    ('2.72', 496, 545, 544, 567),
    ('VISA **** 4417', 68, 215, 572, 605),
    ('29.90', 483, 545, 595, 624),
]


def boxes(rows):
    return [[x0, y0, x1, y1] for _, x0, x1, y0, y1 in rows]


def quads(rows, slope):
    """Detection quads for a page skewed by `slope`, as PaddleOCR reports them:
    four corners clockwise from top-left."""
    out = []
    for _, x0, x1, y0, y1 in rows:
        lift = slope * (x1 - x0)
        out.append([(x0, y0), (x1, y0 + lift), (x1, y1 + lift), (x0, y1)])
    return out


def assembled(rows, skew):
    grouped = _rows_from_boxes(boxes(rows), len(rows), skew)
    return [' '.join(rows[i][0] for i in row) for row in grouped]


class TestPageSkew(unittest.TestCase):
    def test_measures_the_real_rotation(self):
        # ~3 degrees is 0.052 rise per unit run.
        slope = _page_skew(quads(CAFE_0016, 0.053), len(CAFE_0016))
        self.assertAlmostEqual(slope, 0.053, places=3)

    def test_a_square_page_measures_zero(self):
        self.assertAlmostEqual(_page_skew(quads(CAFE_0016, 0.0), len(CAFE_0016)), 0.0, places=6)

    def test_ignores_detections_too_short_to_measure(self):
        # A two-character box spans too little width for corner noise to
        # average out; including them is how a page estimate goes wrong.
        narrow = [('.', 100, 108, 10, 30)]
        self.assertEqual(_page_skew(quads(narrow, 0.4), 1), 0.0)

    def test_a_few_wild_detections_cannot_move_the_median(self):
        polys = quads(CAFE_0016, 0.05)
        polys[0] = [(0, 0), (200, 400), (200, 430), (0, 30)]  # near-vertical
        self.assertAlmostEqual(_page_skew(polys, len(CAFE_0016)), 0.05, places=2)

    def test_no_detections_is_zero_not_a_crash(self):
        self.assertEqual(_page_skew([], 0), 0.0)


class TestRowAssembly(unittest.TestCase):
    def test_the_bug_reproduces_when_skew_is_ignored(self):
        # Guards the fix: if this ever starts passing, the corpus has changed
        # and these numbers no longer demonstrate anything.
        got = assembled(CAFE_0016, skew=0.0)
        self.assertIn('GST INCLUDED $ 29.90', got,
                      'expected the un-deskewed grouping to put the TOTAL amount on the GST line')

    def test_each_amount_joins_its_own_label_once_deskewed(self):
        skew = _page_skew(quads(CAFE_0016, 0.053), len(CAFE_0016))
        self.assertEqual(
            assembled(CAFE_0016, skew),
            ['TOTAL $ 29.90', 'GST INCLUDED 2.72', 'VISA **** 4417 29.90'],
        )

    def test_a_row_does_not_chain_downwards(self):
        # Single-linkage drift: each item overlaps the previous by more than
        # half, so a union-extent row would swallow the whole column. The
        # anchor extent is what stops it.
        stair = [(f'r{i}', 0, 100, 100 + 14 * i, 130 + 14 * i) for i in range(6)]
        self.assertGreater(len(assembled(stair, skew=0.0)), 1)

    def test_words_within_a_row_come_back_left_to_right(self):
        jumbled = [('RIVERTON', 300, 420, 151, 181), ('FRESH MARKET', 60, 290, 150, 180)]
        self.assertEqual(assembled(jumbled, skew=0.0), ['FRESH MARKET RIVERTON'])

    def test_no_detections_is_no_rows(self):
        self.assertEqual(_rows_from_boxes([], 0, 0.0), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
