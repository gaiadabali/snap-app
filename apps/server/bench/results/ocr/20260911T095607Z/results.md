# OCR-stage bench results — 2026-09-11T09:56:07.614890+00:00

source: `--self-test (constructed fixtures, not a real engine)`  
**SELF-TEST: both documents below were built by this script directly from ground truth, not produced by any real OCR engine. They exist to prove the scorer works, not to measure a recogniser. Use --docdom or --sidecar-url for a real measurement.**  

## fixture:identity-reader

- **Detection (coverage, grouped)**: 5/6 truth regions covered at IoU ≥ 0.5 by their grouped predictions (5/6 had ANY prediction assigned); mean coverage IoU where assigned = 1.000
  - recall = 0.833
  - of 5 predicted spans, 5 fell inside a labelled region (1.000) and 0 did not — NOT automatically false positives, may be real text outside any ground-truth region (e.g. field labels)
- **CER** (mean over 5 matched legible regions): strict=0.0000  whitespace-insensitive=0.0000 (drives CORRECT/CONFIDENT_WRONG below)
  - **WER**=0.0000 — noisy at word granularity here; a word-level engine's own box boundaries need not match this ground truth's word breaks, so this is reported but should not be read as a reading-accuracy regression signal on its own
  - `gt-supplier`: truth='Curragundi Rural Supplies Pty Ltd'  read='Curragundi Rural Supplies Pty Ltd'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-abn`: truth='69 447 119 320'  read='69 447 119 320'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-date`: truth='14 August 2026'  read='14 August 2026'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-line`: truth='Fencing wire, 25kg roll x4'  read='Fencing wire, 25kg roll x4'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-total`: truth='$1,042.60'  read='$1,042.60'  (cer_strict=0.000, cer_ws=0.000)
- **Abstention quality**: mean=1.000  outcomes={'CORRECT': 5, 'ABSTAINED_CORRECTLY': 1, 'ABSTAINED_UNNECESSARILY': 0, 'MISSED': 0, 'WRONG_LOW_CONF': 0, 'CONFIDENT_WRONG': 0}
  - invariant (ABSTAINED_CORRECTLY > CONFIDENT_WRONG) holds this run: None
- **Confidence-vs-error correlation**: n/a (n=5, need ≥2 points with varying confidence)
  - engine reports `calibrated`: [False]

## fixture:flawed-reader

- **Detection (coverage, grouped)**: 6/6 truth regions covered at IoU ≥ 0.5 by their grouped predictions (6/6 had ANY prediction assigned); mean coverage IoU where assigned = 1.000
  - recall = 1.000
  - of 6 predicted spans, 6 fell inside a labelled region (1.000) and 0 did not — NOT automatically false positives, may be real text outside any ground-truth region (e.g. field labels)
- **CER** (mean over 5 matched legible regions): strict=0.0143  whitespace-insensitive=0.0182 (drives CORRECT/CONFIDENT_WRONG below)
  - **WER**=0.0500 — noisy at word granularity here; a word-level engine's own box boundaries need not match this ground truth's word breaks, so this is reported but should not be read as a reading-accuracy regression signal on its own
  - `gt-supplier`: truth='Curragundi Rural Supplies Pty Ltd'  read='Curragundi Rural Supplies Pty Ltd'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-abn`: truth='69 447 119 320'  read='69 447 119 321'  (cer_strict=0.071, cer_ws=0.091)
  - `gt-date`: truth='14 August 2026'  read='14 August 2026'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-line`: truth='Fencing wire, 25kg roll x4'  read='Fencing wire, 25kg roll x4'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-total`: truth='$1,042.60'  read='$1,042.60'  (cer_strict=0.000, cer_ws=0.000)
- **Abstention quality**: mean=0.333  outcomes={'CORRECT': 4, 'ABSTAINED_CORRECTLY': 0, 'ABSTAINED_UNNECESSARILY': 0, 'MISSED': 0, 'WRONG_LOW_CONF': 0, 'CONFIDENT_WRONG': 2}
  - invariant (ABSTAINED_CORRECTLY > CONFIDENT_WRONG) holds this run: None
- **Confidence-vs-error correlation**: r=1.000 (n=5)
  - engine reports `calibrated`: [False]

## fixture:mixed-reader

- **Detection (coverage, grouped)**: 5/6 truth regions covered at IoU ≥ 0.5 by their grouped predictions (5/6 had ANY prediction assigned); mean coverage IoU where assigned = 1.000
  - recall = 0.833
  - of 5 predicted spans, 5 fell inside a labelled region (1.000) and 0 did not — NOT automatically false positives, may be real text outside any ground-truth region (e.g. field labels)
- **CER** (mean over 5 matched legible regions): strict=0.0143  whitespace-insensitive=0.0182 (drives CORRECT/CONFIDENT_WRONG below)
  - **WER**=0.0500 — noisy at word granularity here; a word-level engine's own box boundaries need not match this ground truth's word breaks, so this is reported but should not be read as a reading-accuracy regression signal on its own
  - `gt-supplier`: truth='Curragundi Rural Supplies Pty Ltd'  read='Curragundi Rural Supplies Pty Ltd'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-abn`: truth='69 447 119 320'  read='69 447 119 321'  (cer_strict=0.071, cer_ws=0.091)
  - `gt-date`: truth='14 August 2026'  read='14 August 2026'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-line`: truth='Fencing wire, 25kg roll x4'  read='Fencing wire, 25kg roll x4'  (cer_strict=0.000, cer_ws=0.000)
  - `gt-total`: truth='$1,042.60'  read='$1,042.60'  (cer_strict=0.000, cer_ws=0.000)
- **Abstention quality**: mean=0.667  outcomes={'CORRECT': 4, 'ABSTAINED_CORRECTLY': 1, 'ABSTAINED_UNNECESSARILY': 0, 'MISSED': 0, 'WRONG_LOW_CONF': 0, 'CONFIDENT_WRONG': 1}
  - invariant (ABSTAINED_CORRECTLY > CONFIDENT_WRONG) holds this run: True
- **Confidence-vs-error correlation**: r=1.000 (n=5)
  - engine reports `calibrated`: [False]

