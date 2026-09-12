"""Docling adapter (docs/OCR.md §2, contract §6).

This environment does not have `docling` installed (checked via
`pip show docling` — not found). available() reports that plainly. run() is
written against Docling's documented DocumentConverter API so the adapter is
ready the moment the dependency is installed, but it has not been run here.
Per contract §6: "invent nothing."
"""
import importlib.util
import time

from . import EngineResult


class DoclingEngine:
    name = 'docling'

    def available(self):
        if importlib.util.find_spec('docling') is None:
            return False, 'docling not installed (pip install docling)'
        return True, ''

    def run(self, page_paths: list[str], prompt: str, timeout: int = 240) -> EngineResult:
        # NOTE: not exercised in this environment. Docling converts a
        # document (PDF/image) to a DoclingDocument with layout + text; it
        # does not itself perform schema-guided extraction of the fields
        # this harness scores. A real integration needs a second step
        # (rule-based or LLM-based) from DoclingDocument to the extraction
        # schema. That step does not exist yet, so `parsed` is None, not a
        # guess.
        from docling.document_converter import DocumentConverter  # type: ignore

        t0 = time.time()
        converter = DocumentConverter()
        texts = []
        for p in page_paths:
            result = converter.convert(p)
            texts.append(result.document.export_to_markdown())
        secs = time.time() - t0
        return EngineResult(text='\n\n'.join(texts)[:2000], parsed=None, seconds=secs,
                             extra={'note': 'Docling markdown output not yet mapped to extraction schema'})
