"""
ocr/text_enhance.py — heavier preprocessing for DEGRADED text-line crops.

The shared crop recipe (greyscale -> upscale -> autocontrast -> SHARPEN -> PSM 7)
is tuned for tight, high-contrast numeric tokens. On a degraded/shadowed scan a
longer proper-noun line (e.g. a company name in a "Work Address" block) gets
MANGLED by it — the fixed SHARPEN kernel amplifies paper/scan noise into letter-
shaped fragments ("Beaumont Care Homes" -> "pe fomes"), and a single global
autocontrast can't cope with an uneven background. The mangled read is then
(correctly) rejected by the credibility/format gate, so the field comes back
empty.

This module provides the alternative recipe Oscar specified for that case:
  greyscale -> height-driven upscale -> median denoise -> Sauvola ADAPTIVE
  threshold -> mild UnsharpMask (threshold'd, so it doesn't re-amplify noise).

It is applied ONLY to free-text fields and ONLY when the base read failed its
gate (see anchor._crop_and_ocr), so numeric/clean/label/wizard paths are
untouched.

Pure NumPy (BSD) + SciPy.ndimage (BSD) + Pillow (MIT-CMU/HPND) — all bundled,
all free for commercial use. No OpenCV.
"""

import numpy as np
from PIL import Image, ImageFilter


def _sauvola_threshold(arr, window, k=0.34, R=128.0):
    """Sauvola adaptive binarisation: threshold follows the LOCAL background, so
    a line under a shadow/gradient (where a global Otsu/autocontrast leaves part
    muddy) still separates cleanly. T = mean * (1 + k*(std/R - 1)) over a window
    sized to the text height. Pure NumPy + scipy.ndimage."""
    from scipy.ndimage import uniform_filter
    a = arr.astype(np.float64)
    mean = uniform_filter(a, size=window, mode="reflect")
    sq   = uniform_filter(a * a, size=window, mode="reflect")
    std  = np.sqrt(np.clip(sq - mean * mean, 0.0, None))
    thresh = mean * (1.0 + k * (std / R - 1.0))
    return ((a > thresh).astype(np.uint8) * 255)


def enhance_text_crop(pil_img):
    """Return a denoised, adaptively-binarised, mildly-sharpened greyscale image
    for a degraded text line. Defensive: any failure falls back to a plain
    greyscale upscale so the caller still gets a usable image."""
    img = pil_img.convert("L")
    w, h = img.size
    if w < 2 or h < 2:
        return img
    # Height-driven upscale: aim the text line at a healthy cap height for the
    # LSTM engine (it wants ~30-40px); a long line is often wide but short.
    scale = 3 if h < 80 else 2
    img = img.resize((w * scale, h * scale), Image.LANCZOS)
    try:
        from scipy.ndimage import median_filter
        arr = np.asarray(img)
        arr = median_filter(arr, size=3)              # kill salt-and-pepper speckle
        # Sauvola window ~ the text height (odd), clamped to a sane range.
        win = max(15, min(81, (img.size[1] // 2) | 1))
        binimg = _sauvola_threshold(arr, window=win)
        out = Image.fromarray(binimg.astype(np.uint8), mode="L")
    except Exception:
        out = img
    # Mild, THRESHOLD'd unsharp — only sharpens real edges, leaves low-contrast
    # noise alone (unlike the bare SHARPEN kernel the base recipe uses).
    try:
        out = out.filter(ImageFilter.UnsharpMask(radius=1.5, percent=110, threshold=3))
    except Exception:
        pass
    return out
