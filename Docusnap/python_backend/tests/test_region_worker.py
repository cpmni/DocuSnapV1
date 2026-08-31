"""
region_worker.py — the warm OCR worker must read BYTE-IDENTICALLY to region_core.process (so warm ==
cold) and be STATELESS per request (no cross-draw contamination — the whole safety story, since this
path touches no extraction/auto-file decision). Pins the "no cache-last-read" invariant (Oracle C-gate).

Run: cd python_backend && py -3.12 tests/test_region_worker.py
Needs Tesseract; configures the dev path (auto-skips the OCR asserts if it's absent).
"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))            # python_backend
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ocr'))
from PIL import Image, ImageDraw, ImageFont
import pytesseract
import region_core
import region_worker

fail = 0
def check(name, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {name}")
    if not cond: fail += 1

TESS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
FONT = next((f for f in (r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\arialbd.ttf") if os.path.exists(f)), None)
have_ocr = os.path.exists(TESS) and FONT is not None
if have_ocr:
    pytesseract.pytesseract.tesseract_cmd = TESS

def make_png(lines, path, w=520, lh=44, pad=12, size=30):
    h = pad*2 + lh*len(lines)
    im = Image.new("L", (w, h), 255); d = ImageDraw.Draw(im); f = ImageFont.truetype(FONT, size)
    for i, t in enumerate(lines):
        d.text((pad, pad + i*lh), t, font=f, fill=0)
    im.save(path)
    return path

def core_result(path, boxes):
    return region_core.process(Image.open(path).convert('L'), boxes=boxes)

def worker_result(path, boxes):
    r = region_worker._handle({"id": 1, "file": path, "boxes": boxes})
    return {"text": r["text"], "box": r["box"], "words": r["words"], "lines": r["lines"]}

if have_ocr:
    tmp = tempfile.mkdtemp()
    A = make_png(["WS-74522"], os.path.join(tmp, "a.png"))
    B = make_png(["Bluefin Marine Ltd", "Berth 7, Ocean Village", "Southampton"], os.path.join(tmp, "b.png"))

    print("Worker read == region_core.process (byte-identical, warm == cold):")
    for name, p in (("single", A), ("multi", B)):
        for boxes in (False, True):
            same = worker_result(p, boxes) == core_result(p, boxes)
            check(f"{name} boxes={boxes!s:5} identical", same)

    print("\nSTATELESS — no cross-request contamination (the no-cache-last-read pin):")
    a1 = worker_result(A, True)
    _  = worker_result(B, True)          # a DIFFERENT crop in between
    a2 = worker_result(A, True)
    check("crop A read is identical before and after crop B (no bleed)", a1 == a2)
    check("crop A != crop B (the two really differ, so the pin is meaningful)",
          worker_result(A, False)["text"] != worker_result(B, False)["text"])

    print("\nMalformed / error requests never raise:")
    check("missing 'file' -> {'error': ...}", "error" in region_worker._handle({"id": 2}))
    check("bad path -> {'error': ...}", "error" in region_worker._handle({"id": 3, "file": "/no/such.png"}))
    check("error response preserves the id", region_worker._handle({"id": 7}).get("id") == 7)
else:
    print("[skip] OCR byte-identical tests — Tesseract or a TrueType font not available")
    # The error-path assertions need no OCR:
    print("Malformed / error requests never raise (no OCR needed):")
    check("missing 'file' -> {'error': ...}", "error" in region_worker._handle({"id": 2}))
    check("error response preserves the id", region_worker._handle({"id": 7}).get("id") == 7)

print(f"\n{'PASS' if not fail else 'FAIL'} — {fail} failure(s)")
sys.exit(1 if fail else 0)
