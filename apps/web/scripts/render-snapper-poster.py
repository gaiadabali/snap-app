"""
Renders Snapper, the assistant's mascot, to the stills the widget shows before
the live canvas is ready and wherever WebGL is off (docs/ASSISTANT.md §10-11):

  public/assistant/snapper-poster.webp      320 x 320  idle, looking at the viewer
  public/assistant/snapper-poster-160.webp  160 x 160  the same
  public/assistant/snapper-happy.webp       320 x 320  happy (^ ^, arms up, sparkles)

    python apps/web/scripts/render-snapper-poster.py [--base http://127.0.0.1:3417] [--out DIR] [--png]

Needs the web app running in development (the /mascot-lab route 404s in
production) and Playwright for Python with Chromium (`python -m playwright
install chromium`) and Pillow.

Each still is drawn by the same stage code as the live canvas
(components/assistant/mascot/runtime.ts), through /mascot-lab?poster=...:
same camera, same pose at t = 0, so the idle poster IS the live canvas's first
frame. It renders at 2x device pixels with a transparent background, waits
for body[data-ready="1"], screenshots the canvas, and downsamples with Lanczos.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent  # apps/web

SHOTS = [
    # (mood, render css px, output name, output px)
    ("idle", 320, "snapper-poster", 320),
    ("idle", 160, "snapper-poster-160", 160),
    ("happy", 320, "snapper-happy", 320),
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://127.0.0.1:3417", help="where the web app is running")
    ap.add_argument("--out", default=str(ROOT / "public" / "assistant"), help="output directory")
    ap.add_argument("--png", action="store_true", help="also keep the full-size PNGs")
    ap.add_argument("--timeout", type=int, default=60_000, help="ms to wait for each render (first compile is slow)")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = args.base.rstrip("/")

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
        try:
            for mood, css, name, px in SHOTS:
                # Plenty of room around the canvas so nothing overlays it.
                page = browser.new_page(viewport={"width": css + 400, "height": css + 400}, device_scale_factor=2)
                page.on("pageerror", lambda e: print(f"[pageerror] {e}", file=sys.stderr))
                page.goto(f"{base}/mascot-lab?poster={mood}&size={css}", wait_until="load")
                page.wait_for_function(
                    "document.body.dataset.ready === '1' || document.body.dataset.ready === 'error'",
                    timeout=args.timeout,
                )
                state = page.evaluate("document.body.dataset.ready")
                if state != "1":
                    err = page.evaluate("document.body.dataset.error || ''")
                    print(f"{name}: the stage failed to render: {err}", file=sys.stderr)
                    return 1
                layout = json.loads(page.evaluate("document.body.dataset.layout || '{}'"))
                png = page.locator("canvas[data-poster]").screenshot(omit_background=True)
                page.close()

                img = Image.open(io.BytesIO(png)).convert("RGBA")
                if args.png:
                    img.save(out_dir / f"{name}.png")
                if img.size != (px, px):
                    img = img.resize((px, px), Image.Resampling.LANCZOS)
                img.save(out_dir / f"{name}.webp", "WEBP", quality=88, alpha_quality=95, method=6)
                print(f"{name}.webp {px}px {mood} {json.dumps(layout)}")
        finally:
            browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
