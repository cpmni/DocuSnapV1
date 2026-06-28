#!/usr/bin/env python3
"""Crop + annotate the raw Scan Finder screenshots in this folder into the User Guide
images under src/windows/help/img/.

Run from anywhere:  py -3.12 assets/Screenshots/make_help_images.py

Badges are FRACTIONS of the final (cropped+scaled) image so they don't depend on exact
pixel maths. `redact` masks privacy-sensitive text (e.g. a real Windows username in a
preview path) before cropping, so the shipped images never expose it.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = HERE
OUT  = os.path.normpath(os.path.join(HERE, "..", "..", "src", "windows", "help", "img"))
os.makedirs(OUT, exist_ok=True)

ACCENT = (31, 111, 235)
RING   = (255, 255, 255)
PAPER  = (245, 242, 236)   # warm-paper panel bg (for redaction fill)
INK    = (31, 157, 99)     # path text colour (for redaction relabel)

def font(sz, bold=True):
    try:
        return ImageFont.truetype(rf"C:\Windows\Fonts\{'arialbd' if bold else 'arial'}.ttf", sz)
    except Exception:
        return ImageFont.load_default()

def font_mono(sz):
    for n in ("consola.ttf", "cour.ttf"):
        try:
            return ImageFont.truetype(rf"C:\Windows\Fonts\{n}", sz)
        except Exception:
            pass
    return ImageFont.load_default()

def make(src, out, crop, max_w=1100, badges=None, redact=None):
    im = Image.open(os.path.join(SRC, src)).convert("RGB")
    if redact:
        d = ImageDraw.Draw(im); mf = font_mono(15)
        for box, text in redact:
            d.rectangle(box, fill=PAPER)
            d.text((box[0] + 1, box[1] - 1), text, font=mf, fill=INK)
    im = im.crop(crop)
    w, h = im.size
    if w > max_w:
        im = im.resize((max_w, int(h * max_w / w)), Image.LANCZOS); w, h = im.size
    if badges:
        d = ImageDraw.Draw(im); r = 17; f = font(21)
        for n, fx, fy in badges:
            cx, cy = int(fx * w), int(fy * h)
            d.ellipse([cx-r-3, cy-r-3, cx+r+3, cy+r+3], fill=RING)
            d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=ACCENT)
            tb = d.textbbox((0, 0), str(n), font=f)
            d.text((cx-(tb[2]-tb[0])/2, cy-(tb[3]-tb[1])/2 - tb[1]), str(n), font=f, fill=RING)
    im.save(os.path.join(OUT, out))
    print(f"  {out}  {im.size}")

make("general_bottom.png", "settings-general-folders.png",    (240, 60, 1360, 345))
make("general_top.png",    "settings-general-processing.png", (240, 45, 1360, 478))
make("general_top.png",    "settings-appearance.png",         (240, 512, 1360, 682))
make("document_type.png",  "document-types.png", (240, 55, 1360, 535),
     badges=[(1, 0.054, 0.338), (2, 0.411, 0.336), (3, 0.411, 0.833), (4, 0.188, 0.850)])
make("output_structure.png", "output-structure.png", (240, 55, 1360, 590),
     redact=[((353, 520, 390, 538), "user")],
     badges=[(1, 0.438, 0.183), (2, 0.232, 0.262), (3, 0.438, 0.535), (4, 0.491, 0.884)])
make("template_manager_acme_invoice.png", "template-manager-overview.png", (235, 190, 1900, 925),
     badges=[(1, 0.033, 0.065), (2, 0.393, 0.422), (3, 0.613, 0.190), (4, 0.622, 0.639)])
make("template_manager_anchor_drawn.png", "template-anchor.png", (235, 305, 1900, 1032),
     badges=[(1, 0.661, 0.388), (2, 0.430, 0.500), (3, 0.527, 0.500), (4, 0.880, 0.548)])
make("template_manager_how_is_filed.png",      "template-fill-mode.png",  (1210, 495, 1675, 605))
make("template_manager_manual_landmarks.png",  "template-landmarks.png",  (575, 355, 1215, 565))
make("templates_new_template.png",             "template-create.png",     (235, 190, 705, 520))
print("done")
