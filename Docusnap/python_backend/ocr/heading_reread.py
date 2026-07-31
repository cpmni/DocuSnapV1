"""
ocr/heading_reread.py
---------------------
BANNER HEADING RE-READ — recover a garbled document heading so TYPE detection can see it.
TWO rungs, both caller-gated to "the main pass produced no trusted heading":

RUNG 1 (RED, BANNER_HEADING_REREAD, ON since 07-16): a stylised RED banner (big-red
"WORKSHEET"). Design: docs/designs/BANNER_HEADING_REREAD_2026-07-16.md. The full-page pass
OCRs through Tesseract's luminance greyscale which UNDERWEIGHTS red — strokes break at Otsu
("WORKSH = ET"). The red channel (clip(R - max(G,B))) renders the banner full-contrast and
recovers the real word.

RUNG 2 (GENERAL, HEADING_BAND_REREAD, 2026-07-31 herald→Oracle SIGN-OFF-W/COND): ANY-colour
banner garbled by the FULL-PAGE pass itself. Proven mechanism (herald, doc 180 @200 DPI):
PSM-3 fragments a tracked banner and reconstruct_page_text's PSM-6 supp merge DOUBLES tokens
(a supp box centred in the inter-fragment gap dodges _center_in_any) → "PURCHASE PU RC HASE
Oo RDER" → detection reads a wrong type at low conf → title_trusted=False → the whole
heading-authority net disarms. A SINGLE-PASS re-read of just the banner band sidesteps the
supp-merge doubling BY CONSTRUCTION (there is no second pass to merge) — the same 200-DPI
pixels read "PURCHASE ORDER" verbatim. Pre-gated by GEOMETRY PROMINENCE (no OCR, Oracle A2):
the fresh page-0 word geometry must show banner-height type in the TOP band — the
top-fraction constraint keeps the mid-body leftmost-column class (the reason TYPE_REFUSE_HOLD
exists) out of reach.

ADOPTION (both rungs — Oracle A1): exclusively through the INJECTED detect_fn
(keyword.detect_document_type) — exact alias + despaced heading + the Oracle-gated Lever-1
fuzzy (HEADING_FUZZY_VOCAB) all live THERE; this module adds NO matcher of its own.
(⚠ stale-claim correction 2026-07-31: earlier wording here said "no fuzzy match" — the
injected matcher HAS carried the gated Lever-1 fuzzy since 07-26. The invariant that holds:
no NEW matching surface is introduced by this module.)

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
    COPY of ocr_text (COLUMN_BREAK intact, Oracle C5) and re-scored — no NEW matching surface is
    introduced here (exact + despaced + the gated Lever-1 fuzzy all live inside detect_fn), so a
    genuine other-type banner recovers as its OWN type, never spuriously as the worksheet type.

    The CALLER owns the fire policy (kill switch, "main pass had no trusted heading", page-0
    provenance 'ocr') so this helper does the minimum, testable core."""
    band = recover_heading_band(page_image)
    if not band:
        return None
    aug = detect_fn(band + "\n" + (ocr_text or ""), known_types, type_aliases)
    if aug and aug.get("heading") and aug.get("confidence", 0) >= 70:
        return aug
    return None


# ── RUNG 2: GENERAL TITLE-BAND RE-READ (2026-07-31; herald→Oracle SIGN-OFF-W/COND) ────────
_BAND_PROMINENCE = 1.8    # a banner word is ≥ this × med_h (banner-height type, not body text)
_BAND_TOP_FRAC   = 0.30   # its TOP must sit in this fraction of the page (Oracle A2: the falsely-
                          # trusted MID-BODY leftmost-column class must stay out of reach)
_BAND_PAD_FRAC   = 0.45   # vertical pad around the banner rows, fraction of the banner height


def find_prominent_heading_band(geom, page_h=None):
    """GEOMETRY PROMINENCE PRE-GATE (NO OCR — Oracle A2's cheap gate for the colour-agnostic rung,
    the analogue of rung 1's redness gate). `geom` = the fresh page-0 words_out hand-off
    ({'words': [(l,t,w,h,text,conf)], 'med_h', 'size'}). Returns (y0, y1) page-px crop bounds
    around the tallest TOP-BAND banner-height word rows, or None (no prominent top heading — do
    nothing; a cached reprocess / born-digital page 0 has no geometry and is honestly inert).
    PURE — unit-pinned in tests/test_heading_band_reread.py."""
    try:
        words = (geom or {}).get('words') or []
        med_h = float((geom or {}).get('med_h') or 0)
        size  = (geom or {}).get('size')
        H = float(page_h or (size[1] if size else 0))
        if not words or med_h <= 0 or H <= 0:
            return None
        top_limit = H * _BAND_TOP_FRAC
        floor_h = med_h * _BAND_PROMINENCE
        cand = [(t, t + h, h) for (l, t, w, h, _txt, _c) in
                [wd[:6] for wd in words]
                if h >= floor_h and t <= top_limit]
        if not cand:
            return None
        band_h = max(h for (_t0, _t1, h) in cand)
        y0 = min(t0 for (t0, _t1, _h) in cand)
        y1 = max(t1 for (_t0, t1, _h) in cand)
        pad = band_h * _BAND_PAD_FRAC
        return (max(0.0, y0 - pad), min(H, y1 + pad))
    except Exception:
        return None


def recover_heading_band_general(page_image, band_bounds, *, dpi: int = _RENDER_DPI,
                                 min_conf: float = _MIN_WORD_CONF):
    """SINGLE-PASS re-read of the geometry-located banner band (rung 2). Single-pass sidesteps the
    PSM-3 + supp-merge token DOUBLING by construction — there is no second pass to merge. Greyscale
    with the SAME light-touch rules as rung 1 (upscale a short band, gentle autocontrast, no global
    threshold/sharpen); PSM ladder 6→7→11, first read whose words survive the conf floor wins
    (herald's recipe matrix: all three recover the doc-180 banner verbatim at the live 200 DPI).
    Returns the recovered text or None (fail toward the caller's original detection)."""
    try:
        if page_image is None or not band_bounds:
            return None
        w, h = page_image.size
        y0, y1 = int(band_bounds[0]), int(band_bounds[1])
        if w < 4 or y1 - y0 < 4:
            return None
        band = page_image.crop((0, y0, w, y1)).convert('L')
        if band.height < _UPSCALE_MAX_H:
            band = band.resize((int(band.width * _UPSCALE_FACTOR), int(band.height * _UPSCALE_FACTOR)),
                               Image.LANCZOS)
        band = ImageOps.autocontrast(band, cutoff=2)
        for psm in (6, 7, 11):
            data = pytesseract.image_to_data(band, config=_with_dpi(f"--oem 3 --psm {psm}", dpi),
                                             output_type=pytesseract.Output.DICT)
            words = [wd for wd in _words_from_data(data) if wd[5] >= min_conf]
            if not words:
                continue
            heights = sorted(wd[3] for wd in words if wd[3] > 0)
            med_h = heights[len(heights) // 2] if heights else 10
            text = "\n".join(l for l in _group_words_into_lines(words, med_h) if l.strip())
            if text:
                return text
        return None
    except Exception:
        return None


def recover_type_detection_general(page_image, geom, ocr_text, known_types, type_aliases, detect_fn):
    """Rung-2 counterpart of recover_type_detection: geometry pre-gate → single-pass band re-read →
    the SAME adoption contract (detect_fn only — Oracle A1 — and adopt only heading=True AND
    conf >= 70, the exact pair title_trusted_fresh consumes). None on every doubtful path."""
    bounds = find_prominent_heading_band(geom, page_h=(page_image.size[1] if page_image is not None else None))
    if not bounds:
        return None
    band = recover_heading_band_general(page_image, bounds)
    if not band:
        return None
    aug = detect_fn(band + "\n" + (ocr_text or ""), known_types, type_aliases)
    if aug and aug.get("heading") and aug.get("confidence", 0) >= 70:
        return aug
    return None
