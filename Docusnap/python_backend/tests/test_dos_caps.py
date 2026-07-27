#!/usr/bin/env python3
"""
tests/test_dos_caps.py

STAGE 2 (F6/L5) — crafted-document DoS caps in ocr.tesseract.pdf_to_images: a file-size cap, a
page-count cap, and a per-page render-dimension clamp (the decompression/pixel-bomb defence). Each is
set FAR above any real business document (corpus max = 2 pages, A4@300dpi ~3500px), so it is INERT on
real docs — the render scale is min(dpi/72, ...) which equals dpi/72 for every normal page → extraction
byte-identical. This test drives each cap by temporarily shrinking the module constant.

Run:  py -3.12 python_backend/tests/test_dos_caps.py
Exit 0 = all checks passed.  Exit 1 = failure(s).
"""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import pypdfium2 as pdfium
from ocr import tesseract

fails = 0
def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'}  {label}")
    global fails
    if not cond:
        fails += 1

def raises_valueerror(fn):
    try:
        fn(); return False
    except ValueError:
        return True

def make_pdf(path, w=595, h=842, pages=1):
    doc = pdfium.PdfDocument.new()
    for _ in range(pages):
        doc.new_page(w, h)
    doc.save(path)
    doc.close()

print("\n§1  file-size cap fires before parsing (any oversized file)")
tmp = os.path.join(tempfile.gettempdir(), "sf_dos_size.pdf")
with open(tmp, "wb") as f:
    f.write(b"x" * 200)
_old = tesseract._MAX_FILE_BYTES
tesseract._MAX_FILE_BYTES = 1
try:
    check("a file over the byte cap raises ValueError", raises_valueerror(lambda: tesseract.pdf_to_images(tmp)))
finally:
    tesseract._MAX_FILE_BYTES = _old
    try: os.unlink(tmp)
    except OSError: pass

pdfp = os.path.join(tempfile.gettempdir(), "sf_dos_page.pdf")
make_pdf(pdfp)

print("\n§2  a normal page renders full-size (all caps inert → byte-identical)")
imgs = tesseract.pdf_to_images(pdfp)
check("one page image produced", len(imgs) == 1)
check(f"render is full-size ~2480x3508 (clamp did NOT fire): got {imgs[0].size}",
      imgs[0].size[0] > 2000 and imgs[0].size[1] > 2000)

print("\n§3  page-count cap")
_old = tesseract._MAX_PAGES
tesseract._MAX_PAGES = 0
try:
    check("a doc over the page cap raises ValueError", raises_valueerror(lambda: tesseract.pdf_to_images(pdfp)))
finally:
    tesseract._MAX_PAGES = _old

print("\n§4  render-dimension clamp (pixel-bomb defence)")
_old = tesseract._MAX_RENDER_DIM
tesseract._MAX_RENDER_DIM = 100
try:
    imgs = tesseract.pdf_to_images(pdfp)
    check(f"render clamped to <=100px per axis: got {imgs[0].size}", max(imgs[0].size) <= 100)
finally:
    tesseract._MAX_RENDER_DIM = _old

try: os.unlink(pdfp)
except OSError: pass

print("")
if fails:
    print(f"FAILED: {fails} check(s)")
    sys.exit(1)
print("All DoS-cap checks passed.")
sys.exit(0)
