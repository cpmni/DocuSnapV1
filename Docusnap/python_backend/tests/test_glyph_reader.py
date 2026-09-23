"""PIN — glyph_reader (S0 of the PP-OCR confusable slice-fallback).

Locks the load-bearing S0 guarantees so a future change can't silently break them:
 1. FAIL-SAFE: when the engine can't run (onnxruntime absent / no model), read_crop
    returns None and never raises — the pipeline degrades to Tesseract-only.
 2. NEVER RAISES on garbage input (tiny/empty/odd crops).
 3. DETERMINISM (Oracle C5): if the engine IS available, the same crop reads
    byte-identical (string AND confidence) across repeated calls — the value is
    persisted into the corroboration record, so drift would poison it.

Run: PYTHONIOENCODING=utf-8 py -3.12 -m tests.test_glyph_reader   (from python_backend/)
CI-safe: the determinism assertions are skipped (not failed) when the model/onnxruntime
isn't present in the environment; the fail-safe assertions always run.
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ocr import glyph_reader


def _synth_crop(text="PI/26", w=180, h=40):
    img = Image.new("L", (w, h), color=255)
    d = ImageDraw.Draw(img)
    d.text((6, 8), text, fill=0)
    return img


def test_unavailable_is_safe():
    """If onnxruntime/model absent, read_crop returns None (never raises)."""
    if glyph_reader.available():
        return  # covered by the determinism test below
    assert glyph_reader.read_crop(_synth_crop()) is None


def test_garbage_never_raises():
    for bad in (Image.new("L", (1, 1)), Image.new("RGB", (2, 1)),
                np.zeros((1, 1), dtype=np.uint8)):
        try:
            r = glyph_reader.read_crop(bad)
        except Exception as e:  # pragma: no cover
            raise AssertionError(f"read_crop raised on garbage: {e!r}")
        assert r is None or (isinstance(r, tuple) and len(r) == 3)


def test_deterministic_when_available():
    """Same crop → byte-identical (text, conf) across calls. Skipped if no engine."""
    if not glyph_reader.available():
        print("  [skip] engine unavailable (no onnxruntime/model) — determinism not exercised")
        return
    crop = _synth_crop("PI/26/7656")
    r1 = glyph_reader.read_crop(crop)
    r2 = glyph_reader.read_crop(crop)
    assert r1 is not None and r2 is not None
    assert r1[0] == r2[0], f"text drift: {r1[0]!r} vs {r2[0]!r}"
    assert r1[1] == r2[1], f"conf drift: {r1[1]!r} vs {r2[1]!r}"
    assert r1[2] == r2[2], f"glyph-min drift: {r1[2]!r} vs {r2[2]!r}"


def test_output_shape_contract():
    """When it returns a value it is (str, float in 0..1, float in 0..1) with min <= mean
    (the third element is the weakest kept glyph — Oracle C1 for the confusable RELEASE)."""
    if not glyph_reader.available():
        return
    r = glyph_reader.read_crop(_synth_crop("H574240856"))
    assert r is None or (isinstance(r[0], str) and 0.0 <= float(r[1]) <= 1.0
                         and 0.0 <= float(r[2]) <= float(r[1]) + 1e-9)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  ok {fn.__name__}")
    print(f"\n{passed}/{len(fns)} passed  (engine available: {glyph_reader.available()})")
