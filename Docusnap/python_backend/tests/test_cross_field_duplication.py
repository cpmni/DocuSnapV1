#!/usr/bin/env python3
"""tests/test_cross_field_duplication.py — pins the CROSS-FIELD DUPLICATION guard
(Slice 1, 2026-07-10 night; built on the user's explicit POLICY OVERRIDE of the Slice-0
do-nothing gate — belt-and-braces over conditional deployment; the offline twin is
stress_test/crossfield_sweep.py, which imports the SAME predicate).

    py -3.12 tests/test_cross_field_duplication.py    (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction.value_quality import contains_structured_sibling
from extraction.engine import ExtractionEngine

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


P = contains_structured_sibling

print("predicate — fires on wrong-row captures:")
check("KO_wor_41: \"Reference 'WS703182\" contains 'WS703182'",
      P("Reference 'WS703182", "WS703182") is True)
check("caption+value compound 'Reference No. WS703182'",
      P("Reference No. WS703182", "WS703182") is True)
check("date swallowed whole ('Delivery 30-12-2025 Ltd')",
      P("Delivery 30-12-2025 Ltd", "30-12-2025") is True)

print("predicate — never fires on the guarded false-positive classes:")
check("'2026 Holdings Ltd' vs a DATE sibling's whole value (the year class)",
      P("2026 Holdings Ltd", "30-12-2025") is False)
check("pure-alpha sibling can't fire ('MEADOW' in 'Meadowbrook Vets')",
      P("Meadowbrook Vets", "MEADOW") is False)
check("short sibling (<5 normalised) can't fire", P("Unit 42 Ltd", "42") is False)
check("mid-token overlap is NOT boundary-aligned ('WS703182X' vs 'WS703182')",
      P("Reference WS703182X", "WS703182") is False)
check("empty/None inputs", P("", "WS703182") is False and P("x", None) is False)

# ── seam block (results-dict harness, mirrors the engine call) ───────────────────────────
F = ExtractionEngine._flag_cross_field_duplication

def mk(cust_val, cust_conf=82, cust_method="anchor_crop_relocated", cust_note=None,
       ref_conf=95, ref_note=None):
    r = {"customer": {"value": cust_val, "confidence": cust_conf, "method": cust_method},
         "reference_number": {"value": "WS703182", "confidence": ref_conf,
                              "method": "anchor_crop"}}
    if cust_note:
        r["customer"]["validation_note"] = cust_note
    if ref_note:
        r["reference_number"]["validation_note"] = ref_note
    return r

print("seam — the KO_wor_41 shape:")
r = mk("Reference 'WS703182")
F(r)
check("fires: conf capped to 69", r["customer"]["confidence"] == 69)
check("fires: note names the sibling", "reference number" in (r["customer"].get("validation_note") or "")
      and "WS703182" in (r["customer"].get("validation_note") or ""))
# Review ROUTING is via the cap itself (Oracle A2): 69 < the default 70 per-field threshold
# trips validator.needs_review, and the NOTE blocks auto-file/bulk-file. The helper must NOT
# set results['_needs_review'] (dead code — the pipeline reassigns it unconditionally).
check("fires: routed to review by construction (69 < 70 threshold + note present)",
      r["customer"]["confidence"] < 70 and bool(r["customer"].get("validation_note")))
check("no dead _needs_review set (Oracle A2)", "_needs_review" not in r)
check("HOLD-only: the VALUE is untouched", r["customer"]["value"] == "Reference 'WS703182")
check("sibling untouched entirely", r["reference_number"]["confidence"] == 95
      and not r["reference_number"].get("validation_note"))

print("seam — preserved behaviours and exemptions:")
r2 = mk("Reference 'WS703182", cust_note="looks like a reference/code, not a name")
F(r2)
check("existing (wordness) note PRESERVED, cap still applied",
      r2["customer"]["validation_note"] == "looks like a reference/code, not a name"
      and r2["customer"]["confidence"] == 69)
r3 = mk("Meadowbrook Vets")
F(r3)
check("clean name untouched (no fire)", r3["customer"]["confidence"] == 82
      and not r3["customer"].get("validation_note") and "_needs_review" not in r3)
r4 = mk("Reference 'WS703182", cust_method="manual")
F(r4)
check("manual (human-typed) values exempt", r4["customer"]["confidence"] == 82)
r5 = mk("Reference 'WS703182", ref_conf=70)
F(r5)
check("low-confidence sibling (<80) never condemns", r5["customer"]["confidence"] == 82)
r6 = mk("Reference 'WS703182", ref_note="flagged for review")
F(r6)
check("a NOTED sibling never condemns", r6["customer"]["confidence"] == 82)
r7 = mk("Reference 'WS703182", cust_conf=60)
F(r7)
check("a lower incumbent conf is kept (min)", r7["customer"]["confidence"] == 60)

# TRADE-OFF PIN (gary P1, accepted): a layout that LEGITIMATELY prints the ref inside the
# customer cell flags every doc at 69+note until the slice-2 evidence exemption — asserted
# as the intended outcome so a future dev can't restore the silent commit to kill the nag.
r8 = mk("Meadowbrook Vets WS703182")
F(r8)
check("TRADE-OFF PIN: legit compound layout IS flagged (accepted nag until slice 2)",
      r8["customer"]["confidence"] == 69 and bool(r8["customer"].get("validation_note")))

print()
print(f"{fails} FAILED" if fails else "All cross-field duplication checks passed")
sys.exit(1 if fails else 0)
