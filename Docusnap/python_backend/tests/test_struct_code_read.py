"""test_struct_code_read.py — STRUCT_CODE_READ slice 1 (prep-only) pins (Oracle SIGN-OFF-W/COND 2026-08-03).

Slice 1 cures the tight-crop garble ('PO-17039'->'»0-17039'; '19/06/2026'->'09-06-2026') at the READ:
cap-height upscale + synthetic read-time quiet zone + DROP SHARPEN — and DELIBERATELY NO char
whitelist (a whitelist can snap a mis-segmented glyph to a clean-shaped WRONG code that the gateless
Stage-0.5 path auto-files — Oracle seam 2; deferred to a separately-gated slice 2). These pins lock
that discipline (byte-identical OFF, scoped, no whitelist, SHARPEN fallback preserved). The real
garble->clean HEAL is proven by the faithful reprocess-manifest realdoc gate, not a unit fixture.

Run:  py -3.12 python_backend/tests/test_struct_code_read.py
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)   # embeddable-python: seat the backend dir, never bare-import

from PIL import Image                        # noqa: E402
from extraction import anchor                # noqa: E402
from ocr import region_core                  # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


# ── The prep function ───────────────────────────────────────────────────────────────────────
# A wide, tight ~13px code crop (the starvation case) with a thin ink band.
tight = Image.new("L", (320, 13), 255)
for x in range(20, 300, 4):
    tight.putpixel((x, 6), 0)

check("_ink_band_height measures the crop's ink band", region_core._ink_band_height(tight) >= 1)

out = anchor._struct_prep(tight)
# cap-height upscale (target ~34 from a ~1px band → 4x cap) + a 12px quiet-zone border each side.
check("_struct_prep UPSCALES the tight crop (cap-height driven)", out.width > tight.width and out.height > tight.height)
check("_struct_prep adds a synthetic quiet zone (border), not a wider crop",
      out.width >= int(tight.width) + 24)
check("_struct_prep never downscales / stays greyscale", out.mode == "L")

# ── Scope + kill switch ─────────────────────────────────────────────────────────────────────
check("scope = alphanumeric/reference_code/date (job_reference excluded — spaces)",
      anchor._STRUCT_READ_TYPES == frozenset({"alphanumeric", "reference_code", "date"}))

# ── Source discipline (the load-bearing Oracle conditions) ──────────────────────────────────
src = open(os.path.join(_BACKEND, "extraction", "anchor.py"), encoding="utf-8").read()
prep_src = src[src.index("def _struct_prep"):src.index("def _light_prep")]
ladder = src[src.index("def _ocr_crop_laddered"):src.index("def _ocr_crop_laddered") + 9000]

check("C1: NO char whitelist anywhere in the struct prep (slice-1 = prep only)",
      "tessedit_char_whitelist" not in prep_src)
check("C1: the struct read path adds NO whitelist config (deferred to gated slice 2)",
      "tessedit_char_whitelist" not in ladder)
check("C1: cap-height upscale via region_core._ink_band_height + a 34px target",
      "_ink_band_height" in prep_src and "34" in prep_src)
check("C1: synthetic quiet zone via ImageOps.expand (a border, not a wider window)",
      "ImageOps.expand" in prep_src)
check("C1: the struct prep APPLIES no filter (no SHARPEN — the '»'-manufacturing kernel)",
      "ImageFilter" not in prep_src and ".filter(" not in prep_src)
check("C5: STRUCT_CODE_READ kill switch, default OFF, read PER-CALL",
      'os.environ.get("STRUCT_CODE_READ", "0")' in ladder)
check("C2: struct rungs PREPEND the generic light/heavy rungs (fall-through preserved)",
      '(("struct", 7), ("struct", 6)) if _struct_on else ()' in ladder
      and '("light", 7), ("light", 6), ("heavy", 7), ("heavy", 6)' in ladder)
check("C2: the heavy SHARPEN rung is still built (fallback for degraded serials survives)",
      "heavy = _tm._prep(crop)" in ladder)
check("gate arms on scope AND switch (OFF or non-struct type -> byte-identical rungs)",
      "_struct_on = (val_type in _STRUCT_READ_TYPES" in ladder)

# ── C3: the inline reconcile comment was corrected (stale 'Off by default') ──────────────────
tm = open(os.path.join(_BACKEND, "extraction", "template_mapper.py"), encoding="utf-8").read()
check("C3: reconcile comment corrected to 'ON by default' (it is the garble's review backstop)",
      "ON by default" in tm and "corrected 2026-08-03 per Oracle" in tm)

print(f"\n{fails} FAILED" if fails else "\nAll STRUCT_CODE_READ slice-1 pins passed")
sys.exit(1 if fails else 0)
