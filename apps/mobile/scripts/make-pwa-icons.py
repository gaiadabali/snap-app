"""Regenerates public/pwa/*.png from the app's own icon assets (needs Pillow).

    python scripts/make-pwa-icons.py

  icon-192 / icon-512   purpose "any"      icon.png, full bleed
  apple-touch-icon-180  iOS home screen    icon.png, full bleed, opaque (iOS rounds it)
  icon-maskable-512     purpose "maskable" Android adaptive glyph on the adaptive background
                                           colour. The glyph (the shutter ring) is 56% of the
                                           canvas, inside the 80% maskable safe zone, so a circle or
                                           squircle mask does not clip it
"""
from pathlib import Path
from PIL import Image

assets = Path(__file__).resolve().parent.parent / 'assets'
out = Path(__file__).resolve().parent.parent / 'public' / 'pwa'
out.mkdir(parents=True, exist_ok=True)

icon = Image.open(assets / 'icon.png').convert('RGB')
for name, size in (('icon-192', 192), ('icon-512', 512), ('apple-touch-icon-180', 180)):
    icon.resize((size, size), Image.LANCZOS).save(out / f'{name}.png', optimize=True)

BG = (0xEA, 0x54, 0x2D)  # Shutter Orange, app.json android.adaptiveIcon.backgroundColor
glyph = Image.open(assets / 'adaptive-icon.png').convert('RGBA')
canvas = Image.new('RGB', (1024, 1024), BG)
# The adaptive foreground is already drawn inside the safe zone: paste it 1:1.
canvas.paste(glyph, (0, 0), glyph)
canvas.resize((512, 512), Image.LANCZOS).save(out / 'icon-maskable-512.png', optimize=True)
