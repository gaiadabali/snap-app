import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
out=sys.argv[1]
W,H=900,1250
img=Image.new('RGB',(W,H),(252,251,248))
d=ImageDraw.Draw(img)
M='/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'; MB='/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
f=ImageFont.truetype(M,34); fb=ImageFont.truetype(MB,40); fh=ImageFont.truetype(MB,52)
y=70
def c(t,font,fill=(30,30,30)):
    global y
    w=d.textlength(t,font=font); d.text(((W-w)/2,y),t,font=font,fill=fill); y+=font.size+14
def row(l,r,font=f):
    global y
    d.text((70,y),l,font=font,fill=(30,30,30)); w=d.textlength(r,font=font); d.text((W-70-w,y),r,font=font,fill=(30,30,30)); y+=font.size+16
def line():
    global y
    d.line((70,y+8,W-70,y+8),fill=(120,120,120),width=2); y+=30
c('HARBOUR ST COFFEE',fh); c('Demo Cafe Pty Ltd',f); c('12 Wharf Rd, Newcastle NSW 2300',f); c('ABN 12 345 678 901',f); y+=10
c('TAX INVOICE',fb); line()
row('Date: 05/11/2026','10:42'); row('Receipt #: 004213',''); line()
row('Flat white x2','$9.60'); row('Ham & cheese toastie','$12.50'); row('Banana bread','$5.50'); row('Sparkling water','$4.20'); line()
row('Total (incl. GST)','$31.80',fb); y+=6
row('GST included','$2.89'); line()
row('EFTPOS Visa ****0000','$31.80'); y+=20
c('Thank you, see you soon!',f)
img=img.rotate(0.6,resample=Image.BICUBIC,fillcolor=(120,120,118),expand=False)
img.save(out,quality=92)
