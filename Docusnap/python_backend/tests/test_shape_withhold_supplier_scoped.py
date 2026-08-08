#!/usr/bin/env python3
"""
tests/test_shape_withhold_supplier_scoped.py
--------------------------------------------
Cross-contamination fix (iris diagnosis + gary design + Oracle SIGN-OFF-W/COND).

A learned ref SHAPE stored under the cross-supplier doc-type aggregate key ('', type, field)
must NOT hard-NULL a cleanly-read ref from a BRAND-NEW (unconfirmed) supplier — one supplier's
ref convention (e.g. Copperfield's INV-#####) cannot veto another supplier's shape. On a single-
confirmed-supplier install the ('') aggregate IS that one supplier's convention, so it withheld
every stranger ref whose shape differed (born-digital Set A: ref 84.7% cold -> 50% warm).

Fix (engine.py Stage 4.5): when the shape verdict rests ONLY on the ('') aggregate (_xsupplier —
no supplier-scoped format for this (supplier,field)), FLAG the value for review instead of nulling
it. A SUPPLIER-SCOPED shape still hard-nulls (the incumbent-misread guard). Kill switch
SHAPE_WITHHOLD_SUPPLIER_SCOPED, DEFAULT OFF => byte-identical.

Pins (Oracle C4 fail-safe value-recovery half + C5 trade-off boundary):
  1. _xsupplier stranger ref FLAGS-not-NULLS (switch ON) — the recovery.
  2. switch OFF => still NULLS (the byte-identical guarantee).
  3. supplier-scoped garble STILL NULLS even with the switch ON — asserts the _xsupplier=False
     branch, the boundary that stops a future dev extending flag-not-null to a supplier's own shape.

OCR stages stubbed; needs no Tesseract.
    py -3.12 python_backend/tests/test_shape_withhold_supplier_scoped.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as engine_mod
from extraction.engine import ExtractionEngine

CONFIG = str(Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")
SWITCH = "SHAPE_WITHHOLD_SUPPLIER_SCOPED"

# A learned ref shape that reliably populates fmt_entry['shapes'] (####-####-#) so the value below
# hits the terminal shape-WITHHOLD branch (proven by test_stage45_text_preserve's REF_HISTORY). The
# real-world recovery on Set A's own ref shapes is proven separately by the score_demo_digital gate.
REF_HISTORY = ["2603-1351-1", "7602-1354-4", "1234-5678-9"]
BAD_REF     = "9999-9999"   # violates the 3-group ####-####-# shape → the withhold branch
XSUP_FMT = [{"supplier_name": "", "document_type": "wsheet", "field_key": "reference_number",
             "sample_values": REF_HISTORY, "confirmed_count": 20}]
SUP_FMT  = [{"supplier_name": "Copperfield Electrical", "document_type": "wsheet",
             "field_key": "reference_number", "sample_values": REF_HISTORY, "confirmed_count": 20}]
FIELDS = [{"key": "supplier_name", "type": "text"},
          {"key": "reference_number", "type": "text"}]   # ref typed "text", as in the real DB


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


def _run_fmt(kw_results, formats):
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    eng.set_formats(formats)
    orig_kw = engine_mod.keyword.extract_fields
    orig_an = engine_mod.anchor.extract_with_anchors
    orig_va = engine_mod.validator.validate_and_adjust
    engine_mod.keyword.extract_fields = lambda *a, **k: {kk: dict(vv) for kk, vv in kw_results.items()}
    engine_mod.anchor.extract_with_anchors = lambda *a, **k: {}
    engine_mod.validator.validate_and_adjust = lambda results, field_defs, **kw: results  # isolate Stage 4.5
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


def _with_switch(val, fn):
    prev = os.environ.get(SWITCH)
    if val is None:
        os.environ.pop(SWITCH, None)
    else:
        os.environ[SWITCH] = val
    try:
        return fn()
    finally:
        if prev is None:
            os.environ.pop(SWITCH, None)
        else:
            os.environ[SWITCH] = prev


def test_xsupplier_stranger_ref_flags_not_nulls():
    print("DEFAULT (fix ON): a stranger ref that differs from the ('') shape is KEPT + flagged, not nulled")
    f = 0
    r = _with_switch(None, lambda: _run_fmt(
        {"reference_number": {"value": BAD_REF, "confidence": 85, "method": "keyword"}}, XSUP_FMT))
    ref = _f(r, "reference_number")
    f += not check(f"'{BAD_REF}' kept (NOT nulled by the cross-supplier shape)", ref.get("value") == BAD_REF)
    f += not check(f"'{BAD_REF}' flagged with a 'verify' note", "verify" in (ref.get("validation_note") or ""))
    f += not check(f"'{BAD_REF}' confidence capped <= 70", (ref.get("confidence") or 0) <= 70)
    print()
    return f


def test_kill_switch_off_stranger_ref_still_nulled():
    print("kill switch =0: the SAME stranger ref is NULLED — the legacy withhold is restored")
    f = 0
    r = _with_switch("0", lambda: _run_fmt(
        {"reference_number": {"value": BAD_REF, "confidence": 85, "method": "keyword"}}, XSUP_FMT))
    ref = _f(r, "reference_number")
    f += not check("value nulled (kill switch =0 restores the legacy withhold)", ref.get("value") is None)
    f += not check("carries the 'enter manually' note", "manually" in (ref.get("validation_note") or ""))
    print()
    return f


def test_supplier_scoped_garble_still_withheld():
    print("DEFAULT (fix ON), CONFIRMED supplier (_xsupplier False): a supplier's OWN shape-violating ref STILL NULLS")
    f = 0
    r = _with_switch(None, lambda: _run_fmt({
        "supplier_name":   {"value": "Copperfield Electrical", "confidence": 95, "method": "logo"},
        "reference_number": {"value": BAD_REF, "confidence": 85, "method": "keyword"},
    }, SUP_FMT))
    ref = _f(r, "reference_number")
    # The boundary lock (Oracle C5): with a supplier-scoped format the withhold is byte-unchanged,
    # so the incumbent-misread guard survives — a future dev can't extend flag-not-null here.
    f += not check("supplier-own garble nulled (the withhold is preserved for _xsupplier=False)",
                   ref.get("value") is None)
    f += not check("carries the 'enter manually' note", "manually" in (ref.get("validation_note") or ""))
    print()
    return f


if __name__ == "__main__":
    fails = 0
    for t in (test_xsupplier_stranger_ref_flags_not_nulls,
              test_kill_switch_off_stranger_ref_still_nulled,
              test_supplier_scoped_garble_still_withheld):
        fails += t()
    print(f"{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
    sys.exit(1 if fails else 0)
