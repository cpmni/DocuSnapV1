#!/usr/bin/env python3
"""
tests/test_strip_rules.py — guards _strip_horizontal_rules in ocr/region.py
(this is the guard the function's docstring has always named; it now exists).

The function removes a near-full-width SOLID horizontal rule (an underline that
fuses with glyph baselines at the 108-DPI teach preview and garbles OCR). It is
GATED: when no such rule exists the image comes back byte-identical.

PINNED LIMITATION (deliberate, 2026-07-10): a DASHED underline is NOT stripped —
each dash is a short run the length-based opening ignores. Bridging dash gaps
(binary_closing before the opening) risks classifying a TEXT row as a "rule"
and erasing real glyphs, so the dashed case is owned by the OTHER two layers:
the taller caption band (the caption reads cleanly with dashes present — proven
on MP_wor_47.pdf) and the region.py sliver gate (test_region_sliver.py). If you
extend the stripper to dashed rules, you are changing that contract knowingly —
update this pin and re-prove the text-row safety.

Hermetic — function-level only, no Tesseract needed.

Usage:  py -3.12 python_backend/tests/test_strip_rules.py
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "ocr"))
import region  # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def _font(size):
    for name in ("arial.ttf", "DejaVuSans.ttf", "calibri.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def text_img(W=200, H=30, underline=None):
    """A caption crop; underline='solid' fuses a full-width rule to the baseline,
    'dashed' draws the dash pattern from the Meridian worksheet."""
    img = Image.new("L", (W, H), 255)
    d = ImageDraw.Draw(img)
    d.text((2, 4), "Site / Customer", font=_font(15), fill=0)
    if underline == "solid":
        d.rectangle([2, 22, W - 4, 23], fill=0)          # spans ~97% of the width
    elif underline == "dashed":
        for x in range(2, W - 10, 30):
            d.rectangle([x, 22, x + 20, 23], fill=0)     # 20px dashes, 10px gaps
    return img


solid = text_img(underline="solid")
out = region._strip_horizontal_rules(solid)
a_in, a_out = np.asarray(solid), np.asarray(out.convert("L"))
check("solid rule: image was altered", not np.array_equal(a_in, a_out))
# the rule rows are painted to background away from the glyphs (right edge is rule-only)
check("solid rule: rule pixels painted white", int(a_out[22, 150:196].min()) >= 250)
# the glyph ink above the rule survives
check("solid rule: text ink preserved", int((a_out[:20] < 100).sum()) >= int(0.9 * (a_in[:20] < 100).sum()))

plain = text_img(underline=None)
check("no rule: byte-identical (the gate)",
      np.array_equal(np.asarray(plain), np.asarray(region._strip_horizontal_rules(plain).convert("L"))))

dashed = text_img(underline="dashed")
check("dashed rule: UNCHANGED — pinned limitation (see docstring)",
      np.array_equal(np.asarray(dashed), np.asarray(region._strip_horizontal_rules(dashed).convert("L"))))


def bordered_img():
    """The test_region_light_first regression shape: textured background, text, a dotted
    leader, and a tight BOX BORDER. Stripping the border's horizontal edges flipped a clean
    'Serial number' read to EMPTY (2026-07-10) — edge-hugging lines are borders, not fused
    underlines, and must be left alone."""
    rng = np.random.default_rng(7)
    img = Image.fromarray(rng.integers(232, 250, size=(80, 336), dtype=np.uint8), mode="L")
    d = ImageDraw.Draw(img)
    d.text((12, 16), "Serial number", fill=25, font=_font(28))
    for x in range(12, 320, 8):
        d.rectangle([x, 66, x + 1, 67], fill=30)
    d.rectangle((2, 2, 333, 77), outline=60, width=2)
    return img


b = bordered_img()
check("box border at crop edges: UNCHANGED (borders are not underlines)",
      np.array_equal(np.asarray(b), np.asarray(region._strip_horizontal_rules(b).convert("L"))))
# a mid-crop fused rule in the SAME bordered crop must still be stripped
bm = bordered_img()
ImageDraw.Draw(bm).rectangle([10, 47, 325, 48], fill=0)     # solid rule hugging the baseline
out_bm = np.asarray(region._strip_horizontal_rules(bm).convert("L"))
check("mid-crop rule inside a bordered crop: still stripped",
      int(out_bm[47, 200:320].min()) >= 250)
check("mid-crop strip leaves the border alone",
      np.array_equal(np.asarray(bm)[:6], out_bm[:6]) and np.array_equal(np.asarray(bm)[-6:], out_bm[-6:]))

print()
print(f"{fails} FAILED" if fails else "All strip-rules checks passed")
sys.exit(1 if fails else 0)
