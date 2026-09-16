"""Score the on-device preview — OD-5, and the gate OD-6 decides on.

    python preview_score.py --manifest corpus/sample/manifest.json

`docs/ON-DEVICE.md` §6.2 is explicit that the preview is scored with the SAME
`scoring.py` the server engines use, on the same manifest, so a preview number
and an engine number can sit in one table. Three derived columns matter:

  * **Fill rate** — shown / (truth non-null). A preview that is mostly blank
    saves nobody anything.
  * **Wrong-when-shown** — (WRONG + HALLUCINATED) / shown. **The trust metric.**
    A value a person reads and believes.
  * **Blank-form baseline** — every truth-non-null field is one correction if
    there is no preview at all. The bar the preview must beat by a margin.

§6.3's ceilings, which this reports against: money ≥70% filled and **≤3%
wrong-when-shown**, ABN ≥60% / ≤1%, date ≥70% / ≤5%, and the whole preview
≥50% fewer corrections than the blank-form baseline.

WHAT THIS RUN IS NOT
--------------------
It scores the STRUCTURER over whatever DocDOM it is given. Run against the
server sidecar it measures the structurer alone, which is the useful thing to
know first and the only thing measurable without a handset. OD-6's numbers come
from the same script fed DocDOMs exported from a real phone, and §6.4 step 3
is explicit that running both separates *the recogniser's* error from *the
structurer's*.

THE DEVICE IS PART OF THE RESULT
--------------------------------
When DocDOMs come from a device, `--device` records which one. A gate passed on
a phone that is not the floor device is not the gate: §1.2 pins the floor at a
4GB Galaxy A16 5G and a 4GB iPhone 11/12 precisely because a flagship produces
numbers that pass and mean nothing. The report states the device and says so
when it is unknown, for the same reason the corpus states its tier.
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
import scoring  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SHIM = os.path.join(HERE, 'grounding', 'preview.ts')
DEFAULT_SIDECAR = os.environ.get('DOCAI_SIDECAR_URL', 'http://127.0.0.1:18088')

# Manifest field -> the structurer's path. Only fields the preview produces.
FIELD_MAP = {
    'supplier_name': 'header.supplier',
    'supplier_abn': 'header.supplier_abn',
    'issue_date': 'header.issue_date',
    'total_inclusive': 'header.payable_amount',
    'gst_amount': 'header.tax_amount',
}

# §6.3, per field group: (min fill rate, max wrong-when-shown).
CEILINGS = {
    'total_inclusive': (0.70, 0.03),
    'gst_amount': (0.70, 0.03),
    'supplier_abn': (0.60, 0.01),
    'issue_date': (0.70, 0.05),
    'supplier_name': (0.60, 0.10),
}


def structure(doc: dict) -> dict:
    """Run the SHIPPED structurer. Never a Python re-implementation."""
    proc = subprocess.run(
        ['pnpm', 'exec', 'tsx', SHIM],
        input=json.dumps({'doc': doc}), capture_output=True, text=True,
        cwd=REPO, shell=(os.name == 'nt'),
    )
    if proc.returncode != 0:
        raise RuntimeError(f'preview.ts failed ({proc.returncode}): {proc.stderr[:400]}')
    return json.loads(proc.stdout)


def ocr_pages(paths: list[str], sidecar: str) -> dict:
    import urllib.request
    import uuid

    merged = {'version': '1.0.0', 'pages': [], 'blocks': [], 'tables': [], 'figures': [],
              'fields': [], 'unreadable': []}
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
            page = json.loads(r.read().decode('utf-8'))
        merged['pages'].extend(page.get('pages') or [])
        merged['blocks'].extend(page.get('blocks') or [])
        merged['unreadable'].extend(page.get('unreadable') or [])
    return merged


def load_device_docdom(root: str, doc_id: str) -> dict | None:
    """A DocDOM exported from a handset, per §6.4 step 2's corpus layout."""
    path = os.path.join(root, f'{doc_id}.json')
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--manifest', default='corpus/sample/manifest.json')
    ap.add_argument('--sidecar', default=DEFAULT_SIDECAR)
    ap.add_argument('--docdom-dir', default=None,
                    help='DocDOMs exported from a handset (bench/corpus/device/<engine>/<device>/). '
                         'Omitted means read through the server sidecar instead.')
    ap.add_argument('--device', default=None,
                    help='Which handset produced them, e.g. "galaxy-a16-5g-4gb". '
                         'Required with --docdom-dir: a gate passed on an unknown device is not a gate.')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    if args.docdom_dir and not args.device:
        print('REFUSED: --docdom-dir needs --device. docs/ON-DEVICE.md §1.2 pins the floor at a '
              '4GB Galaxy A16 5G and a 4GB iPhone 11/12 because a flagship produces numbers that '
              'pass and mean nothing. An unlabelled device makes the result unreadable.',
              file=sys.stderr)
        return 2

    path = args.manifest if os.path.isabs(args.manifest) else os.path.join(HERE, args.manifest)
    manifest = json.load(open(path, encoding='utf-8'))
    prov.assert_manifest_provenance_valid(manifest)
    docs = manifest['documents'][: args.limit] if args.limit else manifest['documents']

    counts = collections.defaultdict(collections.Counter)
    shown = collections.Counter()
    truth_present = collections.Counter()
    # Per tier as well as overall. The structurer's rules are AUSTRALIAN — its
    # keywords are TOTAL and GST and its ABN check is mod-89 — so holding it to
    # §6.3's ceilings on Indonesian dockets would be scoring it against a
    # distribution it was never built for. Tier P still earns its place here: it
    # says whether the RECOGNISER can read real thermal print, which is the
    # other half of the same question.
    by_tier = collections.defaultdict(collections.Counter)
    shown_t = collections.Counter()
    truth_t = collections.Counter()
    rows, failures, skipped = [], [], []

    for i, d in enumerate(docs, 1):
        try:
            if args.docdom_dir:
                docdom = load_device_docdom(
                    args.docdom_dir if os.path.isabs(args.docdom_dir)
                    else os.path.join(HERE, args.docdom_dir), d['id'])
                if docdom is None:
                    skipped.append(d['id'])
                    continue
            else:
                pages = [p if os.path.isabs(p) else os.path.join(HERE, p) for p in d['pages']]
                docdom = ocr_pages(pages, args.sidecar)
            fields = structure(docdom)
        except Exception as exc:  # noqa: BLE001 — recorded, never silent
            failures.append(f'{d["id"]}: {type(exc).__name__}: {exc}')
            print(f'[{i}/{len(docs)}] {d["id"]}: FAILED {type(exc).__name__}', flush=True)
            continue

        got = {}
        for manifest_name, fpath in FIELD_MAP.items():
            spec = d['fields'].get(manifest_name)
            if spec is None:
                continue
            f = fields.get(fpath) or {}
            value = f.get('normalisedValue') if manifest_name == 'issue_date' else f.get('value')
            got[manifest_name] = value
            if spec.get('truth') is not None:
                truth_present[manifest_name] += 1
            if value is not None:
                shown[manifest_name] += 1
            outcome = scoring.score_field(spec['compare'], spec['truth'], value)
            counts[manifest_name][outcome] += 1
            tier = prov.tier_of(d)
            by_tier[(tier, manifest_name)][outcome] += 1
            if spec.get('truth') is not None:
                truth_t[(tier, manifest_name)] += 1
            if value is not None:
                shown_t[(tier, manifest_name)] += 1

        rows.append({'document': d['id'], 'got': got})
        filled = sum(1 for v in got.values() if v is not None)
        print(f'[{i}/{len(docs)}] {d["id"]:<26} filled {filled}/{len(got)}', flush=True)

    source = f'device:{args.device}' if args.docdom_dir else 'server sidecar'
    print()
    print(prov.banner(prov.weakest_tier(docs)))
    print(f'DocDOM source: {source}')
    if not args.docdom_dir:
        print('  Structurer only — this measures the RULES, not the phone. OD-6 needs DocDOMs')
        print('  exported from a floor device (docs/ON-DEVICE.md §6.4 step 2).')
    print()

    # Ceilings are judged on TIER S / R only — Australian-shaped documents.
    tiers = sorted({prov.tier_of(d) for d in docs})
    for tier in tiers:
        judged = tier != 'P'
        print(f"tier {tier}" + ('' if judged else '  (informational — non-Australian, rules not tuned for it)'))
        print(f"  {'field':<18}{'fill':>7}{'wrong-shown':>13}"
              + (f"{'ceiling':>18}{'verdict':>9}" if judged else ''))
        for name in FIELD_MAP:
            c = by_tier[(tier, name)]
            if not c:
                continue
            n_t, n_s = truth_t[(tier, name)], shown_t[(tier, name)]
            fill = (n_s / n_t) if n_t else float('nan')
            wws = ((c['WRONG'] + c['HALLUCINATED']) / n_s) if n_s else 0.0
            min_fill, max_wws = CEILINGS[name]
            ok = (fill >= min_fill if n_t else True) and wws <= max_wws
            tail = f"{f'>={min_fill:.0%} / <={max_wws:.0%}':>18}{'PASS' if ok else 'FAIL':>9}" if judged else ''
            print(f"  {name:<18}{fill:>6.0%}{wws:>12.1%}{tail}")
        print()

    print('all tiers combined')
    print(f"{'field':<18}{'fill':>7}{'wrong-shown':>13}{'ceiling':>18}{'verdict':>9}")
    total_corrections = 0
    total_docs = max(1, len(rows))
    for name in FIELD_MAP:
        c = counts[name]
        n_truth = truth_present[name]
        n_shown = shown[name]
        fill = (n_shown / n_truth) if n_truth else float('nan')
        wrong = c['WRONG'] + c['HALLUCINATED']
        wws = (wrong / n_shown) if n_shown else 0.0
        min_fill, max_wws = CEILINGS[name]
        ok = (fill >= min_fill if n_truth else True) and wws <= max_wws
        total_corrections += c['WRONG'] + c['MISS'] + c['HALLUCINATED']
        print(f"{name:<18}{fill:>6.0%}{wws:>12.1%}{f'>={min_fill:.0%} / <={max_wws:.0%}':>18}"
              f"{'PASS' if ok else 'FAIL':>9}")

    baseline = sum(truth_present.values()) / total_docs * 100
    actual = total_corrections / total_docs * 100
    print()
    print(f'corrections per 100 documents: preview {actual:.0f}  vs  blank form {baseline:.0f}')
    if baseline > 0:
        cut = 1 - actual / baseline
        print(f'  {cut:.0%} FEWER corrections than a blank form '
              f'(§6.3 wants at least 50% fewer) — {"meets" if cut >= 0.5 else "below"} the bar')
    if skipped:
        print(f'\n{len(skipped)} document(s) had no device DocDOM and were skipped')
    if failures:
        print(f'\n{len(failures)} failed:')
        for f in failures[:10]:
            print(f'  {f}')

    if args.out:
        out = args.out if os.path.isabs(args.out) else os.path.join(HERE, args.out)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        json.dump({
            'manifest': args.manifest, 'tier_floor': prov.weakest_tier(docs),
            'docdom_source': source, 'device': args.device,
            'per_field': {k: dict(v) for k, v in counts.items()},
            'shown': dict(shown), 'truth_present': dict(truth_present),
            'corrections_per_100': actual, 'blank_form_baseline_per_100': baseline,
            'rows': rows, 'skipped': skipped, 'failures': failures,
        }, open(out, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
        print(f'\nwrote {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
