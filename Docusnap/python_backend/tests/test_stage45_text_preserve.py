#!/usr/bin/env python3
"""
tests/test_stage45_text_preserve.py
------------------------------------
Stage 4.5 (format-anomaly) must NOT discard a free-text value just because the
field happens to have a learned SHAPE that this value doesn't match.

Real-world failure this pins (doc00666620…, a WSheet):
  confirmed `customer` history was 3 distinct values all shaped
  "Beaumont Care Homes Ltd - <Site>", which classifies as alphanum_sep with a
  learned shape. A new doc read "Beaumont Care Homes Ltd -" (no trailing site) →
  shape mismatch → the `fmt_entry.get('shapes')` branch HARD-NULLED a perfectly
  good company name, so the Customer field came back empty.

Fix: free-text fields (type text/multiline/untyped, and NOT _is_ref_field) are
flagged for review but never withheld/trimmed by a learned shape. Structured
code fields — including a reference typed plain "text" like reference_number —
keep full shape enforcement.

OCR-dependent stages are stubbed. Needs no Tesseract.
    py -3.12 python_backend/tests/test_stage45_text_preserve.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as engine_mod
from extraction.engine import ExtractionEngine

CONFIG = str(Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")

CUSTOMER_HISTORY = ["Beaumont Care Homes Ltd - Parkview",
                    "Beaumont Care Homes Ltd - Holywood",
                    "Beaumont Care Homes Ltd - Belmont"]
REF_HISTORY = ["2603-1351-1", "7602-1354-4", "1234-5678-9"]

FORMATS = [
    {"supplier_name": "", "document_type": "wsheet", "field_key": "customer",
     "sample_values": CUSTOMER_HISTORY, "confirmed_count": 6,
     "value_counts": {CUSTOMER_HISTORY[0]: 4, CUSTOMER_HISTORY[1]: 1, CUSTOMER_HISTORY[2]: 1}},
    {"supplier_name": "", "document_type": "wsheet", "field_key": "reference_number",
     "sample_values": REF_HISTORY, "confirmed_count": 6},
]

FIELDS = [{"key": "customer", "type": "text"},
          {"key": "reference_number", "type": "text"}]  # ref typed "text", as in the real DB


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


def _run(kw_results):
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    eng.set_formats(FORMATS)
    orig_kw = engine_mod.keyword.extract_fields
    orig_an = engine_mod.anchor.extract_with_anchors
    orig_va = engine_mod.validator.validate_and_adjust
    engine_mod.keyword.extract_fields = lambda *a, **k: {kk: dict(vv) for kk, vv in kw_results.items()}
    engine_mod.anchor.extract_with_anchors = lambda *a, **k: {}
    engine_mod.validator.validate_and_adjust = lambda results, field_defs: results  # isolate Stage 4.5
    try:
        return eng.extract(ocr_text="stub", page_images=[], filename="t.pdf",
                           field_defs=FIELDS, hints=[], anchors=[], logos=[], templates=[],
                           document_type="WSheet", document_slug="wsheet")
    finally:
        engine_mod.keyword.extract_fields = orig_kw
        engine_mod.anchor.extract_with_anchors = orig_an
        engine_mod.validator.validate_and_adjust = orig_va


def _f(r, k):
    return r.get(k) or {}


def test_text_value_preserved_on_shape_mismatch():
    print("text field: a shape-mismatching customer name is KEPT (flagged), not nulled")
    f = 0
    r = _run({"customer": {"value": "Beaumont Care Homes Ltd -", "confidence": 85, "method": "keyword_override"}})
    cust = _f(r, "customer")
    f += not check("customer value preserved (NOT nulled by the learned shape)",
                   cust.get("value") == "Beaumont Care Homes Ltd -")
    f += not check("customer flagged for review with a 'verify' note",
                   bool(cust.get("validation_note")) and "verify" in (cust.get("validation_note") or ""))
    print()
    return f


def test_clean_text_value_unflagged():
    print("text field: a value matching the learned shape passes clean")
    f = 0
    r = _run({"customer": {"value": "Beaumont Care Homes Ltd - Parkview", "confidence": 90, "method": "keyword_override"}})
    cust = _f(r, "customer")
    f += not check("clean customer value kept", cust.get("value") == "Beaumont Care Homes Ltd - Parkview")
    f += not check("clean customer value NOT flagged by Stage 4.5", not cust.get("validation_note"))
    print()
    return f


def test_ref_field_still_shape_enforced():
    print("ref field (typed 'text'): a shape-violating reference is STILL withheld")
    f = 0
    r = _run({"reference_number": {"value": "9999-9999", "confidence": 85, "method": "keyword_override"}})
    ref = _f(r, "reference_number")
    f += not check("reference_number nulled by shape enforcement (unchanged behaviour)",
                   ref.get("value") is None)
    f += not check("reference_number carries the 'enter manually' note",
                   "manually" in (ref.get("validation_note") or ""))
    print()
    return f


def main():
    fails = 0
    fails += test_text_value_preserved_on_shape_mismatch()
    fails += test_clean_text_value_unflagged()
    fails += test_ref_field_still_shape_enforced()
    if fails:
        print(f"{fails} check(s) failed — Stage 4.5 free-text preservation regressed.")
        return 1
    print("All checks passed — Stage 4.5 keeps free-text values, enforces shapes on refs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
