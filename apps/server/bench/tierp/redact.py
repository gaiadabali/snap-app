"""Find and mask personal data on a real receipt before it enters the repository.

`docs/CORPUS.md` §6.2, rule 1. Tier P documents are photographs of real paper
that real people were handed, and real receipts carry card numbers, phone
numbers, email addresses, loyalty ids and sometimes signatures. None of that is
needed to measure whether an engine finds a total, and a corpus full of
strangers' card numbers is a liability sitting in a git history forever.

HOW IT FINDS THEM. With the OCR sidecar we now actually deploy
(`services/docai-engine`, A1′). Every span comes back with a box, so a span
whose text matches a PII pattern can be masked at its own coordinates rather
than by blanking a region someone guessed at. This is the grounding contract
paying for itself in a place it was not designed for: you cannot redact what
you cannot locate, which is the same argument D16 makes about extraction.

THE FAILURE MODE TO RESPECT. The OCR is not perfect, so this is not a proof
that no PII remains — it is a filter. Two safeguards follow from that:

  1. A document where PII is detected on MORE than `MAX_REDACTIONS` spans is
     DROPPED rather than redacted. Heavy PII means a document type we did not
     expect, and masking twenty boxes on a receipt we have not looked at is a
     worse bet than not importing it.
  2. `pii_reviewed` in the manifest means "this filter ran and the document
     passed", not "a human certified it". The provenance field records the
     tool and version so that claim stays honest.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# A document needing more than this many redactions is dropped, not cleaned.
MAX_REDACTIONS = 6

# Patterns are deliberately BROAD. A false positive costs one masked box on a
# receipt we do not otherwise care about; a false negative puts a stranger's
# card number in git permanently. The asymmetry is not close.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # 13-19 digits, optionally grouped. Catches a full PAN in any grouping.
    ('card', re.compile(r'(?:\d[ \-]?){13,19}')),
    # Masked PANs are still worth removing: the last four digits plus a
    # merchant and a timestamp is more identifying than it looks.
    ('card-masked', re.compile(r'[*x#]{3,}\s*\d{3,4}\b', re.I)),
    ('email', re.compile(r'[\w.+-]+@[\w-]+\.[\w.]{2,}')),
    # Phone numbers must carry STRUCTURE — a `+` prefix, or a separator. A bare
    # unbroken digit run is not a phone here, and the reason is specific: an
    # Australian ABN is ELEVEN BARE DIGITS and the earlier version of this
    # pattern matched it. Masking an ABN would delete ground truth we score
    # against — on tier R, the corpus that the whole commercial claim rests on.
    # Caught by `test_an_abn_is_not_treated_as_a_card`.
    #
    # The cost is a false negative on a phone printed as a bare 10-digit run.
    # Accepted deliberately: `_ABN_SHAPE` below protects only the exact ABN
    # shape, so a bare 10- or 12-digit run is still caught by the fallback.
    ('phone', re.compile(r'(?:\+\d[\d \-]{6,})|(?:\d{2,4}[ \-]\d{2,4}[ \-]\d{2,4}(?:[ \-]\d{2,4})?)')),
    # Bare digit runs that are not an ABN and not a price: 8-10 or 12 digits.
    ('id-run', re.compile(r'(?<!\d)(?:\d{8,10}|\d{12})(?!\d)')),
    # Loyalty / member / account identifiers, where the label is adjacent.
    ('member-id', re.compile(r'\b(?:member|loyalty|acct|account|cust(?:omer)?)\W{0,3}\w*\d{4,}',
                             re.I)),
]

# Never redact a span that is plainly money or a date, even if a broad pattern
# above matches it. Removing the total from a receipt destroys the only thing
# the document was imported for.
_NEVER = re.compile(
    r'^\s*(?:'
    r'[\$€£¥]?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?'      # money, either locale
    r'|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}'                      # a day-first date
    # ISO, listed separately: `2026-09-16` is year-FIRST, so the day-first
    # pattern above does not match it, and the phone pattern's
    # digits-separator-digits shape does. `issue_date` truth is stored in ISO
    # throughout this repo, so this is the exact form most likely to appear.
    r'|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}'                        # an ISO date
    r'|\d{1,2}:\d{2}(?::\d{2})?'                                # a time
    r')\s*$'
)

# Eleven bare digits, optionally spaced in the 2-3-3-3 grouping the ATO prints.
# NEVER redacted, and this is load-bearing rather than cautious: the ABN is a
# ground-truth field every AU document is scored on, and it is the one field
# whose mod-89 checksum makes an invented value unrepresentable. Masking it
# would quietly remove the corpus's best hallucination test.
#
# An ABN is public company-register data, not personal information, so there is
# no privacy argument on the other side.
_ABN_SHAPE = re.compile(r'^\s*(?:\d{11}|\d{2}[ ]\d{3}[ ]\d{3}[ ]\d{3})\s*$')


@dataclass(frozen=True)
class Hit:
    kind: str
    text: str
    box: dict


def looks_like_pii(text: str) -> str | None:
    """Return the PII kind for `text`, or None. Money, dates and times never match."""
    t = (text or '').strip()
    if not t or _NEVER.match(t) or _ABN_SHAPE.match(t):
        return None
    digits = sum(c.isdigit() for c in t)
    for kind, pattern in _PATTERNS:
        m = pattern.search(t)
        if not m:
            continue
        # A pattern that matched only a couple of digits inside a longer string
        # is noise — `phone` in particular will chew on anything numeric.
        if kind in ('card', 'phone', 'id-run') and digits < 8:
            continue
        return kind
    return None


def find(spans: list[dict]) -> list[Hit]:
    """PII hits across a flat list of DocDOM spans, each with the box to mask.

    Span-level only. Prefer `find_in_document`, which also catches PII split
    ACROSS spans — see its docstring for why that matters.
    """
    hits: list[Hit] = []
    for span in spans:
        kind = looks_like_pii(span.get('text', ''))
        if kind:
            hits.append(Hit(kind=kind, text=span.get('text', ''), box=span.get('box') or {}))
    return hits


def _union_box(spans: list[dict]) -> dict:
    boxes = [s.get('box') for s in spans if s.get('box')]
    if not boxes:
        return {}
    x0 = min(float(b['x']) for b in boxes)
    y0 = min(float(b['y']) for b in boxes)
    x1 = max(float(b['x']) + float(b['width']) for b in boxes)
    y1 = max(float(b['y']) + float(b['height']) for b in boxes)
    return {'x': x0, 'y': y0, 'width': x1 - x0, 'height': y1 - y0}


def find_in_document(doc: dict) -> list[Hit]:
    """PII hits over a whole DocDOM, checking LINES as well as spans.

    THE REASON THIS EXISTS. The sidecar splits a line into word spans, so a
    receipt printing `MASTERCARD ****8830` yields spans `'MASTERCARD'`,
    `'****'`, `'8830'` — and no single span matches a masked-PAN pattern. A
    span-only filter reports "no PII detected" on a document that plainly
    carries a card number, which is a FALSE NEGATIVE: the direction this
    module's header calls the one that actually costs something.

    So each line's spans are joined and tested as a unit, and when the joined
    text matches, the union of the contributing span boxes is masked. A line
    that hits is not also reported per-span, so `MAX_REDACTIONS` counts
    findings rather than fragments.
    """
    hits: list[Hit] = []
    for block in doc.get('blocks', []):
        for line in block.get('lines', []):
            spans = line.get('spans', []) or []
            joined = ' '.join((s.get('text') or '').strip() for s in spans).strip()
            kind = looks_like_pii(joined) if joined else None
            if kind:
                hits.append(Hit(kind=kind, text=joined, box=_union_box(spans)))
                continue  # do not double-count the same line's spans
            hits.extend(find(spans))
    return hits


def mask(image, hits: list[Hit]):
    """Paint an opaque box over every hit. Returns the image, mutated in place.

    Opaque, not blurred. A blur is reversible often enough to matter and it
    leaves the glyph shapes legible to an engine, which is exactly the reader
    we are trying to keep the data away from.
    """
    from PIL import ImageDraw

    draw = ImageDraw.Draw(image)
    for hit in hits:
        b = hit.box
        if not b:
            continue
        x, y = float(b.get('x', 0)), float(b.get('y', 0))
        w, h = float(b.get('width', 0)), float(b.get('height', 0))
        if w <= 0 or h <= 0:
            continue
        pad = 2
        draw.rectangle(
            [x - pad, y - pad, x + w + pad, y + h + pad],
            fill=(20, 20, 20),
        )
    return image


def decide(hits: list[Hit]) -> tuple[bool, str]:
    """(import_it, reason). A heavily-PII document is dropped, not cleaned."""
    if len(hits) > MAX_REDACTIONS:
        return False, (
            f'{len(hits)} PII spans detected (limit {MAX_REDACTIONS}). Dropped rather than '
            'redacted: that much personal data means a document type we did not expect, and '
            'masking it blind is a worse bet than not importing it.'
        )
    return True, (f'{len(hits)} span(s) redacted' if hits else 'no PII detected')
