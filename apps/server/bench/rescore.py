"""Re-score a finished run against a changed manifest, without calling any engine.

    python rescore.py results/20260916T072651Z --manifest corpus/sample/manifest.json

WHY THIS EXISTS. A comparator is a judgement about what counts as a correct
reading, and a judgement can turn out wrong. Tier P money was first scored with
the `text` comparator, which marked a model that returned `16500` against a
truth of `16,500` as WRONG — every digit correct, one separator normalised.
Twelve of fourteen "misreads" in the first head-to-head were that.

Fixing the comparator then meant re-running every model call against a shared,
weekly rate-limited provider, to re-derive outcomes from answers we already
had. That is the wrong shape. `compare.py` now persists `parsed_by_run`, and
this script re-derives every outcome from it.

WHAT IT DOES NOT DO. It cannot re-score a run from before `parsed_by_run`
existed — those results carry outcomes but not answers, and this refuses rather
than guessing. It also never calls an engine, so a document added to the
manifest since the run simply has no data and is reported as such.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import compare  # noqa: E402  (for to_markdown and mode_outcome)
import provenance as prov  # noqa: E402
import scoring  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


class NotRescorable(Exception):
    pass


def rescore(run_dir: str, manifest_path: str) -> dict:
    run_dir = run_dir if os.path.isabs(run_dir) else os.path.join(HERE, run_dir)
    with open(os.path.join(run_dir, 'results.json'), encoding='utf-8') as f:
        report = json.load(f)

    manifest = compare.load_manifest(manifest_path)   # same ABN + provenance gates
    docs = {d['id']: d for d in manifest['documents']}

    missing = [r['document'] for r in report['results'] if 'parsed_by_run' not in r]
    if missing:
        raise NotRescorable(
            f'{len(missing)} result rows have no `parsed_by_run` — this run predates it '
            '(compare.py stores it since 2026-09-16). The answers were not kept, so the '
            'outcomes cannot be re-derived. Re-run the engines instead of guessing.'
        )

    rescored, skipped = [], []
    for r in report['results']:
        doc = docs.get(r['document'])
        if doc is None:
            skipped.append(r['document'])
            continue
        runs: dict[str, list[str]] = {f: [] for f in doc['fields']}
        lines_matched, parse_failures = [], 0
        for parsed in r['parsed_by_run']:
            ds = scoring.score_document(doc, parsed)
            for f, outcome in ds.outcomes.items():
                runs.setdefault(f, []).append(outcome)
            if ds.lines_total:
                lines_matched.append(ds.lines_matched)
            if ds.parse_failed:
                parse_failures += 1
        entry = dict(r)
        entry['field_outcomes_by_run'] = runs
        entry['field_outcome_mode'] = {f: compare.mode_outcome(v) for f, v in runs.items() if v}
        entry['parse_failures'] = parse_failures
        entry['lines_matched_median'] = (
            sorted(lines_matched)[len(lines_matched) // 2] if lines_matched else None
        )
        rescored.append(entry)

    out = dict(report)
    out['results'] = rescored
    out['rescored_from'] = os.path.basename(run_dir.rstrip(os.sep))
    out['rescored_against'] = manifest_path
    documents = [docs[i] for i in {r['document'] for r in rescored} if i in docs]
    out['tier_floor'] = prov.weakest_tier(documents)
    out['tier_breakdown'] = prov.tier_breakdown(documents)
    out['skipped_not_in_manifest'] = skipped
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('run_dir')
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--out-dir', default=None, help='default: <run_dir>-rescored')
    args = ap.parse_args()

    try:
        report = rescore(args.run_dir, args.manifest)
    except NotRescorable as exc:
        print(f'REFUSED: {exc}', file=sys.stderr)
        return 2

    out_dir = args.out_dir or (
        os.path.join(HERE, args.run_dir.rstrip('/\\') + '-rescored')
        if not os.path.isabs(args.run_dir) else args.run_dir + '-rescored'
    )
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'results.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    with open(os.path.join(out_dir, 'results.md'), 'w', encoding='utf-8') as f:
        f.write(compare.to_markdown(report))

    if report['skipped_not_in_manifest']:
        print(f"skipped (not in manifest): {sorted(set(report['skipped_not_in_manifest']))}")
    print(f'wrote {out_dir}')
    print(prov.banner(report['tier_floor']))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
