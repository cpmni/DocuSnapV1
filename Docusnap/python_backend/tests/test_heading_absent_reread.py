"""Pins for RUNG 3 — ABSENT-TITLE PIXEL RE-READ (HEADING_ABSENT_REREAD, DARK). The full-page --dpi
PSM-3 pass can DROP an oversized centred title entirely (Castellan 'CREDIT NOTE'), so it never reaches
the word geometry rung 2 reads. A NumPy pixel prominence pre-gate (find_absent_heading_band) locates
the banner-height top-band ink run the full-page pass left unread; recover_type_detection_absent
re-reads it and adopts ONLY a trusted heading (heading=True AND conf>=70).

Deterministic: synthetic images for the pixel gate; a stubbed detect_fn / band re-read for adoption.
Run: py -3.12 python_backend/tests/test_heading_absent_reread.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image, ImageDraw
from ocr import heading_reread as HR

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


W, H = 1000, 2000                       # a page; top band = top 30% = 0..600
MED_H = 18                              # body word height; banner floor = 1.8*18 = 32.4px


def _page_with_title(title_h=60, title_w=260, x=370, y=120):
    """White page with a tall centred dark bar (the 'title') in the top band."""
    img = Image.new("L", (W, H), 255)
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + title_w, y + title_h], fill=0)
    return img


# ── find_absent_heading_band ─────────────────────────────────────────────────────
# A tall uncovered top-band run → bounds around it; geom carries body-height med_h + words
# NOT overlapping the title's y-band.
img = _page_with_title()
geom = {"med_h": MED_H, "size": (W, H),
        "words": [(100, 700, 200, MED_H, "body", 90)]}   # a read word BELOW the title band
b = HR.find_absent_heading_band(img, geom)
check("tall uncovered top-band run → bounds returned", b is not None)
check("bounds bracket the title (120..180)", b and b[0] <= 120 and b[1] >= 180 and b[1] < 300)

# A short (body-height) run → None (not banner-height).
b2 = HR.find_absent_heading_band(_page_with_title(title_h=MED_H), geom)
check("body-height run → None (not a banner)", b2 is None)

# The run is COVERED by a read geom word (already read) → None (defer to the full-page text).
covered_geom = {"med_h": MED_H, "size": (W, H),
                "words": [(370, 120, 260, 60, "TITLE", 92)]}  # a word ON the title band
check("run covered by a read word → None (already read)",
      HR.find_absent_heading_band(_page_with_title(), covered_geom) is None)

# Blank page → None.
check("blank page → None", HR.find_absent_heading_band(Image.new("L", (W, H), 255), geom) is None)

# A tall run BELOW the top band → None (mid-body class excluded).
low = Image.new("L", (W, H), 255)
ImageDraw.Draw(low).rectangle([370, 1200, 630, 1260], fill=0)
check("tall run below the top band → None", HR.find_absent_heading_band(low, geom) is None)

# A tall but NARROW run (a logo, not a title) → None.
narrow = Image.new("L", (W, H), 255)
ImageDraw.Draw(narrow).rectangle([460, 120, 520, 180], fill=0)   # 60px wide < 8% of 1000
check("tall narrow run (logo) → None", HR.find_absent_heading_band(narrow, geom) is None)

# No geometry (cached reprocess / born-digital: med_h absent) → None (honestly inert).
check("no med_h → None (inert)", HR.find_absent_heading_band(img, {"size": (W, H)}) is None)
check("None image → None", HR.find_absent_heading_band(None, geom) is None)

# ── recover_type_detection_absent adoption contract ──────────────────────────────
_orig_find = HR.find_absent_heading_band
_orig_band = HR.recover_heading_band_general
HR.find_absent_heading_band = lambda img, geom: (120, 180)
HR.recover_heading_band_general = lambda img, bounds, **k: "CREDIT NOTE"

# heading=True AND conf>=70 → adopt.
adopt = HR.recover_type_detection_absent(img, geom, "body", ["Credit Note"], {},
    lambda t, n, a: {"type": "Credit Note", "confidence": 95, "heading": True})
check("adopt: trusted heading (conf>=70) → returned", adopt and adopt["type"] == "Credit Note")

# heading=False → None (fail toward review).
check("reject: heading=False → None",
      HR.recover_type_detection_absent(img, geom, "body", ["Credit Note"], {},
          lambda t, n, a: {"type": "Credit Note", "confidence": 95, "heading": False}) is None)

# conf<70 → None.
check("reject: conf<70 → None",
      HR.recover_type_detection_absent(img, geom, "body", ["Credit Note"], {},
          lambda t, n, a: {"type": "Credit Note", "confidence": 60, "heading": True}) is None)

# pre-gate None → None (no band, no re-read).
HR.find_absent_heading_band = lambda img, geom: None
check("no band → None", HR.recover_type_detection_absent(img, geom, "body", ["Credit Note"], {},
      lambda t, n, a: {"type": "Credit Note", "confidence": 95, "heading": True}) is None)

# band re-read empty → None.
HR.find_absent_heading_band = lambda img, geom: (120, 180)
HR.recover_heading_band_general = lambda img, bounds, **k: None
check("empty band read → None", HR.recover_type_detection_absent(img, geom, "body", ["Credit Note"], {},
      lambda t, n, a: {"type": "Credit Note", "confidence": 95, "heading": True}) is None)

HR.find_absent_heading_band = _orig_find
HR.recover_heading_band_general = _orig_band

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All HEADING_ABSENT_REREAD checks passed.")
