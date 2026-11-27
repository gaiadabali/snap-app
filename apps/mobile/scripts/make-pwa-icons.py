"""Regenerates public/pwa/*.png from the app's own icon assets (needs Pillow).

    python scripts/make-pwa-icons.py

  icon-192 / icon-512   purpose "any"      icon.png, full bleed
  apple-touch-icon-180  iOS home screen    icon.png, full bleed, opaque (iOS rounds it)
  icon-maskable-512     purpose "maskable" Android adaptive glyph on the adaptive background
                                           colour, inside the 80% safe zone, so a circle or
                                           squircle mask does not clip the brackets
"""
from pathlib import Path
from PIL import Image

assets = Path(__file__).resolve().parent.parent / 'assets'
out = Path(__file__).resolve().parent.parent / 'public' / 'pwa'
out.mkdir(parents=True, exist_ok=True)

icon = Image.open(assets / 'icon.png').convert('RGB')
for name, size in (('icon-192', 192), ('icon-512', 512), ('apple-touch-icon-180', 180)):
    icon.resize((size, size), Image.LANCZOS).save(out / f'{name}.png', optimize=True)

BG = (0x18, 0x78, 0xD8)  # app.json android.adaptiveIcon.backgroundColor
glyph = Image.open(assets / 'adaptive-icon.png').convert('RGBA')
canvas = Image.new('RGB', (1024, 1024), BG)
inner = round(1024 * 0.78)
g = glyph.resize((inner, inner), Image.LANCZOS)
canvas.paste(g, ((1024 - inner) // 2, (1024 - inner) // 2), g)
canvas.resize((512, 512), Image.LANCZOS).save(out / 'icon-maskable-512.png', optimize=True)
