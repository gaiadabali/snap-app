"""CER and WER — character/word error rate against ground truth text.

Standard definition: edit_distance(truth, hyp) / len(truth), at the character
level for CER and the whitespace-tokenised word level for WER. Both are
computed with a plain Levenshtein DP — no external dependency, since `bench/`
otherwise runs in a bare Python 3.13 environment (see PaddleOCR's own install
problem, contract §4, for why "just pip install a metrics package" is not
assumed to be free here).

A truth string of length 0 makes the rate undefined, not 0 or 1 — reported as
`None` (see docstring on `cer`/`wer`) rather than invented, matching the
"invent nothing" rule for the case that would otherwise silently read as a
perfect score.
"""
from __future__ import annotations


def _levenshtein(a: list, b: list) -> int:
    """Classic O(len(a) * len(b)) edit distance over two sequences (chars or
    tokens — the caller decides which by what it passes in)."""
    n, m = len(a), len(b)
    if n == 0:
        return m
    if m == 0:
        return n
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        curr = [i] + [0] * m
        ai = a[i - 1]
        for j in range(1, m + 1):
            cost = 0 if ai == b[j - 1] else 1
            curr[j] = min(
                prev[j] + 1,      # deletion
                curr[j - 1] + 1,  # insertion
                prev[j - 1] + cost,  # substitution
            )
        prev = curr
    return prev[m]


def cer(truth: str, hyp: str) -> float | None:
    """Character error rate. `None` when `truth` is empty (undefined, not 0)."""
    if truth == '':
        return None
    dist = _levenshtein(list(truth), list(hyp))
    return dist / len(truth)


def wer(truth: str, hyp: str) -> float | None:
    """Word error rate over whitespace-split tokens. `None` when `truth` has
    no words."""
    t_words = truth.split()
    h_words = hyp.split()
    if not t_words:
        return None
    dist = _levenshtein(t_words, h_words)
    return dist / len(t_words)


def _strip_all_whitespace(s: str) -> str:
    return ''.join(s.split())


def cer_ignoring_whitespace(truth: str, hyp: str) -> float | None:
    """CER after removing ALL whitespace from both strings first.

    Exists because of a real finding from the first live-sidecar run
    (ocr_score.py's grouping fix): a word-level recogniser's box boundaries
    do not, and should not be expected to, land on the same word breaks a
    region's ground truth was authored with. Concatenating grouped spans
    with a single space between each (the natural thing to do, and what
    `ocr_score.py` does for the reported hypothesis text) can misplace
    spacing around punctuation and inside multi-token numbers (`$1,042.60`
    read as the four tokens `$` `1` `,` `042.60` naively joins to
    `$ 1 , 042.60`) even when every character the engine reported is
    correct. Plain `cer()` would then score that as a real error, which
    conflates "the engine read the wrong characters" with "concatenating
    independently-boxed word spans cannot reproduce exact inter-word
    spacing" -- two very different defects with different owners (the
    recogniser vs. this scorer's join heuristic).

    This is reported ALONGSIDE plain `cer()`, never instead of it -- a
    genuine dropped or added space is a real defect for anything that quotes
    the ORIGINAL text verbatim (contract §4's whole reason DocDOM stores
    spans instead of markdown), so collapsing whitespace differences must be
    an explicit, visible, secondary number, not a silent substitution for
    the strict one.
    """
    return cer(_strip_all_whitespace(truth), _strip_all_whitespace(hyp))
