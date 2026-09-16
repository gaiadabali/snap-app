# Bench results — 2026-09-16T07:26:51.807606+00:00

**Tier S — synthetic. NOT evidence for any published claim.** REFUSED: this run's weakest document is tier S (synthetic). Rendered glyphs are ideal, so recall and CER come back optimistic and a calibration curve fitted here would be worse than none. Needs tier R — real Australian captures (docs/GAPS.md B1, docs/CORPUS.md §2). See `docs/CORPUS.md` §1.

corpus: 12 x tier S, 12 x tier P  
prompt version: `v1`  
documents: tierp-cord-v2-0071, tierp-cord-v2-0039, tierp-cord-v2-0030, tierp-cord-v2-0062, tierp-cord-v2-0015, tierp-cord-v2-0042, tierp-cord-v2-0003, tierp-cord-v2-0009, tierp-cord-v2-0066, tierp-cord-v2-0028, tierp-cord-v2-0001, tierp-cord-v2-0093, gen-no_abn_van-0102, gen-supermarket-0043, gen-no_abn_van-0029, gen-supermarket-0084, gen-no_abn_van-0011, gen-cafe-0291, receipt-noabn, invoice-multipage, gen-no_abn_van-0006, gen-cafe-0016, gen-no_abn_van-0082, gen-trade_invoice-0020  
engines run: hosted:gemma4:31b, hosted:minimax-m3  

## Not run

| engine | reason |
|---|---|
| paddleocr-pp-structurev3 | paddleocr not installed (pip install paddleocr paddlepaddle) |
| docling | docling not installed (pip install docling) |
| llamaparse | llama-cloud-services not installed AND LLAMA_CLOUD_API_KEY not set |

## Corrections per 100 documents

REFUSED: this run's weakest document is tier S (synthetic). Rendered glyphs are ideal, so recall and CER come back optimistic and a calibration curve fitted here would be worse than none. Needs tier R — real Australian captures (docs/GAPS.md B1, docs/CORPUS.md §2).

<details><summary>Internal figure — engineering use only, not quotable</summary>

| engine | corrections per 100 (tier S, NOT a claim) |
|---|---|
| hosted:gemma4:31b | 70.8 |
| hosted:minimax-m3 | 83.3 |

</details>

## Per document x engine

| document | engine | runs | median s | exact | norm | abstain-ok | wrong | miss | halluc | unparse | lines matched | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tierp-cord-v2-0071 | hosted:gemma4:31b | 2/2 | 2.2 | 4 | 0 | 1 | 0 | 1 | 0 | 0 | 6/6 |  |
| tierp-cord-v2-0039 | hosted:gemma4:31b | 2/2 | 6.2 | 4 | 0 | 1 | 0 | 1 | 0 | 0 | 1/1 |  |
| tierp-cord-v2-0030 | hosted:gemma4:31b | 2/2 | 13.9 | 3 | 0 | 1 | 1 | 1 | 0 | 0 | 0/2 |  |
| tierp-cord-v2-0062 | hosted:gemma4:31b | 2/2 | 6.1 | 3 | 0 | 1 | 1 | 1 | 0 | 0 | 1/2 |  |
| tierp-cord-v2-0015 | hosted:gemma4:31b | 2/2 | 5.0 | 3 | 0 | 1 | 1 | 1 | 0 | 0 | 2/2 |  |
| tierp-cord-v2-0042 | hosted:gemma4:31b | 2/2 | 3.1 | 3 | 0 | 2 | 1 | 0 | 0 | 0 | 4/4 |  |
| tierp-cord-v2-0003 | hosted:gemma4:31b | 2/2 | 3.9 | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 1/1 |  |
| tierp-cord-v2-0009 | hosted:gemma4:31b | 2/2 | 5.3 | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 1/1 |  |
| tierp-cord-v2-0066 | hosted:gemma4:31b | 2/2 | 6.1 | 3 | 0 | 1 | 0 | 1 | 0 | 0 | 7/8 |  |
| tierp-cord-v2-0028 | hosted:gemma4:31b | 2/2 | 5.1 | 3 | 0 | 1 | 1 | 1 | 0 | 0 | 6/6 |  |
| tierp-cord-v2-0001 | hosted:gemma4:31b | 2/2 | 4.0 | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 3/3 |  |
| tierp-cord-v2-0093 | hosted:gemma4:31b | 2/2 | 9.9 | 3 | 0 | 1 | 1 | 1 | 0 | 0 | 0/3 |  |
| gen-no_abn_van-0102 | hosted:gemma4:31b | 2/2 | 1.8 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 3/3 |  |
| gen-supermarket-0043 | hosted:gemma4:31b | 2/2 | 5.6 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 9/9 |  |
| gen-no_abn_van-0029 | hosted:gemma4:31b | 2/2 | 3.4 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 3/3 |  |
| gen-supermarket-0084 | hosted:gemma4:31b | 2/2 | 5.4 | 6 | 1 | 0 | 1 | 0 | 0 | 0 | 10/10 |  |
| gen-no_abn_van-0011 | hosted:gemma4:31b | 2/2 | 4.0 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 1/1 |  |
| gen-cafe-0291 | hosted:gemma4:31b | 2/2 | 4.5 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 4/4 |  |
| receipt-noabn | hosted:gemma4:31b | 2/2 | 2.9 | 4 | 1 | 2 | 1 | 0 | 0 | 0 | 2/2 |  |
| invoice-multipage | hosted:gemma4:31b | 2/2 | 11.9 | 7 | 0 | 0 | 1 | 0 | 0 | 0 | 3/3 |  |
| gen-no_abn_van-0006 | hosted:gemma4:31b | 2/2 | 5.6 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 2/2 |  |
| gen-cafe-0016 | hosted:gemma4:31b | 2/2 | 4.3 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 4/4 |  |
| gen-no_abn_van-0082 | hosted:gemma4:31b | 2/2 | 4.0 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 3/3 |  |
| gen-trade_invoice-0020 | hosted:gemma4:31b | 2/2 | 8.8 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 22/22 |  |
| tierp-cord-v2-0071 | hosted:minimax-m3 | 2/2 | 9.4 | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 6/6 |  |
| tierp-cord-v2-0039 | hosted:minimax-m3 | 2/2 | 10.1 | 3 | 0 | 1 | 1 | 1 | 0 | 0 | 0/1 |  |
| tierp-cord-v2-0030 | hosted:minimax-m3 | 2/2 | 22.1 | 3 | 0 | 1 | 1 | 1 | 0 | 0 | 2/2 |  |
| tierp-cord-v2-0062 | hosted:minimax-m3 | 2/2 | 18.1 | 3 | 0 | 1 | 1 | 1 | 0 | 0 | 1/2 |  |
| tierp-cord-v2-0015 | hosted:minimax-m3 | 2/2 | 20.8 | 2 | 0 | 1 | 2 | 1 | 0 | 0 | 2/2 |  |
| tierp-cord-v2-0042 | hosted:minimax-m3 | 2/2 | 8.9 | 3 | 0 | 2 | 1 | 0 | 0 | 0 | 4/4 |  |
| tierp-cord-v2-0003 | hosted:minimax-m3 | 2/2 | 7.2 | 3 | 0 | 2 | 1 | 0 | 0 | 0 | 0/1 |  |
| tierp-cord-v2-0009 | hosted:minimax-m3 | 2/2 | 15.7 | 3 | 0 | 2 | 1 | 0 | 0 | 0 | 1/1 |  |
| tierp-cord-v2-0066 | hosted:minimax-m3 | 2/2 | 21.2 | 2 | 0 | 1 | 2 | 0 | 0 | 0 | 7/8 |  |
| tierp-cord-v2-0028 | hosted:minimax-m3 | 2/2 | 7.7 | 2 | 0 | 1 | 3 | 0 | 0 | 0 | 6/6 |  |
| tierp-cord-v2-0001 | hosted:minimax-m3 | 2/2 | 12.8 | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 3/3 |  |
| tierp-cord-v2-0093 | hosted:minimax-m3 | 2/2 | 24.3 | 3 | 0 | 1 | 2 | 0 | 0 | 0 | 2/3 |  |
| gen-no_abn_van-0102 | hosted:minimax-m3 | 2/2 | 5.1 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 3/3 |  |
| gen-supermarket-0043 | hosted:minimax-m3 | 2/2 | 19.6 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 9/9 |  |
| gen-no_abn_van-0029 | hosted:minimax-m3 | 2/2 | 7.4 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 3/3 |  |
| gen-supermarket-0084 | hosted:minimax-m3 | 2/2 | 8.1 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 10/10 |  |
| gen-no_abn_van-0011 | hosted:minimax-m3 | 2/2 | 5.6 | 4 | 1 | 2 | 1 | 0 | 0 | 0 | 1/1 |  |
| gen-cafe-0291 | hosted:minimax-m3 | 2/2 | 4.7 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 4/4 |  |
| receipt-noabn | hosted:minimax-m3 | 2/2 | 4.7 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 2/2 |  |
| invoice-multipage | hosted:minimax-m3 | 2/2 | 20.2 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 3/3 |  |
| gen-no_abn_van-0006 | hosted:minimax-m3 | 2/2 | 4.7 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 2/2 |  |
| gen-cafe-0016 | hosted:minimax-m3 | 2/2 | 10.1 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 4/4 |  |
| gen-no_abn_van-0082 | hosted:minimax-m3 | 2/2 | 5.2 | 5 | 1 | 2 | 0 | 0 | 0 | 0 | 3/3 |  |
| gen-trade_invoice-0020 | hosted:minimax-m3 | 2/2 | 10.3 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 22/22 |  |

Each field-outcome column counts fields whose MODE outcome across the repeated runs fell in that bucket, out of the fields defined for that document in manifest.json. `abstain-ok` is a ground-truth null correctly returned as null — a success, not a miss. `halluc` is a ground-truth null that the model filled in anyway — worse than a miss.
