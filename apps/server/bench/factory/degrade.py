"""Seeded photographic degradation — `hard.py` generalised from one script to a pipeline.

`docs/CORPUS.md` §5.1. `hard.py` applies one fixed degradation to one fixed
image: dim cab light, motion blur, a glare band, a crease, sensor noise,
downscale. It is good, and it is a single point in a space we need to sample.

**Read §2 before trusting anything scored through this module.** Degrading a
clean render produces *a photograph of perfect printing*, which is not the same
object as a photograph of real thermal print. Thermal heads produce broken
strokes, mid-glyph dropout and uneven density down the roll; faded thermal loses
the THIN strokes first, which is why a real `8` degrades into a `6`. No filter
here reproduces that, and `thermal_fade` below is an approximation that erodes
thin strokes deliberately — closer than a Gaussian blur, still not the real
failure mode.

So: these levels stress a reader usefully and produce faithful RELATIVE
difficulty. They do not produce a recall figure anyone may quote. That is what
tier R is for, and `provenance.py` enforces it.
"""
from __future__ import annotations

import random

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

# Ordered by how much they hurt. `clean` is the optimistic upper bound;
# `severe` is the 2am truck stop.
LEVELS = ('clean', 'light', 'moderate', 'severe')


def _thermal_fade(img: Image.Image, strength: float) -> Image.Image:
    """Crush contrast, warm it, and erode the THIN strokes specifically.

    The erosion is the part that matters, and it has to be selective. Real
    thermal fade loses the faint parts of a glyph first, leaving the stroke
    cores — which is why a faded `8` reads as `6`. A uniform dim takes every
    stroke down equally and does not reproduce that.

    So the curve below lifts MID-tones toward paper while leaving pixels darker
    than `floor` alone. Antialiased stroke edges are mid-grey; stroke cores are
    not. That erodes edges without deleting glyphs.

    TUNED BY LOOKING AT THE OUTPUT. The first version used `MaxFilter(3)`,
    which on a 2x-scaled 12px docket is a 3-pixel dilation of white and simply
    destroyed the text — at `severe` only the supplier name, "TAX INVOICE" and
    the total survived, with six line items and the ABN gone. That is not a
    hard document, it is an unreadable one, and a manifest asserting values the
    image does not legibly contain is the §5.2 mistake in reverse: a ground
    truth making a claim about what an engine can do. Degradation must stay on
    the readable side of illegible.
    """
    img = ImageEnhance.Contrast(img).enhance(1 - 0.26 * strength)
    img = ImageEnhance.Brightness(img).enhance(1 - 0.14 * strength)
    r, g, b = img.split()
    img = Image.merge('RGB', (r, g, b.point(lambda v: int(v * (1 - 0.035 * strength)))))

    if strength > 0.3:
        floor = 105         # at or below this is stroke core or surface — left alone
        lift = 0.48 * strength

        def curve(v: int) -> int:
            if v <= floor:
                return v
            return int(min(255, v + (255 - v) * lift))

        img = Image.merge('RGB', tuple(ch.point(curve) for ch in img.split()))
    return img


def _glare(img: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    """A specular band. Placed over the LOWER half by preference, because that
    is where totals sit and a glare band that never touches the total is not
    testing anything."""
    w, h = img.size
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    top = int(h * rng.uniform(0.40, 0.72))
    band = int(h * rng.uniform(0.06, 0.13))
    peak = int(72 * strength)
    for i in range(band):
        d.line([(0, top + i), (w, top + int(band * 0.35) + i)], fill=max(0, peak - i))
    return Image.composite(Image.new('RGB', (w, h), (250, 249, 245)), img,
                           mask.filter(ImageFilter.GaussianBlur(int(22 * strength) + 6)))


def _crease(img: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    w, h = img.size
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    x0 = int(w * rng.uniform(0.25, 0.75))
    x1 = x0 + int(w * rng.uniform(-0.12, 0.12))
    d.line([(x0, 0), (x1, h)], fill=int(95 * strength), width=int(7 * strength) + 3)
    return Image.composite(Image.new('RGB', (w, h), (120, 116, 108)), img,
                           mask.filter(ImageFilter.GaussianBlur(6)))


def _noise(img: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    w, h = img.size
    px = img.load()
    for _ in range(int(w * h * 0.05 * strength)):
        x, y = rng.randrange(w), rng.randrange(h)
        delta = rng.randint(-26, 26)
        cr, cg, cb = px[x, y]
        px[x, y] = (
            max(0, min(255, cr + delta)),
            max(0, min(255, cg + delta)),
            max(0, min(255, cb + delta)),
        )
    return img


def apply(img: Image.Image, level: str, rng: random.Random) -> Image.Image:
    """Degrade `img` to `level`. Deterministic for a given rng state."""
    if level not in LEVELS:
        raise ValueError(f'unknown degradation level {level!r}; expected one of {LEVELS}')
    img = img.convert('RGB')
    if level == 'clean':
        return img

    strength = {'light': 0.28, 'moderate': 0.55, 'severe': 0.85}[level]

    img = _thermal_fade(img, strength)
    img = img.filter(ImageFilter.GaussianBlur(0.3 + 0.75 * strength))
    if strength >= 0.6 or rng.random() < 0.5:
        img = _glare(img, rng, strength)
    if strength >= 0.6 or rng.random() < 0.4:
        img = _crease(img, rng, strength)
    img = _noise(img, rng, strength)

    # Downscale last: a phone photo uploaded after compression. Applied after
    # the artefacts so they are resampled WITH the text, as they would be.
    factor = 1 - 0.26 * strength
    img = img.resize((max(1, int(img.width * factor)), max(1, int(img.height * factor))),
                     Image.LANCZOS)
    return img
