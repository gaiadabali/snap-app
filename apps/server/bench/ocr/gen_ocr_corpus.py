"""Generate the region-level ground truth for the OCR-stage scorer (contract
§6): a synthetic page where every box is known EXACTLY BY CONSTRUCTION.

Why synthetic-by-construction rather than hand-labelling a real photo (the
choice the contract explicitly leaves to this lane, and asks to be justified):
hand-labelling boxes means a human drags a rectangle and eyeballs it against
a rendered page -- exactly the kind of "plausible-looking number" the
mod-89-ABN defect (docs/OCR.md §9, `abn.py`) already showed this project gets
wrong at a real rate, and boxes are worse than ABNs for this: there is no
checksum for "is this rectangle actually where the glyphs are." The
alternative used here is the one `gen_corpus.py` already uses for field
values -- render HTML, then ask the RENDERER (Playwright/Chromium, the same
engine that laid the text out) for each element's own `bounding_box()`. The
box is not measured after the fact; it is read from the same layout engine
that positioned the pixels, in the same coordinate space as the screenshot.
That is "exact by construction" in the same sense `derive_valid_abn` makes an
ABN valid by construction instead of typing a plausible one.

One region is deliberately REDACTED -- covered by an opaque box in the DOM
after layout, so the pixels underneath are genuinely unrecoverable by any
OCR engine, not just "hard." This is the one honest way to get a truly
illegible ground-truth region without waiting for a real degraded photo:
`abstention.py`'s ABSTAINED_CORRECTLY outcome has nothing to score against
without at least one region no engine could possibly read correctly.

Every ground-truth field below is read FROM THE RENDERED DOM
(`locator.text_content()`), not typed twice in Python and HTML — the same
class of bug the ABN-checksum defect was (a hand-typed "truth" silently
drifting from the actual document) applies at ten times the rate to boxes
labelled by inspection, and applies just as easily to text truth typed twice.
Reading it back from the one place it was authored removes the seam where
that drift would enter.

Output:
  ocr/corpus/ocr-truth.png            -- the rendered page (screenshot pixels)
  ocr/ocr_truth_manifest.json         -- per-region ground truth: id, text,
                                          box (screenshot-pixel coords),
                                          legible, reason (when illegible)

Self-validation (contract's closing note: "whatever you generate, validate it
against itself before scoring anything with it") happens in THIS script,
before the manifest is written -- see `_validate` below -- and again,
independently, in `validate_truth.py`, which `ocr_score.py` runs before
trusting the committed manifest on every invocation. Two checks because the
generator validating its own output once is not the same guarantee as every
future run refusing to trust a manifest that was hand-edited afterwards.

Re-run with: python gen_ocr_corpus.py
"""
from __future__ import annotations

import json
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # bench/
from abn import derive_valid_abn, abn_is_valid  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, 'corpus')
os.makedirs(CORPUS, exist_ok=True)

DEVICE_SCALE = 2  # screenshot pixels = CSS pixels * DEVICE_SCALE

ABN_DIGITS = derive_valid_abn('447119320')
assert abn_is_valid(ABN_DIGITS), f'derive_valid_abn produced an invalid ABN: {ABN_DIGITS}'
ABN_FORMATTED = ' '.join([ABN_DIGITS[0:2], ABN_DIGITS[2:5], ABN_DIGITS[5:8], ABN_DIGITS[8:11]])

HTML = f"""<!doctype html><html><head><meta charset="utf-8"><style>
  body {{ font-family: Arial, Helvetica, sans-serif; font-size: 16px; color: #111;
          width: 640px; margin: 0; padding: 24px; background: #fff; }}
  .row {{ margin: 18px 0; }}
  .label {{ color: #666; font-size: 12px; display: block; }}
  .value {{ font-size: 18px; }}
  .redact-wrap {{ position: relative; display: inline-block; }}
  .redact-box {{ position: absolute; inset: 0; background: #111; }}
  /* Two DEGRADED-BUT-READABLE regions, and the story of how they got that
     label is the point of keeping them.

     They were added as `illegible`, to try to exercise ABSTAINED_CORRECTLY —
     the outcome that needs detection to fire and recognition to fail. At
     2.6px blur the detector found nothing at all (MISSED). Tuned down to
     1.4px it detected them and read BOTH correctly: `CN88421-QX` and
     `REF 7741-BD`. The engine was right and the ground truth was wrong, so
     the scorer dutifully reported two CONFIDENT_WRONGs that were nothing of
     the kind.

     Relabelled to what was measured. They stay because hard-but-readable is
     a useful case, and because the lesson is the expensive one: a ground
     truth asserting what an engine CANNOT do is a claim about the engine,
     and it has to be checked against the engine like any other claim.

     The abstention window — detected, not resolvable — is narrower than a CSS
     filter can reliably hit. Finding it needs a genuinely degraded
     photograph, which is what the `au-receipts` gold set in docs/OCR.md §8.2
     is for. ABSTAINED_CORRECTLY remains unobserved against a real engine. */
  .smudge {{ filter: blur(1.4px); }}
  /* Faint, not blurred. A second shot at the same window: detection is
     driven by contrast, recognition by glyph clarity, so low-contrast
     text is the other way to get a box the recogniser cannot resolve. */
  .faint {{ color: #c9c9c9; }}
</style></head><body>
  <div class="row"><span class="label">Supplier</span>
    <span class="value" id="gt-supplier" data-gt="legible">Curragundi Rural Supplies Pty Ltd</span></div>
  <div class="row"><span class="label">ABN</span>
    <span class="value" id="gt-abn" data-gt="legible">{ABN_FORMATTED}</span></div>
  <div class="row"><span class="label">Invoice date</span>
    <span class="value" id="gt-date" data-gt="legible">14 August 2026</span></div>
  <div class="row"><span class="label">Line item</span>
    <span class="value" id="gt-line" data-gt="legible">Fencing wire, 25kg roll x4</span></div>
  <div class="row"><span class="label">Total (incl. GST)</span>
    <span class="value" id="gt-total" data-gt="legible">$1,042.60</span></div>
  <div class="row"><span class="label">Authorised signature (redacted -- genuinely unreadable, not merely hard)</span>
    <span class="redact-wrap">
      <span class="value" id="gt-signature" data-gt="illegible"
            data-reason="opaque overlay -- the pixels carry no text at all">J. Whitfield</span>
      <span class="redact-box"></span>
    </span></div>
  <div class="row"><span class="label">Consignment note (blurred, and still read correctly)</span>
    <span class="value smudge" id="gt-smudged" data-gt="legible">CN 88421-QX</span></div>
  <div class="row"><span class="label">Carrier reference (low contrast, and still read correctly)</span>
    <span class="value faint" id="gt-faint" data-gt="legible">REF 7741-BD</span></div>
</body></html>"""


def _iou(a, b) -> float:
    ix1, iy1 = max(a['x'], b['x']), max(a['y'], b['y'])
    ix2 = min(a['x'] + a['width'], b['x'] + b['width'])
    iy2 = min(a['y'] + a['height'], b['y'] + b['height'])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = a['width'] * a['height'] + b['width'] * b['height'] - inter
    return inter / union if union > 0 else 0.0


def _measure(page) -> dict:
    """Read every `[data-gt]` element's text + bounding box straight from the
    live DOM, scaled to screenshot-pixel coordinates. Returns {id: {text, box,
    legible}}."""
    regions = {}
    for handle in page.locator('[data-gt]').all():
        el_id = handle.get_attribute('id')
        legible = handle.get_attribute('data-gt') == 'legible'
        # Per-region, because the two illegible regions fail for different
        # reasons and a scorer that cannot tell them apart cannot tell a
        # missed detection from a correct abstention.
        reason = handle.get_attribute('data-reason')
        text = handle.text_content()
        bb = handle.bounding_box()
        if bb is None:
            raise RuntimeError(f'{el_id}: bounding_box() returned None (element not rendered/visible)')
        box = {
            'x': round(bb['x'] * DEVICE_SCALE, 2),
            'y': round(bb['y'] * DEVICE_SCALE, 2),
            'width': round(bb['width'] * DEVICE_SCALE, 2),
            'height': round(bb['height'] * DEVICE_SCALE, 2),
        }
        regions[el_id] = {'text': text, 'box': box, 'legible': legible, 'reason': reason}
    return regions


def _validate(regions: dict, page_w: float, page_h: float) -> None:
    """Refuse to write a manifest that fails its own sanity checks -- the
    "validate against itself before scoring" rule. Every check here is
    something that would silently make the ground truth wrong, not a style
    preference."""
    problems = []

    if not regions:
        problems.append('no [data-gt] regions were measured at all')

    for rid, r in regions.items():
        b = r['box']
        if b['width'] <= 0 or b['height'] <= 0:
            problems.append(f'{rid}: non-positive box size {b}')
        if b['x'] < 0 or b['y'] < 0 or b['x'] + b['width'] > page_w or b['y'] + b['height'] > page_h:
            problems.append(f'{rid}: box {b} falls outside the page ({page_w}x{page_h})')
        if r['legible']:
            if not r['text'] or not r['text'].strip():
                problems.append(f'{rid}: legible region has empty text')
        else:
            # An illegible region's "true" text is deliberately NOT trusted
            # for scoring (see abstention.py) -- but the HTML must still
            # exist and be non-empty, otherwise the redaction box is hiding
            # nothing and the "genuinely unreadable" claim is untested.
            if not r['text'] or not r['text'].strip():
                problems.append(f'{rid}: illegible region has no underlying text to redact')

    # No two LEGIBLE regions should overlap -- an ambiguous ground truth
    # (two truth boxes claiming the same pixels) would make IoU matching
    # against a prediction nondeterministic in exactly the place this
    # metric is supposed to be authoritative.
    ids = list(regions.keys())
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = regions[ids[i]], regions[ids[j]]
            iou = _iou(a['box'], b['box'])
            if iou > 0.05:
                problems.append(f'{ids[i]} and {ids[j]} overlap (IoU={iou:.3f}) -- ground truth boxes must be distinct')

    abn_region = regions.get('gt-abn')
    if abn_region is not None and abn_region['legible']:
        digits = ''.join(c for c in abn_region['text'] if c.isdigit())
        if not abn_is_valid(digits):
            problems.append(f"gt-abn text {abn_region['text']!r} (digits {digits}) fails the mod-89 checksum")

    if problems:
        raise ValueError('ocr ground truth failed self-validation:\n  ' + '\n  '.join(problems))


def generate():
    html_path = os.path.join(HERE, 'ocr-truth.html')
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(HTML)

    png_path = os.path.join(CORPUS, 'ocr-truth.png')
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 640, 'height': 480}, device_scale_factor=DEVICE_SCALE)
        page.goto(f'file:///{html_path}')
        page.wait_for_timeout(30)

        # Measure TWICE and require identical boxes -- catches non-deterministic
        # layout (webfont not yet loaded on first paint, async reflow) before it
        # ever reaches the committed manifest. A ground truth that is not
        # reproducible from its own source is not "exact by construction," it
        # is "exact this one time."
        first = _measure(page)
        page.wait_for_timeout(50)
        second = _measure(page)
        drift = [rid for rid in first if first[rid]['box'] != second[rid]['box']]
        if drift:
            raise RuntimeError(f'box measurement is non-deterministic for: {drift} -- fix rendering before trusting truth')

        page.screenshot(path=png_path, full_page=True)
        body_box = page.locator('body').bounding_box()
        page_w = round(body_box['width'] * DEVICE_SCALE, 2)
        page_h = round(body_box['height'] * DEVICE_SCALE, 2)
        browser.close()

    regions = first
    _validate(regions, page_w, page_h)

    manifest = {
        '_comment': (
            "Region-level OCR ground truth (contract §6, docs/contracts/phase1-ocr-stage.md). "
            "Generated by gen_ocr_corpus.py: every box was read from Playwright's own "
            "bounding_box() on the rendered DOM, not measured by hand. 'gt-signature' is "
            "deliberately redacted (an opaque box painted over real text after layout) so it "
            "is genuinely unreadable by ANY engine -- the one region abstention.py's "
            "ABSTAINED_CORRECTLY outcome can be honestly scored against. Self-validated by "
            "_validate() at generation time and again by validate_truth.py before every score run."
        ),
        'page': {'width': page_w, 'height': page_h, 'source_image': 'corpus/ocr-truth.png', 'device_scale': DEVICE_SCALE},
        'regions': [
            {'id': rid, 'text': (r['text'] if r['legible'] else None), 'box': r['box'], 'legible': r['legible'],
             'reason': None if r['legible'] else r['reason']}
            for rid, r in regions.items()
        ],
    }

    manifest_path = os.path.join(HERE, 'ocr_truth_manifest.json')
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

    print('wrote', html_path)
    print('wrote', png_path)
    print('wrote', manifest_path)
    print(f'{len(regions)} regions, page {page_w}x{page_h}')
    for rid, r in regions.items():
        print(f"  {rid}: legible={r['legible']} box={r['box']} text={r['text']!r}")


if __name__ == '__main__':
    generate()
