"""Builds the hi-res icon and the feature graphic from the repo's own icon source.

Run from anywhere: python3 docs/play-store/tools/make_static.py <path to Geist fonts dir>
The fonts are @expo-google-fonts/geist (the app's own typeface), e.g.
node_modules/.pnpm/@expo-google-fonts+geist@0.4.2/node_modules/@expo-google-fonts/geist
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parents[1]
fonts = Path(sys.argv[1])
icon_src = Image.open(root / "apps/mobile/assets/icon.png").convert("RGB")

# 1. Hi-res icon: 512x512, 32-bit PNG. Square and full bleed: Play applies its own rounded mask.
icon = icon_src.resize((512, 512), Image.LANCZOS).convert("RGBA")
icon.save(out / "icon-512.png", optimize=True)

# 2. Feature graphic: 1024x500, 24-bit PNG (no alpha). Drawn at 2x, then reduced for clean edges.
S = 2
W, H = 1024 * S, 500 * S
bg = Image.new("RGB", (W, H))
px = bg.load()
c0, c1 = (0x18, 0x78, 0xD8), (0x00, 0x50, 0xA8)  # brand blue #1878D8 to a deeper step of it
for y in range(H):
    for x in range(W):
        t = (x / W * 0.65 + y / H * 0.35)
        px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(c0, c1))
# App icon tile at left, rounded like the launcher shows it.
tile = icon_src.resize((176 * S, 176 * S), Image.LANCZOS).convert("RGBA")
mask = Image.new("L", tile.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, *tile.size), 40 * S, fill=255)
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((80 * S, 170 * S, 256 * S, 346 * S), 40 * S, fill=(0, 20, 60, 90))
from PIL import ImageFilter
bg.paste(Image.alpha_composite(bg.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(14 * S))).convert("RGB"))
bg.paste(tile.convert("RGB"), (80 * S, 156 * S), mask)

bold = ImageFont.truetype(str(fonts / "700Bold/Geist_700Bold.ttf"), 62 * S)
semi = ImageFont.truetype(str(fonts / "600SemiBold/Geist_600SemiBold.ttf"), 26 * S)
reg = ImageFont.truetype(str(fonts / "400Regular/Geist_400Regular.ttf"), 27 * S)
d = ImageDraw.Draw(bg)
x = 300 * S
d.text((x, 150 * S), "Snap Apps", font=semi, fill=(214, 232, 252))
d.text((x, 186 * S), "Receipts into records", font=bold, fill=(255, 255, 255))
d.text((x, 268 * S), "Photograph a receipt, check what was read.", font=reg, fill=(226, 238, 252))
bg.resize((1024, 500), Image.LANCZOS).save(out / "feature-graphic-1024x500.png", optimize=True)
