"""Pins for S1 DESKEW_SS_ROTATE (007 + Oracle SIGN-OFF-W/COND C1-C5, 2026-08-05).
The single BICUBIC rotate degraded marginal-resolution print (live doc 561:
'DN-98447' read perfectly raw, garbled after its own +1.9° deskew). The
supersample-rotate-downsample path must be GEOMETRY-IDENTICAL (same centre/
angle/output size/mode) — only the pixels change.

Run: py -3.12 python_backend/tests/test_deskew_ss_rotate.py
"""
import importlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


def dot_page(w=900, h=1200, dot=(700, 300)):
    img = Image.new("L", (w, h), 255)
    for dx in range(-6, 7):
        for dy in range(-6, 7):
            if dx * dx + dy * dy <= 36:
                img.putpixel((dot[0] + dx, dot[1] + dy), 0)
    return img


def centroid(img):
    px = img.load()
    sx = sy = n = 0
    w, h = img.size
    for y in range(h):
        for x in range(w):
            if px[x, y] < 128:
                sx += x; sy += y; n += 1
    return (sx / n, sy / n) if n else (None, None)


os.environ.pop('DESKEW_SS_ROTATE', None)
import ocr.tesseract as T
importlib.reload(T)
check("switch default OFF (C5: doc-561 refuted the interpolation hypothesis; C4 not green)",
      T._SS_ROTATE_ON is False)
os.environ['DESKEW_SS_ROTATE'] = '1'
importlib.reload(T)
check("switch arms", T._SS_ROTATE_ON is True)

# ── geometry invariants ──────────────────────────────────────────────────────
img = dot_page()
rot = T._apply_skew_rotation(img, 1.9)
check("output size EXACTLY original (expand never)", rot.size == img.size)
check("mode preserved (L stays L)", rot.mode == "L")
check("angle=0 returns the SAME object (identity fast path)",
      T._apply_skew_rotation(img, 0.0) is img)

# ── rotation-SIGN pin (test_orientation.py precedent — a wrong sign corrupts every doc) ──
# PIL rotate(angle) is CCW-positive about the image centre in IMAGE coords (y down):
# p' = C + M(-th)·(p - C) for the CONTENT (inverse sampling), i.e. a dot at (700,300)
# under +1.9° must land where the maths says — pin against the analytic prediction.
import math
th = math.radians(1.9)
C = (img.size[0] / 2.0, img.size[1] / 2.0)
dx, dy = 700 - C[0], 300 - C[1]
# PIL CCW-positive in visual terms with y-down means content maps via rotation by +th:
exp = (C[0] + dx * math.cos(th) + dy * math.sin(th),
       C[1] - dx * math.sin(th) + dy * math.cos(th))
got = centroid(rot)
check(f"SIGN pin: dot lands at analytic point (±2px) — got {got}, expected {exp}",
      got[0] is not None and abs(got[0] - exp[0]) <= 2 and abs(got[1] - exp[1]) <= 2)

# kill switch parity: OFF path must land the dot at the SAME point (geometry identical)
os.environ['DESKEW_SS_ROTATE'] = '0'
importlib.reload(T)
got_off = centroid(T._apply_skew_rotation(dot_page(), 1.9))
check("OFF path lands the dot at the same point (±1px) — geometry identical across paths",
      abs(got[0] - got_off[0]) <= 1 and abs(got[1] - got_off[1]) <= 1)
os.environ['DESKEW_SS_ROTATE'] = '1'   # re-arm — clamp + mode tests exercise the SS path
importlib.reload(T)

# ── C2 megapixel clamp: an over-cap page takes the single-resample path (no MemoryError) ──
_orig_max = T._SS_ROTATE_MAX_PIXELS
T._SS_ROTATE_MAX_PIXELS = 1000
r2 = T._apply_skew_rotation(dot_page(), 1.9)
T._SS_ROTATE_MAX_PIXELS = _orig_max
check("clamp: over-cap page still rotates (single-resample path), size preserved",
      r2.size == img.size)

# ── C1: region.py routes through the SHARED helper (one rotation implementation) ──
rsrc = (Path(__file__).resolve().parents[1] / "ocr" / "region.py").read_text(encoding="utf-8")
check("region.py display deskew calls _apply_skew_rotation (no private rotate)",
      "_apply_skew_rotation(orig, angle)" in rsrc
      and "orig.rotate(angle, expand=False" not in rsrc)

# '1'-mode parity (region.py native-mode callers)
one = dot_page().convert("1")
r3 = T._apply_skew_rotation(one, 1.9)
check("mode '1' rotates without error, mode preserved", r3.mode == "1" and r3.size == one.size)
os.environ.pop('DESKEW_SS_ROTATE', None)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All DESKEW_SS_ROTATE checks passed.")
