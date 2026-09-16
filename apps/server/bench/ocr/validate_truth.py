"""Standalone re-validation of `ocr_truth_manifest.json`, run every time
`ocr_score.py` starts -- not just once, inside the generator.

Why both: `gen_ocr_corpus.py` validates what IT produced, at generation time.
That guarantees the manifest was correct the moment it was written; it says
nothing about whether the committed file on disk still is. The mod-89 ABN
defect this project already hit once (docs/OCR.md §9) was exactly a file that
was fine when written and wrong by the time anything scored against it --
`abn.py`'s `assert_manifest_abns_valid` is the same durable-fix pattern
applied at the field level, and this is that pattern applied to boxes and
region text.

This module re-derives every check from the manifest alone (no Playwright, no
re-render) so it is cheap enough to run unconditionally on every score run,
the same way `compare.py` calls `abn.assert_manifest_abns_valid` before it
will run a single engine.
"""
from __future__ import annotations

import json
import os

# Imported as a package normally; the fallback lets this file be run directly as
# `python ocr/validate_truth.py`, not only as `python -m ocr.validate_truth`. A
# validator people cannot invoke the obvious way is a validator that stops being
# run — and this one is the guard on ground truth that every OCR number depends
# on.
try:
    from .geometry import Box, iou
except ImportError:  # pragma: no cover - only on direct script invocation
    import sys

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from ocr.geometry import Box, iou


class TruthValidationError(ValueError):
    pass


def _iou_dicts(a: dict, b: dict) -> float:
    return iou(Box.from_dict(a), Box.from_dict(b))


def validate(manifest: dict) -> None:
    problems: list[str] = []

    page = manifest.get('page')
    if not page or 'width' not in page or 'height' not in page:
        raise TruthValidationError("manifest missing 'page.width'/'page.height' -- cannot validate boxes at all")
    page_w, page_h = page['width'], page['height']
    if page_w <= 0 or page_h <= 0:
        problems.append(f'page dimensions are non-positive: {page_w}x{page_h}')

    regions = manifest.get('regions', [])
    if not regions:
        problems.append('manifest has zero regions')

    seen_ids = set()
    legible_regions = []
    for r in regions:
        rid = r.get('id')
        if not rid:
            problems.append(f'region missing an id: {r}')
            continue
        if rid in seen_ids:
            problems.append(f'duplicate region id: {rid}')
        seen_ids.add(rid)

        box = r.get('box')
        if not box or any(k not in box for k in ('x', 'y', 'width', 'height')):
            problems.append(f'{rid}: malformed box {box}')
            continue
        if box['width'] <= 0 or box['height'] <= 0:
            problems.append(f'{rid}: non-positive box size {box}')
        if box['x'] < 0 or box['y'] < 0 or box['x'] + box['width'] > page_w or box['y'] + box['height'] > page_h:
            problems.append(f'{rid}: box {box} falls outside the page ({page_w}x{page_h})')

        legible = r.get('legible', True)
        text = r.get('text')
        if legible:
            if not text or not str(text).strip():
                problems.append(f'{rid}: legible region has empty/missing text')
            legible_regions.append(r)
        else:
            reason = r.get('reason')
            if not reason or not str(reason).strip():
                problems.append(f'{rid}: illegible region has no reason recorded (contract §4: never an empty reason)')
            if text is not None:
                problems.append(
                    f"{rid}: illegible region carries a non-null 'text' ({text!r}) -- an illegible region's true "
                    f"text must not be trusted for scoring (see abstention.py); it should be null in the manifest"
                )

    for i in range(len(legible_regions)):
        for j in range(i + 1, len(legible_regions)):
            a, b = legible_regions[i], legible_regions[j]
            score = _iou_dicts(a['box'], b['box'])
            if score > 0.05:
                problems.append(f"{a['id']} and {b['id']} overlap (IoU={score:.3f}) -- ambiguous ground truth")

    # ABN-shaped fields get the same checksum discipline as the field-level
    # manifest.json, reusing the exact same check (abn.py) rather than a
    # second implementation of mod-89 that could drift from the first.
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import abn as abn_mod  # noqa: E402
    for r in legible_regions:
        if 'abn' in (r.get('id') or '').lower():
            digits = ''.join(c for c in str(r.get('text') or '') if c.isdigit())
            if len(digits) == 11 and not abn_mod.abn_is_valid(digits):
                problems.append(f"{r['id']}: text {r.get('text')!r} (digits {digits}) fails the mod-89 checksum")

    if problems:
        raise TruthValidationError(
            'ocr_truth_manifest.json failed validation -- refusing to score against it:\n  ' + '\n  '.join(problems)
        )


def load_and_validate(path: str | None = None) -> dict:
    path = path or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ocr_truth_manifest.json')
    with open(path, encoding='utf-8') as f:
        manifest = json.load(f)
    validate(manifest)
    _validate_provenance(manifest)
    return manifest


def _validate_provenance(manifest: dict) -> None:
    """This corpus must declare what it is evidence FOR — docs/CORPUS.md §4.

    It matters more here than anywhere else in the bench: this manifest is what
    produced detection recall 0.875 and CER 0.0661 (docs/OCR.md §8.1), and
    those are exactly the two quantities synthetic data flatters. Rendered
    glyphs have ideal edges, so a recall figure measured here is an upper
    bound, not an estimate.

    Reuses the same validator `compare.py` uses by wrapping the single
    page-level block in the per-document shape it expects — one definition of
    a tier in the repository, not two that drift.
    """
    import sys

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import provenance as prov

    prov.assert_manifest_provenance_valid(
        {'documents': [{'id': 'ocr_truth_manifest.json', 'provenance': manifest.get('provenance')}]}
    )


if __name__ == '__main__':
    m = load_and_validate()
    print(f"ocr_truth_manifest.json valid: {len(m['regions'])} regions, "
          f"page {m['page']['width']}x{m['page']['height']}")
