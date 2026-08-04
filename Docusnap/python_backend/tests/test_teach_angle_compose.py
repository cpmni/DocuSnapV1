"""Pins for TEACH_ANGLE_COMPOSE — the canonical level-frame composition (Oracle
SIGN-OFF-W/COND C1-C6, 2026-08-05 late). Stored teach coords carry the teach sample's
tilt θ_t; under Straighten-ON the engine composes mapping/landmark COPIES to the level
frame by level = C + R(−θ_t)·(raw − C) — the exact inverse of anchorLabel.js
deskewedNormToRaw's empirically-pinned raw = C + R(+θ)·(level − C).

Run: py -3.12 python_backend/tests/test_teach_angle_compose.py
"""
import importlib
import inspect
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image, ImageDraw

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


os.environ.pop('TEACH_ANGLE_COMPOSE', None)
os.environ.pop('DESKEW_RAW_CROPS', None)
import extraction.engine as E
importlib.reload(E)
check("switch default OFF", E.TEACH_ANGLE_COMPOSE is False)

# ── C1a: cross-convention vector (hardcoded from the JS transform's proven R(+θ)) ──
# deskewedNormToRaw(0.8, 0.2, 2.0, 1000, 1000) = (0.8102874..., 0.2106525...): the raw
# point a level (0.8, 0.2) draw was saved as. Composing that raw box back by θ=2.0 must
# recover the level position.
os.environ['TEACH_ANGLE_COMPOSE'] = '1'
importlib.reload(E)
check("switch arms", E.TEACH_ANGLE_COMPOSE is True)
rx, ry = 0.8102874137039426, 0.2106525471091728
x, y, w, h = E._compose_box_to_level(rx, ry, 0.0, 0.0, 2.0, 1000, 1000)
check(f"C1a cross-convention: raw({rx:.4f},{ry:.4f}) composes to level (0.8, 0.2) ±0.001 — got ({x:.4f},{y:.4f})",
      abs(x - 0.8) < 0.001 and abs(y - 0.2) < 0.001)

# ── C1b: content-anchored, OFF-CENTRE, real-rotate/real-detect round trip ──────────
# Build a LEVEL page with text-like bars + an off-centre header marker; tilt it (the
# "scanned teach sample"); teach coords = the marker's box in the TILTED frame; detect
# the tilt with the real detector; straighten with the real pipeline rotation (the
# sibling's level frame); the COMPOSED box must cover the marker's dark pixels.
from ocr.tesseract import detect_skew_angle, _apply_skew_rotation

W, H = 1200, 1600
level = Image.new("L", (W, H), 255)
d = ImageDraw.Draw(level)
for yy in range(500, 1400, 80):                       # detectable text-line structure (clear of the marker band)
    d.rectangle([150, yy, 1050, yy + 14], fill=40)
MX1, MY1, MX2, MY2 = 900, 180, 1020, 210              # the off-centre header "value"
d.rectangle([MX1, MY1, MX2, MY2], fill=0)
THETA = 1.8
tilted = level.rotate(-THETA, expand=False, fillcolor=255, resample=Image.BICUBIC)
det = detect_skew_angle(tilted, 0.2)
check(f"real detector finds the synthetic tilt (~{THETA}): got {det:.2f}",
      abs(det - THETA) <= 0.4)

# Teach box = the marker's bounding box measured IN THE TILTED (raw teach) frame.
px = tilted.load()
xs, ys = [], []
for yy in range(0, 400):
    for xx in range(700, 1200):
        if px[xx, yy] < 100:
            xs.append(xx); ys.append(yy)
tb = (min(xs) / W, min(ys) / H, (max(xs) - min(xs)) / W, (max(ys) - min(ys)) / H)

sibling_level = _apply_skew_rotation(tilted, det)     # the pipeline-straightened sibling
cx, cy, cw, ch = E._compose_box_to_level(tb[0], tb[1], tb[2], tb[3], det, W, H)
spx = sibling_level.load()
dark = total = 0
x1, y1 = int(cx * W), int(cy * H)
x2, y2 = int((cx + cw) * W), int((cy + ch) * H)
for yy in range(max(0, y1), min(H, y2)):
    for xx in range(max(0, x1), min(W, x2)):
        total += 1
        if spx[xx, yy] < 100:
            dark += 1
# The level marker is 120x30 px; the composed AABB is slightly larger (rotation slack).
exp_cover = (MX2 - MX1) * (MY2 - MY1)
check(f"C1b content pin: composed box covers the marker on the straightened page "
      f"(dark px {dark} >= 80% of {exp_cover})", dark >= 0.8 * exp_cover)
# And the WRONG sign must fail: composing with -det should miss most of the marker.
wx, wy, ww, wh = E._compose_box_to_level(tb[0], tb[1], tb[2], tb[3], -det, W, H)
wd = 0
for yy in range(max(0, int(wy * H)), min(H, int((wy + wh) * H))):
    for xx in range(max(0, int(wx * W)), min(W, int((wx + ww) * W))):
        if spx[xx, yy] < 100:
            wd += 1
check("C1b sign discrimination: the WRONG sign misses the marker", wd < 0.5 * dark)

# ── pure-copy no-mutation + composition helpers ────────────────────────────────────
m = {"field_key": "ref", "anchor_x_norm": 0.6, "anchor_y_norm": 0.2, "anchor_w_norm": 0.1,
     "anchor_h_norm": 0.02, "target_x_norm": 0.8, "target_y_norm": 0.2,
     "target_w_norm": 0.08, "target_h_norm": 0.02, "enabled": 1}
orig = dict(m)
out = E._compose_mappings_to_level([m], 1.8, 1200, 1600)
check("mappings composed as COPIES — stored row unmutated", m == orig and out[0] is not m
      and out[0]["target_x_norm"] != m["target_x_norm"])
# NO-BLOAT pin (the nf-gate customer-lane crater): composition preserves w/h EXACTLY —
# a corner-AABB grows a wide box by w·sinθ and pulls the caption line into the crop.
check("composition preserves w/h exactly (no AABB bloat)",
      abs(out[0]["target_w_norm"] - m["target_w_norm"]) < 1e-12
      and abs(out[0]["target_h_norm"] - m["target_h_norm"]) < 1e-12)
lm = {"label_text": "INVOICE", "x_norm": 0.1, "y_norm": 0.05, "w_norm": 0.1, "h_norm": 0.02}
lorig = dict(lm)
lout = E._compose_landmarks_to_level([lm], 1.8, 1200, 1600)
check("landmarks composed as COPIES — stored row unmutated", lm == lorig and lout[0] is not lm)

# ── wiring pins (source-level) ────────────────────────────────────────────────────
src = inspect.getsource(E.ExtractionEngine.extract)
check("C2: composition angle comes from (mapping_src or matched_tmpl)",
      "(mapping_src or matched_tmpl)" in src.split("_compose_mappings_to_level")[0][-1200:])
check("C3: mutual exclusion — composition gated on NOT DESKEW_RAW_CROPS",
      "TEACH_ANGLE_COMPOSE and not DESKEW_RAW_CROPS" in src)
check("mode-level deskew gate (raw_pages presence), NOT per-page angle",
      "and raw_pages and tmpl_mappings" in src)
check("landmarks composed alongside mappings (same source, no double-correction)",
      "_compose_landmarks_to_level" in src)

# ── C4: the JS lazy heal is switch-gated (dark slice = zero spawns/writes) ─────────
hj = Path(r"c:\GIT Projects\Docusnap\src\modules\processing\handler.js").read_text(encoding="utf-8")
check("C4: heal gated on TEACH_ANGLE_COMPOSE env; fire-and-forget helper present",
      "process.env.TEACH_ANGLE_COMPOSE === '1'" in hj and "_healSampleAngles" in hj
      and "_angleHealTried" in hj)
check("C4: heal renders the WORKING file first", "working_path || d.stored_path" in hj)

os.environ.pop('TEACH_ANGLE_COMPOSE', None)
importlib.reload(E)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All TEACH_ANGLE_COMPOSE checks passed.")
