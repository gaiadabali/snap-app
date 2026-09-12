"""OCR-stage scoring (docs/contracts/phase1-ocr-stage.md §6, lane G).

The existing `bench/` harness (compare.py, scoring.py) scores *fields* —
supplier, ABN, total — produced by a VLM reading a whole page at once. Phase 1
inserts a stage one layer below that: detection + recognition that emits TEXT
AND BOXES (DocDOM: `packages/docai/src/docdom.ts`), with the VLM demoted to
the escalation path. Field accuracy cannot grade that stage: a recogniser can
get every box wrong and still let a downstream VLM fix it up into the right
field, and a recogniser that regresses on boxes alone would show up nowhere in
compare.py's results. This package is the stage's own numbers.

Four measurements, all required by the contract:

  - `text_metrics.py`   — CER / WER per region.
  - `geometry.py`       — detection IoU (did we find the text, and where).
  - `abstention.py`     — abstention quality: a correctly-declared-unreadable
                            region must outscore a confident wrong reading.
  - `calibration.py`    — confidence-vs-error correlation, the input D20
                            calibration needs before `Provenance.calibrated`
                            can honestly become `true` for any engine.

Everything here is pure and stdlib-only (no numpy/scipy dependency) so it
runs in the same bare Python 3.13 environment the rest of `bench/` already
uses, and so the metrics can be unit-tested against constructed fixtures
without a live engine — see `test_ocr_metrics.py`.

`ocr_score.py` (one level up, `apps/server/bench/ocr_score.py`) is the CLI
that wires these against a DocDOM document from ANY source: a file on disk, a
live sidecar (contract §4's `POST /read`), or the ground truth itself scored
against itself as a trivial "identity engine" smoke test. It reports "not
run" — never a fabricated number — when no engine is reachable, per contract
§6's closing rule: invent nothing.
"""
