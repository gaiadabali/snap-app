"""Make the test realistic: a thermal docket photographed badly.

Dim cab light, motion blur, a crease, glare across the total, and faded
thermal print. This is what actually arrives from a truck stop at 2am, and it
is the case that decides whether extraction is usable in production.
"""
import os
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
src = Image.open(os.path.join(HERE, 'receipt.png')).convert('RGB')
w, h = src.size

# 1. Faded thermal print: crush contrast and warm it.
img = ImageEnhance.Contrast(src).enhance(0.62)
img = ImageEnhance.Brightness(img).enhance(0.72)
r, g, b = img.split()
img = Image.merge('RGB', (r, g, b.point(lambda v: int(v * 0.9))))

# 2. Motion blur from a handheld shot in low light.
img = img.filter(ImageFilter.GaussianBlur(1.5))

# 3. Glare band across the middle — where the total sits.
glare = Image.new('L', (w, h), 0)
gd = ImageDraw.Draw(glare)
for i in range(70):
    gd.line([(0, int(h * 0.46) + i), (w, int(h * 0.52) + i)], fill=int(90 - i))
img = Image.composite(Image.new('RGB', (w, h), (255, 252, 240)), img, glare.filter(ImageFilter.GaussianBlur(28)))

# 4. A crease: a darker seam down the paper.
seam = Image.new('L', (w, h), 0)
sd = ImageDraw.Draw(seam)
sd.line([(int(w * 0.42), 0), (int(w * 0.50), h)], fill=120, width=9)
img = Image.composite(Image.new('RGB', (w, h), (120, 116, 108)), img, seam.filter(ImageFilter.GaussianBlur(6)))

# 5. Sensor noise from a high ISO.
import random
random.seed(7)
px = img.load()
for _ in range(int(w * h * 0.05)):
    x, y = random.randrange(w), random.randrange(h)
    d = random.randint(-26, 26)
    cr, cg, cb = px[x, y]
    px[x, y] = (max(0, min(255, cr + d)), max(0, min(255, cg + d)), max(0, min(255, cb + d)))

# 6. Smaller, as a phone photo downscaled for upload.
img = img.resize((int(w * 0.62), int(h * 0.62)), Image.LANCZOS)
img.save(os.path.join(HERE, 'receipt-hard.png'))
prev = img.copy()
prev.thumbnail((430, 700))
prev.save(os.path.join(HERE, 'receipt-hard-s.png'))
print('wrote receipt-hard.png', img.size)
