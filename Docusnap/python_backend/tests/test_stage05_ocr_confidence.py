#!/usr/bin/env python3
"""
tests/test_stage05_ocr_confidence.py
------------------------------------
Stage A guard for the Stage 0.5 template-mapping OCR path (extraction/template_mapper.py).
The value crop now reads through the SHARED light-first OCR ladder (anchor._ocr_crop_laddered)
and is scored by its REAL OCR mean confidence instead of a synthetic constant. Proves:
  1. a low-quality / symbol-soup FREE-TEXT read is capped at its OCR mean+5 -> it can no
     longer commit at the synthetic 90 and is routed to review;
  2. a clean free-text read keeps full confidence;
  3. a STRUCTURED (regex-validated) field is NOT capped (Tesseract under-reads dashed
     refs, so the pattern is the trust signal — mirrors anchor.py);
  4. with no captured confidence (a legacy/stub reader) behaviour is unchanged (90);
  5. _crop_and_ocr routes the DEFAULT image reader through the ladder and threads its
     confidence out via `meta`, while a CUSTOM reader keeps the legacy path.

No Tesseract needed: _mapping_result is exercised directly and the ladder is stubbed.

Usage: py -3.12 python_backend/tests/test_stage05_ocr_confidence.py
Exit 0 = behaves as expected, 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper  # noqa: E402

fail = 0


def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1


_mr = template_mapper._mapping_result

# 1. Garbled free-text read (low OCR mean) -> capped to mean+5, NOT the synthetic 90.
r = _mr("504 Ald Unkesand Band 20|0U0U", True, False, False, "cust", ocr_conf=65, val_type=None)
check("garbled free-text read capped at ocr_mean+5 (got %d, want 70)" % r["confidence"], r["confidence"] == 70)
check("garbled read no longer scores the synthetic 90", r["confidence"] < 90)

# 2. Clean free-text read (high OCR mean) keeps full confidence.
r = _mr("Beaumont Care Homes Ltd - Holywood", True, False, False, "cust", ocr_conf=92, val_type="text")
check("clean free-text read keeps high confidence (got %d, want 90)" % r["confidence"], r["confidence"] == 90)

# 3. STRUCTURED field (regex-valid) is NOT capped even at a low OCR mean (dashed-ref parity).
r = _mr("2602-0768-1", True, False, False, "reference_number", ocr_conf=13, val_type="alphanumeric")
check("structured ref NOT sunk by low OCR conf (got %d, want 90)" % r["confidence"], r["confidence"] == 90)

# 4. No captured confidence (stub/legacy reader) -> unchanged synthetic base.
r = _mr("anything", True, False, False, "cust", ocr_conf=None, val_type=None)
check("no ocr_conf -> back-compat synthetic 90", r["confidence"] == 90)


# 5. _crop_and_ocr wiring: default image reader -> ladder (+ meta); custom reader -> legacy.
class _FakePage:
    size = (1000, 800)

    def crop(self, box):
        return "CROP"   # the ladder stub never inspects the pixels


_routed = {}


def _ladder_stub(crop, val_type=None, verify_fn=None, meta=None, page=None, box=None):
    # MUST mirror the real anchor._ocr_crop_laddered signature, incl. page/box (the
    # preview-scale free-text fast-path). _crop_and_ocr calls it with page=/box=; if the
    # stub omits them the call raises TypeError, which _crop_and_ocr's except swallows
    # (returning None) — silently masking the wiring this test verifies.
    _routed["called"] = True
    if meta is not None:
        meta["conf"] = 71
        meta["min_conf"] = 60
    return "LADDER-READ"


_box = {"x_norm": 0.5, "y_norm": 0.3, "w_norm": 0.2, "h_norm": 0.05}
_orig = template_mapper._ocr_crop_laddered
template_mapper._ocr_crop_laddered = _ladder_stub
try:
    m = {}
    out = template_mapper._crop_and_ocr(_FakePage(), _box, None, template_mapper._ocr_text, meta=m)
    check("default reader routes through the light-first ladder", _routed.get("called") is True)
    check("ladder confidence threaded out via meta (got %r)" % m.get("conf"), m.get("conf") == 71)
    check("laddered value returned", out == "LADDER-READ")

    _routed.clear()
    template_mapper._crop_and_ocr(_FakePage(), _box, None, lambda crop: "STUB", meta={})
    check("a custom reader keeps the legacy path (ladder NOT called)", _routed.get("called") is None)
finally:
    template_mapper._ocr_crop_laddered = _orig


print("\n%s" % ("All Stage 0.5 OCR-confidence checks passed." if not fail else f"{fail} FAILED"))
sys.exit(1 if fail else 0)
