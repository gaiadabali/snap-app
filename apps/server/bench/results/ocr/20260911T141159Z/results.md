# OCR-stage bench results — 2026-09-11T14:11:50.294638+00:00

source: `--sidecar-url http://127.0.0.1:8088`  

## sidecar

- **Detection (coverage, grouped)**: 7/8 truth regions covered at IoU ≥ 0.5 by their grouped predictions (7/8 had ANY prediction assigned); mean coverage IoU where assigned = 0.823
  - recall = 0.875
  - of 70 predicted spans, 25 fell inside a labelled region (0.357) and 45 did not — NOT automatically false positives, may be real text outside any ground-truth region (e.g. field labels)
- **CER** (mean over 7 matched legible regions): strict=0.0661  whitespace-insensitive=0.0000 (drives CORRECT/CONFIDENT_WRONG below)
  - **WER**=0.7714 — noisy at word granularity here; a word-level engine's own box boundaries need not match this ground truth's word breaks, so this is reported but should not be read as a reading-accuracy regression signal on its own
  - `gt-supplier`: truth='Curragundi Rural Supplies Pty Ltd'  read='Curragundi Rural Supplies Pty Ltd'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-abn`: truth='69 447 119 320'  read='69 447 119 320'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-date`: truth='14 August 2026'  read='14 August 2026'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-line`: truth='Fencing wire, 25kg roll x4'  read='Fencing wire , 25kg roll x4'  (cer_strict=0.038, cer_ws=0.000)
  - `gt-total`: truth='$1,042.60'  read='$ 1 , 042.60'  (cer_strict=0.333, cer_ws=0.000)
  - `gt-smudged`: truth='CN 88421-QX'  read='CN88421-QX'  (cer_strict=0.091, cer_ws=0.000)
  - `gt-faint`: truth='REF 7741-BD'  read='REF 7741-BD'  (cer_strict=0.000, cer_ws=0.000)
- **Abstention quality**: mean=0.875  outcomes={'CORRECT': 7, 'ABSTAINED_CORRECTLY': 0, 'ABSTAINED_UNNECESSARILY': 0, 'MISSED': 1, 'WRONG_LOW_CONF': 0, 'CONFIDENT_WRONG': 0}
  - invariant (ABSTAINED_CORRECTLY > CONFIDENT_WRONG) holds this run: None
- **Confidence-vs-error correlation**: n/a (n=7, need ≥2 points with varying confidence)
  - engine reports `calibrated`: [False]

