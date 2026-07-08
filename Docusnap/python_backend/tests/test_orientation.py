#!/usr/bin/env python3
"""
tests/test_orientation.py — auto-rotate signs (the part that, if wrong, corrupts documents).

Proves the rotation CONVENTIONS deterministically without needing Tesseract:
  * ocr.orientation.correct_image — PIL (counter-clockwise lib): correct(img, r) == img.rotate(360-r)
    must INVERT a clockwise-r rotation (r ∈ {90,180,270}).
  * pdf_rotate.rotate_pdf — pypdf (clockwise, additive): page i gets /Rotate == r verbatim (no flip).
A Tesseract-gated smoke check confirms detect_rotation returns 0 on a blank/low-text page (safe).

    py -3.12 python_backend/tests/test_orientation.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

FAILS = 0
def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")


def _distinct_image():
    """A clearly non-symmetric RGB image so a wrong rotation is detectable byte-wise."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (120, 80), "white")
    d  = ImageDraw.Draw(im)
    d.rectangle([0, 0, 30, 10], fill="black")      # a mark only in the top-left
    d.rectangle([110, 70, 119, 79], fill="red")    # and one bottom-right
    return im


print("correct_image — inverts a clockwise rotation (PIL sign):")
try:
    from ocr import orientation
    base = _distinct_image()
    check("rotate=0 returns the image unchanged", orientation.correct_image(base, 0) is base)
    for r in (90, 180, 270):
        # Simulate a scan that needs `r`° clockwise to be upright = base.rotate(r) (PIL CCW r ≡
        # the OSD `rotate` framing); correcting it with the SAME r must reproduce `base` exactly.
        scanned   = base.rotate(r, expand=True)
        corrected = orientation.correct_image(scanned, r)
        same = (corrected.size == base.size) and (corrected.tobytes() == base.tobytes())
        check(f"rotate={r}: corrected == original (size {corrected.size})", same)
except Exception as e:
    check(f"correct_image tests ran (PIL available): {e}", False)


print("rotate_pdf — pypdf applies the value verbatim (clockwise sign):")
try:
    import io, tempfile, os
    from pypdf import PdfReader, PdfWriter
    import pdf_rotate
    # Build a 3-page PDF, rotate pages [0,90,270], confirm /Rotate per page (additive from 0).
    w = PdfWriter()
    for _ in range(3):
        w.add_blank_page(width=200, height=300)
    tmp = os.path.join(tempfile.mkdtemp(prefix="ds_rot_"), "t.pdf")
    with open(tmp, "wb") as fh:
        w.write(fh)
    rotated = pdf_rotate.rotate_pdf(tmp, [0, 90, 270])
    check("rotate_pdf reports 2 pages rotated", rotated == 2)
    pages = PdfReader(tmp).pages
    def _rot(p):
        try: return int(p.rotation)            # pypdf normalises /Rotate to 0..359
        except Exception: return int(p.get("/Rotate", 0) or 0)
    check("page 0 /Rotate == 0",   _rot(pages[0]) == 0)
    check("page 1 /Rotate == 90",  _rot(pages[1]) == 90)
    check("page 2 /Rotate == 270", _rot(pages[2]) == 270)
    os.remove(tmp)
except Exception as e:
    check(f"rotate_pdf tests ran (pypdf available): {e}", False)


print("detect_rotation — safe default on a blank page (Tesseract-gated):")
try:
    from PIL import Image
    from ocr import orientation as _o
    import pytesseract
    # If Tesseract isn't on PATH this raises -> skip (not a failure), like the region tests.
    try:
        pytesseract.get_tesseract_version()
        have_tess = True
    except Exception:
        have_tess = False
    if have_tess:
        blank = Image.new("RGB", (600, 800), "white")
        check("blank page -> 0 (no rotation guessed)", _o.detect_rotation(blank) == 0)
    else:
        print("  -- skipped (Tesseract not available)")
except Exception as e:
    print(f"  -- skipped (setup): {e}")


print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
