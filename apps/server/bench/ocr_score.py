"""OCR-stage scorer (docs/contracts/phase1-ocr-stage.md §6, lane G).

`compare.py` scores FIELDS (supplier, ABN, total) produced by a VLM reading
a whole page. This script scores the layer below that: a DocDOM document's
TEXT AND BOXES against per-region ground truth (`ocr/ocr_truth_manifest.json`),
because field accuracy cannot tell whether a recogniser is improving -- it
can only tell whether the whole chain still works (contract §6 preamble).

Four numbers, all required by the contract, computed by `ocr/`:
  - CER / WER per matched region                    (ocr/text_metrics.py)
  - Detection IoU                                    (ocr/geometry.py)
  - Abstention quality                                (ocr/abstention.py)
  - Confidence-vs-error correlation                   (ocr/calibration.py)

A DocDOM document can come from ANY source -- this script never assumes a
particular producer:

    python ocr_score.py --docdom path/to/document.json
    python ocr_score.py --sidecar-url http://127.0.0.1:8088
    python ocr_score.py --self-test

`--self-test` builds two DocDOM fixtures IN THIS SCRIPT, from the ground
truth itself: a perfect "identity" reader (proves the scorer reports 0
error/IoU 1 on a trivially-correct input) and a deliberately flawed reader
(proves CONFIDENT_WRONG is detected and scores below ABSTAINED_CORRECTLY on
a real run of the pipeline, not just in the unit tests). Neither of these is
a claim about any real engine's accuracy -- the markdown/JSON output says so
explicitly, the same way compare.py's `--dry-run` output is never allowed to
read like a real score.

With no engine reachable and no `--docdom` file given, this reports "not
run" and exits 0 -- never a fabricated number (contract §6's closing rule,
same as engines/paddleocr_engine.py's `available()` contract).
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import statistics
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ocr import abstention as ab
from ocr import calibration as cal
from ocr.docdom_json import DocDomShapeError, load_document
from ocr import text_metrics
from ocr.geometry import Box, greedy_match, group_by_containment, iou, union_box
from ocr.text_metrics import cer, wer
from ocr.validate_truth import TruthValidationError, load_and_validate

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TRUTH_IMAGE = os.path.join(HERE, 'ocr', 'corpus', 'ocr-truth.png')
DEFAULT_IOU_THRESHOLD = 0.5
DEFAULT_CONFIDENT_THRESHOLD = 0.5
# How much of a PREDICTED span's own box must fall inside a truth region for
# that prediction to be counted as belonging to it (geometry.group_by_containment).
# Looser than DEFAULT_IOU_THRESHOLD deliberately -- containment of a small
# span inside a big region is a different question from IoU between two
# same-scale boxes, and 0.5 there would still reject a word that straddles a
# region's edge by a few pixels of padding.
DEFAULT_CONTAINMENT_THRESHOLD = 0.5


# ── acquiring a DocDOM document ─────────────────────────────────────────

def load_docdom_from_file(path: str) -> dict:
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def load_docdom_from_sidecar(base_url: str, image_path: str, timeout: int = 60) -> dict:
    """POST /read per contract §4: multipart image bytes + JSON fields. Raises
    on any failure -- the caller decides whether that means "not run" or a
    real error to surface, never swallows it into a score."""
    url = base_url.rstrip('/') + '/read'
    boundary = uuid.uuid4().hex
    with open(image_path, 'rb') as f:
        image_bytes = f.read()
    content_type = mimetypes.guess_type(image_path)[0] or 'application/octet-stream'
    meta = json.dumps({'pageNumber': 1, 'capabilities': ['detect', 'recognise', 'layout']})

    parts = []
    # Field name is `params`, fixed by docs/contracts/phase1-ocr-stage.md §4.
    # The first draft of that contract left it unstated and all three lanes
    # guessed: this scorer and the TypeScript adapter both said `meta`, the
    # service said `params`, and nothing looked wrong until they were run
    # together.
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="params"\r\n\r\n{meta}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{os.path.basename(image_path)}"\r\n'
        f'Content-Type: {content_type}\r\n\r\n'.encode()
    )
    parts.append(image_bytes)
    parts.append(f'\r\n--{boundary}--\r\n'.encode())
    body = b''.join(parts)

    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': f'multipart/form-data; boundary={boundary}',
        'Content-Length': str(len(body)),
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def check_sidecar_health(base_url: str, timeout: int = 5) -> tuple[bool, str]:
    try:
        req = urllib.request.Request(base_url.rstrip('/') + '/health', method='GET')
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode('utf-8'))
            if not body.get('ok', False):
                return False, f'sidecar /health returned ok={body.get("ok")}'
            return True, ''
    except urllib.error.URLError as e:
        return False, f'sidecar unreachable at {base_url}: {e}'
    except Exception as e:  # noqa: BLE001 -- any failure here means "not run", report exactly why
        return False, f'sidecar /health failed: {type(e).__name__}: {e}'


# ── self-test fixtures (NOT a real engine score -- see module docstring) ──

def _fixture_from_truth(truth_regions: list[dict], mode: str) -> dict:
    """Build a DocDOM-shaped dict directly from ground truth.

    mode='identity'  -- reads every legible region exactly, confidence 1.0,
                         correctly abstains on the illegible one. Proves the
                         scorer reports a clean run when given one.
    mode='flawed'    -- confidently misreads ONE legible region (a single
                         substituted character, the same class of error the
                         mod-89 ABN defect was about), reads the rest
                         correctly, and does NOT abstain on the illegible
                         region (reads it confidently and wrong). Proves the
                         scorer's CONFIDENT_WRONG detection fires on a run of
                         the actual pipeline code, not just in unit tests.
    mode='mixed'     -- BOTH behaviours in the same run: correctly abstains
                         on the illegible region AND confidently misreads the
                         ABN. This is the only fixture where
                         `invariant_holds_this_run` can actually evaluate to
                         True instead of None -- 'identity' never produces a
                         CONFIDENT_WRONG to compare against, and 'flawed'
                         never produces an ABSTAINED_CORRECTLY, so neither run
                         alone demonstrates the ordering contract §6 asks for
                         on a real (if constructed) document.
    """
    spans = []
    unreadable = []
    for i, r in enumerate(truth_regions):
        span_id = f'fixture-{r["id"]}'
        if not r['legible']:
            if mode in ('identity', 'mixed'):
                unreadable.append({'page': 1, 'box': r['box'], 'reason': r['reason']})
            else:
                spans.append({
                    'id': span_id, 'text': 'X. Fabricated', 'box': r['box'],
                    'provenance': {'engine': 'fixture', 'confidence': 0.97, 'calibrated': False},
                })
            continue
        text = r['text']
        confidence = 1.0
        if mode in ('flawed', 'mixed') and r['id'] == 'gt-abn':
            # one confident, plausible-looking digit substitution
            text = text[:-1] + ('1' if text[-1] != '1' else '2')
            confidence = 0.97
        spans.append({
            'id': span_id, 'text': text, 'box': r['box'],
            'provenance': {'engine': 'fixture', 'confidence': confidence, 'calibrated': False},
        })
    return {
        'blocks': [{
            'id': 'fixture-block', 'page': 1, 'order': 0,
            'lines': [{'id': f'fixture-line-{i}', 'order': i, 'spans': [s]} for i, s in enumerate(spans)],
        }],
        'unreadable': unreadable,
    }


# ── scoring ──────────────────────────────────────────────────────────────

def score_document(
    doc: dict, truth_manifest: dict,
    iou_threshold: float = DEFAULT_IOU_THRESHOLD,
    confident_threshold: float = DEFAULT_CONFIDENT_THRESHOLD,
    containment_threshold: float = DEFAULT_CONTAINMENT_THRESHOLD,
) -> dict:
    """Score one DocDOM document against the region-level ground truth.

    GROUPING, NOT 1:1 MATCHING (fixed after the first live-sidecar run:
    PP-OCR emits one span per word, so 45 word boxes against 6 region boxes
    made 1:1 greedy IoU matching fail by construction -- an 8-word region
    read perfectly still scored as 1 match + 7 false positives + the other 5
    regions MISSED, because no single word's box has meaningful IoU against
    a multi-word region's box). `spans` from `load_document` is already in
    DOCUMENT READING ORDER (page, then block/line `order` -- see
    docdom_json.py's docstring), so grouping preserves that order for
    concatenation without re-deriving it from geometry; a two-column region
    would come out scrambled if this instead sorted by y-then-x.
    """
    spans, unreadable = load_document(doc)  # raises DocDomShapeError on malformed input

    truth_regions = truth_manifest['regions']
    truth_boxes = [Box.from_dict(r['box']) for r in truth_regions]
    pred_boxes = [s.box for s in spans]        # reading order, from load_document
    pred_texts = [s.text for s in spans]
    pred_confidences = [s.confidence for s in spans]
    unreadable_boxes = [u.box for u in unreadable]

    # Which truth regions does the engine consider unreadable? Unreadable
    # entries are page-region-scale (not word-scale), so a 1:1 IoU match
    # against the region box is still the right predicate here -- this part
    # of the pipeline was never the bug.
    unreadable_matches, _, _ = greedy_match(truth_boxes, unreadable_boxes, iou_threshold)
    abstained_truth_idx = {t for t, _, _ in unreadable_matches}

    # Group every PREDICTED span into the truth region it is mostly inside,
    # preserving reading order (see docstring). Predictions that land inside
    # no region at all (page labels like "Supplier"/"ABN" that are real text
    # but not part of any ground-truth region, or genuine noise) are reported
    # separately -- they are not silently dropped and not silently blamed as
    # errors against a region they were never claiming to read.
    assignment, unassigned_pred = group_by_containment(truth_boxes, pred_boxes, containment_threshold)

    outcomes = []
    cer_strict_values, cer_ws_values, wer_values = [], [], []
    calibration_points: list[cal.CalibrationPoint] = []
    per_region_coverage = []
    per_region_text = []

    for i, r in enumerate(truth_regions):
        assigned = assignment.get(i, [])
        grouped_texts = [pred_texts[j] for j in assigned]
        grouped_boxes = [pred_boxes[j] for j in assigned]
        # Join tokens for reporting: strip each token's own leading/trailing
        # whitespace first (some engines report it as literal characters
        # inside the span text, which otherwise double-spaces the join),
        # then join with a single space. This is standard whitespace
        # normalisation, not invention -- it collapses formatting noise, it
        # does not add or remove any character the engine did not report.
        combined = ' '.join(t.strip() for t in grouped_texts if t.strip())
        # The confidence of a GROUP of spans is the LOWEST, never the
        # average -- same rule docdom.ts's own `weakest()` uses and for the
        # same reason: one badly-read word inside an 8-word region is not
        # "88% right," it is the digit that makes the region wrong.
        grouped_confidences = [min(pred_confidences[j] for j in assigned)] if assigned else []
        was_abstained = i in abstained_truth_idx

        # CORRECTNESS (the CORRECT/CONFIDENT_WRONG decision) is judged on
        # whitespace-insensitive CER, not the strict one. Justification, from
        # the first live-sidecar run: a word-level recogniser's box grouping
        # does not reproduce our ground truth's exact word breaks even when
        # every character is right ($1,042.60 read as four separate boxes
        # --"$" "1" "," "042.60"-- joins to "$ 1 , 042.60", which is a pure
        # spacing artifact of concatenating independently-detected boxes, not
        # a misread digit). The product's own field-level scorer
        # (scoring.py's `digits`/`amount` comparators) already normalises
        # away exactly this kind of formatting noise for the same reason.
        # The STRICT number is still computed and reported below, in full,
        # for anyone who needs verbatim fidelity.
        outcome = ab.classify_region_grouped(
            r['id'], r.get('text'), r['legible'],
            grouped_texts, grouped_confidences, was_abstained,
            confident_threshold, text_metrics.cer_ignoring_whitespace,
        )
        outcomes.append(outcome)

        gbox = union_box(grouped_boxes)
        coverage_iou = iou(truth_boxes[i], gbox) if gbox is not None else 0.0
        per_region_coverage.append({
            'truth_id': r['id'], 'n_assigned': len(assigned), 'coverage_iou': coverage_iou,
        })

        if r['legible'] and grouped_texts:
            c_strict = cer(r['text'], combined)
            c_ws = text_metrics.cer_ignoring_whitespace(r['text'], combined)
            w = wer(r['text'], combined)
            if c_strict is not None:
                cer_strict_values.append(c_strict)
            if c_ws is not None:
                cer_ws_values.append(c_ws)
            if w is not None:
                wer_values.append(w)
            per_region_text.append({
                'truth_id': r['id'], 'truth_text': r['text'], 'grouped_text': combined,
                'cer_strict': c_strict, 'cer_whitespace_insensitive': c_ws, 'wer': w,
            })
            # Calibration uses the same whitespace-insensitive correctness the
            # outcome classification used -- otherwise a well-calibrated
            # engine would look miscalibrated purely because of the join
            # artifact above, which has nothing to do with confidence.
            correctness = max(0.0, min(1.0, 1.0 - c_ws)) if c_ws is not None else None
            if correctness is not None and grouped_confidences:
                calibration_points.append(cal.CalibrationPoint(grouped_confidences[0], correctness))

    ab_summary = ab.AbstentionSummary(outcomes=outcomes)
    correlation = cal.pearson_confidence_correctness(calibration_points)
    buckets = cal.reliability_buckets(calibration_points)

    claimed_calibrated = sorted({s.calibrated for s in spans}) if spans else []

    n_truth = len(truth_regions)
    n_detected = sum(1 for c in per_region_coverage if c['n_assigned'] > 0 and c['coverage_iou'] >= iou_threshold)
    mean_coverage_detected = (
        statistics.mean([c['coverage_iou'] for c in per_region_coverage if c['n_assigned'] > 0])
        if any(c['n_assigned'] > 0 for c in per_region_coverage) else None
    )
    n_pred = len(spans)
    n_pred_assigned = n_pred - len(unassigned_pred)

    return {
        'iou_threshold': iou_threshold,
        'confident_threshold': confident_threshold,
        'containment_threshold': containment_threshold,
        'n_truth_regions': n_truth,
        'n_predicted_spans': n_pred,
        'n_unreadable_declared': len(unreadable),
        'detection': {
            # Region-level: did the grouped predictions cover the truth box.
            'n_truth': n_truth,
            'n_regions_with_any_prediction': sum(1 for c in per_region_coverage if c['n_assigned'] > 0),
            'n_regions_detected_at_threshold': n_detected,
            'recall_at_threshold': (n_detected / n_truth) if n_truth else None,
            'mean_coverage_iou_where_any_prediction': mean_coverage_detected,
            'per_region_coverage': per_region_coverage,
            # Document-level: of everything the engine emitted, how much fell
            # inside SOME truth region at all. Not "precision" in the 1:1
            # sense any more -- an unassigned span is not automatically a
            # hallucination, it may be real text outside any labelled region
            # (see docstring above and the report notes).
            'n_pred_total': n_pred,
            'n_pred_assigned_to_a_region': n_pred_assigned,
            'n_pred_unassigned': len(unassigned_pred),
            'pred_assigned_fraction': (n_pred_assigned / n_pred) if n_pred else None,
        },
        'text_error': {
            # STRICT: exact concatenation, spacing counted as a real error --
            # penalises the join heuristic's inability to reproduce exact
            # inter-word spacing from independently-boxed word spans, not
            # just genuine misreads. Kept because a consumer wanting verbatim
            # fidelity (contract §4/§5's editable twin) needs the honest
            # worst case, not just the flattering one.
            'mean_cer_strict': statistics.mean(cer_strict_values) if cer_strict_values else None,
            # WHITESPACE-INSENSITIVE: same comparison with all whitespace
            # removed from both sides first -- see text_metrics.cer_ignoring_whitespace's
            # docstring. This is what drives the CORRECT/CONFIDENT_WRONG
            # classification below.
            'mean_cer_whitespace_insensitive': statistics.mean(cer_ws_values) if cer_ws_values else None,
            # WER at word granularity is measured but not trustworthy here:
            # a word-level recogniser's own box boundaries do not have to
            # match this ground truth's word breaks (a comma or symbol
            # detected as its own box becomes an extra "word" WER did not
            # expect), so a high WER on a word-level engine's output can
            # reflect tokenization mismatch rather than reading error. See
            # the report notes -- this is reported plainly, not hidden, but
            # should not be read as a reading-accuracy regression signal on
            # its own the way CER (whitespace-insensitive) can be.
            'mean_wer_matched': statistics.mean(wer_values) if wer_values else None,
            'n_matched_legible': len(cer_strict_values),
            'per_region': per_region_text,
        },
        'abstention': {
            'outcome_counts': ab_summary.counts(),
            'mean_quality': ab_summary.mean_quality(),
            'invariant_holds_this_run': ab_summary.invariant_holds(),
            'per_region': [
                {'truth_id': o.truth_id, 'outcome': o.outcome, 'quality': o.quality,
                 'confidence': o.matched_pred_confidence,
                 'cer_used_for_classification_whitespace_insensitive': o.cer}
                for o in outcomes
            ],
        },
        'calibration': {
            'n_points': len(calibration_points),
            'pearson_confidence_vs_correctness': correlation,
            'reliability_buckets': [
                {'range': [b.lo, b.hi], 'n': b.n, 'mean_confidence': b.mean_confidence, 'mean_correctness': b.mean_correctness}
                for b in buckets
            ],
            'engine_claims_calibrated': claimed_calibrated,  # per docdom.ts Provenance.calibrated, as reported
        },
    }


def to_markdown(report: dict) -> str:
    lines = [f"# OCR-stage bench results — {report['generated_at']}", '']
    # Before anything quotable. Recall and CER are the two numbers this file
    # reports and the two synthetic data most flatters — docs/CORPUS.md §2.
    if report.get('tier'):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import provenance as _prov

        lines.append(_prov.banner(report['tier']))
        lines.append('')
    lines.append(f"source: `{report['source']}`  ")
    if report.get('note'):
        lines.append(f"**{report['note']}**  ")
    lines.append('')

    if report.get('not_run'):
        lines.append(f"## NOT RUN — {report['not_run']}")
        lines.append('')
        return '\n'.join(lines) + '\n'

    for label, s in report['scores'].items():
        lines.append(f'## {label}')
        lines.append('')
        det = s['detection']
        cov = det['mean_coverage_iou_where_any_prediction']
        lines.append(f"- **Detection (coverage, grouped)**: {det['n_regions_detected_at_threshold']}/{det['n_truth']} "
                      f"truth regions covered at IoU ≥ {s['iou_threshold']} by their grouped predictions "
                      f"({det['n_regions_with_any_prediction']}/{det['n_truth']} had ANY prediction assigned); "
                      + (f"mean coverage IoU where assigned = {cov:.3f}" if cov is not None else "mean coverage IoU = n/a"))
        recall = det['recall_at_threshold']
        lines.append(f"  - recall = {recall:.3f}" if recall is not None else "  - recall = n/a")
        paf = det['pred_assigned_fraction']
        lines.append(
            f"  - of {det['n_pred_total']} predicted spans, {det['n_pred_assigned_to_a_region']} fell inside a "
            f"labelled region ({paf:.3f}) and {det['n_pred_unassigned']} did not — NOT automatically false "
            f"positives, may be real text outside any ground-truth region (e.g. field labels)"
            if paf is not None else "  - pred_assigned_fraction = n/a (no predictions at all)"
        )
        te = s['text_error']
        cer_strict_s = f"{te['mean_cer_strict']:.4f}" if te['mean_cer_strict'] is not None else 'n/a'
        cer_ws_s = f"{te['mean_cer_whitespace_insensitive']:.4f}" if te['mean_cer_whitespace_insensitive'] is not None else 'n/a'
        wer_s = f"{te['mean_wer_matched']:.4f}" if te['mean_wer_matched'] is not None else 'n/a'
        lines.append(f"- **CER** (mean over {te['n_matched_legible']} matched legible regions): "
                      f"strict={cer_strict_s}  whitespace-insensitive={cer_ws_s} (drives CORRECT/CONFIDENT_WRONG below)")
        lines.append(f"  - **WER**={wer_s} — noisy at word granularity here; a word-level engine's own box "
                      f"boundaries need not match this ground truth's word breaks, so this is reported but "
                      f"should not be read as a reading-accuracy regression signal on its own")
        for pr in te['per_region']:
            lines.append(f"  - `{pr['truth_id']}`: truth={pr['truth_text']!r}  read={pr['grouped_text']!r}  "
                          f"(cer_strict={pr['cer_strict']:.3f}, cer_ws={pr['cer_whitespace_insensitive']:.3f})")
        ab_s = s['abstention']
        lines.append(f"- **Abstention quality**: mean={ab_s['mean_quality']:.3f}  outcomes={ab_s['outcome_counts']}"
                      if ab_s['mean_quality'] is not None else "- **Abstention quality**: n/a (no regions)")
        lines.append(f"  - invariant (ABSTAINED_CORRECTLY > CONFIDENT_WRONG) holds this run: {ab_s['invariant_holds_this_run']}")
        calib = s['calibration']
        corr = calib['pearson_confidence_vs_correctness']
        lines.append(f"- **Confidence-vs-error correlation**: r={corr:.3f} (n={calib['n_points']})"
                      if corr is not None else f"- **Confidence-vs-error correlation**: n/a (n={calib['n_points']}, need ≥2 points with varying confidence)")
        lines.append(f"  - engine reports `calibrated`: {calib['engine_claims_calibrated']}")
        lines.append('')

    return '\n'.join(lines) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--docdom', help='path to a DocDOM JSON document to score')
    ap.add_argument('--sidecar-url', help='base URL of a running docai-engine sidecar, e.g. http://127.0.0.1:8088')
    ap.add_argument('--self-test', action='store_true',
                     help='score two fixtures built from ground truth (identity + deliberately flawed) -- '
                          'proves the scorer itself works; NOT a real engine measurement')
    ap.add_argument('--iou-threshold', type=float, default=DEFAULT_IOU_THRESHOLD,
                     help='coverage-IoU threshold for a region to count as detected')
    ap.add_argument('--confident-threshold', type=float, default=DEFAULT_CONFIDENT_THRESHOLD)
    ap.add_argument('--containment-threshold', type=float, default=DEFAULT_CONTAINMENT_THRESHOLD,
                     help='fraction of a PREDICTED span that must fall inside a truth region to be grouped into it')
    ap.add_argument('--out-dir', default=os.path.join(HERE, 'results', 'ocr'))
    args = ap.parse_args()

    truth_manifest = load_and_validate()  # raises TruthValidationError -- refuse to run on bad truth

    report = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'contract': 'docs/contracts/phase1-ocr-stage.md §6',
    }

    scores = {}
    source_desc = None
    note = None

    try:
        if args.docdom:
            source_desc = f'--docdom {args.docdom}'
            doc = load_docdom_from_file(args.docdom)
            scores['docdom-file'] = score_document(doc, truth_manifest, args.iou_threshold, args.confident_threshold, args.containment_threshold)

        elif args.sidecar_url:
            source_desc = f'--sidecar-url {args.sidecar_url}'
            ok, reason = check_sidecar_health(args.sidecar_url)
            if not ok:
                report['not_run'] = reason
            else:
                doc = load_docdom_from_sidecar(args.sidecar_url, DEFAULT_TRUTH_IMAGE)
                scores['sidecar'] = score_document(doc, truth_manifest, args.iou_threshold, args.confident_threshold, args.containment_threshold)

        elif args.self_test:
            source_desc = '--self-test (constructed fixtures, not a real engine)'
            note = ('SELF-TEST: both documents below were built by this script directly from ground truth, '
                    'not produced by any real OCR engine. They exist to prove the scorer works, not to '
                    'measure a recogniser. Use --docdom or --sidecar-url for a real measurement.')
            identity_doc = _fixture_from_truth(truth_manifest['regions'], 'identity')
            flawed_doc = _fixture_from_truth(truth_manifest['regions'], 'flawed')
            mixed_doc = _fixture_from_truth(truth_manifest['regions'], 'mixed')
            scores['fixture:identity-reader'] = score_document(identity_doc, truth_manifest, args.iou_threshold, args.confident_threshold, args.containment_threshold)
            scores['fixture:flawed-reader'] = score_document(flawed_doc, truth_manifest, args.iou_threshold, args.confident_threshold, args.containment_threshold)
            scores['fixture:mixed-reader'] = score_document(mixed_doc, truth_manifest, args.iou_threshold, args.confident_threshold, args.containment_threshold)

        else:
            # No source given and no default engine to probe -- contract §6:
            # "If the sidecar is not running, report 'not run' and say so."
            # There is no hardcoded default sidecar URL to guess at (lane E's
            # port is not specified anywhere this lane owns), so the honest
            # default is to say nothing was run rather than silently assume
            # localhost:SOMETHING is or is not up.
            source_desc = '(none given)'
            report['not_run'] = ('no --docdom file, --sidecar-url, or --self-test given, and this scorer does '
                                  'not guess at a default sidecar address -- nothing was run')
    except (DocDomShapeError, TruthValidationError) as e:
        report['not_run'] = f'{type(e).__name__}: {e}'
    except urllib.error.URLError as e:
        report['not_run'] = f'sidecar request failed: {e}'
    except FileNotFoundError as e:
        report['not_run'] = f'file not found: {e}'

    report['source'] = source_desc
    # The corpus's own declaration, carried into the report so the banner and
    # the JSON agree. `load_and_validate` already refused to return a manifest
    # without it, so this cannot be silently absent.
    report['tier'] = (truth_manifest.get('provenance') or {}).get('tier')
    if note:
        report['note'] = note
    if scores:
        report['scores'] = scores

    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    out_dir = os.path.join(args.out_dir, ts)
    os.makedirs(out_dir, exist_ok=True)
    json_path = os.path.join(out_dir, 'results.json')
    md_path = os.path.join(out_dir, 'results.md')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(to_markdown(report))

    print(json.dumps(report, indent=2)[:4000])
    print()
    print(f'wrote {json_path}')
    print(f'wrote {md_path}')


if __name__ == '__main__':
    main()
