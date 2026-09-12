"""Per-field scoring: exact match, normalised match, and abstention.

The core principle (docs/AI.md §1, contract §6): a null in the ground truth
means the document does not have that value, and a model returning null there
is CORRECT. Treating that as a "miss" is exactly the bug that made the old
compare.py useless -- it could not tell a correct abstention from a wrong
answer, so it never rewarded a model for saying "I don't know" instead of
guessing.

Five outcomes per field, not two:

  EXACT        truth is not null; got matches truth exactly (after only the
               comparator's own normalisation, e.g. digit-stripping an ABN).
  NORMALISED   truth is not null; got matches after a looser normalisation
               (case-fold, whitespace, currency symbols) but not raw-exact.
  WRONG        truth is not null; got does not match under either rule.
  MISS         truth is not null; got is null/missing -- the model abstained
               when it should not have.
  ABSTAIN_OK   truth IS null; got is null/missing -- correct abstention.
  HALLUCINATED truth IS null; got is a non-null value -- the model invented
               something that is not on the document. Worse than MISS: this
               is the failure mode a silent-error rate is built to catch.

Comparator types (set per field in manifest.json, not hardcoded per field
name here, so the manifest stays the single source of truth):

  exact    — string/enum equality after strip().
  text     — case-folded, whitespace-collapsed substring-or-equality check.
  digits   — strip everything but digits, compare.
  amount   — parse as a decimal (stripping $ and commas), compare to 1 cent.
  bool     — Python bool equality.
  int      — int equality.
"""
from dataclasses import dataclass, field
from typing import Any
import re

EXACT = 'EXACT'
NORMALISED = 'NORMALISED'
WRONG = 'WRONG'
MISS = 'MISS'
ABSTAIN_OK = 'ABSTAIN_OK'
HALLUCINATED = 'HALLUCINATED'
UNPARSEABLE = 'UNPARSEABLE'  # the model's output didn't parse as JSON at all


def _norm_text(s: str) -> str:
    return re.sub(r'\s+', ' ', str(s).strip().lower())


def _norm_digits(s: str) -> str:
    return ''.join(c for c in str(s) if c.isdigit())


def _norm_amount(s):
    s = str(s).strip().replace('$', '').replace(',', '').replace('AUD', '').strip()
    return round(float(s), 2)


def _is_present(v: Any) -> bool:
    return v is not None and v != ''


def score_field(compare: str, truth: Any, got: Any) -> str:
    """Return one of the outcome constants above for a single field."""
    truth_present = _is_present(truth)
    got_present = _is_present(got)

    if not truth_present:
        return ABSTAIN_OK if not got_present else HALLUCINATED
    if not got_present:
        return MISS

    try:
        if compare == 'exact':
            return EXACT if str(truth).strip() == str(got).strip() else WRONG
        if compare == 'text':
            if str(truth).strip() == str(got).strip():
                return EXACT
            return NORMALISED if _norm_text(truth) in _norm_text(got) or _norm_text(got) in _norm_text(truth) else WRONG
        if compare == 'digits':
            if str(truth) == str(got):
                return EXACT
            return NORMALISED if _norm_digits(truth) == _norm_digits(got) and _norm_digits(truth) != '' else WRONG
        if compare == 'amount':
            if str(truth).strip() == str(got).strip():
                return EXACT
            try:
                return NORMALISED if abs(_norm_amount(truth) - _norm_amount(got)) < 0.005 else WRONG
            except (ValueError, TypeError):
                return WRONG
        if compare == 'bool':
            return EXACT if bool(truth) == bool(got) else WRONG
        if compare == 'int':
            try:
                return EXACT if int(truth) == int(got) else WRONG
            except (ValueError, TypeError):
                return WRONG
    except Exception:
        return WRONG
    raise ValueError(f'unknown comparator {compare!r}')


def score_lines(truth_lines: list, got_lines: list) -> tuple[int, int, list[str]]:
    """Containment check: how many of the (representative) truth lines have a
    matching amount somewhere in what the model returned. Descriptions are
    compared loosely (substring, case-insensitive) and only reported as a
    note, never as a separate pass/fail, since OCR of a line description is
    inherently fuzzier than a dollar figure.

    Returns (matched, total, notes).
    """
    if not isinstance(got_lines, list):
        got_lines = []
    got_amounts = []
    for l in got_lines:
        if isinstance(l, dict) and _is_present(l.get('amount')):
            try:
                got_amounts.append((_norm_amount(l['amount']), _norm_text(l.get('description', ''))))
            except (ValueError, TypeError):
                pass
    matched, notes = 0, []
    for tl in truth_lines:
        try:
            t_amt = _norm_amount(tl['amount'])
        except (ValueError, TypeError):
            continue
        hit = next((g for g in got_amounts if abs(g[0] - t_amt) < 0.005), None)
        if hit:
            matched += 1
        else:
            notes.append(f"missing line amount={tl['amount']} ({tl.get('description','')})")
    return matched, len(truth_lines), notes


@dataclass
class DocScore:
    """Aggregated per-field outcomes for one (document, engine, run)."""
    outcomes: dict = field(default_factory=dict)   # field name -> outcome constant
    lines_matched: int = 0
    lines_total: int = 0
    lines_notes: list = field(default_factory=list)
    parse_failed: bool = False

    def counts(self) -> dict:
        c = {k: 0 for k in (EXACT, NORMALISED, WRONG, MISS, ABSTAIN_OK, HALLUCINATED, UNPARSEABLE)}
        for outcome in self.outcomes.values():
            c[outcome] += 1
        return c

    def field_pass(self) -> bool:
        """A run 'passes' if every field is EXACT/NORMALISED/ABSTAIN_OK."""
        good = {EXACT, NORMALISED, ABSTAIN_OK}
        return not self.parse_failed and all(o in good for o in self.outcomes.values())


def score_document(doc: dict, got: dict | None) -> DocScore:
    ds = DocScore()
    if got is None:
        ds.parse_failed = True
        for fname in doc['fields']:
            ds.outcomes[fname] = UNPARSEABLE
        ds.lines_total = len(doc.get('lines', {}).get('truth', []))
        return ds
    for fname, spec in doc['fields'].items():
        ds.outcomes[fname] = score_field(spec['compare'], spec['truth'], got.get(fname))
    truth_lines = doc.get('lines', {}).get('truth', [])
    if truth_lines:
        ds.lines_matched, ds.lines_total, ds.lines_notes = score_lines(truth_lines, got.get('lines'))
    return ds
