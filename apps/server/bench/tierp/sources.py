"""Tier P sources: real paper we can legitimately use, with the licence gate.

`docs/CORPUS.md` §6, ticket X4. Tier P exists to get **real thermal print, real
dropout, real glare and real curl** into the corpus without Australian paper,
which tier S fundamentally cannot produce (§2). An engine that cannot read a
Singaporean or Indonesian docket will not read a Gundagai one, and that finding
is available now rather than after the client ships us paper.

WHAT TIER P IS NOT. It is not evidence about Australian paperwork. Every
document imported here carries `tier: P`, and `provenance.may_publish_headline`
refuses `corrections per 100 documents` and any calibration curve on that
basis. That refusal is the entire point of the tier system.

THE LICENCE GATE, AND WHY IT IS HERE. `packages/docai/src/registry.ts` has
`violatesLicenceFloor()` for model weights, and D23's reasoning is that
discovering a licence problem during a customer's procurement review is a bad
day CI can have instead. Training data is the same exposure with a longer fuse:
a corpus assembled casually today is a question nobody can answer the day a
fine-tune ships. So each source declares its licence, and a source whose licence
is **unstated** is refused outright — `docs/OCR.md` §2 already rules on the
equivalent case for weights: *"An unstated licence is an unusable one."*

That rule has teeth immediately. SROIE is the best-known public receipt set and
is listed below as REFUSED, because its Hugging Face card states no licence at
all.
"""
from __future__ import annotations

from dataclasses import dataclass

# Licences we accept for internal measurement. Permissive and explicit.
ACCEPTABLE_LICENCES = frozenset({'cc-by-4.0', 'cc-by-sa-4.0', 'mit', 'apache-2.0', 'cc0-1.0'})


class SourceRefused(Exception):
    """Raised when a source cannot be used, with the reason in the message."""


@dataclass(frozen=True)
class Source:
    key: str
    dataset: str                # Hugging Face dataset id
    config: str
    split: str
    licence: str | None         # None means UNSTATED, which is refused
    captured_in: str            # ISO-3166 alpha-2 of where the paper was photographed
    description: str

    def check(self) -> None:
        if self.licence is None:
            raise SourceRefused(
                f"source {self.key!r} ({self.dataset}) states NO licence. Refused: an unstated "
                'licence is an unusable one (docs/OCR.md §2 rules the same way for model '
                'weights). Find a licensed equivalent rather than assuming permission.'
            )
        if self.licence not in ACCEPTABLE_LICENCES:
            raise SourceRefused(
                f"source {self.key!r} ({self.dataset}) is licensed {self.licence!r}, which is not "
                f'in the accepted set {sorted(ACCEPTABLE_LICENCES)}. Add it deliberately, with a '
                'note on what it permits, or drop the source.'
            )


SOURCES: dict[str, Source] = {
    'cord-v2': Source(
        key='cord-v2',
        dataset='naver-clova-ix/cord-v2',
        config='default',
        split='test',
        licence='cc-by-4.0',
        captured_in='ID',
        description=(
            'CORD — Consolidated Receipt Dataset. Real photographed Indonesian receipts with '
            'line-item ground truth. The closest public analogue to an Australian thermal '
            'docket: same print technology, same degradation, same line-item structure. The tax '
            'regime is Indonesian and irrelevant here — what is being measured is whether the '
            'engine can READ thermal print.'
        ),
    ),
}

# Deliberately listed, deliberately refused. Keeping these visible is the point:
# the next person to reach for SROIE finds the reason rather than the dataset.
REFUSED_SOURCES: dict[str, tuple[str, str]] = {
    'sroie': (
        'darentang/sroie',
        'No licence stated on the dataset card (checked 2026-09-16). ICDAR 2019 competition '
        'data, widely used, and still unusable by the rule above — "an unstated licence is an '
        'unusable one". Revisit only if the organisers publish terms.',
    ),
    'invoices-donut': (
        'katanaml-org/invoices-donut-data-v1',
        'MIT and therefore acceptable on licence, but the images are GENERATED invoices rather '
        'than photographed paper. That is tier S with extra steps — it adds no real print, '
        'which is the only reason tier P exists.',
    ),
}


def get(key: str) -> Source:
    """Fetch a source by key, refusing anything that fails the licence gate."""
    if key in REFUSED_SOURCES:
        dataset, reason = REFUSED_SOURCES[key]
        raise SourceRefused(f'source {key!r} ({dataset}) is on the refused list: {reason}')
    if key not in SOURCES:
        raise SourceRefused(
            f'unknown source {key!r}. Known: {sorted(SOURCES)}; refused: {sorted(REFUSED_SOURCES)}'
        )
    source = SOURCES[key]
    source.check()
    return source
