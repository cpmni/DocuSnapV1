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


def _run_fmt(kw_results, formats, fields):
    """As _run but with caller-supplied confirmed formats + field defs."""
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    eng.set_formats(formats)
    orig_kw = engine_mod.keyword.extract_fields
    orig_an = engine_mod.anchor.extract_with_anchors
    orig_va = engine_mod.validator.validate_and_adjust
    engine_mod.keyword.extract_fields = lambda *a, **k: {kk: dict(vv) for kk, vv in kw_results.items()}
    engine_mod.anchor.extract_with_anchors = lambda *a, **k: {}
    engine_mod.validator.validate_and_adjust = lambda results, field_defs: results
    try:
        return eng.extract(ocr_text="stub", page_images=[], filename="t.pdf",
                           field_defs=fields, hints=[], anchors=[], logos=[], templates=[],
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


def test_strong_token_repair_auto_applied():
    print("name repair: a near-universal token misread ('Lid'->'Ltd') is AUTO-APPLIED, not just suggested")
    f = 0
    # 'Ltd' is at doc_freq 1.0 across the customer history → a 1-glyph misread is a
    # confident fix. The VALUE is corrected (not only flagged), and a high-confidence
    # fix is not review-forced.
    r = _run({"customer": {"value": "Beaumont Care Homes Lid - Parkview", "confidence": 90, "method": "keyword_override"}})
    cust = _f(r, "customer")
    f += not check("value auto-corrected 'Lid' -> 'Ltd'",
                   cust.get("value") == "Beaumont Care Homes Ltd - Parkview")
    f += not check("was_corrected flag set", cust.get("was_corrected") is True)
    f += not check("confidence kept (not capped to 70) -> not review-forced",
                   (cust.get("confidence") or 0) >= 70 and not r.get("_needs_review"))
    f += not check("note records the correction + the original read",
                   "Auto-corrected" in (cust.get("validation_note") or "")
                   and "Lid" in (cust.get("validation_note") or ""))
    print()
    return f


def test_varied_site_new_name_not_flagged():
    print("name field: a NEW site (different length) is NOT flagged when the prefix conforms")
    f = 0
    # Varied confirmed sites -> no single site dominates -> the site position is
    # variable. A brand-new site of a never-seen LENGTH ('Clandeboye') used to trip
    # the learned-shape check ("format differs"); the name-lexicon conformance now
    # recognises the stable prefix and suppresses that false flag.
    varied = ["Beaumont Care Homes Ltd - Parkview", "Beaumont Care Homes Ltd - Bangor",
              "Beaumont Care Homes Ltd - Holywood", "Beaumont Care Homes Ltd - Belmont"]
    fmts = [{"supplier_name": "", "document_type": "wsheet", "field_key": "customer",
             "sample_values": varied, "confirmed_count": 12,
             "value_counts": {varied[0]: 3, varied[1]: 3, varied[2]: 3, varied[3]: 3}}]
    flds = [{"key": "customer", "type": "text"}]
    r = _run_fmt({"customer": {"value": "Beaumont Care Homes Ltd - Clandeboye", "confidence": 90,
                               "method": "keyword_override"}}, fmts, flds)
    cust = _f(r, "customer")
    f += not check("new-site value kept", cust.get("value") == "Beaumont Care Homes Ltd - Clandeboye")
    f += not check("new-site value NOT flagged ('format differs' suppressed)", not cust.get("validation_note"))
    # A genuinely WRONG prefix is still flagged.
    r2 = _run_fmt({"customer": {"value": "Totally Different Co - Clandeboye", "confidence": 90,
                                "method": "keyword_override"}}, fmts, flds)
    f += not check("wrong-prefix value IS still flagged", bool(_f(r2, "customer").get("validation_note")))
    print()
    return f


def test_identity_field_not_flagged_by_global_supplier_shape():
    """A supplier IDENTITY field (supplier_name/customer_name) must NOT be validated against the
    GLOBAL cross-supplier format: its value IS the scope key, so the global aggregates DIFFERENT
    suppliers. When one supplier dominates the corpus (SuperStore = 78 of 84 docs) the global
    learns ONLY that name's shape ('@@@@@@@@@@') + "SuperStore" prefix, and without the exemption
    every OTHER supplier ("City Office NI") is flagged 'format differs'. A NON-identity name field
    keeps the global fallback (so canonical-token repair still works)."""
    f = 0
    SUP_HIST = ["SuperStore", "City Office NI", "Profile Construction", "Contoso Asia"]
    counts = {"SuperStore": 78, "City Office NI": 3, "Profile Construction": 2, "Contoso Asia": 1}
    print("identity field: a different supplier's name is NOT flagged by the dominated global format")
    sup_fmt = [{"supplier_name": "", "document_type": "wsheet", "field_key": "supplier_name",
                "sample_values": SUP_HIST, "confirmed_count": 84, "value_counts": counts}]
    r = _run_fmt({"supplier_name": {"value": "City Office NI", "confidence": 90, "method": "logo"}},
                 sup_fmt, [{"key": "supplier_name", "type": "text"}])
    sup = _f(r, "supplier_name")
    f += not check("identity value kept", sup.get("value") == "City Office NI")
    f += not check("identity NOT flagged 'format differs'", not sup.get("validation_note"))
    f += not check("identity confidence not capped", (sup.get("confidence") or 0) >= 90)
    # (The non-identity global fallback stays active — proven by the Lid->Ltd customer repair in
    # test_strong_token_repair_auto_applied, which relies on the '' global customer format.)
    print()
    return f


def main():
    fails = 0
    fails += test_text_value_preserved_on_shape_mismatch()
    fails += test_clean_text_value_unflagged()
    fails += test_ref_field_still_shape_enforced()
    fails += test_strong_token_repair_auto_applied()
    fails += test_varied_site_new_name_not_flagged()
    fails += test_identity_field_not_flagged_by_global_supplier_shape()
    if fails:
        print(f"{fails} check(s) failed — Stage 4.5 free-text preservation regressed.")
        return 1
    print("All checks passed — Stage 4.5 keeps free-text values, enforces shapes on refs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
