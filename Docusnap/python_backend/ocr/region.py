#!/usr/bin/env python3
"""
ocr_region.py — receives a base64 PNG via --image argument, runs focused OCR.
Called by Electron for zone-selection field picking in the review window.
"""
import sys
import argparse
import base64
import tempfile
import os
from io import BytesIO
import pytesseract
from PIL import Image, ImageFilter, ImageOps


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-file', required=True, help='Path to PNG file')
    parser.add_argument('--tesseract', default=None,  help='Path to tesseract.exe')
    # --boxes: emit JSON {"text":..., "box":[left,top,width,height]} where box is
    # the union of detected word boxes in ORIGINAL (pre-upscale) crop pixels. Used
    # by the ⊕ tool to capture the taught LABEL's position so a drift-invariant
    # label→value offset can be stored. Default (no flag) is unchanged: plain text.
    parser.add_argument('--boxes', action='store_true')
    # --skew: emit JSON {"angle": <deg>} — the page's detected skew (PIL CCW-positive, 0.0 when
    # < 0.2°). Used by the Review window to straighten the DISPLAYED page so drawn ⊕ boxes align
    # with the text (display-only; the filed original is untouched). No OCR — measure only.
    parser.add_argument('--skew', action='store_true')
    # --deskew: emit JSON {"angle": <deg>, "image": <base64 PNG of the straightened page | null>}.
    parser.add_argument('--deskew', action='store_true')
    args = parser.parse_args()

    if args.tesseract and os.path.exists(args.tesseract):
        pytesseract.pytesseract.tesseract_cmd = args.tesseract

    # Load image from file
    try:
        img = Image.open(args.image_file).convert('L')  # greyscale
    except Exception as e:
        print('', end='')
        return

    # --skew: measure the page's skew angle (no OCR) and return it. Display-deskew endpoint.
    if args.skew:
        import json
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # python_backend
        try:
            from ocr.tesseract import detect_skew_angle
            angle = float(detect_skew_angle(img))
        except Exception:
            angle = 0.0
        print(json.dumps({"angle": round(angle, 2)}), end='', flush=True)
        return

    # --deskew: return the STRAIGHTENED page as a base64 PNG + its angle, for the Review DISPLAY.
    # The rotation uses PIL's convention (img.rotate(angle), CCW-positive, expand=False so the dims
    # are UNCHANGED — zoom/pan and the drawn-box math stay valid). The renderer swaps docImg to this
    # so a drawn ⊕ box crops STRAIGHT text; it transforms the box back to the raw frame on save via
    # the SAME angle. Angle 0 / below-threshold -> {"angle":0,"image":null} (caller shows the raw).
    if args.deskew:
        import json
        import base64 as _b64
        from io import BytesIO
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        try:
            from ocr.tesseract import detect_skew_angle
            angle = float(detect_skew_angle(img))
        except Exception:
            angle = 0.0
        if abs(angle) < 0.2:
            print(json.dumps({"angle": 0.0, "image": None}), end='', flush=True)
            return
        try:
            orig = Image.open(args.image_file)                      # native mode (not the greyscale copy)
            fill = 255 if orig.mode in ('L', '1') else (255, 255, 255)
            rot  = orig.rotate(angle, expand=False, fillcolor=fill, resample=Image.BICUBIC)
            buf  = BytesIO(); rot.save(buf, format='PNG')
            print(json.dumps({"angle": round(angle, 2),
                              "image": _b64.b64encode(buf.getvalue()).decode('ascii')}), end='', flush=True)
        except Exception:
            print(json.dumps({"angle": 0.0, "image": None}), end='', flush=True)
        return

    # SLIVER GATE (pre-upscale): a hairline ink band has no readable text — OCR would invent
    # words from glyph tips / underline dashes. Empty output = the caller's safe fallback.
    if _looks_unreadable_sliver(img):
        if args.boxes:
            import json
            print(json.dumps({"text": "", "box": None, "words": [], "lines": 1}), end='', flush=True)
        else:
            print('', end='')
        return

    # Upscale small crops for better accuracy. Track the factor so --boxes can map
    # word boxes back to the caller's ORIGINAL crop coordinates. The scale is the
    # SAME for the light and heavy rungs below (heavy is derived from the upscaled
    # greyscale), so box mapping is unaffected by which rung wins.
    w, h = img.size
    scale = 1
    if w < 300:
        scale = max(2, 300 // max(1, w))
        img = img.resize((w * scale, h * scale), Image.LANCZOS)

    # LIGHT-FIRST OCR ladder — mirrors extraction's anchor._crop_and_ocr ladder so
    # an interactively-drawn box reads the SAME as extraction reads (the ⊕ tool,
    # Template Wizard read-back and Template Manager all come through here). The old
    # unconditional autocontrast(cutoff=2)+SHARPEN over-processes a clean, high-res
    # (e.g. born-digital) crop: PSM 7 then locks onto amplified rules/edges and
    # returns garbage or empty ("Serial number" -> "be_7"). So read LIGHT first
    # (greyscale + upscale only, NO autocontrast/sharpen) and escalate to the heavy
    # recipe ONLY when the light read is empty — heavy still crispens genuinely
    # degraded tight serials. First non-empty rung wins, light preferred.
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

    # MULTI-LINE AWARE: a drawn box can cover a value that WRAPS onto 2+ lines (e.g. a work
    # address "Beaumont Care Homes Ltd -" / "Jordanstown"). PSM 7 (single-line mode) wins the
    # ladder first but MANGLES a multi-line crop into one garbled line ("p sverablseti Care
    # Homes Ltd -"). So re-segment the CHOSEN image with PSM 6 (block mode); when it's
    # genuinely multi-line, rebuild the value line-by-line (top→bottom, joined by a space). A
    # single-line crop keeps the ladder text — byte-identical. The PSM-6 data is computed once
    # here and REUSED by --boxes below (no extra OCR pass for the box path).
    data6 = None
    mline = 1   # detected line count (for --boxes consumers, e.g. the ⊕ tall-box auto-rule)
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

    # Clean up common OCR artifacts
    text = text.replace('\n', ' ').replace('\r', '').strip()

    if args.boxes:
        import json
        box = None
        words = []   # per-word boxes (pre-upscale px) so a caller can split columns
        try:
            data = data6 if data6 is not None else pytesseract.image_to_data(
                chosen, config='--oem 3 --psm 6', output_type=pytesseract.Output.DICT)
            xs, ys, x2s, y2s = [], [], [], []
            for i in range(len(data.get('text', []))):
                w = (data['text'][i] or '').strip()
                if not w:
                    continue
                xs.append(data['left'][i]); ys.append(data['top'][i])
                x2s.append(data['left'][i] + data['width'][i])
                y2s.append(data['top'][i] + data['height'][i])
                # Each word mapped back to the caller's ORIGINAL (pre-upscale) px, so a
                # consumer (e.g. the ⊕ anchor capture) can cluster words by horizontal
                # gap and keep only the column nearest the value.
                words.append({"text": w,
                              "box": [data['left'][i] / scale, data['top'][i] / scale,
                                      data['width'][i] / scale, data['height'][i] / scale]})
            if xs:
                # Union of word boxes, mapped back to original (pre-upscale) px.
                l, t = min(xs) / scale, min(ys) / scale
                bw, bh = (max(x2s) - min(xs)) / scale, (max(y2s) - min(ys)) / scale
                box = [l, t, bw, bh]
        except Exception:
            box = None
        print(json.dumps({"text": text, "box": box, "words": words, "lines": mline}), end='', flush=True)
        return

    print(text, end='', flush=True)

if __name__ == '__main__':
    main()
