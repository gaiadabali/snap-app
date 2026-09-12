> **Superseded** — this run scored `invoice-multipage` against an invalid ground-truth ABN (`54129887341`, fails mod-89 per apps/server/src/extraction/validators.ts::abnIsValid). Fixed in manifest.json/gen_corpus.py; see results/20260911T055249Z/ for the corrected re-run.

# Bench results — 2026-09-11T05:47:28.909395+00:00

prompt version: `v1`  
documents: receipt-noabn, invoice-multipage  
engines run: hosted:gemma4:31b  

## Per document x engine

| document | engine | runs | median s | exact | norm | abstain-ok | wrong | miss | halluc | unparse | lines matched | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| receipt-noabn | hosted:gemma4:31b | 2/2 | 1.7 | 4 | 1 | 2 | 1 | 0 | 0 | 0 | 2/2 |  |
| invoice-multipage | hosted:gemma4:31b | 2/2 | 3.9 | 7 | 0 | 0 | 1 | 0 | 0 | 0 | 3/3 |  |

Each field-outcome column counts fields whose MODE outcome across the repeated runs fell in that bucket, out of the fields defined for that document in manifest.json. `abstain-ok` is a ground-truth null correctly returned as null — a success, not a miss. `halluc` is a ground-truth null that the model filled in anyway — worse than a miss.
