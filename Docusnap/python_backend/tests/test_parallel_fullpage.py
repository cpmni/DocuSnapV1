#!/usr/bin/env python3
"""
tests/test_parallel_fullpage.py — Option B (2026-07-17): reconstruct_page_text runs its two
full-page passes (PSM-3 main + PSM-6 supplementary) CONCURRENTLY when DS_OCR_PARALLEL_FULLPAGE
is set, for a ~2x speedup on a single-doc straighten/enhance/first-import reprocess.

The change is PURELY a scheduling change — the recognised text must be BYTE-IDENTICAL to the
sequential (default/OFF) path, because a reprocess feeds learning + auto-file. This pins:
  1. OFF (default) vs ON => identical text (the determinism contract),
  2. ON is deterministic across repeats (no completion-order dependence),
  3. OFF with the flag explicitly '0' == unset (byte-identical default).

Run: cd python_backend && py -3.12 tests/test_parallel_fullpage.py
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import pytesseract
from PIL import Image, ImageDraw, ImageFont
_TESS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if os.path.exists(_TESS):
    pytesseract.pytesseract.tesseract_cmd = _TESS
from ocr.tesseract import reconstruct_page_text

fails = 0
def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}" + (f"  [{extra}]" if extra and not cond else ""))
    if not cond: fails += 1

# A document-like page with a right-aligned totals block (exercises the PSM-6 supplementary pass).
def make_page():
    img = Image.new("RGB", (1240, 1600), "white")
    d = ImageDraw.Draw(img)
    try:
        big = ImageFont.truetype("arial.ttf", 44); mid = ImageFont.truetype("arial.ttf", 30)
    except Exception:
        big = mid = ImageFont.load_default()
    d.text((80, 70), "ACME WORKSHEET", font=big, fill="black")
    for i, line in enumerate(["Description", "Site attendance", "Delivery", "Service call-out", "Labour hours"]):
        d.text((80, 220 + i * 70), line, font=mid, fill="black")
    d.text((820, 640), "Subtotal", font=mid, fill="black");  d.text((1040, 640), "387.74", font=mid, fill="black")
    d.text((820, 700), "VAT", font=mid, fill="black");       d.text((1040, 700), "77.55", font=mid, fill="black")
    d.text((820, 760), "Order Total", font=mid, fill="black"); d.text((1040, 760), "465.29", font=mid, fill="black")
    return img

def off(img):
    os.environ.pop("DS_OCR_PARALLEL_FULLPAGE", None); os.environ.pop("OMP_THREAD_LIMIT", None)
    return reconstruct_page_text(img, dpi=150)
def on(img):
    os.environ["DS_OCR_PARALLEL_FULLPAGE"] = "1"
    try: return reconstruct_page_text(img, dpi=150)
    finally: os.environ.pop("DS_OCR_PARALLEL_FULLPAGE", None)

page = make_page()
base = off(page)
check("OFF path returns non-empty text (test is meaningful)", len(base.strip()) > 0, f"{base!r}")
check("ON == OFF (byte-identical text)", on(page) == base)

# determinism: 5 ON runs must all match
runs = [on(page) for _ in range(5)]
check("ON is deterministic across 5 repeats", all(r == base for r in runs))

# explicit '0' must equal unset
os.environ["DS_OCR_PARALLEL_FULLPAGE"] = "0"
zero = reconstruct_page_text(page, dpi=150)
os.environ.pop("DS_OCR_PARALLEL_FULLPAGE", None)
check("flag='0' == default (OFF)", zero == base)

print(f"\n{'PASS' if not fails else 'FAIL'} — {fails} failure(s)")
sys.exit(1 if fails else 0)
