"""
Regression guards for the anchor-drift hardening (Fixes A / B / C):

A — _crop_is_credible rejects wrong-but-"credible" rigid reads (repeated-glyph
    bands, bare label words) so drift recovery is no longer suppressed by them,
    WITHOUT rejecting legitimate names / addresses / references.
B — _widen_relocated_crop adds a centre-PRESERVING margin to a relocated crop
    (so the drift-invariant value centre is unchanged) and only grows the size.
C — _clean_text_fallback narrows a text-fallback over-capture: a structured
    field to its pattern match, a free-text field via the shared cleaner.

Pure-logic, no Tesseract / no page image — mirrors the codebase's convention of
testing extraction logic directly.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.anchor import (
    _crop_is_credible, _clean_text_fallback, _widen_relocated_crop,
    _is_weak_read, _should_replace_weak, _strict_credible, _should_replace,
)

VP = {
    "date": [r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}"],
    "alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"],
    "job_reference": [r"\b\d{4}[-.\s_/]{0,3}\d{4}[-.\s_/]{0,3}\d\b"],
}

fails = []


def check(name, got, exp):
    if got == exp:
        print(f"  OK  {name}")
    else:
        print(f"  FAIL {name}: got={got!r} exp={exp!r}")
        fails.append(name)


print("Fix A — credibility gate rejects junk/label, keeps real values:")
# Wrong-but-credible rigid reads that USED to commit and suppress drift recovery:
check("low-entropy ruled-band junk rejected",
      _crop_is_credible("5 de oe et Ee ee ee ee ee ee ee ee eee ee eee ee 8", "text", VP), False)
check("repeated-glyph junk rejected", _crop_is_credible("ee ee ee ee", "text", VP), False)
check("bare label word rejected (loose alphanumeric)",
      _crop_is_credible("Field", "alphanumeric", VP, "Work Address Field"), False)
# Legitimate values must still pass (no false rejects):
check("real name kept", _crop_is_credible("Beaumont Care Homes Ltd - Belmont", "text", VP), True)
check("short two-word name kept", _crop_is_credible("Ann Blume", "text", VP), True)
check("address whose own token is a number kept", _crop_is_credible("Unit 4 1024 Park", "text", VP), True)
check("job reference kept", _crop_is_credible("2605-0769-1", "job_reference", VP), True)
check("value sharing ONE word with label kept",
      _crop_is_credible("Beaumont Care Homes", "text", VP, "Customer Name"), True)

print("Fix C — text-fallback over-capture is narrowed:")
check("job_reference narrowed from label band",
      _clean_text_fallback("2605-0769-1 Work Address Beaumont Care Homes Ltd - Belmont", "job_reference", VP),
      "2605-0769-1")
check("date narrowed from surrounding words",
      _clean_text_fallback("Logged 29-05-2026 ref", "date", VP), "29-05-2026")
check("free-text cleaned via shared cleaner (column noise dropped)",
      _clean_text_fallback("Beaumont Care Homes Ltd    73 High St", "text", VP),
      "Beaumont Care Homes Ltd")

print("Fix B — relocated crop widened but centre PRESERVED (drift-invariant):")
cx, cy, w, h = 0.40, 0.30, 0.10, 0.02
ncx, ncy, nw, nh = _widen_relocated_crop((cx, cy, w, h), "text")
check("centre x unchanged", abs(ncx - cx) < 1e-12, True)
check("centre y unchanged", abs(ncy - cy) < 1e-12, True)
check("width grew", nw > w, True)
check("text field gets vertical headroom", nh > h, True)
# Non-text field: no vertical headroom (numerics don't need ascender room).
_, _, _, nh2 = _widen_relocated_crop((cx, cy, w, h), "alphanumeric")
check("numeric field height unchanged", abs(nh2 - h) < 1e-12, True)

print("Fix E — weak rigid read lets drift recovery run, safely:")
# Short single tokens for a free-text field are weak (drift gets a chance):
check("short fragment is weak (nara)", _is_weak_read("nara", "text"), True)
check("label-word fragment is weak (Field)", _is_weak_read("Field", "text"), True)
# Strong / typed values are NOT weak (clean happy path untouched):
check("multi-word name not weak", _is_weak_read("Beaumont Care Homes Ltd", "text"), False)
check("longer single word not weak", _is_weak_read("SuperStore", "text"), False)
check("date field never weak", _is_weak_read("22", "date"), False)
check("ref field never weak", _is_weak_read("2605", "job_reference"), False)
# Replacement rule: strong candidate replaces a weak incumbent; clean reads stay.
check("strong candidate replaces weak incumbent",
      _should_replace_weak("nara", "Beaumont Care Homes Ltd - Parkview", "text"), True)
check("weak incumbent kept when candidate also weak/same",
      _should_replace_weak("nara", "narb", "text"), False)
check("strong incumbent never displaced (clean page safe)",
      _should_replace_weak("Beaumont Care Homes Ltd", "Some Other Co", "text"), False)
check("empty slot always takes candidate",
      _should_replace_weak("", "Anything Ltd", "text"), True)

print("Fix #3 — light prep reads clean crops without over-processing:")
from PIL import Image as _PILImage
from extraction.anchor import _light_prep
# Low-contrast greyscale band: autocontrast WOULD stretch it to 0..255; light
# prep must NOT (over-processing a clean crop is what produced "nara").
_lo = _PILImage.new("L", (400, 60), color=120)
for _x in range(400):
    for _y in range(60):
        _lo.putpixel((_x, _y), 110 + (_x % 30))   # values stay in ~110..139
_out = _light_prep(_lo)
check("light prep returns greyscale", _out.mode, "L")
check("large crop NOT upscaled (read essentially as-is)", _out.size, (400, 60))
_ex = _out.getextrema()
check("no contrast stretch (values not pushed to 0/255)", _ex[0] >= 100 and _ex[1] <= 145, True)
# Tiny crop IS upscaled so small numeric tokens stay legible.
_small = _light_prep(_PILImage.new("L", (90, 30), color=128))
check("small crop upscaled (>=2x) for legibility", _small.size[0] >= 180, True)

print("Gated rescue — strict credibility + harvest-replaces-garbage:")
# Code-like fields (ref/serial) are single tokens: high-DPI garbage with a space
# is NOT strictly credible (so the harvest is allowed to rescue it)...
check("garbage 'cield wu' not strict (alphanumeric)", _strict_credible("cield wu", "alphanumeric", VP), False)
check("clean ref IS strict (alphanumeric)", _strict_credible("2602-0768-1", "alphanumeric", VP), True)
# ...but a clean rigid read is strictly credible and must never be displaced.
check("garbage date not strict", _strict_credible("ZWIVLZIZULO", "date", VP), False)
check("clean date IS strict", _strict_credible("20/02/2026", "date", VP), True)
# A free-text name with spaces is fine (the single-token rule is code-only).
check("multi-word name strict (text)", _strict_credible("Beaumont Care Homes", "text", VP), True)
# Replacement: harvest replaces a non-strict incumbent, never a strict one.
check("clean harvest replaces garbage ref",
      _should_replace("cield wu", "2602-0768-1", "alphanumeric", VP), True)
check("clean rigid ref is NOT displaced",
      _should_replace("2602-0768-1", "2602-0768-9", "alphanumeric", VP), False)

if fails:
    print(f"\n{len(fails)} check(s) FAILED")
    sys.exit(1)
print("\nAll anchor drift-fix checks passed.")
sys.exit(0)
