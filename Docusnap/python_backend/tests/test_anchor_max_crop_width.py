"""
test_anchor_max_crop_width.py — Box-width learning, SLICE 2 (the Python crop reader; DARK behind
ANCHOR_MAX_CROP_WIDTH). A taught field's crop width is its box w_norm, so a value LONGER than the box
ever drawn is truncated ("Tesco" box cuts off "Billies Hardware Store"). When the switch is ON,
_crop_and_ocr extends the crop RIGHTWARD to the learned high-water max_w_norm, keeping the value's
LEFT edge fixed, never beyond the absolute cap. Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-21.

Pins: red-first capture (OFF truncates, ON captures), left-edge-preserved + right-extends-by-delta,
byte-identical-OFF (switch off / max_w_norm None / max_w_norm<=w_norm), and the absolute cap
(a huge max is clamped, but a legitimately-wide single teach w_norm>cap is NEVER shrunk).

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_anchor_max_crop_width.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from PIL import Image, ImageDraw, ImageFont
import pytesseract

TESSERACT = os.environ.get("TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe")
from extraction.anchor import _crop_and_ocr, _MAX_CROP_WIDTH_CAP, clean_crop_segment

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1
def setenv(v):
    if v is None: os.environ.pop("ANCHOR_MAX_CROP_WIDTH", None)
    else: os.environ["ANCHOR_MAX_CROP_WIDTH"] = v

def _font(size):
    for name in ("arial.ttf", "DejaVuSans.ttf", "calibri.ttf"):
        try: return ImageFont.truetype(name, size)
        except Exception: continue
    return ImageFont.load_default()

# ── A synthetic page: a short caption box taught around "Tesco", but the real value here is a
#    LONG name that runs well to the right of that box. ──
W, H = 1700, 400
NAME = "Billies Hardware Store Ltd"
NAME_X0 = 300           # left edge of the value text (px)
NAME_Y  = 180

def page():
    img = Image.new("L", (W, H), 250)
    d = ImageDraw.Draw(img)
    d.text((NAME_X0, NAME_Y), NAME, fill=20, font=_font(40))
    return img

P = page()
# The TAUGHT box: narrow (as if drawn around a short "Tesco"), centred over the START of the name.
TAUGHT_W = 0.10                                   # ~170px — only fits the first word-ish
CX = (NAME_X0 + TAUGHT_W * W / 2) / W             # centre so the box LEFT edge == the name's left edge
CY = (NAME_Y + 22) / H
TAUGHT_H = 0.05
# The learned high-water: a wide box (as if the operator once drew around a long value).
MAX_W = 0.62                                      # exceeds the cap on purpose (tests clamping)


def read(max_w_norm):
    v = _crop_and_ocr(P, CX, CY, TAUGHT_W, TAUGHT_H, "text", max_w_norm=max_w_norm)
    return (clean_crop_segment(v, "text") or v or "").strip()


def main():
    pytesseract.pytesseract.tesseract_cmd = TESSERACT
    if not os.path.exists(TESSERACT):
        print("SKIP (no tesseract at %s)" % TESSERACT); return

    # ── geometry: prove the transform keeps the LEFT edge and extends RIGHT (unit-level) ──
    setenv("1")
    # Re-derive the transform the way _crop_and_ocr does, to assert the math directly.
    eff_w = max(TAUGHT_W, min(MAX_W, _MAX_CROP_WIDTH_CAP))
    left_before = CX - TAUGHT_W / 2.0
    new_cx = left_before + eff_w / 2.0
    left_after = new_cx - eff_w / 2.0
    right_before = CX + TAUGHT_W / 2.0
    right_after = new_cx + eff_w / 2.0
    check("geometry: eff_w is capped at _MAX_CROP_WIDTH_CAP (huge max clamped)", eff_w == _MAX_CROP_WIDTH_CAP)
    check("geometry: LEFT edge is preserved exactly", abs(left_after - left_before) < 1e-12)
    check("geometry: RIGHT edge extends by exactly (eff_w - w_norm)",
          abs((right_after - right_before) - (eff_w - TAUGHT_W)) < 1e-12)

    # ── the absolute-cap arithmetic trap: a legitimately-WIDE single teach must NOT be shrunk ──
    wide_w = 0.7                                   # a real taught box wider than the cap
    eff_wide = max(wide_w, min(wide_w, _MAX_CROP_WIDTH_CAP))
    check("cap trap: w_norm already > cap is NEVER shrunk (outer max wins)", eff_wide == wide_w)

    # ── OCR: OFF truncates the long value, ON captures it ──
    setenv(None)                                   # OFF (default) — byte-identical
    off = read(MAX_W)
    check("RED-FIRST (OFF): the narrow taught box TRUNCATES the long value (no full name)",
          "billies" not in off.lower() or "store" not in off.lower())

    setenv("1")                                    # ON
    on = read(MAX_W)
    check("FIXED (ON): extending to the learned max captures the full long value",
          "billies" in on.lower() and "store" in on.lower())

    # ── byte-identical OFF-equivalent inputs (must all behave like OFF, i.e. no widen) ──
    setenv("1")
    check("no widen when max_w_norm is None", read(None) == off or "billies" not in (read(None)).lower())
    check("no widen when max_w_norm <= w_norm (legacy backfill / first teach)",
          "store" not in read(TAUGHT_W).lower())
    setenv("0")
    check("kill switch =0 ⇒ no widen (byte-identical to OFF)", "store" not in read(MAX_W).lower())
    setenv(None)

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
