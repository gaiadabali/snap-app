"""LlamaParse adapter (docs/OCR.md §2, contract §6).

LlamaParse is a hosted API (LlamaCloud), not a local dependency, so it needs
BOTH the `llama-cloud-services` (or legacy `llama-parse`) package AND a
`LLAMA_CLOUD_API_KEY`. Neither is present in this environment: the package is
not installed and no key is set. available() reports both checks
independently so the "not run" reason is specific. run() is written against
the documented parse API for whoever adds the dependency and key, but it has
never executed here. Per contract §6: "invent nothing."
"""
import importlib.util
import os
import time

from . import EngineResult


class LlamaParseEngine:
    name = 'llamaparse'

    def available(self):
        has_pkg = (importlib.util.find_spec('llama_cloud_services') is not None
                   or importlib.util.find_spec('llama_parse') is not None)
        has_key = bool(os.environ.get('LLAMA_CLOUD_API_KEY'))
        if not has_pkg and not has_key:
            return False, 'llama-cloud-services not installed AND LLAMA_CLOUD_API_KEY not set'
        if not has_pkg:
            return False, 'llama-cloud-services not installed (pip install llama-cloud-services)'
        if not has_key:
            return False, 'LLAMA_CLOUD_API_KEY not set'
        return True, ''

    def run(self, page_paths: list[str], prompt: str, timeout: int = 240) -> EngineResult:
        # NOTE: not exercised in this environment — no key, no package.
        from llama_cloud_services import LlamaParse  # type: ignore

        t0 = time.time()
        parser = LlamaParse(api_key=os.environ['LLAMA_CLOUD_API_KEY'], result_type='markdown')
        texts = []
        for p in page_paths:
            docs = parser.load_data(p)
            texts.extend(d.text for d in docs)
        secs = time.time() - t0
        return EngineResult(text='\n\n'.join(texts)[:2000], parsed=None, seconds=secs,
                             extra={'note': 'LlamaParse markdown output not yet mapped to extraction schema'})
