"""
ocr/region_core.py
------------------
Pure, importable focused-crop OCR — the image->result logic shared by the region.py CLI (cold spawn
per draw) and, from Slice 2, the warm OCR worker, so BOTH read byte-identically. Extracted verbatim
from region.py (2026-07-16, draw-tool UX plan Slice 0). No process/CLI/base64/skew concerns here —
the caller loads the image and prints/serialises the returned dict.

STATELESS per call (no module-level caches carried between crops) — this is the load-bearing
invariant for the warm worker (a cached-last-read would cross-contaminate draws). Do not add one.
"""

import os
import pytesseract
from PIL import Image, ImageFilter, ImageOps

# Slice 1 kill switch: on a single-line PLAIN-text crop, skip the PSM-6 multi-line re-segmentation
# (byte-identical — the rebuild only fires at >=2 lines). Env-overridable; default ON.
SINGLELINE_FAST = os.environ.get("DS_OCR_SINGLELINE_FAST", "1") != "0"


def _strip_horizontal_rules(img):
    """Remove near-full-width thin horizontal RULES (an underline under a caption, a table rule, a
    fill-in line) that FUSE with glyph baselines at low DPI and garble OCR — the ⊕ teach reads the
    108-DPI preview, where the underline under "Site / Customer" merged into the letters and read as
    "one f Lustomer". GATED: alters the image only when such a rule is actually found (byte-identical
    otherwise). Length-based, so a glyph stroke, a single "/" and an underscore inside a code are all
    SHORT and preserved — only a rule spanning >=55% of the crop width is erased. scipy.ndimage (BSD,
    already bundled — see ocr/text_enhance.py) + numpy are imported LAZILY so the common no-rule path
    and any non-scipy caller pay nothing. Any failure returns the faithful original — never worse than
    today. (oscar-designed, Oracle-signed 2026-07-10; guarded by tests/test_strip_rules.py.)"""
    try:
        import numpy as np
        from scipy import ndimage
    except Exception:
        return img
    try:
        a = np.asarray(img.convert('L'))
        H, W = a.shape
        dark = a < max(80, int(a.mean()) - 25)                              # dark ink on a bright crop
        L = max(20, int(0.55 * W))                                          # a "rule" spans >= 55% of the width
        lines = ndimage.binary_opening(dark, structure=np.ones((1, L), bool))   # keep ONLY long horizontal runs
        if int(lines.sum()) < L:
            return img                                                      # no rule found -> unchanged
        # A full-width line HUGGING the crop's top/bottom edge is a BOX BORDER, not an underline
        # fused into glyph baselines — and erasing a border demonstrably flips a clean read to
        # EMPTY (test_region_light_first's bordered textured crop read "Serial number" raw, ''
        # stripped; found 2026-07-10). Leave edge bands alone; a real fused rule sits mid-crop.
        m = max(3, int(round(H * 0.06)))
        lines[:m, :] = False
        lines[H - m:, :] = False
        if int(lines.sum()) < L:
            return img                                                      # only borders found -> unchanged
        lines = ndimage.binary_dilation(lines, structure=np.ones((3, 1), bool))  # +1px vertical for the anti-alias halo
        out = a.copy()
        out[lines] = 255                                                    # paint the rule to background
        return Image.fromarray(out, 'L')
    except Exception:
        return img


def _looks_unreadable_sliver(img):
    """True when the crop's ink is confined to a hairline band (<5 px tall, PRE-upscale): the
    bottom pixel-tips of a caption CLIPPED by a mis-sized label strip, or a bare underline/rule.
    Such a crop contains no readable text, but OCR happily HALLUCINATES words from it — the ⊕
    teach's one-line above-strip clipped "Site / Customer" to its bottom 3 rows and the readout
    showed "eee F WS CwE ewe" (2026-07-10). Real text at the 108-DPI preview spans >=6 px even at
    small print, so a <5 px band is never a legitimate value or caption — report "nothing
    readable" and let the caller take its safe no-label/position-only path instead of junk.
    Rows with <2 dark px are ignored as speckle; a blank crop is NOT a sliver (the ladder already
    returns empty faithfully). Fail-open: any failure -> False (read exactly as today)."""
    try:
        import numpy as np
        a = np.asarray(img.convert('L'))
        if a.ndim != 2 or a.size == 0:
            return False
        dark = a < max(80, int(a.mean()) - 25)
        rows = np.flatnonzero(dark.sum(axis=1) >= 2)
        if rows.size == 0:
            return False
        return int(rows[-1] - rows[0] + 1) < 5
    except Exception:
        return False


def _ink_band_count(img):
    """Slice 1 helper: count SEPARATED horizontal ink bands (runs of inked rows split by blank
    rows). <=1 band => the crop is a single text line, so the PSM-6 multi-line re-segmentation
    (which only rebuilds `text` at >=2 detected lines) cannot change the plain-text output and can
    be skipped byte-identically. A blank gap between two text lines (normal line spacing) makes 2+
    bands, so a genuine multi-line value is NEVER mis-classed as single. Fail-safe: any error -> 2
    (assume multi-line = keep the PSM-6 pass = today's behaviour)."""
    try:
        import numpy as np
        a = np.asarray(img.convert('L'))
        if a.ndim != 2 or a.size == 0:
            return 2
        dark = a < max(80, int(a.mean()) - 25)
        inked = dark.sum(axis=1) >= 2                      # a row with >=2 dark px is "inked" (matches the sliver gate)
        bands, prev = 0, False
        for r in inked:
            if r and not prev:
                bands += 1
            prev = bool(r)
        return bands
    except Exception:
        return 2


def process(img, *, boxes=False, singleline_fast=None, timing=None):
    """Focused OCR of an already-loaded greyscale ('L') PIL crop. Returns
    {"text": str, "box": [l,t,w,h]|None, "words": [...], "lines": int} with box/words in the caller's
    ORIGINAL (pre-upscale) crop pixels. Byte-identical to region.py's pre-refactor OCR path.

    singleline_fast (Slice 1): skip the PSM-6 multi-line pass on a single-line PLAIN-text crop
    (never on the --boxes path, which needs the word boxes). None -> the module SINGLELINE_FAST /
    DS_OCR_SINGLELINE_FAST switch. timing: optional callable(label) called at each stage (perf hook)."""
    if singleline_fast is None:
        singleline_fast = SINGLELINE_FAST
    _t = timing if callable(timing) else (lambda *a: None)

    # SLIVER GATE (pre-upscale): a hairline ink band has no readable text — OCR would invent
    # words from glyph tips / underline dashes. Empty output = the caller's safe fallback.
    if _looks_unreadable_sliver(img):
        return {"text": "", "box": None, "words": [], "lines": 1}

    # Upscale small crops for better accuracy. Track the factor so --boxes can map word boxes back to
    # the caller's ORIGINAL crop coordinates. Same scale for the light and heavy rungs below.
    w, h = img.size
    scale = 1
    if w < 300:
        scale = max(2, 300 // max(1, w))
        img = img.resize((w * scale, h * scale), Image.LANCZOS)
    _t('upscale')

    # LIGHT-FIRST OCR ladder — mirrors extraction's anchor._crop_and_ocr ladder so an
    # interactively-drawn box reads the SAME as extraction reads. Read LIGHT first (greyscale +
    # upscale only, NO autocontrast/sharpen) and escalate to the heavy recipe ONLY when the light
    # read is empty. First non-empty rung wins, light preferred.
    light = _strip_horizontal_rules(img)         # remove a fused underline/rule that garbles OCR (else faithful)
    heavy = None
    chosen, text = light, ''
    for src, psm in (('light', 7), ('light', 6), ('heavy', 7), ('heavy', 6)):
        if src == 'heavy' and heavy is None:
            heavy = ImageOps.autocontrast(light, cutoff=2).filter(ImageFilter.SHARPEN)
        rimg = light if src == 'light' else heavy
        t = pytesseract.image_to_string(rimg, config=f'--oem 3 --psm {psm}').strip()
        if t:
            chosen, text = rimg, t
            break
    _t('ladder')

    # MULTI-LINE AWARE: a drawn box can cover a value that WRAPS onto 2+ lines. PSM 7 wins the ladder
    # but MANGLES a multi-line crop into one garbled line, so re-segment the CHOSEN image with PSM 6
    # (block mode) and rebuild line-by-line when genuinely multi-line. A single-line crop keeps the
    # ladder text — byte-identical. The PSM-6 data is computed once here and REUSED by --boxes below.
    # SLICE 1: on the PLAIN-text path (boxes=False), a single-line crop (<=1 ink band) cannot have its
    # text changed by this pass (the rebuild only fires at len(seg)>=2), so skip it entirely — one
    # fewer tesseract run, byte-identical. The --boxes path ALWAYS runs it (word boxes need data6).
    data6 = None
    mline = 1   # detected line count (for --boxes consumers, e.g. the ⊕ tall-box auto-rule)
    _skip_multiline = (singleline_fast and not boxes and bool(text) and _ink_band_count(chosen) <= 1)
    if not _skip_multiline:
        try:
            data6 = pytesseract.image_to_data(chosen, config='--oem 3 --psm 6',
                                              output_type=pytesseract.Output.DICT)
            groups = {}
            for i in range(len(data6.get('text', []))):
                t6 = (data6['text'][i] or '').strip()
                try: cf6 = float(data6['conf'][i])
                except Exception: cf6 = -1.0
                if not t6 or cf6 < 0:
                    continue
                k6 = (data6['block_num'][i], data6['par_num'][i], data6['line_num'][i])
                g6 = groups.get(k6)
                if g6 is None:
                    groups[k6] = {'w': [t6], 'top': data6['top'][i]}
                else:
                    g6['w'].append(t6); g6['top'] = min(g6['top'], data6['top'][i])
            seg = [' '.join(g6['w']) for g6 in sorted(groups.values(), key=lambda g: g['top'])]
            seg = [s for s in seg if len(s) >= 2]          # ignore stray 1-char noise "lines"
            mline = max(1, len(seg))
            if len(seg) >= 2:
                text = ' '.join(seg)
        except Exception:
            data6 = None
    _t('multiline')

    # Clean up common OCR artifacts
    text = text.replace('\n', ' ').replace('\r', '').strip()

    box = None
    words = []   # per-word boxes (pre-upscale px) so a caller can split columns
    if boxes:
        try:
            data = data6 if data6 is not None else pytesseract.image_to_data(
                chosen, config='--oem 3 --psm 6', output_type=pytesseract.Output.DICT)
            xs, ys, x2s, y2s = [], [], [], []
            for i in range(len(data.get('text', []))):
                wtok = (data['text'][i] or '').strip()
                if not wtok:
                    continue
                xs.append(data['left'][i]); ys.append(data['top'][i])
                x2s.append(data['left'][i] + data['width'][i])
                y2s.append(data['top'][i] + data['height'][i])
                # Each word mapped back to the caller's ORIGINAL (pre-upscale) px.
                words.append({"text": wtok,
                              "box": [data['left'][i] / scale, data['top'][i] / scale,
                                      data['width'][i] / scale, data['height'][i] / scale]})
            if xs:
                l, t = min(xs) / scale, min(ys) / scale
                bw, bh = (max(x2s) - min(xs)) / scale, (max(y2s) - min(ys)) / scale
                box = [l, t, bw, bh]
        except Exception:
            box = None
    _t('boxes')

    return {"text": text, "box": box, "words": words, "lines": mline}
