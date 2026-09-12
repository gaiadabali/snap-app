# Bench results — 2026-09-11T05:47:45.974477+00:00

prompt version: `v1`  
documents: receipt-easy  
engines run: hosted:glm-5.2  

## Per document x engine

| document | engine | runs | median s | exact | norm | abstain-ok | wrong | miss | halluc | unparse | lines matched | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| receipt-easy | hosted:glm-5.2 | 0/1 | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | —/3 | 1 failed |

Each field-outcome column counts fields whose MODE outcome across the repeated runs fell in that bucket, out of the fields defined for that document in manifest.json. `abstain-ok` is a ground-truth null correctly returned as null — a success, not a miss. `halluc` is a ground-truth null that the model filled in anyway — worse than a miss.
