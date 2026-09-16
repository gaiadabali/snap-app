"""Corpus provenance: what a document is evidence FOR, enforced rather than noted.

`docs/CORPUS.md` §1 and §4. A corpus does three different jobs — exercise the
harness, regression-test the code, and support a claim — and they have
different evidence bars. Conflating them is how a synthetic number ends up on
a slide.

Three tiers:

  S  SYNTHETIC. Rendered from HTML we author, degraded by hard.py. Perfect
     glyphs underneath, so detection recall and CER come back OPTIMISTIC and a
     calibration curve fitted here is worse than none — it would make
     `auto_accepted` a risk decision resting on a false risk. Faithful for
     anything structural: does the structurer find the total, does a missing
     ABN yield null, does every field carry a span.

  P  PUBLIC. Real photographed documents from public datasets or the open web.
     Real thermal print, real dropout, real glare — but NOT Australian, and not
     our users' distribution. Good enough to decide whether an engine can read
     thermal print at all; not evidence about Australian paperwork.

  R  REAL AU. What `docs/GAPS.md` B1 actually asks for: captured in Australia,
     per-field ground truth committed. The only tier that supports a published
     claim.

WHY THIS FILE EXISTS AT ALL. The manifest already carried `"synthetic": true`
on every document. That is a flag, and a flag is precisely what shipped the
sample testimonials — three overrides, each with a comment instructing its own
removal, none removed, so the guard could never fire. The lesson recorded in
`docs/DEPLOY.md` §8 and `docs/GAPS.md` is that **a decision recorded in a
document is not a control**. So the tier is not a note here. It is required
with no default, it is validated, and `may_publish_headline()` REFUSES below
Tier R — the same property `compare.py`'s engine adapters already have, where
an engine that did not run reports "not run" with a reason rather than a score.

Same shape as `abn.py`: a validator that raises naming every offending
document, called from `compare.py`'s `load_manifest()`, plus a `__main__`
self-check.
"""
from __future__ import annotations

TIER_SYNTHETIC = 'S'
TIER_PUBLIC = 'P'
TIER_REAL_AU = 'R'

TIERS = (TIER_SYNTHETIC, TIER_PUBLIC, TIER_REAL_AU)

# Ordered weakest to strongest. `weakest_tier` reports the floor of a run,
# because a mixed run is only as quotable as its weakest document.
_RANK = {TIER_SYNTHETIC: 0, TIER_PUBLIC: 1, TIER_REAL_AU: 2}

TIER_NAMES = {
    TIER_SYNTHETIC: 'synthetic',
    TIER_PUBLIC: 'public (real paper, not Australian)',
    TIER_REAL_AU: 'real Australian capture',
}

REQUIRED_KEYS = ('tier', 'source', 'licence', 'captured_in', 'pii_reviewed')


class ProvenanceError(ValueError):
    """Raised when the manifest's provenance block is missing or incoherent."""


def tier_of(doc: dict) -> str:
    """The document's tier. Raises rather than defaulting — see the module docstring."""
    prov = doc.get('provenance')
    if not isinstance(prov, dict):
        raise ProvenanceError(f"document {doc.get('id')!r} has no provenance block")
    tier = prov.get('tier')
    if tier not in TIERS:
        raise ProvenanceError(
            f"document {doc.get('id')!r} has provenance.tier {tier!r}; expected one of {TIERS}"
        )
    return tier


def _problems_for(doc: dict) -> list[str]:
    ident = doc.get('id', '<no id>')
    prov = doc.get('provenance')
    if not isinstance(prov, dict):
        return [
            f"document '{ident}': no provenance block. Every document must declare one — "
            'there is no default tier, because a defaulted tier is a guess about what the '
            'document proves (docs/CORPUS.md §4).'
        ]

    problems: list[str] = []
    missing = [k for k in REQUIRED_KEYS if k not in prov]
    if missing:
        problems.append(f"document '{ident}': provenance is missing {', '.join(sorted(missing))}")

    tier = prov.get('tier')
    if tier not in TIERS:
        problems.append(
            f"document '{ident}': provenance.tier is {tier!r}; expected one of {TIERS}"
        )
        return problems  # the checks below are all tier-dependent

    if not str(prov.get('source') or '').strip():
        problems.append(f"document '{ident}': provenance.source is empty — say where it came from")
    if not str(prov.get('licence') or '').strip():
        problems.append(
            f"document '{ident}': provenance.licence is empty. Cheap to record now and "
            'impossible later; it is what lets us drop a document whose licence turns out '
            'to matter (docs/CORPUS.md §6.2).'
        )

    captured_in = prov.get('captured_in')
    if tier == TIER_SYNTHETIC:
        if captured_in is not None:
            problems.append(
                f"document '{ident}': tier S is rendered, so provenance.captured_in must be null, "
                f'not {captured_in!r}'
            )
    else:
        if not isinstance(captured_in, str) or len(captured_in) != 2 or not captured_in.isalpha():
            problems.append(
                f"document '{ident}': tier {tier} is a real capture, so provenance.captured_in "
                f'must be a two-letter country code, not {captured_in!r}'
            )
        elif tier == TIER_REAL_AU and captured_in.upper() != 'AU':
            problems.append(
                f"document '{ident}': tier R means captured in Australia, but captured_in is "
                f"{captured_in!r}. A real capture from elsewhere is tier P."
            )

    # A real document can carry a card PAN, a name, an address or a signature.
    # Tier S cannot, because we invented every value in it.
    if tier in (TIER_PUBLIC, TIER_REAL_AU) and prov.get('pii_reviewed') is not True:
        problems.append(
            f"document '{ident}': tier {tier} is a real document and provenance.pii_reviewed "
            'is not true. Redact card numbers, names and addresses in the IMAGE and set the '
            'matching ground truth to the redacted value before committing '
            '(docs/CORPUS.md §6.2).'
        )

    return problems


def assert_manifest_provenance_valid(manifest: dict) -> None:
    """Raise naming every offending document, so one run fixes the whole manifest.

    Deliberately not a warning. A document whose provenance is unknown cannot be
    scored into a headline, and continuing past that point is how the headline
    gets quoted anyway.
    """
    problems: list[str] = []
    for doc in manifest.get('documents', []):
        problems.extend(_problems_for(doc))
    if problems:
        raise ProvenanceError(
            'manifest.json provenance is invalid — fix before running the harness:\n  '
            + '\n  '.join(problems)
        )


def weakest_tier(documents: list[dict]) -> str | None:
    """The floor of a set of documents. None for an empty set.

    A mixed run is only as quotable as its weakest document, which is why this
    is a floor and not an average or a majority.
    """
    tiers = [tier_of(d) for d in documents]
    if not tiers:
        return None
    return min(tiers, key=lambda t: _RANK[t])


def tier_breakdown(documents: list[dict]) -> dict[str, int]:
    """Counts per tier, always printed, so a mixed run cannot hide behind an average."""
    counts = {t: 0 for t in TIERS}
    for doc in documents:
        counts[tier_of(doc)] += 1
    return counts


def may_publish_headline(tier: str | None) -> tuple[bool, str]:
    """May a headline number be emitted from a run whose floor is `tier`?

    Returns (allowed, reason). The reason is printed IN PLACE OF the number, so
    a reader of results.md sees why it is absent rather than an empty cell they
    might fill in from somewhere else.

    Headline numbers are `corrections per 100 documents` (docs/GAPS.md B4, the
    metric the practice channel actually buys) and any calibration curve
    (B3/D20). Both are statistical statements about the real distribution.
    """
    if tier is None:
        return False, 'no documents were scored, so there is nothing to report'
    if tier == TIER_REAL_AU:
        return True, ''
    if tier == TIER_SYNTHETIC:
        return False, (
            'REFUSED: this run\'s weakest document is tier S (synthetic). Rendered glyphs are '
            'ideal, so recall and CER come back optimistic and a calibration curve fitted here '
            'would be worse than none. Needs tier R — real Australian captures '
            '(docs/GAPS.md B1, docs/CORPUS.md §2).'
        )
    return False, (
        'REFUSED: this run\'s weakest document is tier P (real paper, but not Australian). '
        'Good evidence that the engine can read thermal print; not evidence about Australian '
        'paperwork, which is what the claim would be about. Needs tier R '
        '(docs/GAPS.md B1, docs/CORPUS.md §2).'
    )


def banner(tier: str | None) -> str:
    """One line for the top of results.md, naming what the run can and cannot support."""
    if tier is None:
        return '**No documents scored.**'
    if tier == TIER_REAL_AU:
        return (
            '**Tier R — real Australian captures.** This run can support a published claim, '
            'provided the corpus and date are stated alongside it.'
        )
    allowed, reason = may_publish_headline(tier)
    assert not allowed
    return (
        f'**Tier {tier} — {TIER_NAMES[tier]}. NOT evidence for any published claim.** '
        f'{reason} See `docs/CORPUS.md` §1.'
    )


if __name__ == '__main__':
    # Quick standalone check: python provenance.py
    import json
    import os

    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, 'manifest.json'), encoding='utf-8') as f:
        m = json.load(f)
    assert_manifest_provenance_valid(m)
    docs = m.get('documents', [])
    floor = weakest_tier(docs)
    print(f'manifest.json provenance is valid: {tier_breakdown(docs)}')
    print(f'weakest tier: {floor}')
    print(banner(floor))
