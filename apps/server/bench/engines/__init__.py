"""Pluggable engine adapters for the bench harness (contract §6, point 6).

Every adapter exposes the same shape so compare.py can drive them uniformly:

    class SomeEngine:
        name: str
        def available(self) -> tuple[bool, str]:
            '''(True, "") if this engine can actually run here, else
            (False, reason) — a missing dependency or API key, never a
            probabilistic guess about whether it WOULD work.'''

        def run(self, page_paths: list[str], prompt: str, timeout: int) -> EngineResult:
            '''page_paths is 1..n image file paths, in page order (a PDF is
            pre-rasterised by compare.py before this is called, since not
            every engine speaks PDF bytes). Raises on a hard failure; a
            missing capability must be caught by available() before run() is
            ever called.'''

ABSOLUTE RULE (contract §6, docs/OCR.md §8.1): if available() returns False,
compare.py records "not run" with the reason and never fabricates a score.
Nothing in this package invents a number.
"""
from dataclasses import dataclass


@dataclass
class EngineResult:
    text: str            # raw model/engine output, for debugging
    parsed: dict | None  # parsed JSON matching the extraction schema, or None
    seconds: float
    extra: dict          # engine-specific metadata (tokens, engine version, ...)
