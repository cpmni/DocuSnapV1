#!/usr/bin/env python3
"""
tests/test_anchor_code_left_grow_efficacy.py
--------------------------------------------
EFFICACY injection for anchor_code_left_grow (mig 192) — the Oracle-required proof the DARK safety census
(TESTING/_measure/anchor_left_grow_census_20260920) could NOT give: the synthetic corpus has zero
crop_fullpage_disagree flags, so the arm never fires there (the "vacuous arm"). This drives the REAL recovery
`template_mapper._grow_code_left_read` (NOT stubbed — real Tesseract, real `_read_pad_window_code`, real
`_full_page_lines`) on a RENDERED page where the taught box clips the leading glyph, and asserts:

  CONVERGE  -- page prints "WS-62315"; the taught box's tight rigid read is a shape-valid single-leading-glyph
              confusable ("NS-62315", the measured result of clipping a mono "WS-62315" ~0.6 char -- see the
              scratchpad exploration); the padded re-read of the taught box recovers the true "WS-62315" and
              the recovery RETURNS it -> the crosscheck disagreement would DISSOLVE (clean commit, no flag).

  ADVERSARIAL (the safety) -- the page really prints the minority form "NS-62315"; the tight read "NS-62315" is
              therefore PAGE-PRESENT -> the recovery ABSTAINS (returns None) -> no convergence -> today's
              flip+flag STANDS. This is what protects a genuine minority-series doc from being silently converted.

Tesseract-gated (skips cleanly if the binary is absent). Deterministic render (Courier New).
    py -3.12 python_backend/tests/test_anchor_code_left_grow_efficacy.py
"""
import os
import sys
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

TESS = os.environ.get("TESSERACT_CMD") or r"C:\Program Files\Tesseract-OCR\tesseract.exe"
try:
    import pytesseract
    from PIL import Image, ImageDraw, ImageFont
    if os.path.exists(TESS):
        pytesseract.pytesseract.tesseract_cmd = TESS
    pytesseract.get_tesseract_version()
    HAVE_TESS = True
except Exception:
    HAVE_TESS = False

from extraction import format_anomaly_checker as F
from extraction import template_mapper as TM

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")


def _mono(size):
    for n in ("cour.ttf", "consola.ttf"):
        p = os.path.join(r"C:\Windows\Fonts", n)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def _ref_patterns():
    cfg = json.loads((ROOT.parent / "config" / "keyword_patterns.json").read_text(encoding="utf-8"))
    vp = cfg.get("validation_patterns", cfg)
    return vp.get("reference_code") or [r"^(?=[A-Za-z0-9][A-Za-z0-9\-/.]*\d)[A-Za-z0-9][A-Za-z0-9\-/.]{2,20}$"]


ENTRY = F.build_format_class_index([{
    "field_key": "reference_number", "supplier_name": "Castellan Security Systems",
    "document_type": "service_worksheet",
    "sample_values": ["WS-62301", "WS-62288", "WS-62312", "WS-62290", "WS-73601"],
    "value_counts": {"WS-62301": 3, "WS-62288": 2, "WS-62312": 2, "WS-62290": 2, "WS-73601": 2},
}]).get(("castellan security systems", "service_worksheet", "reference_number"))


def _render(value):
    W, H = 1000, 1400
    page = Image.new("L", (W, H), 255)
    d = ImageDraw.Draw(page)
    f = _mono(34)
    d.text((90, 60), "CASTELLAN SECURITY SYSTEMS", fill=0, font=f)
    d.text((90, 120), "SERVICE WORKSHEET", fill=0, font=f)
    row_y, val_x = 300, 430
    d.text((90, row_y), "Reference No.", fill=0, font=f)
    d.text((val_x, row_y), value, fill=0, font=f)
    d.text((90, 400), "Date  26-09-2025", fill=0, font=f)
    bb = d.textbbox((val_x, row_y), value, font=f)
    vx0, vy0, vx1, vy1 = bb
    charw = (vx1 - vx0) / max(1, len(value))
    tb_x0 = vx0 + int(charw * 0.6)   # clip ~0.6 char into the leading glyph
    box = {"x_norm": tb_x0 / W, "y_norm": (vy0 - 4) / H,
           "w_norm": (vx1 - tb_x0) / W, "h_norm": (vy1 - vy0 + 8) / H}
    return page, box


def main():
    print("anchor_code_left_grow -- EFFICACY (real render + real Tesseract)")
    if not HAVE_TESS:
        print("  SKIP -- Tesseract not available on this machine")
        return 0
    if ENTRY is None:
        print("  BAD -- could not build the learned-shape entry")
        return 1
    vps = {"reference_code": _ref_patterns()}
    os.environ["ANCHOR_CODE_LEFT_GROW"] = "1"

    check("WS-62315 and NS-62315 share the learned shape (single-glyph confusable, same length)",
          F.shape_match_score("WS-62315", ENTRY) == 1.0 and F.shape_match_score("NS-62315", ENTRY) == 1.0)

    page, box = _render("WS-62315")
    rec = TM._grow_code_left_read(page, box, "NS-62315", "reference_number", "Reference No.",
                                  vps, (lambda k: ENTRY), TM._ocr_lines, {}, env_var="ANCHOR_CODE_LEFT_GROW")
    check("CONVERGE: padded re-read recovers the true 'WS-62315' (recovery fires on a real clipped raster)",
          rec is not None and TM._code_norm(rec[0]) == TM._code_norm("WS-62315"))

    page2, box2 = _render("NS-62315")
    rec2 = TM._grow_code_left_read(page2, box2, "NS-62315", "reference_number", "Reference No.",
                                   vps, (lambda k: ENTRY), TM._ocr_lines, {}, env_var="ANCHOR_CODE_LEFT_GROW")
    check("ADVERSARIAL: committed value genuinely on the page -> recovery ABSTAINS (None) -> flag would STAND",
          rec2 is None)

    os.environ.pop("ANCHOR_CODE_LEFT_GROW", None)
    rec3 = TM._grow_code_left_read(page, box, "NS-62315", "reference_number", "Reference No.",
                                   vps, (lambda k: ENTRY), TM._ocr_lines, {}, env_var="ANCHOR_CODE_LEFT_GROW")
    check("OFF: switch unset -> None (byte-identical)", rec3 is None)

    print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
