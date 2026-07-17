#!/usr/bin/env python3
"""
ocr_region.py — receives a PNG file via --image-file, runs focused OCR for zone-selection field
picking / the ⊕ teach tool in the Review window (and Template Wizard read-back, --boxes label
capture, --skew/--deskew for the display). The pure OCR logic lives in ocr/region_core.py (shared
with the warm OCR worker); this file is the CLI wrapper (arg parse, image load, skew/deskew, print).
"""
import time as _time
_PROC_START = _time.perf_counter()   # DS_OCR_TIMING: region.py's own import cost is measured from here

import sys
import argparse
import base64
import tempfile
import os
from io import BytesIO
import pytesseract
from PIL import Image, ImageFilter, ImageOps

# region_core holds the pure OCR logic. Make it importable as a SIBLING: the PACKAGED build runs an
# EMBEDDABLE Python whose pythonXX._pth SUPPRESSES the automatic script-dir on sys.path (dev's system
# Python adds it — which is why this only bit the built app: `import region_core` crashed region.py
# before main(), killing --deskew/--skew/--boxes AND the ⊕ draw tool). Explicitly put this file's own
# dir (ocr/) and its parent (python_backend) on the path FIRST — mirrors the insert the --skew/--deskew
# branch already does for `from ocr.tesseract import ...`. Re-export the two image helpers so existing
# tests (`region._strip_horizontal_rules` / `_looks_unreadable_sliver`) keep resolving unchanged.
_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (os.path.dirname(_HERE), _HERE):        # python_backend (for the pkg fallback), then ocr/ at [0]
    if _p not in sys.path:
        sys.path.insert(0, _p)
try:
    import region_core
except ImportError:                              # imported as a package (ocr.region)
    from ocr import region_core
_strip_horizontal_rules = region_core._strip_horizontal_rules
_looks_unreadable_sliver = region_core._looks_unreadable_sliver

_IMPORTS_DONE = _time.perf_counter()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-file', required=True, help='Path to PNG file')
    parser.add_argument('--tesseract', default=None,  help='Path to tesseract.exe')
    # --boxes: emit JSON {"text":..., "box":[l,t,w,h], "words":[...], "lines":N} where box is the
    # union of detected word boxes in ORIGINAL (pre-upscale) crop pixels. Used by the ⊕ tool to
    # capture the taught LABEL's position for a drift-invariant label->value offset. Default: plain text.
    parser.add_argument('--boxes', action='store_true')
    # --skew: emit JSON {"angle": <deg>} — the page's detected skew (PIL CCW-positive, 0.0 when
    # < 0.2°). Straightens the DISPLAYED page so drawn ⊕ boxes align with the text. No OCR.
    parser.add_argument('--skew', action='store_true')
    # --deskew: emit JSON {"angle": <deg>, "image": <base64 PNG of the straightened page | null>}.
    parser.add_argument('--deskew', action='store_true')
    # Minimum skew angle (deg) for --skew/--deskew; a page tilted LESS reads/shows raw. Clamped
    # [0.2, 5.0]; default 0.2 = the built-in floor (byte-identical to before this flag).
    parser.add_argument('--min-angle', type=float, default=0.2)
    args = parser.parse_args()
    _min_angle = max(0.2, min(5.0, float(getattr(args, 'min_angle', 0.2) or 0.2)))

    # DS_OCR_TIMING (env, default off -> zero stderr, byte-identical stdout): attribute the per-draw
    # latency. Emits one stderr line {"import_ms", "stages":[[label,ms]...], "op"} — the "warm-
    # addressable" (import_ms) vs the irreducible tesseract-spawn cost the warm worker can't remove.
    _timing_on = os.environ.get('DS_OCR_TIMING', '0') != '0'
    _ticks = []
    _last = [_time.perf_counter()]
    def _tick(label):
        if _timing_on:
            now = _time.perf_counter()
            _ticks.append([label, round((now - _last[0]) * 1000, 1)])
            _last[0] = now
    def _emit_timing(extra=None):
        if not _timing_on:
            return
        import json as _json
        rec = {"import_ms": round((_IMPORTS_DONE - _PROC_START) * 1000, 1), "stages": _ticks}
        if extra:
            rec.update(extra)
        sys.stderr.write("DS_OCR_TIMING " + _json.dumps(rec) + "\n")
        sys.stderr.flush()

    if args.tesseract and os.path.exists(args.tesseract):
        pytesseract.pytesseract.tesseract_cmd = args.tesseract

    # Load image from file
    try:
        img = Image.open(args.image_file).convert('L')  # greyscale
    except Exception:
        print('', end='')
        _emit_timing({"op": "load-error"})
        return
    _tick('load')

    # --skew: measure the page's skew angle (no OCR) and return it. Display-deskew endpoint.
    if args.skew:
        import json
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # python_backend
        try:
            from ocr.tesseract import detect_skew_angle
            angle = float(detect_skew_angle(img, _min_angle))
        except Exception:
            angle = 0.0
        print(json.dumps({"angle": round(angle, 2)}), end='', flush=True)
        _emit_timing({"op": "skew"})
        return

    # --deskew: return the STRAIGHTENED page as a base64 PNG + its angle, for the Review DISPLAY. The
    # rotation uses PIL's convention (img.rotate(angle), CCW-positive, expand=False so dims are
    # UNCHANGED). Angle 0 / below-threshold -> {"angle":0,"image":null} (caller shows the raw).
    if args.deskew:
        import json
        import base64 as _b64
        from io import BytesIO
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        try:
            from ocr.tesseract import detect_skew_angle
            angle = float(detect_skew_angle(img, _min_angle))
        except Exception:
            angle = 0.0
        if abs(angle) < 0.2:
            print(json.dumps({"angle": 0.0, "image": None}), end='', flush=True)
            _emit_timing({"op": "deskew"})
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
        _emit_timing({"op": "deskew"})
        return

    # OCR path -> region_core (byte-identical; the SAME function the warm worker will call).
    res = region_core.process(img, boxes=args.boxes, timing=_tick)

    if args.boxes:
        import json
        print(json.dumps({"text": res["text"], "box": res["box"],
                          "words": res["words"], "lines": res["lines"]}), end='', flush=True)
    else:
        print(res["text"], end='', flush=True)
    _emit_timing({"op": "boxes" if args.boxes else "text"})


if __name__ == '__main__':
    main()
