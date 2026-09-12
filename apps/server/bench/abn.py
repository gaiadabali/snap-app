"""Australian Business Number checksum — ported from the modulus-89 check in
apps/server/src/extraction/validators.ts (`abnIsValid`), so the bench harness
judges ABNs by the exact same rule the product does.

Why this file exists at all: a hand-typed "plausible-looking" 11-digit number
in a ground-truth manifest is not automatically a valid ABN, and if it isn't,
the corpus is worthless for the one thing mod-89 exists to catch — a
one-digit misread is the most expensive failure this product has, and an
invalid ground-truth ABN makes a correct reading and an incorrect reading
fail identically. See docs/OCR.md §9 / the coordinator's note: this rotted
silently once already (invoice-multipage's original truth, 54129887341,
failed the checksum) and the fix is to make it impossible to reintroduce
silently, not just to correct the one number.
"""

_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]


def abn_checksum(digits: str) -> int:
    """The mod-89 remainder for an 11-digit string. 0 means valid."""
    d = [int(c) for c in digits]
    if len(d) != 11:
        raise ValueError(f'ABN must be 11 digits, got {len(d)}: {digits!r}')
    total = sum((n - 1 if i == 0 else n) * _WEIGHTS[i] for i, n in enumerate(d))
    return total % 89


def abn_is_valid(abn) -> bool:
    if not abn:
        return False
    digits = ''.join(c for c in str(abn) if c.isdigit())
    if len(digits) != 11:
        return False
    return abn_checksum(digits) == 0


def derive_valid_abn(business9: str) -> str:
    """Given the 9 trailing digits of an ABN (the actual business number,
    positions 2..10), find the 2 leading check digits that make the whole
    11-digit number pass mod-89 — i.e. derive a genuinely valid ABN instead
    of typing a plausible one. Used by gen_corpus.py so every synthetic
    document's ABN is checksum-valid by construction, not by luck.
    """
    if len(business9) != 9 or not business9.isdigit():
        raise ValueError(f'business9 must be exactly 9 digits, got {business9!r}')
    for first_two in range(100):
        candidate = f'{first_two:02d}{business9}'
        if abn_checksum(candidate) == 0:
            return candidate
    raise RuntimeError(f'no valid check-digit pair found for business9={business9!r} — should be impossible')


def assert_manifest_abns_valid(manifest: dict) -> None:
    """Manifest self-check (the durable fix, not just the one-time patch):
    every non-null supplier_abn ground truth in manifest.json must pass the
    checksum, or the harness refuses to run. A gold set whose ground truth is
    never validated rots silently; this makes that impossible to miss.

    Raises ValueError naming every offending document, so a bad manifest
    fails loudly and specifically rather than producing a corpus that scores
    a wrong ABN as correct.
    """
    problems = []
    for doc in manifest.get('documents', []):
        fields = doc.get('fields', {})
        abn_field = fields.get('supplier_abn')
        if abn_field is None:
            continue
        truth = abn_field.get('truth')
        if truth is None:
            continue  # absence-of-ABN is a legitimate abstention case (receipt-noabn)
        if not abn_is_valid(truth):
            problems.append(f"document '{doc['id']}': supplier_abn truth {truth!r} fails the mod-89 checksum")
    if problems:
        raise ValueError(
            'manifest.json ground truth contains invalid ABN(s) — fix before running the harness:\n  '
            + '\n  '.join(problems)
        )


if __name__ == '__main__':
    # Quick standalone check: python abn.py
    import json
    import os
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'manifest.json'), encoding='utf-8') as f:
        m = json.load(f)
    assert_manifest_abns_valid(m)
    print('all ground-truth ABNs in manifest.json pass the mod-89 checksum')
