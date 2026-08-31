#!/usr/bin/env python3
"""
tests/test_region_embeddable_import.py — REGRESSION PIN for the 2026-07-17 packaged-build crash.

region.py / region_worker.py import the sibling `region_core`. The PACKAGED app runs an EMBEDDABLE
Python whose pythonXX._pth SUPPRESSES the automatic script-directory entry on sys.path, so a bare
`import region_core` raised ModuleNotFoundError and crashed the script before main() — killing the
Straighten button (--deskew), --skew/--boxes, and the ⊕ draw tool (warm worker + cold fallback).
Dev's system Python auto-adds the script dir, which MASKED the bug in every dev test.

`python -P` (PYTHONSAFEPATH, 3.11+) reproduces the embeddable behaviour in dev: it does NOT prepend
the script's directory. So running these scripts under -P must still succeed. If a future refactor
re-introduces a bare sibling import without the sys.path guard, this test fails.

Run: cd python_backend && py -3.12 tests/test_region_embeddable_import.py
"""
import sys, os, subprocess, json, tempfile
from pathlib import Path

OCR = Path(__file__).resolve().parent.parent / "ocr"
REGION = str(OCR / "region.py")
WORKER = str(OCR / "region_worker.py")

fails = 0
def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}" + (f"  [{extra}]" if extra and not cond else ""))
    if not cond:
        fails += 1

# A tiny image is enough — --skew needs no tesseract (pure numpy/PIL detect_skew_angle).
from PIL import Image, ImageDraw
img = Image.new("L", (600, 400), 255)
d = ImageDraw.Draw(img)
for y in range(60, 360, 40):           # horizontal rules -> a real projection signal
    d.line([(40, y), (560, y + 12)], fill=0, width=3)   # slight downward tilt
png = os.path.join(tempfile.gettempdir(), "ds_embed_test.png")
img.save(png)

# 1) region.py --skew under -P must NOT crash (was ModuleNotFoundError: region_core).
r = subprocess.run([sys.executable, "-P", REGION, "--image-file", png, "--skew", "--min-angle", "0.2"],
                   capture_output=True, text=True, timeout=60)
check("region.py --skew runs under -P (no ModuleNotFoundError)", r.returncode == 0 and "ModuleNotFoundError" not in r.stderr,
      (r.stderr or "")[:120])
try:
    ang = json.loads(r.stdout.strip())
    check("region.py --skew returns valid JSON with an 'angle'", isinstance(ang, dict) and "angle" in ang, r.stdout[:80])
except Exception as e:
    check("region.py --skew returns valid JSON with an 'angle'", False, f"{e}: {r.stdout[:80]!r}")

# 2) region_worker.py under -P must reach readiness (which only prints AFTER region_core imports).
p = subprocess.Popen([sys.executable, "-P", WORKER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.PIPE, text=True)
try:
    first = p.stdout.readline()          # emitted right after the import succeeds
finally:
    try: p.stdin.close()
    except Exception: pass
    try: p.wait(timeout=10)
    except Exception: p.kill()
err = (p.stderr.read() or "") if p.stderr else ""
check("region_worker.py imports region_core under -P (prints ready)",
      first.strip() == json.dumps({"ready": True}), f"first={first!r} err={err[:120]!r}")
check("region_worker.py did not crash on import under -P", "ModuleNotFoundError" not in err, err[:120])

print(f"\n{'PASS' if not fails else 'FAIL'} — {fails} failure(s)")
sys.exit(1 if fails else 0)
