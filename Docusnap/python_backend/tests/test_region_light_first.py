#!/usr/bin/env python3
"""
tests/test_region_light_first.py — guards the LIGHT-FIRST OCR ladder in
ocr/region.py (the shared read behind every interactive draw tool: the review
⊕ field-picker, the Template Wizard read-back, and the Template Manager).

Regression class: region.py used to apply an UNCONDITIONAL autocontrast(cutoff=2)
+ SHARPEN to every crop. On a crisp, high-resolution (e.g. born-digital) crop
that heavy prep amplifies thin rules / box borders into noise, and PSM 7 then
locks onto the artefact and returns garbage or empty ("Serial number" -> junk).
That is the same failure anchor._crop_and_ocr was rebuilt to avoid; region.py
was the un-migrated outlier. The fix reads LIGHT first (greyscale + upscale-only,
no autocontrast/sharpen) and escalates to the heavy recipe only when light is
empty.

This test renders that exact failure shape (clean text hugged by a thin rule),
then asserts:
  1. the heavy recipe DOES corrupt the crop (the repro is real — a soft guard
     that prints a warning if the local Tesseract happens to read it anyway), and
  2. region.py's CLI (the new ladder) reads the text FAITHFULLY.

Needs a real Tesseract (it exercises the actual OCR recipe). SKIPS cleanly with
exit 0 when Tesseract isn't installed, so it never breaks a hermetic run.

Usage:  py -3.12 python_backend/tests/test_region_light_first.py
"""

import os
import re
import sys
import subprocess
import tempfile
from pathlib import Path

import pytesseract
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

ROOT = Path(__file__).parent.parent
REGION_PY = ROOT / "ocr" / "region.py"

# Dev Tesseract location (same path the Electron handler hardcodes). Honour an
# override so CI/other machines can point elsewhere.
TESSERACT = os.environ.get("TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe")

EXPECTED = "Serial number"


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def _norm(s):
    """Loose comparison: lowercase, collapse whitespace, drop punctuation noise."""
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower()).strip()


def _reads_text(out):
    """True when the OCR output faithfully contains the expected words."""
    n = _norm(out)
    return "serial" in n and "number" in n


def _font(size):
    for name in ("arial.ttf", "DejaVuSans.ttf", "calibri.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def render_crop():
    """A tight label crop the way the ⊕ tool / Template Wizard actually grab one:
    small (<300px, so region.py's upscale fires) crisp text boxed by a thin rule —
    a dotted leader under it and a box border, like the field rules/boxes in the
    sample document. It is precisely the upscale × SHARPEN interaction on these
    thin artefacts that the OLD recipe over-amplifies into noise."""
    import numpy as np
    W, H = 168, 40
    # Faint, non-pure-white textured background (values ~232-250) like a real
    # render/scan. autocontrast(cutoff=2) STRETCHES this faint noise across the
    # full range and SHARPEN then rings it into black specks PSM 7 mistakes for
    # glyphs — the documented over-amplification. A light read leaves it untouched.
    rng = np.random.default_rng(7)
    bg = rng.integers(232, 250, size=(H, W), dtype=np.uint8)
    img = Image.fromarray(bg, mode="L")
    d = ImageDraw.Draw(img)
    d.text((6, 8), EXPECTED, fill=25, font=_font(20))
    # Dotted leader hugging the baseline + a tight box border (form-field shapes).
    for x in range(6, W - 6, 4):
        d.point((x, 33), fill=30)
    d.rectangle((1, 1, W - 2, H - 2), outline=60, width=1)
    return img


def render_multiline():
    """A taller crop covering a value that WRAPS onto TWO lines (a work address). PSM 7
    (single-line) mangles this into one garbled line; the multi-line-aware PSM-6 rebuild
    must read BOTH lines and join them."""
    W, H = 340, 82
    img = Image.new("L", (W, H), color=245)
    d = ImageDraw.Draw(img)
    f = _font(20)
    d.text((6, 8),  "Beaumont Care Homes Ltd -", fill=20, font=f)
    d.text((6, 44), "Jordanstown",              fill=20, font=f)
    return img


def heavy_read(img):
    """Reproduce the OLD region.py recipe VERBATIM, including the small-crop
    upscale: greyscale -> upscale(if w<300) -> autocontrast(cutoff=2) -> SHARPEN,
    PSM 7 then 6. This is what a revert to the heavy recipe would do."""
    g = img.convert("L")
    w, h = g.size
    if w < 300:
        scale = max(2, 300 // max(1, w))
        g = g.resize((w * scale, h * scale), Image.LANCZOS)
    g = ImageOps.autocontrast(g, cutoff=2)
    g = g.filter(ImageFilter.SHARPEN)
    t = pytesseract.image_to_string(g, config="--oem 3 --psm 7").strip()
    if not t:
        t = pytesseract.image_to_string(g, config="--oem 3 --psm 6").strip()
    return t.replace("\n", " ").strip()


def region_cli_read(png_path):
    """Run region.py exactly as Electron does (subprocess, --image-file +
    --tesseract) and return its stdout text."""
    proc = subprocess.run(
        [sys.executable, str(REGION_PY), "--image-file", str(png_path), "--tesseract", TESSERACT],
        capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        print("     region.py stderr:", proc.stderr.strip())
    return proc.stdout.strip()


def main():
    if not os.path.exists(TESSERACT):
        print(f"SKIP: Tesseract not found at {TESSERACT} (set TESSERACT_CMD to run). Exit 0.")
        return 0
    pytesseract.pytesseract.tesseract_cmd = TESSERACT

    failures = 0
    print("region.py light-first ladder: clean crop with a thin rule reads faithfully")

    img = render_crop()
    with tempfile.TemporaryDirectory() as td:
        png = Path(td) / "serial_crop.png"
        img.save(png)

        heavy = heavy_read(img)
        out = region_cli_read(png)

        # 1. PRIMARY guard (always, non-flaky): region.py reads the crop
        #    FAITHFULLY — not the empty / garbage read ("be_7") the user hit.
        if not check(f"region.py reads the clean crop faithfully (got {out!r})", _reads_text(out)):
            failures += 1

        # 2. CONTRAST guard: where the OLD heavy recipe over-amplifies the thin
        #    artefacts and adds junk ("Serial number __"), region.py must read
        #    CLEANLY. A revert to the heavy recipe would make region.py dirty too
        #    and fail this. Soft-skipped only when the local Tesseract shrugs the
        #    heavy recipe off on this synthetic crop (repro weaker on that build).
        clean = lambda s: s.strip().lower() == EXPECTED.lower()
        if not clean(heavy):
            if not check(f"region.py reads CLEAN where heavy corrupts "
                         f"(heavy={heavy!r}, region={out!r})", clean(out)):
                failures += 1
        else:
            print(f"  WARN heavy recipe read this crop cleanly here ({heavy!r}); "
                  f"repro weaker on this Tesseract build, primary check still applies")

    print("region.py multi-line: a 2-line value reads BOTH lines (not garbled to one)")
    ml = render_multiline()
    with tempfile.TemporaryDirectory() as td:
        png = Path(td) / "ml.png"
        ml.save(png)
        out = region_cli_read(png)
        n = _norm(out)
        if not check(f"reads line 1 (Beaumont…Ltd) (got {out!r})", "beaumont" in n and "ltd" in n):
            failures += 1
        # The continuation line is what PSM-7 single-line mode drops/mangles; the PSM-6
        # rebuild must include it.
        if not check(f"reads line 2 (Jordanstown), joined in (got {out!r})", "jordanstown" in n):
            failures += 1

    print()
    if failures:
        print(f"{failures} check(s) failed — region.py light-first ladder regressed.")
        return 1
    print("All checks passed — region.py reads clean crops faithfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
