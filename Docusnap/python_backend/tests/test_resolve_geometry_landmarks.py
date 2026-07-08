#!/usr/bin/env python3
"""
tests/test_resolve_geometry_landmarks.py
----------------------------------------
Guards the Template Manager "preview registration across docs" plumbing (Slice 1):
resolve_geometry must forward the template's landmarks (and registration_enabled)
to extract_with_mappings, so the admin overlay resolves each box through the SAME
registration transform reprocess uses. Without it the overlay would silently fall
back to the per-field anchor path and never reflect registration.

No Tesseract: _locate_anchor and extract_with_mappings are stubbed; we assert the
forwarded kwargs only.

Usage: py -3.12 python_backend/tests/test_resolve_geometry_landmarks.py
Exit 0 = plumbing intact, 1 = regression.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper as tm  # noqa: E402

fail = 0


def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1


MAPPING = {"field_key": "cust", "anchor_x_norm": 0.1, "anchor_y_norm": 0.1,
           "anchor_w_norm": 0.1, "anchor_h_norm": 0.03,
           "target_x_norm": 0.3, "target_y_norm": 0.1,
           "target_w_norm": 0.2, "target_h_norm": 0.03,
           "anchor_text": "Customer", "enabled": True, "page_number": 0}
LANDMARKS = [{"label_text": "INVOICE", "x_norm": 0.1, "y_norm": 0.05, "w_norm": 0.1, "h_norm": 0.03}]

_seen = {}


def _stub_extract(page_images, mappings, **kw):
    _seen['template_landmarks'] = kw.get('template_landmarks')
    _seen['registration_enabled'] = kw.get('registration_enabled')
    return {"cust": {"value": "X", "confidence": 90, "method": "template_mapping"}}


_orig_extract = tm.extract_with_mappings
_orig_locate = tm._locate_anchor
tm.extract_with_mappings = _stub_extract
tm._locate_anchor = lambda *a, **k: None       # no OCR; the geometry plumbing is what we test
try:
    # 1. With landmarks -> forwarded + registration ON
    _seen.clear()
    tm.resolve_geometry("PAGE", MAPPING, template_landmarks=LANDMARKS)
    check("landmarks forwarded to extract_with_mappings", _seen.get('template_landmarks') == LANDMARKS)
    check("registration_enabled True when landmarks present", _seen.get('registration_enabled') is True)

    # 2. No landmarks -> registration OFF (back-compat: the plain Test-button path)
    _seen.clear()
    tm.resolve_geometry("PAGE", MAPPING)
    check("no landmarks -> registration_enabled False", _seen.get('registration_enabled') is False)
    check("no landmarks -> template_landmarks None", _seen.get('template_landmarks') is None)
finally:
    tm.extract_with_mappings = _orig_extract
    tm._locate_anchor = _orig_locate

print("\n%s" % ("All resolve_geometry landmark-forwarding checks passed." if not fail else f"{fail} FAILED"))
sys.exit(1 if fail else 0)
