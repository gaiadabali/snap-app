# OCR-stage bench results — 2026-09-11T14:08:46.872352+00:00

source: `--sidecar-url http://127.0.0.1:8088`  

## sidecar

- **Detection (coverage, grouped)**: 5/7 truth regions covered at IoU ≥ 0.5 by their grouped predictions (5/7 had ANY prediction assigned); mean coverage IoU where assigned = 0.848
  - recall = 0.714
  - of 58 predicted spans, 22 fell inside a labelled region (0.379) and 36 did not — NOT automatically false positives, may be real text outside any ground-truth region (e.g. field labels)
- **CER** (mean over 5 matched legible regions): strict=0.0744  whitespace-insensitive=0.0000 (drives CORRECT/CONFIDENT_WRONG below)
  - **WER**=0.8800 — noisy at word granularity here; a word-level engine's own box boundaries need not match this ground truth's word breaks, so this is reported but should not be read as a reading-accuracy regression signal on its own
  - `gt-supplier`: truth='Curragundi Rural Supplies Pty Ltd'  read='Curragundi Rural Supplies Pty Ltd'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-abn`: truth='69 447 119 320'  read='69 447 119 320'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-date`: truth='14 August 2026'  read='14 August 2026'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-line`: truth='Fencing wire, 25kg roll x4'  read='Fencing wire , 25kg roll x4'  (cer_strict=0.038, cer_ws=0.000)
  - `gt-total`: truth='$1,042.60'  read='$ 1 , 042.60'  (cer_strict=0.333, cer_ws=0.000)
- **Abstention quality**: mean=0.714  outcomes={'CORRECT': 5, 'ABSTAINED_CORRECTLY': 0, 'ABSTAINED_UNNECESSARILY': 0, 'MISSED': 2, 'WRONG_LOW_CONF': 0, 'CONFIDENT_WRONG': 0}
  - invariant (ABSTAINED_CORRECTLY > CONFIDENT_WRONG) holds this run: None
- **Confidence-vs-error correlation**: n/a (n=5, need ≥2 points with varying confidence)
  - engine reports `calibrated`: [False]

