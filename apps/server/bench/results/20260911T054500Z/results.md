# Bench results — 2026-09-11T05:45:00.990909+00:00

prompt version: `v1`  
documents: receipt-easy, receipt-noabn, invoice-multipage  
engines run: hosted:gemma4:31b, hosted:minimax-m3  

**DRY RUN — no engine was actually called. Every score below is a placeholder, not a measurement.**

## Not run

| engine | reason |
|---|---|
| paddleocr-pp-structurev3 | paddleocr not installed (pip install paddleocr paddlepaddle) |
| docling | docling not installed (pip install docling) |
| llamaparse | llama-cloud-services not installed AND LLAMA_CLOUD_API_KEY not set |

## Per document x engine

| document | engine | runs | median s | exact | norm | abstain-ok | wrong | miss | halluc | unparse | lines matched | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| receipt-easy | hosted:gemma4:31b | 2/2 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0/3 |  |
| receipt-noabn | hosted:gemma4:31b | 2/2 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0/2 |  |
| invoice-multipage | hosted:gemma4:31b | 2/2 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0/3 |  |
| receipt-easy | hosted:minimax-m3 | 2/2 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0/3 |  |
| receipt-noabn | hosted:minimax-m3 | 2/2 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0/2 |  |
| invoice-multipage | hosted:minimax-m3 | 2/2 | 0.0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0/3 |  |

Each field-outcome column counts fields whose MODE outcome across the repeated runs fell in that bucket, out of the fields defined for that document in manifest.json. `abstain-ok` is a ground-truth null correctly returned as null — a success, not a miss. `halluc` is a ground-truth null that the model filled in anyway — worse than a miss.
