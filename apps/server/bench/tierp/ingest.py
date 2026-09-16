"""Import a licensed public receipt set as tier P — real print, PII removed.

`docs/CORPUS.md` §6, ticket X4.

    python -m tierp.ingest --source cord-v2 --count 100

Writes `corpus/tierp/<id>.png` and `corpus/tierp/manifest.json`, in the same
shape `compare.py` already consumes, with `provenance.tier = "P"`.

THE THREE THINGS THIS FILE IS CAREFUL ABOUT
-------------------------------------------

**1. Money is not in AUD and is not formatted like an AUD docket.** CORD is
Indonesian: `"60.000"` is sixty thousand rupiah, dot as the THOUSANDS
separator. `scoring.py`'s `amount` comparator strips commas and calls `float`,
so it reads `"60.000"` as 60.0 — and would then score a correct reading as
WRONG, or a wrong one as right. Silently grading the engine against a corrupted
truth is the single worst thing a corpus can do.

So money on tier P uses the **`text` comparator**, and truth is the string **as
printed**. That is not a workaround, it is the honest target: tier P measures
whether the engine READS the characters on real thermal print. Whether a figure
is a valid GST-inclusive Australian total is a tier R question, and tier P was
never going to answer it. The manifest supports per-field comparators by design
— `scoring.py`'s own header says the comparator is chosen in the manifest "not
hardcoded per field name here, so the manifest stays the single source of
truth".

**2. Most Australian fields are genuinely absent, and that is valuable.** An
Indonesian receipt has no ABN and does not say "TAX INVOICE". Those truths are
`null` and `false`, which makes every imported document an ABSTENTION case for
the two fields most prone to invention. A model that produces an ABN here is
hallucinating with no ambiguity to hide behind — and `docs/GAPS.md` B1 notes
that abstention cases are the ones nobody ever collects enough of.

**3. Nothing is imported unredacted.** Every image goes through the OCR sidecar
(A1′) and `redact.py` before it is written. A document with more PII than the
threshold is dropped rather than cleaned.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tierp import redact, sources  # noqa: E402

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BENCH, 'corpus', 'tierp')
ROWS_API = 'https://datasets-server.huggingface.co/rows'
DEFAULT_SIDECAR = os.environ.get('DOCAI_SIDECAR_URL', 'http://127.0.0.1:18088')

REDACTOR_VERSION = 'tierp.redact/1 + ppocr-v5'


def _get(url: str, timeout: int = 120, attempts: int = 4) -> bytes:
    """GET with backoff.

    The datasets-server answers 502 intermittently under load, and a nine-minute
    import that dies on minute seven because of one transient gateway error is
    not a failure worth reproducing by hand.
    """
    import time
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code not in (429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
        wait = 2 ** attempt
        print(f'    retry in {wait}s ({type(last).__name__}: {last})', flush=True)
        time.sleep(wait)
    raise RuntimeError(f'GET failed after {attempts} attempts: {url} — last error {last}')


def fetch_rows(source: sources.Source, offset: int, length: int) -> list[dict]:
    url = (
        f'{ROWS_API}?dataset={urllib.parse.quote(source.dataset, safe="")}'
        f'&config={source.config}&split={source.split}&offset={offset}&length={length}'
    )
    return json.loads(_get(url).decode('utf-8'))['rows']


def fetch_image(url: str) -> bytes:
    return _get(url)


def ocr_document(image_bytes: bytes, sidecar: str) -> dict:
    """The whole DocDOM from the deployed sidecar. Used to LOCATE PII, not to read.

    Returns the document rather than a flat span list so `redact.find_in_document`
    can test LINES as well as spans — a masked PAN is split across word spans and
    is invisible to a span-only filter.
    """
    import uuid

    boundary = uuid.uuid4().hex
    parts, body = [], b''
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="p.jpg"\r\n'
        f'Content-Type: image/jpeg\r\n\r\n'.encode()
    )
    body += parts[0] + image_bytes + b'\r\n'
    body += (
        f'--{boundary}\r\nContent-Disposition: form-data; name="params"\r\n\r\n'
        f'{{"pageNumber":1}}\r\n--{boundary}--\r\n'
    ).encode()
    req = urllib.request.Request(
        f'{sidecar.rstrip("/")}/read', data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode('utf-8'))


def ocr(image_bytes: bytes, sidecar: str) -> list[dict]:
    """Flat spans, kept for probing and tests."""
    doc = ocr_document(image_bytes, sidecar)
    return [s for b in doc.get('blocks', []) for l in b.get('lines', []) for s in l.get('spans', [])]


def _walk_menu(menu) -> list[dict]:
    """CORD's `menu` is a dict for a one-item receipt and a list otherwise."""
    if menu is None:
        return []
    return menu if isinstance(menu, list) else [menu]


def truth_from_cord(gt: dict) -> dict | None:
    """Map CORD's gt_parse onto our fields. Returns None if unusable.

    Only fields CORD states are mapped. `supplier_name` and `issue_date` are
    NOT in gt_parse, so they are omitted entirely rather than guessed — an
    invented truth is worse than a missing one.
    """
    parse = gt.get('gt_parse') or {}
    total = (parse.get('total') or {}).get('total_price')
    if not total:
        return None

    lines = []
    for item in _walk_menu(parse.get('menu')):
        if not isinstance(item, dict):
            continue
        name, price = item.get('nm'), item.get('price')
        if name and price:
            lines.append({'description': str(name), 'amount': str(price)})

    # Did CORD claim line items we FAILED to map? `menu` uses a few different
    # key sets across the corpus, and an item without `nm`+`price` falls
    # through the loop above. Asserting `line_count: 0` in that case is a FALSE
    # TRUTH — the receipt plainly has items — and it would score a correct
    # reading of "2 items" as WRONG. Found by looking at tierp-cord-v2-0011,
    # whose image shows two line items against a truth of zero.
    #
    # So the mapper reports the discrepancy and the caller omits the field
    # rather than inventing a value for it. An unscored field costs one signal;
    # a wrong one corrupts every run that uses this corpus.
    claimed_items = len(_walk_menu(parse.get('menu')))
    sub = parse.get('sub_total') or {}
    return {
        'total_inclusive': str(total),
        'tax_printed': str(sub['tax_price']) if sub.get('tax_price') else None,
        'lines': lines,
        'lines_are_complete': claimed_items > 0 and len(lines) == claimed_items,
    }


def manifest_entry(doc_id: str, source: sources.Source, page: str, truth: dict,
                   redaction_note: str, source_offset: int) -> dict:
    fields = {
        # Money as PRINTED, compared as TEXT — see this module's header.
        # `amount` would misread this locale's thousands separator and corrupt
        # the truth. CORD uses BOTH "60.000" and "120,000" across the corpus,
        # which is exactly why the printed string is the only safe target.
        'total_inclusive': {'truth': truth['total_inclusive'], 'compare': 'text'},
        'gst_amount': {'truth': truth['tax_printed'], 'compare': 'text'},
        # Genuinely absent on a non-Australian receipt. Abstention cases, and
        # the two fields most prone to invention.
        'supplier_abn': {'truth': None, 'compare': 'digits'},
        'is_tax_invoice': {'truth': False, 'compare': 'bool'},
        'page_count': {'truth': 1, 'compare': 'int'},
    }
    # Only scored when every item CORD claimed was actually mapped. Omitting a
    # field we cannot establish is the whole point — see truth_from_cord.
    if truth['lines_are_complete']:
        fields['line_count'] = {'truth': len(truth['lines']), 'compare': 'int'}

    return {
        'id': doc_id,
        'provenance': {
            'tier': 'P',
            'source': (
                f'{source.dataset} ({source.split}) row {source_offset} — {source.description} '
                f'Redacted by {REDACTOR_VERSION}: {redaction_note}.'
            ),
            'licence': source.licence,
            'captured_in': source.captured_in,
            'pii_reviewed': True,
        },
        # Traceability back to the exact source row. Document ids are sequential
        # over IMPORTED documents and rows get skipped, so the id is NOT the
        # dataset offset — without this there is no way back to the original.
        # docs/CORPUS.md §6.2 rule 2: cheap now, impossible later.
        'source_row': {'dataset': source.dataset, 'split': source.split, 'offset': source_offset},
        'format': 'image',
        'pages': [page],
        'fields': fields,
        'lines': {'truth': truth['lines'], 'complete': truth['lines_are_complete']},
    }


def ingest(source_key: str, count: int, out_dir: str, sidecar: str) -> dict:
    source = sources.get(source_key)          # licence gate; raises if refused
    os.makedirs(out_dir, exist_ok=True)
    from PIL import Image

    entries, stats = [], {'seen': 0, 'no_truth': 0, 'dropped_pii': 0, 'redacted': 0, 'imported': 0}
    offset, page_size = 0, 20

    while stats['imported'] < count:
        rows = fetch_rows(source, offset, min(page_size, count * 2))
        if not rows:
            break
        page_start = offset
        offset += len(rows)
        for row_index, row in enumerate(rows):
            source_offset = page_start + row_index
            if stats['imported'] >= count:
                break
            stats['seen'] += 1
            r = row['row']
            try:
                gt = json.loads(r['ground_truth']) if isinstance(r['ground_truth'], str) else r['ground_truth']
            except (json.JSONDecodeError, KeyError, TypeError):
                stats['no_truth'] += 1
                continue
            truth = truth_from_cord(gt)
            if truth is None:
                stats['no_truth'] += 1
                continue

            src = r['image']['src'] if isinstance(r['image'], dict) else r['image']
            try:
                raw = fetch_image(src)
            except Exception as exc:  # noqa: BLE001 — a flaky asset URL is not fatal
                print(f'  skip (image fetch failed: {type(exc).__name__})', flush=True)
                continue

            hits = redact.find_in_document(ocr_document(raw, sidecar))
            keep, reason = redact.decide(hits)
            if not keep:
                stats['dropped_pii'] += 1
                print(f'  DROPPED: {reason}', flush=True)
                continue

            img = Image.open(io.BytesIO(raw)).convert('RGB')
            if hits:
                img = redact.mask(img, hits)
                stats['redacted'] += 1

            doc_id = f'tierp-{source.key}-{stats["imported"]:04d}'
            path = os.path.join(out_dir, f'{doc_id}.png')
            img.save(path)
            rel = os.path.relpath(path, BENCH).replace(os.sep, '/')
            entries.append(manifest_entry(doc_id, source, rel, truth, reason, source_offset))
            stats['imported'] += 1
            print(f'  {doc_id}: {reason}', flush=True)

    manifest = {
        '_comment': (
            'GENERATED by tierp/ingest.py — do not hand-edit. Tier P: REAL photographed paper, '
            'NOT Australian. Money truth is the string AS PRINTED and compared as TEXT, because '
            'this source formats numbers with dot-thousands and the `amount` comparator would '
            'misread it and corrupt the ground truth (see tierp/ingest.py). supplier_abn and '
            'is_tax_invoice are genuine abstention cases — a non-AU receipt has neither. Every '
            'image passed the PII filter in tierp/redact.py before being written.'
        ),
        'generator': {'source': source.key, 'dataset': source.dataset, 'module': 'tierp.ingest'},
        'prompt_version': 'v1',
        'documents': entries,
    }
    with open(os.path.join(out_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')
    return {'manifest': manifest, 'stats': stats, 'out_dir': out_dir}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--source', default='cord-v2')
    ap.add_argument('--count', type=int, default=100)
    ap.add_argument('--out-dir', default=OUT_DIR)
    ap.add_argument('--sidecar', default=DEFAULT_SIDECAR,
                    help='OCR sidecar base URL, used to LOCATE PII for redaction')
    args = ap.parse_args()

    result = ingest(args.source, args.count, args.out_dir, args.sidecar)

    import abn as abn_mod
    import provenance as prov
    abn_mod.assert_manifest_abns_valid(result['manifest'])
    prov.assert_manifest_provenance_valid(result['manifest'])

    docs = result['manifest']['documents']
    print()
    print(f'stats: {result["stats"]}')
    print(f'wrote {len(docs)} documents to {result["out_dir"]}')
    print(prov.banner(prov.weakest_tier(docs)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
