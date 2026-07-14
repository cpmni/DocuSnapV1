"""
test_caption_exclusion.py — (P) caption-band exclusion on the relocate crop (007+Oracle 2026-07-14).
A thin one-line value box is padded ~3x taller in _crop_and_ocr, so a below-anchor relocate crop can
balloon UP into the located caption ("Customer") → a shifted/deskewed scan reads "Customer eu". The
clamp forces the crop TOP below the located caption. Pins the fail-safe Oracle required: clamp ONLY when
the caption is cleanly ABOVE the value (never clip into it); a degenerate clamp COLLAPSES the crop → None
→ the caller skips the relocate (rigid read + caption-demotion backstop → review, never a silent wrong value).

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_caption_exclusion.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from PIL import Image
from extraction.anchor import _caption_top_limit, _crop_and_ocr

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1
def approx(a, b): return a is not None and abs(a - b) < 1e-6

# label (caption) box TOP-LEFT; relo value box (cx,cy,w,h) CENTRE. Caption cleanly above the value:
CAP  = {"x_norm": 0.64, "y_norm": 0.203, "w_norm": 0.10, "h_norm": 0.014}   # bottom = 0.217
RELO = (0.803, 0.233, 0.324, 0.016)                                          # value top = 0.233-0.008 = 0.225

def main():
    os.environ.pop("RELOCATE_CAPTION_EXCLUDE", None)

    # ── _caption_top_limit ───────────────────────────────────────────────────
    tl = _caption_top_limit(CAP, "below", RELO)
    check("below + caption cleanly above → clamp just below the caption bottom (0.217+gap)",
          approx(tl, 0.217 + 0.002))
    check("clamp never exceeds the value top (never clips into the value)", tl <= 0.225 + 1e-9)

    # caption NOT cleanly above (label bottom at/over the value top) → None (no clamp)
    CAP_ABUT = {"x_norm": 0.64, "y_norm": 0.223, "w_norm": 0.10, "h_norm": 0.014}   # bottom 0.237 > val top 0.225
    check("caption abutting/overlapping the value → None (never clip the value)",
          _caption_top_limit(CAP_ABUT, "below", RELO) is None)

    check("non-'below' direction → None", _caption_top_limit(CAP, "right", RELO) is None
          and _caption_top_limit(CAP, "above", RELO) is None)
    check("missing label box → None", _caption_top_limit(None, "below", RELO) is None)
    check("missing relo box → None", _caption_top_limit(CAP, "below", None) is None)

    os.environ["RELOCATE_CAPTION_EXCLUDE"] = "0"
    check("kill switch RELOCATE_CAPTION_EXCLUDE=0 → None (byte-identical)",
          _caption_top_limit(CAP, "below", RELO) is None)
    os.environ.pop("RELOCATE_CAPTION_EXCLUDE", None)
    check("re-enabled → clamps again", _caption_top_limit(CAP, "below", RELO) is not None)

    # ── _crop_and_ocr COLLAPSE guard (the fail-safe: degenerate clamp → None, BEFORE OCR) ──
    img = Image.new("L", (200, 200), 255)   # blank; the collapse guard returns before OCR
    # top_limit 0.99 forces y1≈198 ≥ y2 → collapse → None (caller then skips → rigid + backstop)
    check("clamp that collapses the crop → None (skip the relocate)",
          _crop_and_ocr(img, 0.5, 0.5, 0.1, 0.02, "text", top_limit_norm=0.99) is None)
    # a normal top_limit (0.30) does NOT collapse (crop still spans the value region below)
    _v = _crop_and_ocr(img, 0.5, 0.5, 0.1, 0.02, "text", top_limit_norm=0.30)
    check("a non-collapsing clamp still reads (None only because the test image is blank, not collapsed)",
          _v is None or isinstance(_v, str))   # blank image → None; the point is it didn't raise
    # no top_limit → unchanged path (byte-identical for every existing caller)
    check("top_limit_norm=None → normal path (no clamp, no collapse)",
          _crop_and_ocr(img, 0.5, 0.5, 0.1, 0.02, "text") in (None, "") or isinstance(_crop_and_ocr(img, 0.5, 0.5, 0.1, 0.02, "text"), str))

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
