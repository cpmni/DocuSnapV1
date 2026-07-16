"""
ocr/heading_reread.py
---------------------
BANNER HEADING RE-READ — recover a stylised RED document heading (e.g. a big-red
"WORKSHEET" banner) that the main greyscale OCR pass garbles, so document-TYPE detection
can see it. Design + Oracle conditions: docs/designs/BANNER_HEADING_REREAD_2026-07-16.md.

WHY. The full-page pipeline OCRs the raw RGB render through Tesseract's internal luminance
greyscale (L ≈ 0.299·R + 0.587·G + 0.114·B), which UNDERWEIGHTS red — a bright-red banner
maps to only moderate darkness, so its strokes break up at Otsu and OCR reads garbage
("WORKSH = ET", "WO RKS MH Ee ET"). detect_document_type then never matches the type's
alias -> heading=False -> title_trusted=False, and the whole 2026-07-15 heading-authority
net (template TYPE-REFUSE / sibling-STAMP suppression) is disarmed, so the type falls to a
same-logo sibling. The RED CHANNEL is clean: isolating red (clip(R - max(G,B))) renders the
banner as full-contrast dark-on-white and recovers the REAL word, which then hits the
EXISTING exact-alias matcher in keyword.detect_document_type. Because it recovers the real
glyphs (no fuzzy match), it adds NO new false-positive surface.

SCOPE. A single targeted TYPE-ONLY re-read of the TOP BAND of page 0, run by the caller
(process_docs.py) ONLY when the main pass produced no trusted heading. Empirically proven
(design recipe (d)): recovered the exact "WORKSHEET" on the worst garble AND kept a clean
control clean.

FAIL-SAFE. Returns None on anything doubtful — no red mark in the band (Oracle C1 cheap
pre-gate, so the OCR pass + the false-positive surface are confined to red-banner docs); a
non-RGB / greyscale-raster page (Oracle C4 — no red channel to isolate, an honest inert
recall gap, not a covered case); no word surviving the conf floor; or any error. The caller
then keeps the original detection (today's review-hold). Kill switch (in the caller):
BANNER_HEADING_REREAD.

Dependency-free beyond the already-bundled stack: Pillow (MIT/HPND), NumPy (BSD-3),
pytesseract (Apache-2.0). No OpenCV, no PyMuPDF, no new dependency.
"""

import numpy as np
from PIL import Image, ImageOps

import pytesseract

from ocr.tesseract import _words_from_data, _group_words_into_lines, _with_dpi, _RENDER_DPI

# ── Tunable constants (owner-adjustable; see the design doc's "open decisions"). ──────────
_TOP_BAND_FRAC  = 0.28    # fraction of page height treated as the heading band
_MIN_WORD_CONF  = 60.0    # image_to_data word-conf floor; below this the band is still garbled
_UPSCALE_MAX_H  = 400     # upscale the band when shorter than this (px) so glyphs stay legible
_UPSCALE_FACTOR = 2.0
# Oracle C1 redness PRE-GATE (NO OCR): the band must carry a real red mark or we do nothing,
# confining both the extra OCR cost AND the false-positive surface to red-banner docs.
_REDNESS_MIN    = 80      # per-pixel clip(R - max(G,B)) that counts as "red ink"
_RED_AREA_MIN   = 0.0006  # fraction of band pixels that must be red for the re-read to run


def _as_rgb(img):
    """Return an RGB view of `img`, or None when it carries NO colour information.

    A genuine greyscale raster (mode 'L'/'1'/'I'/'F') has no red channel to isolate, so the
    re-read is inert on it (Oracle C4 — an honest recall gap, handled explicitly rather than
    relying on the swallowing try/except). RGBA/P/LA carry colour and are converted."""
    if img is None:
        return None
    mode = getattr(img, "mode", None)
    if mode == "RGB":
        return img
    if mode in ("RGBA", "P", "LA"):
        try:
            return img.convert("RGB")
        except Exception:
            return None
    return None   # 'L', '1', 'I', 'F' — greyscale, no colour -> inert


def _redness(rgb: np.ndarray) -> np.ndarray:
    """Per-pixel redness = clip(R - max(G,B), 0, 255) as uint8. Red ink -> high; black/grey/white
    -> ~0 (which is why BLACK body text and captions vanish, leaving the red banner alone)."""
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    return np.clip(r - np.maximum(g, b), 0, 255).astype(np.uint8)


def has_red_banner(page_image, top_band_frac: float = _TOP_BAND_FRAC) -> bool:
    """Cheap Oracle-C1 pre-gate (NO OCR): does the top band carry a prominent red mark? Fail-safe
    False on any non-RGB input or error, so a greyscale-raster scan skips the re-read entirely."""
    try:
        rgb = _as_rgb(page_image)
        if rgb is None:
            return False
        w, h = rgb.size
        band = rgb.crop((0, 0, w, max(1, int(h * top_band_frac))))
        red = _redness(np.asarray(band))
        return float((red >= _REDNESS_MIN).mean()) >= _RED_AREA_MIN
    except Exception:
        return False


def recover_heading_band(page_image, *, dpi: int = _RENDER_DPI,
                         top_band_frac: float = _TOP_BAND_FRAC,
                         min_conf: float = _MIN_WORD_CONF):
    """Red-isolate + OCR the TOP BAND of a RAW RGB page-0 image; return the recovered clean
    heading line(s) as text (COLUMN_BREAK preserved via _group_words_into_lines — Oracle C5), or
    None. See the module docstring for the fail-safe cases.

    The caller prepends the returned text to a COPY of the page's ocr_text and re-runs
    detect_document_type; the EXISTING exact-alias matcher decides the type (no fuzzy here)."""
    try:
        rgb = _as_rgb(page_image)
        if rgb is None:
            return None                         # C4: no red channel -> inert
        w, h = rgb.size
        if w < 4 or h < 4:
            return None
        band = rgb.crop((0, 0, w, max(1, int(h * top_band_frac))))
        red = _redness(np.asarray(band))
        if float((red >= _REDNESS_MIN).mean()) < _RED_AREA_MIN:
            return None                         # C1: no red mark -> skip the OCR pass entirely
        # Red ink -> dark, everything else (incl. BLACK body text / captions) -> white.
        iso = Image.fromarray(255 - red, mode="L")
        # Light touch ONLY: upscale a short band so glyphs are legible, then gentle autocontrast.
        # NO global threshold and NO sharpen kernel — both re-break the already-thin strokes.
        if iso.height < _UPSCALE_MAX_H:
            iso = iso.resize((int(iso.width * _UPSCALE_FACTOR), int(iso.height * _UPSCALE_FACTOR)),
                             Image.LANCZOS)
        iso = ImageOps.autocontrast(iso, cutoff=2)
        data = pytesseract.image_to_data(iso, config=_with_dpi("--oem 3 --psm 3", dpi),
                                         output_type=pytesseract.Output.DICT)
        words = [wd for wd in _words_from_data(data) if wd[5] >= min_conf]
        if not words:
            return None                         # still garbled below the conf floor -> contribute nothing
        heights = sorted(wd[3] for wd in words if wd[3] > 0)
        med_h = heights[len(heights) // 2] if heights else 10
        text = "\n".join(l for l in _group_words_into_lines(words, med_h) if l.strip())
        return text or None
    except Exception:
        return None


def recover_type_detection(page_image, ocr_text, known_types, type_aliases, detect_fn):
    """Recover a garbled RED heading and RE-DETECT the document type through the SAME exact-alias
    matcher. Returns a NEW detection dict to ADOPT (only when it now carries a TRUSTED heading —
    heading is True AND confidence >= 70, the exact pair title_trusted_fresh consumes), or None to
    keep the caller's original detection (fail toward review).

    `detect_fn(text, known_types, type_aliases)` is engine.detect_document_type, INJECTED so this
    stays engine-agnostic and unit-testable. The recovered band is PREPENDED as the top line(s) of a
    COPY of ocr_text (COLUMN_BREAK intact, Oracle C5) and re-scored — no fuzzy matching is introduced,
    so a genuine other-type banner recovers as its OWN type, never spuriously as the worksheet type.

    The CALLER owns the fire policy (kill switch, "main pass had no trusted heading", page-0
    provenance 'ocr') so this helper does the minimum, testable core."""
    band = recover_heading_band(page_image)
    if not band:
        return None
    aug = detect_fn(band + "\n" + (ocr_text or ""), known_types, type_aliases)
    if aug and aug.get("heading") and aug.get("confidence", 0) >= 70:
        return aug
    return None
