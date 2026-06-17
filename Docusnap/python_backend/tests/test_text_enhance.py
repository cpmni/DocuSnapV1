#!/usr/bin/env python3
"""
tests/test_text_enhance.py — the degraded-text-crop preprocessing (Variant A).
Pure image math (NumPy/SciPy/Pillow); no Tesseract. Verifies the recipe runs,
upscales, binarises adaptively, and degrades gracefully on tiny/odd inputs.

Usage:  py -3.12 python_backend/tests/test_text_enhance.py
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent.parent))
from ocr import text_enhance  # noqa: E402


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def test_sauvola_binary():
    failures = 0
    print("Sauvola threshold: returns a binary {0,255} field that follows local bg")
    # A gradient background (left dark -> right light) with a darker stripe: a
    # global threshold would mis-split it; Sauvola should binarise to {0,255}.
    g = np.tile(np.linspace(40, 210, 120).astype(np.uint8), (40, 1))
    g[15:25, :] = np.clip(g[15:25, :].astype(int) - 60, 0, 255)  # a darker text-ish band
    out = text_enhance._sauvola_threshold(g, window=15)
    uniq = set(np.unique(out).tolist())
    if not check(f"output is binary {{0,255}} (got {sorted(uniq)})", uniq <= {0, 255}):
        failures += 1
    if not check("output keeps the image shape", out.shape == g.shape):
        failures += 1
    print()
    return failures


def test_enhance_runs_and_upscales():
    failures = 0
    print("enhance_text_crop: runs, returns an upscaled greyscale image")
    img = Image.fromarray(
        np.random.default_rng(0).integers(0, 255, (30, 200), dtype=np.uint8), mode="L")
    out = text_enhance.enhance_text_crop(img)
    if not check("returns an L-mode image", out.mode == "L"):
        failures += 1
    if not check(f"upscaled (out {out.size} > in {img.size})",
                 out.size[0] > img.size[0] and out.size[1] > img.size[1]):
        failures += 1
    # Short line -> 3x upscale path.
    if not check("short line uses 3x upscale", out.size[0] == 200 * 3):
        failures += 1
    print()
    return failures


def test_degrades_gracefully():
    failures = 0
    print("enhance_text_crop: tiny / odd inputs never raise")
    for sz in ((1, 1), (1, 50), (3, 3)):
        try:
            o = text_enhance.enhance_text_crop(Image.new("L", sz, 128))
            ok = o is not None
        except Exception as e:
            ok = False
            print(f"     raised on {sz}: {e}")
        if not check(f"size {sz} handled", ok):
            failures += 1
    # An RGB input is converted, not rejected.
    if not check("RGB input accepted (converted to L)",
                 text_enhance.enhance_text_crop(Image.new("RGB", (120, 30), (200, 200, 200))).mode == "L"):
        failures += 1
    print()
    return failures


def main():
    failures = 0
    failures += test_sauvola_binary()
    failures += test_enhance_runs_and_upscales()
    failures += test_degrades_gracefully()
    if failures:
        print(f"{failures} check(s) failed — text_enhance regressed.")
        return 1
    print("All checks passed — text_enhance behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
