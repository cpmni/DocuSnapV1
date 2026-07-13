#!/usr/bin/env python3
"""tests/test_deskew_min_angle.py — pins the --deskew-min-angle FLOOR (oscar-signed 2026-07-13).

The Review session "Straighten all" toggle sends an operator-chosen minimum skew angle: only pages
tilted MORE than that are straightened, for BOTH the on-screen display (region.py --deskew) and the
Reprocess-All read (--deskew-pages). The floor lives in ONE place — detect_skew_angle (tesseract.py) —
as max(0.2, min_angle), so the hard 0.2° noise floor can never be undercut and an unset floor (0.2) is
byte-identical to the pre-flag behaviour. This pins: (a) the floor gates the measured angle, (b) _deskew
no-ops above the floor, (c) region.py threads --min-angle end-to-end (display path), (d) the default is
inert. Run: py -3.12 tests/test_deskew_min_angle.py
"""
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from PIL import Image, ImageDraw
from ocr.tesseract import detect_skew_angle, _deskew

REGION = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ocr", "region.py")
fails = 0


def check(label, cond, extra=""):
    global fails
    print(("OK  " if cond else "BAD ") + label + (("  " + extra) if extra else ""))
    if not cond:
        fails += 1


def _tilted(deg: float) -> Image.Image:
    """A white page of strong horizontal bars (ideal for the projection-variance estimator), tilted."""
    img = Image.new("L", (1000, 1400), 255)
    d = ImageDraw.Draw(img)
    for y in range(80, 1360, 60):
        d.rectangle([80, y, 920, y + 14], fill=0)
    return img.rotate(-deg, expand=False, fillcolor=255, resample=Image.BICUBIC)


skew2 = _tilted(2.0)

print("detect_skew_angle floor (max(0.2, min_angle)):")
a_default = detect_skew_angle(skew2)          # unset -> 0.2 floor -> measures the tilt
a_keep    = detect_skew_angle(skew2, 1.0)     # 2 > 1.0 -> kept
a_supp    = detect_skew_angle(skew2, 3.0)     # 2 < 3.0 -> floored to 0.0
a_hardfl  = detect_skew_angle(_tilted(0.0), 0.2)   # a straight page is always 0.0
check("default (unset) floor measures a ~2° tilt", 1.2 <= a_default <= 2.8, f"got {a_default}")
check("floor 1.0° keeps a ~2° tilt", a_keep >= 1.0, f"got {a_keep}")
check("floor 3.0° suppresses a ~2° tilt → 0.0", a_supp == 0.0, f"got {a_supp}")
check("a straight page is 0.0 regardless of floor", a_hardfl == 0.0, f"got {a_hardfl}")
# The hard 0.2° floor can never be undercut: passing 0.0 still floors at 0.2.
check("min_angle below 0.2 is clamped up to the hard floor (0.05 behaves like 0.2)",
      detect_skew_angle(_tilted(0.1), 0.05) == 0.0)   # a 0.1° tilt < 0.2 hard floor → 0.0

print("\n_deskew honours the floor (no-op above it):")
low  = _deskew(skew2, 1.0)   # 2 > 1.0 → rotates
high = _deskew(skew2, 3.0)   # 2 < 3.0 → returns the SAME object, untouched
check("_deskew below floor rotates (same dims, different pixels)",
      low.size == skew2.size and low.tobytes() != skew2.tobytes())
check("_deskew above floor returns the input object unchanged (no resample)", high is skew2)

print("\nregion.py --min-angle threads end-to-end (the DISPLAY path):")
tmp = os.path.join(tempfile.gettempdir(), "ds_deskew_minangle_probe.png")
skew2.convert("RGB").save(tmp)


def region_skew(minang):
    r = subprocess.run([sys.executable, REGION, "--image-file", tmp, "--skew", "--min-angle", str(minang)],
                       capture_output=True, text=True)
    import json
    try:
        return json.loads(r.stdout)["angle"]
    except Exception:
        return f"PARSE-FAIL stdout={r.stdout!r} stderr={r.stderr[-160:]!r}"


r_keep = region_skew(1.0)
r_supp = region_skew(3.0)
check("region.py --skew --min-angle 1.0 reports the tilt", isinstance(r_keep, (int, float)) and abs(r_keep) >= 1.0, f"got {r_keep}")
check("region.py --skew --min-angle 3.0 reports 0.0 (floored)", r_supp == 0.0, f"got {r_supp}")

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
