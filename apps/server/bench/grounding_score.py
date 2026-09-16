"""Measure grounding against KNOWN-TRUE values — the number phase1c left open.

    python grounding_score.py --manifest corpus/sample/manifest.json

`docs/contracts/phase1c-grounding.md` made grounding advisory on purpose:

    "We have a grounding rate from one document. We do not know the
    false-positive rate, and the failure mode of getting this wrong is a review
    queue full of 'unsupported value' warnings on values that were read
    perfectly — which is the fastest way to teach a reviewer to ignore
    warnings... Store first, measure, promote on evidence."

The `enforced` column exists and defaults false, waiting for that evidence.
This produces it.

WHAT MAKES THE MEASUREMENT CLEAN. No model is involved. The values fed to
`groundExtraction` are the corpus's GROUND TRUTH — values we know are on the
page because the generator chose them or the dataset states them. So:

    a TRUE value that fails to ground == the OCR never read it
                                      == enforcement would DELETE a correct field

That is precisely the false-positive rate of enforcement, isolated from every
question about whether a model reads well. `docs/GAPS.md` C2 ("no span means
null") cannot be safely switched on until this number is known, and D16's
"nothing is asserted that cannot be pointed at" is only affordable if the
pointing works.

WHAT IT DOES NOT MEASURE. Whether grounding rejects a HALLUCINATED value — the
true-negative side. That needs wrong values to ground, and the honest source of
those is a real model run, not values invented here. `grounding.ts`'s header
notes it already rejected the exact ABN misread `gemma4:31b` produced on the
Phase 0 document; one case is not a rate.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import provenance as prov  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SHIM = os.path.join(HERE, 'grounding', 'ground.ts')
DEFAULT_SIDECAR = os.environ.get('DOCAI_SIDECAR_URL', 'http://127.0.0.1:18088')

# Which truth fields map onto which grounding kind. The paths are
# `documents.locked_fields` vocabulary, as phase1c §3 specifies, so a grounding
# row here names the same thing the review screen locks.
FIELD_MAP = [
    ('supplier_name', 'header.supplier', 'text'),
    ('supplier_abn', 'header.supplier_abn', 'abn'),
    ('issue_date', 'header.issue_date', 'date'),
    ('total_inclusive', 'header.payable_amount', 'money'),
    ('gst_amount', 'header.tax_amount', 'money'),
]


def ocr_pages(image_paths: list[str], sidecar: str) -> dict:
    """OCR every page and merge into ONE DocDOM.

    The first version read `pages[0]` only. On `invoice-multipage` — whose
    totals fall on page 2 by construction, which is the entire reason that
    fixture exists — it then reported the grand total and GST as ungrounded.
    Two of thirteen ungrounded values in the first measurement were that: a bug
    in the instrument being read as a finding about the engine.
    """
    merged = {'version': '1.0.0', 'pages': [], 'blocks': [], 'unreadable': []}
    for n, path in enumerate(image_paths, 1):
        doc = ocr_page(path, sidecar, n)
        merged['pages'].extend(doc.get('pages') or [])
        merged['blocks'].extend(doc.get('blocks') or [])
        merged['unreadable'].extend(doc.get('unreadable') or [])
    return merged


def ocr_page(image_path: str, sidecar: str, page_number: int = 1) -> dict:
    import urllib.request
    import uuid

    with open(image_path, 'rb') as f:
        image = f.read()
    boundary = uuid.uuid4().hex
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="p.png"\r\n'
        f'Content-Type: image/png\r\n\r\n'.encode()
        + image
        + b'\r\n'
        + (
            f'--{boundary}\r\nContent-Disposition: form-data; name="params"\r\n\r\n'
            f'{{"pageNumber":{page_number}}}\r\n--{boundary}--\r\n'
        ).encode()
    )
    req = urllib.request.Request(
        f'{sidecar.rstrip("/")}/read', data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode('utf-8'))


def ground(doc: dict, fields: list[dict]) -> dict:
    """Call the SHIPPED grounding code. Never a Python reimplementation."""
    proc = subprocess.run(
        ['pnpm', 'exec', 'tsx', SHIM],
        input=json.dumps({'doc': doc, 'fields': fields}),
        capture_output=True, text=True, cwd=REPO, shell=(os.name == 'nt'),
    )
    if proc.returncode != 0:
        raise RuntimeError(f'ground.ts failed ({proc.returncode}): {proc.stderr[:400]}')
    return json.loads(proc.stdout)


def truth_fields(doc: dict) -> list[dict]:
    out = []
    for manifest_field, path, kind in FIELD_MAP:
        spec = doc['fields'].get(manifest_field)
        if not spec:
            continue
        truth = spec.get('truth')
        if truth is None or truth == '':
            continue  # an abstention case asserts nothing, so there is nothing to ground
        out.append({'path': path, 'kind': kind, 'value': str(truth)})
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--manifest', default='corpus/sample/manifest.json')
    ap.add_argument('--sidecar', default=DEFAULT_SIDECAR)
    ap.add_argument('--limit', type=int, default=0, help='0 = every document')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    path = args.manifest if os.path.isabs(args.manifest) else os.path.join(HERE, args.manifest)
    with open(path, encoding='utf-8') as f:
        manifest = json.load(f)
    prov.assert_manifest_provenance_valid(manifest)

    docs = manifest['documents']
    if args.limit:
        docs = docs[: args.limit]

    per_field = collections.defaultdict(lambda: {'grounded': 0, 'ungrounded': 0})
    per_tier = collections.defaultdict(lambda: {'grounded': 0, 'ungrounded': 0})
    per_degradation = collections.defaultdict(lambda: {'grounded': 0, 'ungrounded': 0})
    rows, failures = [], []

    for i, d in enumerate(docs, 1):
        pages = [p if os.path.isabs(p) else os.path.join(HERE, p) for p in d['pages']]
        tier = prov.tier_of(d)
        deg = d.get('degradation', 'n/a')
        fields = truth_fields(d)
        if not fields:
            continue
        try:
            docdom = ocr_pages(pages, args.sidecar)
            report = ground(docdom, fields)
        except Exception as exc:  # noqa: BLE001 — recorded, not swallowed
            failures.append(f'{d["id"]}: {type(exc).__name__}: {exc}')
            print(f'[{i}/{len(docs)}] {d["id"]}: FAILED {type(exc).__name__}', flush=True)
            continue

        for f in fields:
            g = report['fields'][f['path']]
            key = 'grounded' if g['grounded'] else 'ungrounded'
            per_field[f['path']][key] += 1
            per_tier[tier][key] += 1
            per_degradation[deg][key] += 1
            if not g['grounded']:
                rows.append({'document': d['id'], 'tier': tier, 'degradation': deg,
                             'path': f['path'], 'value': f['value']})
        print(f'[{i}/{len(docs)}] {d["id"]:<26} rate={report["rate"]:.2f} '
              f'ungrounded={report["ungrounded"]}', flush=True)

    def pct(c):
        t = c['grounded'] + c['ungrounded']
        return (c['grounded'] / t * 100) if t else 0.0

    print()
    print('GROUNDING RATE ON KNOWN-TRUE VALUES')
    print('A true value that will not ground is a field enforcement would DELETE.')
    print()
    print(f"{'field path':<26}{'grounded':>9}{'ungrounded':>12}{'rate':>8}")
    for p, c in sorted(per_field.items()):
        print(f"{p:<26}{c['grounded']:>9}{c['ungrounded']:>12}{pct(c):>7.1f}%")
    print()
    print(f"{'tier':<26}{'grounded':>9}{'ungrounded':>12}{'rate':>8}")
    for t, c in sorted(per_tier.items()):
        print(f"{t:<26}{c['grounded']:>9}{c['ungrounded']:>12}{pct(c):>7.1f}%")
    print()
    print(f"{'degradation':<26}{'grounded':>9}{'ungrounded':>12}{'rate':>8}")
    for k, c in sorted(per_degradation.items()):
        print(f"{k:<26}{c['grounded']:>9}{c['ungrounded']:>12}{pct(c):>7.1f}%")

    total = sum(c['grounded'] + c['ungrounded'] for c in per_field.values())
    bad = sum(c['ungrounded'] for c in per_field.values())
    print()
    print(f'OVERALL: {total - bad}/{total} grounded '
          f'({(total - bad) / total * 100:.1f}%) — false-positive rate of enforcement '
          f'= {bad / total * 100:.1f}%' if total else 'OVERALL: nothing scored')
    if failures:
        print(f'\n{len(failures)} document(s) failed to process:')
        for f in failures[:10]:
            print(f'  {f}')

    if args.out:
        out = args.out if os.path.isabs(args.out) else os.path.join(HERE, args.out)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'w', encoding='utf-8') as f:
            json.dump({
                'manifest': args.manifest,
                'tier_floor': prov.weakest_tier(docs),
                'per_field': {k: dict(v) for k, v in per_field.items()},
                'per_tier': {k: dict(v) for k, v in per_tier.items()},
                'per_degradation': {k: dict(v) for k, v in per_degradation.items()},
                'ungrounded_rows': rows,
                'failures': failures,
            }, f, indent=2, ensure_ascii=False)
        print(f'\nwrote {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
