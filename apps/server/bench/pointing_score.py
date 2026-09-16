"""Score the GROUNDED (pointing) extractor against the free-reading one.

    python pointing_score.py --manifest corpus/sample/manifest.json --models gemma4:31b

`docs/GAPS.md` C1 changes the extractor's job "from reading to pointing", and
`docs/OCR.md` §2 is blunt about how such a change may be adopted: the same
discipline A2 states for PP-OCRv6 — **adopt only if it improves**. Switching the
production reading path on an argument rather than a number is the pattern this
repository keeps rediscovering.

So this runs both prompts over the same documents and scores them with the SAME
`scoring.py` the free-reading head-to-head uses, which makes the two runs
directly comparable.

WHAT TO WATCH, and it is not the headline accuracy
--------------------------------------------------
The pointing path is expected to LOSE some fields, for a reason that is not a
defect: it can only name spans the OCR found, so a region the recogniser missed
becomes an abstention rather than a lucky read. `docs/GAPS.md` C3 makes exactly
this point about promoting the OCR stage — *a region the OCR misses is
invisible to a grounded extractor.*

The trade it is supposed to win is the other column:

  * **HALLUCINATED** should go to zero and stay there, structurally. A pointed
    field's value is read out of the page by `grounded.ts`; the model supplies
    no digits at all.
  * **unknown span ids** is the new failure mode, and it is the interesting
    one. A model that invents an identifier has done the pointing equivalent of
    inventing a value — with the difference that this one can be counted.

A run where pointing trades a few MISSes for zero HALLUCINATEDs is a win on a
compliance product, and that judgement belongs to a person reading the table,
not to this script.
"""
from __future__ import annotations

import argparse
import base64
import collections
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import provenance as prov  # noqa: E402
import scoring  # noqa: E402
from engines.hosted import HostedEngine  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SHIM = os.path.join(HERE, 'grounding', 'point.ts')
DEFAULT_SIDECAR = os.environ.get('DOCAI_SIDECAR_URL', 'http://127.0.0.1:18088')

# Manifest field -> the pointed field it corresponds to. Only fields the
# grounded extractor POINTS at appear; booleans are judgements, not values.
POINTED = {
    'supplier_name': 'supplierName',
    'supplier_abn': 'supplierAbn',
    'issue_date': 'issueDate',
    'total_inclusive': 'payableAmount',
    'gst_amount': 'taxAmount',
}


def shim(payload: dict) -> dict:
    proc = subprocess.run(
        ['pnpm', 'exec', 'tsx', SHIM],
        input=json.dumps(payload), capture_output=True, text=True,
        cwd=REPO, shell=(os.name == 'nt'),
    )
    if proc.returncode != 0:
        raise RuntimeError(f'point.ts failed ({proc.returncode}): {proc.stderr[:400]}')
    return json.loads(proc.stdout)


def ocr_pages(paths: list[str], sidecar: str) -> dict:
    import urllib.request
    import uuid

    merged = {'version': '1.0.0', 'pages': [], 'blocks': [], 'unreadable': []}
    for n, path in enumerate(paths, 1):
        with open(path, 'rb') as f:
            image = f.read()
        boundary = uuid.uuid4().hex
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="p.png"\r\n'
            f'Content-Type: image/png\r\n\r\n'.encode()
            + image + b'\r\n'
            + (
                f'--{boundary}\r\nContent-Disposition: form-data; name="params"\r\n\r\n'
                f'{{"pageNumber":{n}}}\r\n--{boundary}--\r\n'
            ).encode()
        )
        req = urllib.request.Request(
            f'{sidecar.rstrip("/")}/read', data=body,
            headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
        )
        with urllib.request.urlopen(req, timeout=180) as r:
            doc = json.loads(r.read().decode('utf-8'))
        merged['pages'].extend(doc.get('pages') or [])
        merged['blocks'].extend(doc.get('blocks') or [])
        merged['unreadable'].extend(doc.get('unreadable') or [])
    return merged


def read_prompt() -> str:
    """The SHIPPED grounded prompt, read from source — never a bench copy."""
    src = os.path.join(REPO, 'apps', 'server', 'src', 'extraction', 'grounded-prompt.ts')
    text = open(src, encoding='utf-8').read()
    start = text.index('GROUNDED_EXTRACTION_PROMPT = `') + len('GROUNDED_EXTRACTION_PROMPT = `')
    end = text.index('`;', start)
    return text[start:end]


def to_manifest_shape(resolved: dict, doc_fields: dict) -> dict:
    """Map the resolved pointed fields onto the manifest's field names."""
    out: dict = {}
    for manifest_name, pointed in POINTED.items():
        if manifest_name not in doc_fields:
            continue
        out[manifest_name] = (resolved['fields'].get(pointed) or {}).get('value')
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--manifest', default='corpus/sample/manifest.json')
    ap.add_argument('--models', nargs='*', default=['gemma4:31b'])
    ap.add_argument('--sidecar', default=DEFAULT_SIDECAR)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    path = args.manifest if os.path.isabs(args.manifest) else os.path.join(HERE, args.manifest)
    manifest = json.load(open(path, encoding='utf-8'))
    prov.assert_manifest_provenance_valid(manifest)
    docs = manifest['documents'][: args.limit] if args.limit else manifest['documents']

    prompt = read_prompt()
    results, failures = [], []
    counts = collections.defaultdict(lambda: collections.Counter())
    unknown_total = collections.Counter()

    for engine_name in args.models:
        engine = HostedEngine(engine_name)
        ok, reason = engine.available()
        if not ok:
            print(f'-- {engine.name}: NOT RUN ({reason})')
            continue

        for i, d in enumerate(docs, 1):
            pages = [p if os.path.isabs(p) else os.path.join(HERE, p) for p in d['pages']]
            try:
                docdom = ocr_pages(pages, args.sidecar)
                catalogue = shim({'mode': 'catalogue', 'doc': docdom})['catalogue']
                full = f'{prompt}\n\nSPAN CATALOGUE (id<TAB>text):\n{catalogue}\n\nReturn the JSON described above.'
                res = engine.run(pages, full, timeout=240)
                refs = res.parsed or {}
                resolved = shim({'mode': 'resolve', 'doc': docdom, 'refs': refs})
            except Exception as exc:  # noqa: BLE001 — recorded, never silent
                failures.append(f'{d["id"]} x {engine.name}: {type(exc).__name__}: {exc}')
                print(f'[{i}/{len(docs)}] {d["id"]}: FAILED {type(exc).__name__}', flush=True)
                continue

            got = to_manifest_shape(resolved, d['fields'])
            for name, value in got.items():
                outcome = scoring.score_field(d['fields'][name]['compare'],
                                              d['fields'][name]['truth'], value)
                counts[(engine.name, name)][outcome] += 1
            unknown_total[engine.name] += len(resolved['unknownSpans'])
            results.append({'document': d['id'], 'engine': engine.name,
                            'groundedRate': resolved['groundedRate'],
                            'unknownSpans': resolved['unknownSpans'], 'got': got})
            print(f'[{i}/{len(docs)}] {d["id"]:<26} grounded={resolved["groundedRate"]:.2f} '
                  f'unknown={len(resolved["unknownSpans"])}', flush=True)

    print()
    print(prov.banner(prov.weakest_tier(docs)))
    print()
    print('POINTING PATH — per field')
    print(f"{'engine':<20}{'field':<18}{'exact':>6}{'norm':>6}{'abst-ok':>8}{'WRONG':>7}{'MISS':>6}{'HALLUC':>8}")
    for (engine_name, field), c in sorted(counts.items()):
        print(f"{engine_name:<20}{field:<18}{c['EXACT']:>6}{c['NORMALISED']:>6}"
              f"{c['ABSTAIN_OK']:>8}{c['WRONG']:>7}{c['MISS']:>6}{c['HALLUCINATED']:>8}")

    print()
    for engine_name in {k[0] for k in counts}:
        halluc = sum(c['HALLUCINATED'] for (e, _), c in counts.items() if e == engine_name)
        miss = sum(c['MISS'] for (e, _), c in counts.items() if e == engine_name)
        print(f'  {engine_name}: HALLUCINATED={halluc}  MISS={miss}  '
              f'invented span ids={unknown_total[engine_name]}')
    print()
    print('A pointed field cannot be fabricated, so HALLUCINATED should be structurally 0.')
    print('Invented span ids are the new failure mode — countable, unlike an invented number.')

    if failures:
        print(f'\n{len(failures)} failed:')
        for f in failures[:10]:
            print(f'  {f}')

    if args.out:
        out = args.out if os.path.isabs(args.out) else os.path.join(HERE, args.out)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        json.dump(
            {'manifest': args.manifest, 'tier_floor': prov.weakest_tier(docs),
             'per_field': {f'{e}|{f}': dict(c) for (e, f), c in counts.items()},
             'unknown_spans': dict(unknown_total), 'results': results, 'failures': failures},
            open(out, 'w', encoding='utf-8'), indent=2, ensure_ascii=False,
        )
        print(f'\nwrote {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
