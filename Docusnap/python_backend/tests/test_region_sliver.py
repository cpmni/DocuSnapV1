#!/usr/bin/env python3
"""
tests/test_region_sliver.py — guards the SLIVER GATE in ocr/region.py.

Regression class (2026-07-10, MP_wor_47.pdf): the ⊕ teach's one-line above-strip
clipped the caption "Site / Customer" to its bottom 2-4 pixel rows (descender
tips + a dashed underline). Tesseract has no concept of "nothing readable here"
and HALLUCINATED confident junk from the sliver ("eee F WS CwE ewe" in the
readout bar). The gate: a crop whose ink spans a <5px band (pre-upscale) is
reported as EMPTY — the caller's safe no-label/position-only path — instead of
being OCR'd into junk. Blank crops are NOT gated (the ladder already returns
empty faithfully), so the gate can only ever swallow hallucinations.

Function-level checks are hermetic; the CLI checks need no Tesseract BINARY
(the gate short-circuits before OCR). The final end-to-end check exercises the
real bug shape with Tesseract and SKIPS cleanly when it isn't installed.

Usage:  py -3.12 python_backend/tests/test_region_sliver.py
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent.parent
REGION_PY = ROOT / "ocr" / "region.py"
TESSERACT = os.environ.get("TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe")

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


def sliver_img():
    """The measured repro shape: 172x20 white crop whose only ink is the bottom
    tips of a clipped caption + its dashed underline in the TOP 4 rows (dash
    runs ~20px, gaps ~10px — the exact profile captured from MP_wor_47.pdf)."""
    img = Image.new("L", (172, 20), 255)
    d = ImageDraw.Draw(img)
    for x in range(4, 172, 30):
        d.rectangle([x, 0, min(x + 20, 171), 1], fill=0)     # dashes, rows 0-1
    for x in range(10, 160, 18):
        d.rectangle([x, 2, x + 2, 3], fill=0)                # glyph tips, rows 2-3
    return img


def caption_img():
    """A full-height caption line WITH a dashed underline — must NOT be gated."""
    img = Image.new("L", (172, 26), 255)
    d = ImageDraw.Draw(img)
    d.text((2, 3), "Site / Customer", font=_font(13), fill=0)
    for x in range(2, 150, 14):
        d.rectangle([x, 21, x + 9, 22], fill=0)
    return img


def run_cli(img, boxes=False):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        path = f.name
    img.save(path)
    try:
        cmd = [sys.executable, str(REGION_PY), "--image-file", path, "--tesseract", TESSERACT]
        if boxes:
            cmd.append("--boxes")
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        return r.stdout
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass


print("_looks_unreadable_sliver (function level):")
check("clipped-caption sliver IS a sliver", region._looks_unreadable_sliver(sliver_img()) is True)
check("full-height caption is NOT a sliver", region._looks_unreadable_sliver(caption_img()) is False)
check("blank crop is NOT a sliver (empty read stays faithful)",
      region._looks_unreadable_sliver(Image.new("L", (172, 20), 255)) is False)
# isolated 1px speckle rows are ignored (<2 dark px per row) — not treated as ink at all
speck = Image.new("L", (172, 20), 255)
speck.putpixel((30, 2), 0)
speck.putpixel((90, 17), 0)
check("lone speckle pixels are NOT a sliver", region._looks_unreadable_sliver(speck) is False)
# a crop drawn so thin the whole canvas is <5px acts as a sliver when it holds ink
thin = Image.new("L", (172, 3), 255)
ImageDraw.Draw(thin).rectangle([10, 0, 60, 1], fill=0)
check("ultra-thin inked crop IS a sliver", region._looks_unreadable_sliver(thin) is True)

print("region.py CLI (gate short-circuits before OCR — no Tesseract binary needed):")
check("sliver -> empty plain output", run_cli(sliver_img()).strip() == "")
out = run_cli(sliver_img(), boxes=True)
try:
    j = json.loads(out)
    check("sliver --boxes -> text:'' words:[] box:None",
          j.get("text") == "" and j.get("words") == [] and j.get("box") is None)
except Exception:
    check(f"sliver --boxes returned valid JSON (got: {out[:60]!r})", False)

print("end-to-end with Tesseract (the real bug shape):")
have_tess = os.path.exists(TESSERACT)
if not have_tess:
    print("  SKIP — Tesseract not installed; function/CLI gates above still guard the fix")
else:
    full = run_cli(caption_img())
    low = full.lower()
    check(f"full caption crop reads the caption (got {full.strip()!r})",
          "customer" in low)

print()
print(f"{fails} FAILED" if fails else "All region-sliver checks passed")
sys.exit(1 if fails else 0)
