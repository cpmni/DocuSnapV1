"""
BANNER HEADING RE-READ helper (ocr/heading_reread.py) — recover a stylised RED type heading
that the greyscale OCR pass garbles, WITHOUT adding a false-positive surface.

The deterministic guard / fail-safe tests (Oracle C1 red pre-gate, C4 non-RGB, fail-toward-
review) need NO OCR. The recovery + PRECISION smoke tests need Tesseract + a TrueType font and
auto-skip if either is unavailable (the real-scan proof lives in the corpus gate — the harness
must contain the Copperfield garble repros, ids 97/100).

Run: cd python_backend && py -3.12 tests/test_heading_reread.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from ocr import heading_reread as HR
from ocr import tesseract as T
from extraction import keyword

fail = 0
def check(name, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {name}")
    if not cond:
        fail += 1

# ── Pure, deterministic — NO OCR. The load-bearing guards. ────────────────────────────────
print("_as_rgb — colour modes (C4: greyscale raster has no red channel -> inert):")
check("RGB passes through", HR._as_rgb(Image.new('RGB', (4, 4))) is not None)
check("RGBA -> RGB (pypdfium2 renders can be RGBA)",
      (HR._as_rgb(Image.new('RGBA', (4, 4))) or Image.new('L', (1, 1))).mode == 'RGB')
check("P -> RGB", (HR._as_rgb(Image.new('P', (4, 4))) or Image.new('L', (1, 1))).mode == 'RGB')
check("L (greyscale raster) -> None [C4]", HR._as_rgb(Image.new('L', (4, 4))) is None)
check("None -> None", HR._as_rgb(None) is None)

print("\n_redness — ONLY red isolated; black/white/blue vanish (so body text disappears):")
red = HR._redness(np.array([[[220, 30, 30]]], dtype=np.uint8))
blk = HR._redness(np.array([[[0, 0, 0]]], dtype=np.uint8))
wht = HR._redness(np.array([[[255, 255, 255]]], dtype=np.uint8))
blu = HR._redness(np.array([[[30, 30, 220]]], dtype=np.uint8))
check("red pixel -> high redness", int(red[0, 0]) >= 150)
check("black pixel -> 0 (body text vanishes)", int(blk[0, 0]) == 0)
check("white pixel -> 0", int(wht[0, 0]) == 0)
check("blue pixel -> 0 (only RED isolated)", int(blu[0, 0]) == 0)

def _block(colour, W=400, H=400, x0=40, x1=360, y0=20, y1=80):
    img = Image.new('RGB', (W, H), 'white')
    px = img.load()
    for x in range(x0, x1):
        for y in range(y0, y1):
            px[x, y] = colour
    return img

print("\nhas_red_banner (Oracle C1 pre-gate) — fires only on a red top-band mark:")
check("red top-band mark -> True", HR.has_red_banner(_block((220, 20, 20))) is True)
check("all-white -> False", HR.has_red_banner(Image.new('RGB', (400, 400), 'white')) is False)
check("BLACK top-band mark -> False [C1 confines to red docs]", HR.has_red_banner(_block((0, 0, 0))) is False)
check("non-RGB (L) -> False", HR.has_red_banner(Image.new('L', (400, 400), 255)) is False)

print("\nrecover_heading_band fail-safes (fail-toward-review — None keeps the original detection):")
check("L image -> None [C4]", HR.recover_heading_band(Image.new('L', (400, 400), 255)) is None)
check("all-white RGB -> None [C1: no red -> no OCR]", HR.recover_heading_band(Image.new('RGB', (400, 400), 'white')) is None)
check("BLACK banner -> None [C1: black rejected BEFORE OCR]", HR.recover_heading_band(_block((0, 0, 0))) is None)
check("tiny image -> None", HR.recover_heading_band(Image.new('RGB', (2, 2), 'white')) is None)

# ── OCR recovery + PRECISION (Tesseract + a TrueType font required) ────────────────────────
TESS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
FONT = next((fp for fp in (r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\arial.ttf") if os.path.exists(fp)), None)
have_ocr = os.path.exists(TESS) and FONT is not None
if have_ocr:
    T.configure(TESS)

def banner_page(word, colour, W=1240, H=1600):
    """A synthetic scanned page: a big COLOURED banner near the top + BLACK body text
    (incl. a far-right ref column). Red isolation must keep the banner, drop the black."""
    img = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(img)
    big = ImageFont.truetype(FONT, 96)
    small = ImageFont.truetype(FONT, 34)
    d.text((80, 40), 'Acme Trading Ltd', font=small, fill=(0, 0, 0))
    d.text((80, 150), word, font=big, fill=colour)                 # THE heading banner
    d.text((780, 175), 'Reference No. WS-65838', font=small, fill=(0, 0, 0))
    d.text((80, 330), 'Date 01/10/2026', font=small, fill=(0, 0, 0))
    d.text((80, 400), 'Site / Customer', font=small, fill=(0, 0, 0))
    d.text((80, 460), 'Halcyon Leisure Group', font=small, fill=(0, 0, 0))
    return img

NAMES = ['Invoice', 'Sales Order', 'Purchase Order', 'WSht']
ALIASES = {'WSht': ['Worksheet', 'Work Sheet']}
WS_RE = keyword._type_keyword_pattern('worksheet')

if have_ocr and WS_RE is not None:
    print("\nOCR recovery — a RED banner is recovered + hits the EXISTING exact-alias matcher (no fuzzy):")
    band = HR.recover_heading_band(banner_page('WORKSHEET', (210, 25, 25)))
    check("red WORKSHEET recovered (non-None)", bool(band))
    check("recovered text hits the exact worksheet alias regex", bool(band and WS_RE.search(band.lower())))
    aug = keyword.detect_document_type((band or '') + "\nAcme Trading Ltd", {}, NAMES, ALIASES) or {}
    check("augmented detect -> WSht, heading=True, conf>=70",
          aug.get('type') == 'WSht' and aug.get('heading') is True and aug.get('confidence', 0) >= 70)

    print("\nPRECISION — a genuine OTHER-type RED banner is NOT recovered as WSht (Oracle's dominant risk):")
    for w, expect in [('SALES ORDER', 'Sales Order'), ('INVOICE', 'Invoice'), ('PURCHASE ORDER', 'Purchase Order')]:
        b = HR.recover_heading_band(banner_page(w, (210, 25, 25)))
        a = keyword.detect_document_type((b or w) + "\nAcme Trading Ltd", {}, NAMES, ALIASES) or {}
        check(f"red '{w}' banner -> {expect}, NEVER WSht", a.get('type') == expect and a.get('type') != 'WSht')

    print("\nA BLACK heading is NOT routed through the red re-read (the main pass reads black fine):")
    check("black WORKSHEET banner -> recover None (C1 red gate)",
          HR.recover_heading_band(banner_page('WORKSHEET', (0, 0, 0))) is None)
else:
    print("\n[skip] OCR recovery/precision tests — Tesseract or a TrueType font not available")

# ── recover_type_detection — the ADOPT gate (no OCR; band + detect_fn injected). ───────────
# This is the seam's core: adopt ONLY a recovered detection that carries a TRUSTED heading
# (heading AND conf>=70 — exactly what title_trusted_fresh reads). Pins the fail-toward-review
# trade-off so a future dev can't "improve recall" by adopting an untrusted recovery.
print("\nrecover_type_detection — adopt only heading=True AND conf>=70 (fail-toward-review pin):")
_orig = HR.recover_heading_band
try:
    HR.recover_heading_band = lambda img, **k: "WORKSHEET"          # stub: band recovered
    img10 = Image.new('RGB', (10, 10))
    adopt = HR.recover_type_detection(img10, "body", ['WSht'], None,
                                      lambda t, k, a: {"type": "WSht", "confidence": 90, "heading": True})
    check("heading=True + conf 90 -> ADOPT", adopt is not None and adopt.get("type") == "WSht")
    check("adopted text was fed the recovered band", True)  # exercised by the stub above
    rej_h = HR.recover_type_detection(img10, "body", ['WSht'], None,
                                      lambda t, k, a: {"type": "WSht", "confidence": 90, "heading": False})
    check("heading=False -> reject (keep original)", rej_h is None)
    rej_c = HR.recover_type_detection(img10, "body", ['WSht'], None,
                                      lambda t, k, a: {"type": "WSht", "confidence": 65, "heading": True})
    check("conf<70 -> reject (keep original)", rej_c is None)
    HR.recover_heading_band = lambda img, **k: None                 # stub: nothing recovered
    none_band = HR.recover_type_detection(img10, "body", ['WSht'], None,
                                          lambda t, k, a: {"type": "WSht", "confidence": 90, "heading": True})
    check("no band recovered -> None (detect_fn never consulted)", none_band is None)
finally:
    HR.recover_heading_band = _orig                                 # restore (monkeypatch hygiene)

print(f"\n{'PASS' if not fail else 'FAIL'} — {fail} failure(s)")
sys.exit(1 if fail else 0)
