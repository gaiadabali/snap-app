"""Build a stratified sample across corpora, as one manifest the harness can run.

`docs/GAPS.md` B2 — the head-to-head that has never been run.

    python sample.py --size 24 --out corpus/sample/manifest.json

WHY SAMPLE AT ALL. The corpus is now ~400 documents across two tiers, and the
extraction provider is **shared and weekly rate-limited** (docs/AI.md, and the
project's own note that it is "borrowed + SHARED + weekly-rate-limited — NOT a
prepaid token balance"). A full run is several hundred vision calls per model
and would spend a shared allowance on redundancy: the fortieth clean
supermarket docket tells us nothing the fourth did not.

WHY STRATIFIED RATHER THAN RANDOM. A random draw from this corpus is 28%
supermarket dockets and would under-represent exactly the cases that decide
whether the engine is usable — the severely degraded ones and the abstention
ones. `docs/OCR.md` §8.1 records the harness's own version of this lesson: one
synthetic image scored 8/8 by five of six models and could no longer
discriminate anything. A sample is only worth running if it can still
discriminate.

So the strata are the things that change the answer:

  * **tier** — S and P are different evidence (docs/CORPUS.md §1) and the
    results file reports them apart.
  * **degradation** — clean through severe. Relative difficulty is the one
    thing tier S is faithful about (§2).
  * **abstention** — documents whose correct answer is `null`. Over-weighted
    deliberately: they are how hallucination is measured, and a sample without
    them cannot see the failure mode the VLM path actually has.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import provenance as prov  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

DEFAULT_MANIFESTS = [
    'manifest.json',
    'corpus/generated/manifest.json',
    'corpus/tierp/manifest.json',
]


def _load(path: str) -> list[dict]:
    full = path if os.path.isabs(path) else os.path.join(HERE, path)
    if not os.path.exists(full):
        return []
    with open(full, encoding='utf-8') as f:
        manifest = json.load(f)
    prov.assert_manifest_provenance_valid(manifest)   # same gate as compare.py
    docs = manifest['documents']
    for d in docs:
        # Pages are stored relative to bench/; a combined manifest lives
        # elsewhere, so resolve now and let compare.py's os.path.join keep them.
        d['pages'] = [p if os.path.isabs(p) else os.path.join(HERE, p) for p in d['pages']]
    return docs


def is_abstention(doc: dict) -> bool:
    """Does this document have at least one field whose correct answer is null?"""
    return any(spec.get('truth') is None for spec in doc['fields'].values())


def stratum(doc: dict) -> tuple:
    return (
        prov.tier_of(doc),
        doc.get('degradation', 'n/a'),
        'abstain' if is_abstention(doc) else 'full',
    )


def build(size: int, seed: int, manifests: list[str]) -> dict:
    docs: list[dict] = []
    for m in manifests:
        docs.extend(_load(m))
    if not docs:
        raise SystemExit('no documents found — has the corpus been generated?')

    rng = random.Random(seed)

    # TIER FIRST, then strata within it. A single flat round-robin looked right
    # and was not: every tier P document is an abstention case with no
    # degradation label, so all 95 collapse into ONE stratum and the corpus's
    # only real paper got 1/11 of the sample — three documents. Tier S, being
    # sub-divided into ten strata, took the rest.
    #
    # That is backwards. The S-vs-P contrast is the primary comparison this run
    # exists to make (real print versus rendered), so each tier gets an equal
    # share of the sample and stratification happens INSIDE it.
    by_tier: dict[str, dict[tuple, list[dict]]] = {}
    for d in docs:
        by_tier.setdefault(prov.tier_of(d), {}).setdefault(stratum(d), []).append(d)
    for strata in by_tier.values():
        for b in strata.values():
            rng.shuffle(b)

    tiers = sorted(by_tier)
    quota = {t: size // len(tiers) for t in tiers}
    for t in tiers[: size % len(tiers)]:
        quota[t] += 1

    picked: list[dict] = []
    for tier in tiers:
        strata = by_tier[tier]
        keys = sorted(strata)
        taken, i = 0, 0
        # Round-robin within the tier: every stratum appears before any repeats,
        # which is what keeps the sample discriminating.
        while taken < quota[tier] and any(strata[k] for k in keys):
            k = keys[i % len(keys)]
            if strata[k]:
                picked.append(strata[k].pop())
                taken += 1
            i += 1
        # A tier with fewer documents than its quota hands the remainder back.
        quota_shortfall = quota[tier] - taken
        if quota_shortfall:
            for other in tiers:
                if other == tier:
                    continue
                quota[other] += quota_shortfall
                break

    return {
        '_comment': (
            'GENERATED by sample.py — a stratified sample across corpora, for one bench run. '
            'Do not hand-edit; regenerate with the same --seed. Strata are (tier, degradation, '
            'abstention) and selection is round-robin across them, so every stratum appears '
            'before any repeats. The tier floor of this file governs what the run may claim: '
            'see docs/CORPUS.md §4.'
        ),
        'generator': {'module': 'sample.py', 'seed': seed, 'size': len(picked),
                      'manifests': manifests},
        'prompt_version': 'v1',
        'documents': picked,
    }


def summarise(docs: list[dict]) -> str:
    by: dict[tuple, int] = {}
    for d in docs:
        by[stratum(d)] = by.get(stratum(d), 0) + 1
    lines = [f'{len(docs)} documents across {len(by)} strata:']
    for k in sorted(by):
        lines.append(f'  tier {k[0]}  degradation {k[1]:<9} {k[2]:<8} x{by[k]}')
    lines.append(f'abstention cases: {sum(1 for d in docs if is_abstention(d))}')
    return '\n'.join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--size', type=int, default=24)
    ap.add_argument('--seed', type=int, default=20260916)
    ap.add_argument('--out', default='corpus/sample/manifest.json')
    ap.add_argument('--manifests', nargs='*', default=DEFAULT_MANIFESTS)
    args = ap.parse_args()

    manifest = build(args.size, args.seed, args.manifests)
    out = args.out if os.path.isabs(args.out) else os.path.join(HERE, args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')

    docs = manifest['documents']
    print(summarise(docs))
    print()
    print(f'wrote {out}')
    print(prov.banner(prov.weakest_tier(docs)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
