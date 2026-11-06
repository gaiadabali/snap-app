"""Checks every Play graphic against Play's published limits and flattens screenshots to 24-bit PNG.
Run: python3 docs/play-store/tools/verify.py   (exit code 1 on any failure)
"""
import sys
from pathlib import Path
from PIL import Image

base = Path(__file__).resolve().parents[1]
bad = 0

def report(name, ok, msg):
    global bad
    print(("OK   " if ok else "FAIL ") + name + "  " + msg)
    bad += 0 if ok else 1

# Screenshots: Play wants JPEG or 24-bit PNG, each side 320..3840, long side at most 2x the short side, 8 MB max.
for f in sorted((base / "phone").glob("*.png")):
    im = Image.open(f)
    if im.mode != "RGB":
        im.convert("RGB").save(f, optimize=True)
        im = Image.open(f)
    w, h = im.size
    kb = f.stat().st_size / 1024
    report(f"phone/{f.name}", im.mode == "RGB" and 320 <= min(w, h) and max(w, h) <= 3840 and max(w, h) <= 2 * min(w, h) and kb < 8192 and (w, h) == (1080, 1920), f"{w}x{h} {im.mode} {kb:.0f} KB")

f = base / "icon-512.png"; im = Image.open(f)
report("icon-512.png", im.size == (512, 512) and im.mode == "RGBA" and f.stat().st_size <= 1024 * 1024, f"{im.size[0]}x{im.size[1]} {im.mode} {f.stat().st_size/1024:.0f} KB")
f = base / "feature-graphic-1024x500.png"; im = Image.open(f)
report("feature-graphic-1024x500.png", im.size == (1024, 500) and im.mode == "RGB" and f.stat().st_size <= 15 * 1024 * 1024, f"{im.size[0]}x{im.size[1]} {im.mode} {f.stat().st_size/1024:.0f} KB")
sys.exit(1 if bad else 0)
