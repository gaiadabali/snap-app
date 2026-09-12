"""Minimal reader for a DocDOM document serialised as JSON.

`packages/docai/src/docdom.ts` is the frozen contract (nobody outside that
package may edit it, per contract §2's ownership table, and this lane does
not need to: DocDOM is plain data, and any engine — the sidecar, a fixture
built by hand, a future TypeScript pipeline dump — can hand this scorer JSON
that matches the shape without either side importing the other's language.

This module reads exactly the fields the OCR-stage metrics need (spans with
box + text + provenance, and the document-level `unreadable` list) and
nothing else -- it is not a full DocDOM deserialiser, and does not attempt to
validate blocks/tables/figures/fields that this scorer never looks at.

`spans_of` mirrors `docdom.ts`'s own `spansOf` (page order, then block/line
`order`) so a region's identity here matches what a human clicking through
the same document in the app would see, but is reimplemented rather than
imported since this is Python and docdom.ts is TypeScript -- see
`geometry.py`'s docstring for the same tradeoff.
"""
from __future__ import annotations

from dataclasses import dataclass

from .geometry import Box


@dataclass
class SpanRecord:
    id: str
    page: int
    text: str
    box: Box
    engine: str
    confidence: float
    calibrated: bool


@dataclass
class UnreadableRecord:
    page: int
    box: Box
    reason: str


class DocDomShapeError(ValueError):
    """Raised when the JSON handed in does not have the fields this scorer
    needs -- a shape error, not a scoring result, so it must never be
    swallowed into a 'MISS' or a zero score."""


def _require(d: dict, key: str, where: str):
    if key not in d:
        raise DocDomShapeError(f'{where}: missing required field {key!r}')
    return d[key]


def load_document(doc: dict) -> tuple[list[SpanRecord], list[UnreadableRecord]]:
    """Parse the subset of a DocDOM `Document` this scorer reads. Raises
    `DocDomShapeError` on anything malformed rather than skipping it, because
    a silently-dropped block would understate misses, which is the direction
    that flatters whatever produced the document."""
    if 'blocks' not in doc:
        raise DocDomShapeError("document: missing required field 'blocks'")

    spans: list[SpanRecord] = []
    blocks = sorted(doc['blocks'], key=lambda b: (b.get('page', 0), b.get('order', 0)))
    for b in blocks:
        page = _require(b, 'page', f"block {b.get('id', '?')}")
        lines = sorted(b.get('lines', []), key=lambda l: l.get('order', 0))
        for line in lines:
            for span in line.get('spans', []):
                sid = _require(span, 'id', 'span')
                text = _require(span, 'text', f'span {sid}')
                box = Box.from_dict(_require(span, 'box', f'span {sid}'))
                prov = _require(span, 'provenance', f'span {sid}')
                spans.append(SpanRecord(
                    id=sid,
                    page=page,
                    text=text,
                    box=box,
                    engine=prov.get('engine', 'unknown'),
                    confidence=float(prov.get('confidence', 0.0)),
                    calibrated=bool(prov.get('calibrated', False)),
                ))

    unreadable = []
    for u in doc.get('unreadable', []):
        unreadable.append(UnreadableRecord(
            page=_require(u, 'page', 'unreadable entry'),
            box=Box.from_dict(_require(u, 'box', 'unreadable entry')),
            reason=_require(u, 'reason', 'unreadable entry'),
        ))
        if not unreadable[-1].reason:
            raise DocDomShapeError(
                "unreadable entry has an empty reason -- contract §4 forbids this "
                "('never an empty string, never a plausible filler')"
            )

    return spans, unreadable
