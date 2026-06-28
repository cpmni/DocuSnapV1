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

# ── Main window (the home dashboard) ─────────────────────────────────────────
make("main.png", "home-dashboard.png", (0, 28, 1920, 1010), badges=[
    (1, 0.045, 0.10),    # nav rail
    (2, 0.520, 0.145),   # trial bar
    (3, 0.295, 0.235),   # needs your attention
    (4, 0.460, 0.235),   # documents filed
    (5, 0.300, 0.655),   # recent activity
])

# ── Import view ──────────────────────────────────────────────────────────────
make("main_doc_import.png", "import-view.png", (0, 28, 1920, 1010), badges=[
    (1, 0.210, 0.114),   # source folder
    (2, 0.810, 0.124),   # Process Documents
    (3, 0.915, 0.094),   # session stats
    (4, 0.365, 0.323),   # results table
    (5, 0.585, 0.241),   # "Review your documents"
])

# ── Teach: draw a box + live read-back (fills the existing teach figure) ──────
make("teach_4_confirm_box.png", "teach-draw-box.png", (0, 28, 1186, 1010), badges=[
    (1, 0.200, 0.061),   # instruction banner
    (2, 0.650, 0.407),   # the box drawn on the value
    (3, 0.135, 0.785),   # live read-back (Yes / Redraw)
    (4, 0.877, 0.175),   # field checklist
])

# ── Teach: review what was read (clean lower window of the double capture) ────
make("teach_5.png", "teach-review.png", (120, 290, 1066, 600))

# ── Review window (queue · preview · fields) ─────────────────────────────────
make("review.png", "review-window-annotated.png", (0, 28, 1920, 1010), badges=[
    (1, 0.050, 0.062),   # the queue (Review / Deferred + doc list)
    (2, 0.470, 0.380),   # the document preview
    (3, 0.860, 0.262),   # the extracted fields to check
])

# ── Themes showcase — Warm Paper + Dark home, side by side ───────────────────
def compose_themes():
    box = (0, 28, 1920, 1010); tw = 540
    def prep(src):
        im = Image.open(os.path.join(SRC, src)).convert("RGB").crop(box)
        return im.resize((tw, int(im.height * tw / im.width)), Image.LANCZOS)
    warm, dark = prep("main_theme_warm_paper.png"), prep("main_theme_dark_mode.png")
    gap = 16; h = max(warm.height, dark.height)
    canvas = Image.new("RGB", (tw * 2 + gap, h), (255, 255, 255))
    canvas.paste(warm, (0, 0)); canvas.paste(dark, (tw + gap, 0))
    canvas.save(os.path.join(OUT, "home-themes.png"))
    print(f"  home-themes.png  {canvas.size}")
compose_themes()

print("done")
