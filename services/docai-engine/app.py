"""
docai-engine — the Python OCR sidecar (contract: docs/contracts/phase1-ocr-stage.md §4).

TypeScript keeps DocDOM, grounding, validators and the pipeline (`packages/docai`);
this process holds only the PP-OCRv5 model adapter behind a small HTTP seam
(`packages/docai/src/engines/sidecar.ts` is the caller, lane F's — do not edit
it from here). The two endpoints below are the entire contract surface:

  POST /read    multipart(image, params) -> DocDOM-shaped blocks/unreadable
  GET  /health  -> which models are loaded, on what device, under what licence

Run it: see README.md for the venv + `uvicorn app:app` invocation.
"""

from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from ocr_engine import (
    DET_MODEL_NAME,
    DEVICE,
    ENABLE_MKLDNN,
    ENGINE_ID,
    MODEL_TIER,
    REC_MODEL_NAME,
    WEIGHTS_LICENCE,
    OcrEngine,
)

_engine: Optional[OcrEngine] = None
_load_error: Optional[str] = None
_load_ms: Optional[float] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _engine, _load_error, _load_ms
    t0 = time.perf_counter()
    try:
        _engine = OcrEngine()
    except Exception as exc:  # noqa: BLE001 - reported via /health, not swallowed
        _load_error = f"{type(exc).__name__}: {exc}"
    _load_ms = round((time.perf_counter() - t0) * 1000, 2)
    yield


app = FastAPI(title="docai-engine", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    loaded = _engine is not None
    return {
        "ok": loaded,
        "models": [
            {"id": DET_MODEL_NAME, "licence": WEIGHTS_LICENCE, "loaded": loaded},
            {"id": REC_MODEL_NAME, "licence": WEIGHTS_LICENCE, "loaded": loaded},
        ],
        "device": DEVICE,
        # Additive fields beyond the contract's {ok, models, device} minimum —
        # the adapter (lane F) is free to ignore them, but they're what let a
        # deployer see the mkldnn workaround and the layout gap without
        # reading this service's source.
        "engine": ENGINE_ID,
        "modelTier": MODEL_TIER,
        "capabilities": ["detect", "recognise"],  # "layout" is not implemented — see README
        "mkldnnEnabled": ENABLE_MKLDNN,
        "modelLoadMs": _load_ms,
        "error": _load_error,
    }


@app.post("/read")
async def read(image: UploadFile = File(...), params: str = Form(...)) -> JSONResponse:
    if _engine is None:
        raise HTTPException(status_code=503, detail=f"OCR engine not loaded: {_load_error}")

    try:
        meta = json.loads(params)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"params is not valid JSON: {exc}") from exc

    page_number = meta.get("pageNumber", 1)
    region = meta.get("region")
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="image part was empty")

    try:
        result = _engine.read(image_bytes, page_number=page_number, region=region)
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller, not swallowed
        raise HTTPException(status_code=500, detail=f"OCR read failed: {type(exc).__name__}: {exc}") from exc

    return JSONResponse(result)
