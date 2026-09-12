# Bench results — 2026-09-11T08:03:56.293092+00:00

prompt version: `v1`  
documents: receipt-easy, receipt-hard, receipt-noabn, invoice-multipage  
engines run: hosted:minimax-m3, hosted:gemma4:31b, hosted:kimi-k3, hosted:qwen3.5:397b  

## Per document x engine

| document | engine | runs | median s | exact | norm | abstain-ok | wrong | miss | halluc | unparse | lines matched | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| receipt-easy | hosted:minimax-m3 | 5/5 | 4.2 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-hard | hosted:minimax-m3 | 5/5 | 5.7 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-noabn | hosted:minimax-m3 | 5/5 | 3.4 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 2/2 |  |
| invoice-multipage | hosted:minimax-m3 | 5/5 | 13.0 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-easy | hosted:gemma4:31b | 5/5 | 2.4 | 6 | 1 | 0 | 0 | 1 | 0 | 0 | 3/3 |  |
| receipt-hard | hosted:gemma4:31b | 5/5 | 2.9 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-noabn | hosted:gemma4:31b | 5/5 | 1.8 | 4 | 1 | 2 | 1 | 0 | 0 | 0 | 2/2 |  |
| invoice-multipage | hosted:gemma4:31b | 5/5 | 4.1 | 7 | 0 | 0 | 1 | 0 | 0 | 0 | 3/3 |  |
| receipt-easy | hosted:kimi-k3 | 5/5 | 5.9 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-hard | hosted:kimi-k3 | 5/5 | 7.7 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-noabn | hosted:kimi-k3 | 5/5 | 5.4 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 2/2 |  |
| invoice-multipage | hosted:kimi-k3 | 5/5 | 28.6 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-easy | hosted:qwen3.5:397b | 5/5 | 21.2 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-hard | hosted:qwen3.5:397b | 5/5 | 27.3 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| receipt-noabn | hosted:qwen3.5:397b | 5/5 | 20.4 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 2/2 |  |
| invoice-multipage | hosted:qwen3.5:397b | 5/5 | 50.2 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |

Each field-outcome column counts fields whose MODE outcome across the repeated runs fell in that bucket, out of the fields defined for that document in manifest.json. `abstain-ok` is a ground-truth null correctly returned as null — a success, not a miss. `halluc` is a ground-truth null that the model filled in anyway — worse than a miss.
