"""
test_deskew_cache_fast.py — the DESKEW×CACHE fast path in tesseract.extract_text_and_images
(oscar-designed, Oracle SIGN-OFF-WITH-CONDITIONS). Proves the verdict:
  needs_scanned_ocr = (not use_cache) or (deskew_pages and (any_scanned_tilted or not DESKEW_CACHE_FAST))
and that it is fail-toward-re-OCR + neutral for the non-deskew paths.

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_deskew_cache_fast.py
"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pathlib import Path
from PIL import Image, ImageDraw

import ocr.tesseract as T

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1

class SpyEngine:
    """Records whether the full-page OCR actually ran, and returns a marker so we can tell a fresh
    read from a served cache."""
    def __init__(self): self.calls = 0
    def read_page(self, img, enhance_params, dpi=None):
        self.calls += 1
        return "FRESH_OCR_TEXT"

def lined(tilt=0.0):
    """A white page with horizontal black bars (text-line proxy) → strong horizontal-projection
    variance at 0°; rotate it to inject a detectable skew."""
    img = Image.new('L', (800, 1000), 255)
    d = ImageDraw.Draw(img)
    for y in range(120, 880, 40):
        d.rectangle([120, y, 680, y + 12], fill=0)
    if tilt:
        img = img.rotate(tilt, expand=False, fillcolor=255, resample=Image.BICUBIC)
    return img.convert('RGB')

def run(path, **kw):
    spy = SpyEngine()
    text, pages = T.extract_text_and_images(Path(path), engine=spy, **kw)
    return spy.calls, text

def main():
    tmp = tempfile.mkdtemp(prefix='deskew_fast_')
    level_png  = os.path.join(tmp, 'level.png');  lined(0.0).save(level_png)
    tilted_png = os.path.join(tmp, 'tilted.png'); lined(3.0).save(tilted_png)
    level_pdf  = os.path.join(tmp, 'level.pdf');  lined(0.0).save(level_pdf,  'PDF')
    tilted_pdf = os.path.join(tmp, 'tilted.pdf'); lined(3.0).save(tilted_pdf, 'PDF')

    print("\nfixture skew detection:")
    check('level image detects 0.0° (below floor)',  T.detect_skew_angle(lined(0.0), 0.2) == 0.0)
    check('tilted image detects a non-zero angle',    abs(T.detect_skew_angle(lined(3.0), 0.2)) >= 0.2)

    print("\nneutrality — non-deskew paths unchanged:")
    calls, _ = run(level_png, cached_text=None, deskew_pages=False)
    check('no cache, no deskew → fresh OCR runs', calls == 1)
    calls, text = run(level_png, cached_text='CACHED', deskew_pages=False)
    check('cache, no deskew → OCR skipped, cache served', calls == 0 and text == 'CACHED')

    print("\nDESKEW×CACHE fast path (raster):")
    calls, text = run(level_png, cached_text='CACHED', deskew_pages=True, deskew_min_angle=0.2)
    check('level raster + deskew + cache → OCR SKIPPED, cache served (the win)', calls == 0 and text == 'CACHED')
    calls, text = run(tilted_png, cached_text='CACHED', deskew_pages=True, deskew_min_angle=0.2)
    check('tilted raster + deskew + cache → fresh straightened OCR (NOT cache)', calls == 1 and text == 'FRESH_OCR_TEXT')

    print("\nDESKEW×CACHE fast path (PDF Pass A/B):")
    calls, text = run(level_pdf, cached_text='CACHED', deskew_pages=True, deskew_min_angle=0.2)
    check('level PDF + deskew + cache → OCR SKIPPED, cache served', calls == 0 and text == 'CACHED')
    calls, text = run(tilted_pdf, cached_text='CACHED', deskew_pages=True, deskew_min_angle=0.2)
    check('tilted PDF + deskew + cache → fresh straightened OCR (NOT cache)', calls == 1 and text == 'FRESH_OCR_TEXT')

    print("\nfail-toward-re-OCR + kill switch:")
    calls, _ = run(tilted_png, cached_text='CACHED', deskew_pages=True, deskew_min_angle=0.2)
    check('a tilted page NEVER silently reuses cache (skew-misread recovery preserved)', calls == 1)
    os.environ['DESKEW_CACHE_FAST'] = '0'
    try:
        calls, text = run(level_png, cached_text='CACHED', deskew_pages=True, deskew_min_angle=0.2)
        check('DESKEW_CACHE_FAST=0 → level doc FORCED to re-OCR (old always-re-OCR behaviour)', calls == 1)
    finally:
        os.environ.pop('DESKEW_CACHE_FAST', None)
    calls, text = run(level_png, cached_text='CACHED', deskew_pages=True, deskew_min_angle=0.2)
    check('kill switch reset → fast path serves cache again', calls == 0 and text == 'CACHED')

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
