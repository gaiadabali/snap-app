"""
The PaddleOCR wrapper — the only place PP-OCRv5's own shapes are allowed to
exist. Everything past `OcrEngine.read()` is DocDOM (`packages/docai/src/docdom.ts`);
everything inside it is PaddleOCR's business.

Why this file is careful about coordinates (docdom.ts, rule 1 of the contract):
PP-OCRv5 already maps its detection boxes back to the resolution of whatever
array we hand it — that is what `rec_boxes` being in input-image pixels (not
the model's internal resize) means, and we verified it against the real
receipt fixtures before trusting it (see README "Coordinate verification").
So as long as we never feed the model a deskewed/dewarped/rotated derivative,
the boxes it returns are already original-page coordinates and need no
back-mapping. That is exactly why `use_doc_orientation_classify` and
`use_doc_unwarping` are forced off below: turning them on would require us to
carry a transform and map boxes back, which this stage does not yet do. If
that ever changes, `Page.restoration`/`Page.transform` must be populated at
the same time — do not flip those flags without also wiring that.

Why mkldnn is off by default: PaddlePaddle 3.3.1's oneDNN/PIR executor throws
`NotImplementedError: ConvertPirAttribute2RuntimeAttribute not support
[pir::ArrayAttribute<pir::DoubleAttribute>]` on both PP-OCRv5 detection models
on this machine (CPU, Windows, cp313) — reproduced with both `server` and
`mobile` det models, so it is not a model-specific gap in PaddleX's own
MKLDNN_BLOCKLIST, it is a version bug. `enable_mkldnn=False` is the verified
workaround; CPU inference works correctly and just runs without that
accelerator. Re-test before ever flipping `DOCAI_ENABLE_MKLDNN=true`.
"""

from __future__ import annotations

import io
import math
import os
import time
from typing import Any, Optional

import numpy as np
from PIL import Image

# --- Configuration (env-overridable; defaults are what we verified) --------

MODEL_TIER = os.environ.get("DOCAI_MODEL_TIER", "mobile").strip().lower()
DEVICE = os.environ.get("DOCAI_DEVICE", "cpu").strip().lower()
# See module docstring: mkldnn crashes text detection on this paddlepaddle
# build. Default stays off until re-verified against a fixed paddlepaddle.
ENABLE_MKLDNN = os.environ.get("DOCAI_ENABLE_MKLDNN", "false").strip().lower() == "true"
# Below this recognition score a region is abstained into `unreadable`
# rather than emitted as a span. This is a heuristic operating point, not a
# calibrated one — there is no gold-set-derived threshold yet (D20).
MIN_CONFIDENCE = float(os.environ.get("DOCAI_MIN_CONFIDENCE", "0.3"))
# Boxes with a top-edge tilt smaller than this are reported as horizontal
# (rotation omitted) rather than carrying detector jitter as a false signal.
ROTATION_EPSILON_DEG = 1.0

# ENGINE_ID is set with the tier below, not fixed here. The registry treats an
# engine id as PROVENANCE, so a layout read by v6 must not claim to be v5 —
# otherwise a re-run comparison is comparing two things with the same name.
WEIGHTS_LICENCE = "apache-2.0"  # PP-OCRv5 weights are Apache-2.0, per PaddleOCR's own LICENSE.

# Both generations, selectable side by side — docs/GAPS.md A2.
#
# The v5 pair is NOT replaced. `paddleocr==3.7.0` ships PP-OCRv6 and this file
# asked for v5 by name only because it was written before v6 existed, but
# swapping the default would make the two ungradeable against each other: the
# bench has to score them on identical input before anything adopts either.
# D34's instruction is to re-evaluate, not to assume, and PaddleOCR's +4.6%
# detection claim is PaddleOCR's.
#
# Verified present in the pinned paddlex build (config filenames), not taken
# from the release notes — det AND rec exist for all three v6 tiers.
_MODEL_NAMES = {
    # tier      detection                  recognition               engine id
    "mobile": ("PP-OCRv5_mobile_det", "PP-OCRv5_mobile_rec", "ppocr-v5"),
    "server": ("PP-OCRv5_server_det", "PP-OCRv5_server_rec", "ppocr-v5"),
    "tiny":   ("PP-OCRv6_tiny_det",   "PP-OCRv6_tiny_rec",   "ppocr-v6"),
    "small":  ("PP-OCRv6_small_det",  "PP-OCRv6_small_rec",  "ppocr-v6"),
    "medium": ("PP-OCRv6_medium_det", "PP-OCRv6_medium_rec", "ppocr-v6"),
}

if MODEL_TIER not in _MODEL_NAMES:
    raise ValueError(f"DOCAI_MODEL_TIER must be one of {list(_MODEL_NAMES)}, got {MODEL_TIER!r}")

DET_MODEL_NAME, REC_MODEL_NAME, ENGINE_ID = _MODEL_NAMES[MODEL_TIER]


def _aabb(points: list[tuple[float, float]]) -> dict[str, float]:
    """Axis-aligned bounding box of a (possibly rotated) quad, as {x,y,width,height}."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x0, y0 = min(xs), min(ys)
    x1, y1 = max(xs), max(ys)
    return {"x": float(x0), "y": float(y0), "width": float(x1 - x0), "height": float(y1 - y0)}


def _rotation_deg(points: list[tuple[float, float]]) -> Optional[float]:
    """
    Clockwise degrees of the quad's top edge (points[0] -> points[1]), in
    image coordinates (y down, so this is a direct atan2 with no sign flip).
    Returns None when the tilt is within detector jitter (see epsilon above)
    so we don't claim a rotation we didn't really observe.
    """
    (x0, y0), (x1, y1) = points[0], points[1]
    dx, dy = x1 - x0, y1 - y0
    if dx == 0 and dy == 0:
        return None
    angle = math.degrees(math.atan2(dy, dx))
    return angle if abs(angle) >= ROTATION_EPSILON_DEG else None


def _box_from_quad(points: list[tuple[float, float]]) -> dict[str, Any]:
    box = _aabb(points)
    rot = _rotation_deg(points)
    if rot is not None:
        box["rotation"] = rot
    return box



def _rows_from_boxes(rec_boxes, n: int) -> list[list[int]]:
    """Group detections into printed ROWS, each ordered left-to-right.

    Two detections belong to the same row when their vertical extents overlap
    by more than half the shorter one. Overlap rather than a fixed pixel
    tolerance, because line height varies with type size on the same document —
    a 15px total and an 11px footnote need different tolerances and an overlap
    ratio supplies both.

    Rows are returned top-to-bottom; indices within a row are left-to-right.
    """
    if n == 0:
        return []

    items = []
    for i in range(n):
        box = rec_boxes[i]
        y0, y1 = float(box[1]), float(box[3])
        if y1 < y0:
            y0, y1 = y1, y0
        items.append((i, float(box[0]), y0, y1))
    items.sort(key=lambda it: (it[2], it[1]))

    rows: list[list[tuple]] = []
    for it in items:
        placed = False
        for row in rows:
            ry0 = min(r[2] for r in row)
            ry1 = max(r[3] for r in row)
            overlap = min(ry1, it[3]) - max(ry0, it[2])
            shorter = min(ry1 - ry0, it[3] - it[2])
            if shorter > 0 and overlap > 0.5 * shorter:
                row.append(it)
                placed = True
                break
        if not placed:
            rows.append([it])

    rows.sort(key=lambda row: min(r[2] for r in row))
    return [[r[0] for r in sorted(row, key=lambda r: r[1])] for row in rows]

class OcrEngine:
    """Loads PP-OCRv5 once and answers DocDOM-shaped `read()` calls."""

    def __init__(self) -> None:
        from paddleocr import PaddleOCR  # imported here so a load failure is caught by the caller

        self.det_model_name = DET_MODEL_NAME
        self.rec_model_name = REC_MODEL_NAME
        self.device = DEVICE
        self._ocr = PaddleOCR(
            text_detection_model_name=DET_MODEL_NAME,
            text_recognition_model_name=REC_MODEL_NAME,
            # Off deliberately — see module docstring on coordinate fidelity.
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device=DEVICE,
            enable_mkldnn=ENABLE_MKLDNN,
        )

    def read(
        self,
        image_bytes: bytes,
        page_number: int,
        region: Optional[dict[str, float]] = None,
    ) -> dict[str, Any]:
        t_start = time.perf_counter()

        im = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        offset_x, offset_y = 0.0, 0.0
        if region is not None:
            offset_x, offset_y = float(region["x"]), float(region["y"])
            crop_box = (
                int(region["x"]),
                int(region["y"]),
                int(region["x"] + region["width"]),
                int(region["y"] + region["height"]),
            )
            im = im.crop(crop_box)

        # PaddleOCR/OpenCV convention is BGR; PIL gives RGB.
        arr = np.array(im)[:, :, ::-1]

        results = list(
            self._ocr.predict(
                arr,
                return_word_box=True,
                # We own the abstention threshold; ask PaddleOCR for everything.
                text_rec_score_thresh=0.0,
            )
        )

        spans_by_line: list[list[dict[str, Any]]] = []
        line_boxes: list[dict[str, Any]] = []
        unreadable: list[dict[str, Any]] = []

        if results:
            res = results[0]
            rec_texts = res.get("rec_texts", [])
            rec_scores = res.get("rec_scores", [])
            rec_boxes = res.get("rec_boxes", [])
            rec_polys = res.get("rec_polys", [])
            text_words = res.get("text_word", [None] * len(rec_texts))
            text_word_regions = res.get("text_word_region", [None] * len(rec_texts))

            n = len(rec_texts)
            # Reading order, and ROW ASSEMBLY — see _rows_from_boxes.
            #
            # The previous version sorted by (y, x) on the RAW y, with a comment
            # claiming "top-to-bottom, then left-to-right". A one-pixel
            # difference defeats that: on a real docket `RIVERTON` was detected
            # at y=151 and `FRESH MARKET` at y=150, so the supplier name came
            # back as `FRESH`, `MARKET`, `RIVERTON` — right-to-left across what
            # is one printed line.
            #
            # Worse than cosmetic. The detector also splits one printed line
            # into SEPARATE detections, and each became its own DocDOM line;
            # `groundValue` scans contiguous runs *within a line*, so a supplier
            # name spread over two of them could never be grounded at all. Four
            # of thirteen ungrounded true values in the first grounding
            # measurement were exactly this.
            #
            # docs/OCR.md §4.4 lists "box merging, line assembly" among the
            # things the stage owns rather than borrows. This is that.
            rows = _rows_from_boxes(rec_boxes, n)

            for line_no, row in enumerate(rows):
              row_spans: list[dict[str, Any]] = []
              row_quads: list[list[tuple[float, float]]] = []
              for i in row:
                  text = rec_texts[i]
                  score = float(rec_scores[i])
                  poly = [(float(px), float(py)) for px, py in rec_polys[i]]
                  abs_poly = [(px + offset_x, py + offset_y) for px, py in poly]
                  line_box = _box_from_quad(abs_poly)

                  if not text.strip():
                      unreadable.append(
                          {"page": page_number, "box": line_box, "reason": "empty_recognition"}
                      )
                      continue
                  if score < MIN_CONFIDENCE:
                      unreadable.append(
                          {
                              "page": page_number,
                              "box": line_box,
                              "reason": f"low_confidence:{score:.3f}",
                          }
                      )
                      continue

                  words = text_words[i]
                  word_regions = text_word_regions[i]
                  spans: list[dict[str, Any]] = []
                  if words and word_regions and len(words) == len(word_regions):
                      span_no = 0
                      for word, wregion in zip(words, word_regions):
                          # Skip pure-whitespace word segments: they are gap
                          # geometry the word-box heuristic invents between
                          # words, not something the recogniser "read". Keeping
                          # them would look like content it wasn't.
                          if not word.strip():
                              continue
                          wpoly = [(float(px) + offset_x, float(py) + offset_y) for px, py in wregion]
                          spans.append(
                              {
                                  "id": f"sp-p{page_number}-l{line_no}-w{span_no}",
                                  "text": word,
                                  "box": _box_from_quad(wpoly),
                                  # Word segmentation carries the LINE's recognition
                                  # confidence — PP-OCRv5 is CTC over the whole
                                  # line and does not score sub-line units
                                  # independently. Repeating it is honest about
                                  # what was measured; it is not a new number.
                                  "provenance": {
                                      "engine": ENGINE_ID,
                                      "confidence": score,
                                      "calibrated": False,
                                  },
                              }
                          )
                          span_no += 1
                  if not spans:
                      # No usable word segmentation (e.g. return_word_box gave
                      # nothing for this script/line) — fall back to one span
                      # for the whole line rather than dropping the reading.
                      spans.append(
                          {
                              "id": f"sp-p{page_number}-l{line_no}-w0",
                              "text": text,
                              "box": line_box,
                              "provenance": {
                                  "engine": ENGINE_ID,
                                  "confidence": score,
                                  "calibrated": False,
                              },
                          }
                      )

                  row_spans.extend(spans)
                  row_quads.append(abs_poly)

              # One DocDOM line per printed ROW, spans left-to-right inside it.
              if row_spans:
                  row_spans.sort(key=lambda sp: sp["box"]["x"])
                  for span_no, sp in enumerate(row_spans):
                      sp["id"] = f"sp-p{page_number}-l{line_no}-w{span_no}"
                  spans_by_line.append(row_spans)
                  line_boxes.append(_box_from_quad([pt for q in row_quads for pt in q]))

        lines = [
            {
                "id": f"ln-p{page_number}-{idx}",
                "box": line_boxes[idx],
                "spans": spans_by_line[idx],
                "order": idx,
            }
            for idx in range(len(spans_by_line))
        ]

        blocks: list[dict[str, Any]] = []
        if lines:
            all_confidences = [s["provenance"]["confidence"] for spans in spans_by_line for s in spans]
            xs0 = [ln["box"]["x"] for ln in lines]
            ys0 = [ln["box"]["y"] for ln in lines]
            xs1 = [ln["box"]["x"] + ln["box"]["width"] for ln in lines]
            ys1 = [ln["box"]["y"] + ln["box"]["height"] for ln in lines]
            block_box = {
                "x": min(xs0),
                "y": min(ys0),
                "width": max(xs1) - min(xs0),
                "height": max(ys1) - min(ys0),
            }
            blocks.append(
                {
                    "id": f"blk-p{page_number}-0",
                    # No layout model is wired in (see /health "capabilities"
                    # and README) — 'unknown' is the honest answer, not a
                    # guess, per docdom.ts's own comment on BlockKind.
                    "kind": "unknown",
                    "box": block_box,
                    "page": page_number,
                    "order": 0,
                    "lines": lines,
                    "provenance": {
                        "engine": ENGINE_ID,
                        # Weakest-span rule (docdom.ts `weakest()`): a block's
                        # confidence is only as good as its worst reading.
                        "confidence": min(all_confidences) if all_confidences else 0.0,
                        "calibrated": False,
                    },
                }
            )

        total_ms = (time.perf_counter() - t_start) * 1000
        return {
            "blocks": blocks,
            "unreadable": unreadable,
            "engine": ENGINE_ID,
            "timings": {"totalMs": round(total_ms, 2)},
        }
