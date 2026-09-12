# docai-engine — the OCR sidecar (Phase 1, lane E)

A small Python HTTP service wrapping PP-OCRv5 (PaddleOCR), per
`docs/contracts/phase1-ocr-stage.md` §4. It is the only thing in this repo
allowed to know PaddleOCR's shapes; everything it returns is DocDOM-shaped
(`packages/docai/src/docdom.ts`), so the adapter in `packages/docai/src/engines/sidecar.ts`
(lane F, not this lane) never has to translate — it just parses JSON.

## Does PaddleOCR actually run here? Yes — with one workaround.

Python 3.13 (`C:\Program Files\Python313`) was the concern going in. Verified
in a venv under this directory (`.venv313`):

| Package | Version | Result |
|---|---|---|
| `paddlepaddle` | 3.3.1 | Installs (`cp313` wheel exists now), `paddle.utils.run_check()` passes on CPU |
| `paddleocr` | 3.7.0 | Installs, PP-OCRv5 detection+recognition models download and run |
| `paddlex` | 3.7.2 | Pulled in by paddleocr; the actual inference runtime |

So the premise in the brief ("paddlepaddle may not support 3.13") turned out
to be *no longer* true for paddlepaddle 3.3.1 — but a different, real bug
showed up instead, which is the thing actually worth reporting:

**Bug found:** with `enable_mkldnn=True` (paddleocr/paddlex's CPU default),
text detection throws on *both* PP-OCRv5 detection models on this machine:

```
NotImplementedError: (Unimplemented) ConvertPirAttribute2RuntimeAttribute not
support [pir::ArrayAttribute<pir::DoubleAttribute>]
(at ..\paddle\fluid\framework\new_executor\instruction\onednn\onednn_instruction.cc:118)
```

This reproduces identically for `PP-OCRv5_server_det` and `PP-OCRv5_mobile_det`,
so it isn't a per-model gap in PaddleX's own `MKLDNN_BLOCKLIST`
(`paddlex/inference/models/runners/paddle_static/config/blocklists.py`) — it's
a version incompatibility between paddlepaddle 3.3.1's new PIR executor and
its oneDNN (mkldnn) backend on this CPU/OS build. **Workaround, verified:**
`enable_mkldnn=False`. CPU inference is then correct — just without that
accelerator. This is set as the default in `ocr_engine.py` and should be
re-tested before ever flipping `DOCAI_ENABLE_MKLDNN=true` (e.g. after a
paddlepaddle upgrade).

No substitution happened. This is PaddleOCR / PP-OCRv5, run for real, with a
documented CPU-backend flag turned off because turning it on crashes.

## What actually runs, CPU vs GPU

Everything verified here is **CPU** (`device="cpu"`). GPU (`device="gpu"`) is
wired via the same `DOCAI_DEVICE` env var but **not tested** — no CUDA-capable
GPU on this machine. Per the contract, CPU must work and does; GPU is an
optimisation left unverified rather than faked.

Two model tiers, both Apache-2.0, selectable with `DOCAI_MODEL_TIER`:

| Tier | Models | Per-receipt latency (steady state, CPU, mkldnn off) |
|---|---|---|
| `mobile` (default) | `PP-OCRv5_mobile_det` + `PP-OCRv5_mobile_rec` | ~5.7s |
| `server` | `PP-OCRv5_server_det` + `PP-OCRv5_server_rec` | ~31s |

Measured on `apps/server/bench/receipt.png` (1120×1800), same process,
repeated calls (so model-load time excluded). `mobile` is the default because
5x the latency for the `server` tier is hard to justify as "near-free" CPU
inference at the volumes §4.4 describes (T1's whole selling point is no GPU
and no rate limit) — a deployer who wants the accuracy trade can set
`DOCAI_MODEL_TIER=server`. Cold model load (first request after process
start) is ~2-3s for `mobile`, reported once in `/health.modelLoadMs`.

## Endpoints

### `GET /health`

```json
{
  "ok": true,
  "models": [
    {"id": "PP-OCRv5_mobile_det", "licence": "apache-2.0", "loaded": true},
    {"id": "PP-OCRv5_mobile_rec", "licence": "apache-2.0", "loaded": true}
  ],
  "device": "cpu",
  "engine": "ppocr-v5",
  "modelTier": "mobile",
  "capabilities": ["detect", "recognise"],
  "mkldnnEnabled": false,
  "modelLoadMs": 2647.09,
  "error": null
}
```

`models`/`device`/`ok` are the contract's minimum shape; the rest are
additive fields the adapter can ignore. `capabilities` deliberately omits
`"layout"` — see Limitations below. Licences: paddlepaddle, paddleocr and
paddlex are all Apache-2.0 (checked via `pip show`); PP-OCRv5's own weights
are released Apache-2.0 by the PaddleOCR project. D23's floor is met.

### `POST /read`

`multipart/form-data` with two parts:
- `image`: the page image bytes (PNG/JPEG — anything Pillow decodes).
- `params`: a JSON string: `{"pageNumber": 1, "capabilities": ["detect","recognise"], "region": {"x":0,"y":0,"width":100,"height":50}}`.
  `region` is optional; when present, only that sub-rectangle (in original
  page pixels) is read, and returned boxes are still in original page
  coordinates (the crop offset is folded back in before the response is
  built — see "Coordinate verification" below). This is what a later
  escalation/re-read of a single flagged region would call.

Response — exactly the contract's `{ blocks, unreadable, engine, timings }`,
`blocks`/`unreadable` DocDOM-shaped:

```json
{
  "blocks": [{
    "id": "blk-p1-0", "kind": "unknown", "page": 1, "order": 0,
    "box": {"x": 253, "y": 546, "width": 621, "height": 712},
    "provenance": {"engine": "ppocr-v5", "confidence": 0.727, "calibrated": false},
    "lines": [{
      "id": "ln-p1-17", "order": 16,
      "box": {"x": 737, "y": 997, "width": 132, "height": 38, "rotation": -2.62},
      "spans": [
        {"id": "sp-p1-l17-w0", "text": "$", "box": {"x":742,"y":1003,"width":5,"height":26},
         "provenance": {"engine": "ppocr-v5", "confidence": 0.999, "calibrated": false}},
        {"id": "sp-p1-l17-w1", "text": "266.91", "box": {"x":763,"y":1003,"width":96,"height":26},
         "provenance": {"engine": "ppocr-v5", "confidence": 0.999, "calibrated": false}}
      ]
    }]
  }],
  "unreadable": [{"page": 1, "box": {"x":304,"y":812,"width":10,"height":10,"rotation":-50.2}, "reason": "empty_recognition"}],
  "engine": "ppocr-v5",
  "timings": {"totalMs": 5870.05}
}
```

That `"266.91"` span (the receipt total) is real output from a real call
against `apps/server/bench/receipt.png` on this machine — the box
`{x:763, y:1003, width:96, height:26}` is drawable on the original 1120×1800
PNG right over the printed total. Full response captured during verification;
reproduce with the curl command in "Verification" below.

## The three rules from the contract

**1. Boxes in original page coordinates.** `use_doc_orientation_classify`,
`use_doc_unwarping` and `use_textline_orientation` are all forced off in
`ocr_engine.py` — no derivative is ever created, so there is no transform to
report and `Page.transform`/`restoration` bookkeeping (lane F's concern,
since `Page` is assembled in the pipeline, not here) can stay identity/empty
for anything this sidecar reads. **Verified, not assumed:** the region-crop
test below reads the *same* text via a 180×60 crop and a full 1120×1800 page
and both land on the same original-image coordinates (±1-2px from detector
quantisation) — see "Coordinate verification".

**2. Abstain rather than guess.** Two cases move a region to `unreadable`
instead of emitting a span: empty recognition (`"empty_recognition"`) and
recognition confidence below `DOCAI_MIN_CONFIDENCE` (default `0.3`,
reason `"low_confidence:<score>"`). Neither ever emits an empty-string or
filler span. Note the asymmetry this doesn't cover: a region the *detector*
never finds at all (glare/dim text below the detection threshold) is not in
`unreadable` either — we don't know it exists, which is a different fact from
"found it, couldn't read it" (this is exactly the distinction
`Document.unreadable`'s own comment in docdom.ts calls out). That gap is
inherent to a detect-then-recognise engine and would need a second engine or
a human pass to close, not a sidecar fix.

**3. `calibrated: false` everywhere.** Every `Provenance` in this service sets
it explicitly. No calibration work (D20) has been done — PP-OCRv5's raw CTC
score is reported as-is.

## Word-level spans, and what "per-character confidence" actually means here

`Span.chars` (per-character boxes) is **not populated**. PP-OCRv5's
recogniser is CTC over the whole text line; `paddleocr`'s `return_word_box`
gives *word*-level sub-boxes (split on literal spaces in the recognised
string — see `text_word`/`text_word_region` in the raw PaddleX result), not
true per-character boxes for space-separated scripts. Populating `chars` from
word boxes would violate DocDOM's own contract for that field ("length
matches `text`") and would be exactly the kind of "plausible-looking box it
did not compute" the brief warns against. So: `Span`s are emitted at
**word granularity** (finer than a whole line, which is what grounding a
`$1,234.56` inside a longer line needs), `chars` is omitted, and every word
span in a line carries that line's one recognition score — repeating a real
measured number at finer geometric grain, not inventing a new one. This is
documented in code (`ocr_engine.py`) as well.

## Verification performed (real, on this machine)

Server started with `.venv313\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8731`.

```
curl -s http://127.0.0.1:8731/health
# {"ok":true,"models":[...PP-OCRv5_mobile_det/rec, licence apache-2.0, loaded:true],"device":"cpu",...}

curl -s -X POST http://127.0.0.1:8731/read \
  -F "image=@apps/server/bench/receipt.png;type=image/png" \
  -F 'params={"pageNumber":1,"capabilities":["detect","recognise"]}'
# 200 OK, 1 block, 24 lines, 1 unreadable region (empty_recognition, a stray
# detected mark near a fold), total 5.87s (mobile tier, cold-ish first call)
```

- `apps/server/bench/receipt.png` (clean): read correctly end-to-end,
  including `TOTAL` / `$266.91` / `GST INCLUDED` / ABN line, one
  `unreadable` abstention.
- `apps/server/bench/receipt-hard.png` (dim/creased/glare): **also read
  correctly, 0 abstentions, lowest line confidence 0.843** (the masked card
  number). Reported honestly rather than tuned to produce a failure — this
  particular "hard" fixture didn't defeat PP-OCRv5-mobile's recognition; that
  is useful evidence for lane G's harness, not a result to explain away.
- Region-crop path (`region: {x:730,y:990,width:180,height:60}`): re-read
  just the total, 113.8ms, and the returned span box
  (`x:761,y:1004,width:96,height:24`) matches the full-page read of the same
  text (`x:763,y:1003,width:96,height:26`) to within ~2px of detector
  quantisation — this is the coordinate-fidelity check for rule 1.
- Error paths: malformed `params` JSON → 400 with the JSON error; missing
  `image` part → 422 from FastAPI's own validation. Neither path reaches the
  OCR engine.
- Not verified: GPU device path (no GPU on this machine); `server` model
  tier against the full `apps/server/bench/corpus/`; the multi-page PDF
  fixtures (`invoice-multipage.pdf`) — this service takes images, not PDFs,
  by design (PDF demux is tier 0, already done in `apps/server/src/extraction/pdf.ts`,
  not this lane's job).

## Setup

```
cd services/docai-engine
"C:\Program Files\Python313\python.exe" -m venv .venv313
.venv313\Scripts\python.exe -m pip install -r requirements.txt
.venv313\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8731
```

First `/read` (or the lifespan startup) downloads PP-OCRv5 weights to
`~/.paddlex/official_models/` (~10-20MB per model tier) — that download is
the only network access this service makes; after that it is fully
self-hosted, matching lane F's `sidecar.ts` comment that a loopback call to
this process is not egress.

Env vars (all optional, defaults are what's verified above):
`DOCAI_MODEL_TIER` (`mobile`|`server`), `DOCAI_DEVICE` (`cpu`|`gpu`, gpu
untested), `DOCAI_ENABLE_MKLDNN` (`true`|`false`, default `false` — see the
bug above), `DOCAI_MIN_CONFIDENCE` (float, default `0.3`, the abstention
threshold — a heuristic, not a calibrated one).

## Explicitly out of scope for this lane (belongs elsewhere)

- **Layout classification.** No layout model is wired in, so every response
  has exactly one `Block` per page/region with `kind: "unknown"` containing
  all detected lines. `unknown` is the honest answer per docdom.ts's own
  comment on `BlockKind`, not a placeholder to fix later in this lane — a
  real layout stage (tables, figures, form fields) is Phase 2+ per
  `docs/OCR.md` §9, and PP-StructureV3 or similar would be a separate,
  heavier model to evaluate then.
- **Calibration (D20).** Turning `calibrated: false` into `true` requires
  gold-set-derived temperature scaling, which is lane G's `apps/server/bench`
  work, not something this service can do to itself.
- **The adapter** (`packages/docai/src/engines/sidecar.ts`) and **pipeline**
  (`packages/docai/src/pipeline.ts`) — lane F. This service does not know
  they exist beyond matching the wire shape they'll parse.
- **Fine-tuning weights** — explicitly D30/out of scope for Phase 1 per the
  contract's header ("We are not training weights").
