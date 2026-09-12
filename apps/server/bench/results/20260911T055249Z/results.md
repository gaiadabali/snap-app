# Bench results — 2026-09-11T05:52:49.221692+00:00

prompt version: `v1`  
documents: receipt-easy, receipt-hard, receipt-noabn, invoice-multipage  
engines run: hosted:gemma4:31b, hosted:minimax-m3  

## Per document x engine

| document | engine | runs | median s | exact | norm | abstain-ok | wrong | miss | halluc | unparse | lines matched | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| receipt-easy | hosted:gemma4:31b | 2/2 | 2.2 | 6 | 1 | 0 | 0 | 1 | 0 | 0 | 3/3 |  |
| receipt-hard | hosted:gemma4:31b | 2/2 | 3.0 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-noabn | hosted:gemma4:31b | 2/2 | 1.4 | 4 | 1 | 2 | 1 | 0 | 0 | 0 | 2/2 |  |
| invoice-multipage | hosted:gemma4:31b | 2/2 | 4.0 | 7 | 0 | 0 | 1 | 0 | 0 | 0 | 3/3 |  |
| receipt-easy | hosted:minimax-m3 | 2/2 | 2.8 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-hard | hosted:minimax-m3 | 2/2 | 4.0 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-noabn | hosted:minimax-m3 | 2/2 | 4.0 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 2/2 |  |
| invoice-multipage | hosted:minimax-m3 | 2/2 | 10.1 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |

Each field-outcome column counts fields whose MODE outcome across the repeated runs fell in that bucket, out of the fields defined for that document in manifest.json. `abstain-ok` is a ground-truth null correctly returned as null — a success, not a miss. `halluc` is a ground-truth null that the model filled in anyway — worse than a miss.
