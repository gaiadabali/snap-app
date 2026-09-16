# OCR-stage bench results — 2026-09-16T09:42:08.668188+00:00

**Tier S — synthetic. NOT evidence for any published claim.** REFUSED: this run's weakest document is tier S (synthetic). Rendered glyphs are ideal, so recall and CER come back optimistic and a calibration curve fitted here would be worse than none. Needs tier R — real Australian captures (docs/GAPS.md B1, docs/CORPUS.md §2). See `docs/CORPUS.md` §1.

source: `--sidecar-url http://127.0.0.1:18088`  

## sidecar

- **Detection (coverage, grouped)**: 7/8 truth regions covered at IoU ≥ 0.5 by their grouped predictions (7/8 had ANY prediction assigned); mean coverage IoU where assigned = 0.823
  - recall = 0.875
  - of 70 predicted spans, 25 fell inside a labelled region (0.357) and 45 did not — NOT automatically false positives, may be real text outside any ground-truth region (e.g. field labels)
- **CER on money / identifier / date (5 regions): 0.0000** — whitespace-insensitive, and this is the headline. Strict is 0.0848 on the same regions, and the difference is the engine splitting `$1,042.60` into `$ 1 , 042.60` — where it drew its boxes, not what it read (docs/GAPS.md A3).
- **CER on prose (2 regions): 0.0192** — strict, because in running text a space is a character the engine either read or did not.
- CER over ALL 7 matched legible regions: strict=0.0661  whitespace-insensitive=0.0000 (the latter drives CORRECT/CONFIDENT_WRONG below)
  - **WER**=0.7714 — noisy at word granularity here; a word-level engine's own box boundaries need not match this ground truth's word breaks, so this is reported but should not be read as a reading-accuracy regression signal on its own
  - `gt-supplier` [text]: truth='Curragundi Rural Supplies Pty Ltd'  read='Curragundi Rural Supplies Pty Ltd'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-abn` [identifier]: truth='69 447 119 320'  read='69 447 119 320'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-date` [date]: truth='14 August 2026'  read='14 August 2026'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-line` [text]: truth='Fencing wire, 25kg roll x4'  read='Fencing wire , 25kg roll x4'  (cer_strict=0.038, cer_ws=0.000)
  - `gt-total` [money]: truth='$1,042.60'  read='$ 1 , 042.60'  (cer_strict=0.333, cer_ws=0.000)
  - `gt-smudged` [identifier]: truth='CN 88421-QX'  read='CN88421-QX'  (cer_strict=0.091, cer_ws=0.000)
  - `gt-faint` [identifier]: truth='REF 7741-BD'  read='REF 7741-BD'  (cer_strict=0.000, cer_ws=0.000)
- **Abstention quality**: mean=0.875  outcomes={'CORRECT': 7, 'ABSTAINED_CORRECTLY': 0, 'ABSTAINED_UNNECESSARILY': 0, 'MISSED': 1, 'WRONG_LOW_CONF': 0, 'CONFIDENT_WRONG': 0}
  - invariant (ABSTAINED_CORRECTLY > CONFIDENT_WRONG) holds this run: None
- **Confidence-vs-error correlation**: n/a (n=7, need ≥2 points with varying confidence)
  - engine reports `calibrated`: [False]

