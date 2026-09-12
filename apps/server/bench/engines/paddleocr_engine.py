"""PaddleOCR PP-StructureV3 adapter (docs/OCR.md §2, contract §6).

This environment does not have `paddleocr`/`paddlepaddle` installed (checked
via `pip show paddleocr` — not found). available() reports that plainly;
run() is written against the documented PP-StructureV3 pipeline API so the
adapter is ready the moment the dependency is installed, but nothing here has
been exercised end-to-end, and this file must not be read as evidence that it
has. Per contract §6: "invent nothing."
"""
import importlib.util
import time

from . import EngineResult


class PaddleOCREngine:
    name = 'paddleocr-pp-structurev3'

    def available(self):
        if importlib.util.find_spec('paddleocr') is None:
            return False, 'paddleocr not installed (pip install paddleocr paddlepaddle)'
        return True, ''

    def run(self, page_paths: list[str], prompt: str, timeout: int = 240) -> EngineResult:
        # NOTE: not exercised in this environment. Written against
        # PaddleOCR's documented PPStructureV3 pipeline() call for whoever
        # installs the dependency next; treat as unverified until it has
        # actually produced output once.
        from paddleocr import PPStructureV3  # type: ignore

        t0 = time.time()
        pipeline = PPStructureV3()
        outputs = []
        for p in page_paths:
            for res in pipeline.predict(input=p):
                outputs.append(res)
        secs = time.time() - t0
        # PP-StructureV3 returns layout/markdown/JSON per page, not the
        # extraction-schema JSON this harness scores against. A real
        # integration needs a mapping step from its structured output to the
        # {supplier_name, ...} schema; that mapping does not exist yet, so
        # `parsed` is intentionally None rather than a fabricated mapping.
        return EngineResult(text=str(outputs)[:2000], parsed=None, seconds=secs,
                             extra={'note': 'PP-StructureV3 output not yet mapped to extraction schema'})
