"""detect_skew_angle (ocr/tesseract.py) — the non-destructive skew measurement shared by
_deskew (OCR copy) and the Review-window display deskew. Pins: straight->~0, a known skew is
measured, the sub-0.2deg threshold, and that _deskew's behaviour is UNCHANGED by the refactor.

Run:  py -3.12 tests/test_skew_angle.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image, ImageDraw
from ocr.tesseract import detect_skew_angle, _deskew

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def bars(w=800, h=600):
    """A straight page of horizontal 'text lines' — a clean projection-variance signal."""
    img = Image.new('L', (w, h), 255)
    d = ImageDraw.Draw(img)
    for y in range(60, h - 60, 40):
        d.rectangle([90, y, w - 90, y + 12], fill=0)
    return img


straight = bars()
check("straight page -> ~0 angle", abs(detect_skew_angle(straight)) < 0.5)

# Skew the page 3deg CLOCKWISE (PIL rotate is CCW-positive, so -3 = CW). The straightening angle
# is therefore +3 (CCW 3deg). detect_skew_angle returns the angle to PASS TO img.rotate() to
# straighten (PIL convention), so it should be ~ +3.
skewed = straight.rotate(-3.0, expand=False, fillcolor=255)
a = detect_skew_angle(skewed)
check(f"3deg-CW skew measured ~+3 (straightening angle; got {a})", abs(a - 3.0) < 0.7)

# ...and the opposite direction gives ~ -3
skewed_ccw = straight.rotate(3.0, expand=False, fillcolor=255)
a2 = detect_skew_angle(skewed_ccw)
check(f"3deg-CCW skew measured ~-3 (got {a2})", abs(a2 + 3.0) < 0.7)

# _deskew behaviour UNCHANGED by the refactor: no-op object identity on a straight page,
# a new (rotated) image on a skewed page, and the result reads ~straight.
check("_deskew no-op on straight page (same object)", _deskew(straight) is straight)
ds = _deskew(skewed)
check("_deskew rotates a skewed page (new object)", ds is not skewed)
check("_deskew result reads ~straight (<1deg residual)", abs(detect_skew_angle(ds)) < 1.0)

# sub-threshold micro-skew is ignored
check("sub-0.2deg skew -> 0.0", detect_skew_angle(straight.rotate(-0.1, expand=False, fillcolor=255)) == 0.0)

print()
if fails:
    print(f"{fails} FAILED")
    sys.exit(1)
print("All skew-angle checks passed")
