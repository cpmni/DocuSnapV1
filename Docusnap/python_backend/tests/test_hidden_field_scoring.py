#!/usr/bin/env python3
"""
tests/test_hidden_field_scoring.py

HIDDEN_FIELD_SCORING (Oracle SIGN-OFF-WITH-CONDITIONS, 2026-07-27): a field the operator
declared "this layout lacks it" (template_hidden_fields, resolved per (supplier, type) by
template_matcher.hidden_fields_for_scope) no longer counts as an expected-but-missing 0 in
validator.overall_confidence — the "held at 72% with nothing flagged" cap on scopes whose
layout genuinely omits schema fields (live case: Northgate Service Worksheets #714-717).

EMPTY-ONLY exclusion (Oracle Condition 1 — load-bearing): a VALUED hidden field scores
exactly as before. Its drag is what keeps a ghost read (boilerplate/label collision into a
field the layout lacks) below 100, where the FULL docTrustGate runs — at 100 the structural
gate is opt-in-off by default, so removing the drag would let a ghost value file gate-free
AND be learned. Do NOT "improve" this to full key_fields filtering.

Also pins:
  * UNDECLARED missing fields still score 0 (the original "72% with two empty fields"
    guard must survive — anti-restore pin).
  * required∩hidden: scoring skips the 0 but needs_review still forces review (the
    operator's remedy is un-requiring the field).
  * format_consistency_delta needs NO exclude support (it builds signals from VALUED
    fields only — an empty hidden field never reached it).
  * resolver semantics byte-mirror the JS display resolver (shared vector file
    tests/data/vis_norm_vectors.json — the JS suite database/modules/
    test_hidden_field_scoring.js reads the SAME file, so drift breaks a suite).
  * NO branding-fingerprint backup arm in the scoring resolver (fail toward held).
  * protected_keys strip (identity keys + current ref/date roles) at consumption.

Run:  py -3.12 python_backend/tests/test_hidden_field_scoring.py
Exit 0 = all checks passed.  Exit 1 = failure(s).
"""

import inspect
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # cp1252 console safety
except Exception:
    pass

from extraction.validator import overall_confidence, format_consistency_delta, needs_review
from extraction.template_matcher import _norm_name_for_vis, hidden_fields_for_scope


def check(label: str, cond: bool) -> bool:
    print(f"  {'OK ' if cond else 'BAD'}  {label}")
    return cond


fails = 0

# ── The 07-27 live schema shape: 6 fields, none required (a wizard-made worksheet type). Since
#    2026-08-27 (mig 92 + document_types.assertStructuralRequired) NO writer produces this state
#    any more — the identity + ref/date roles are always required=1 — but the "every field"
#    fallback stays for fixtures like this one, so these pins keep guarding it. ───────────────
WS = [{"key": k, "required": False} for k in
      ("supplier_name", "reference_number", "date", "customer", "item", "serial_no")]
FOUR = {
    "supplier_name":    {"value": "Northgate Textiles",  "confidence": 90},
    "reference_number": {"value": "WS-98058",            "confidence": 97},
    "date":             {"value": "18-12-2026",          "confidence": 98},
    "customer":         {"value": "Halcyon Leisure Grp", "confidence": 94},
}

print("\n§1 exclude_keys=None is byte-identical (the 72%-bug baseline)")
v = overall_confidence(FOUR, WS)
fails += not check(f"4 valued + 2 undeclared empty -> {v} (expect 63)", v == 63)
fails += not check("exclude_keys=None identical", overall_confidence(FOUR, WS, exclude_keys=None) == v)

print("\n§2 declared-absent EMPTY fields excluded (the Northgate fix)")
v = overall_confidence(FOUR, WS, exclude_keys={"item", "serial_no"})
fails += not check(f"hidden {{item,serial_no}} empty -> {v} (expect 94 = mean of the 4 real fields)", v == 94)

print("\n§3 anti-restore: UNDECLARED missing fields STILL score 0")
# Do NOT widen exclusion beyond the declared keys — this is the original "72% with two
# empty fields" guard. Only item is declared; serial_no keeps its zero.
v = overall_confidence(FOUR, WS, exclude_keys={"item"})
fails += not check(f"hidden {{item}} only -> serial_no still 0 -> {v} (expect 75, not 94)", v == 75)

print("\n§4 EMPTY-ONLY: a VALUED hidden field scores exactly as today (Oracle C1)")
withghost = dict(FOUR)
withghost["item"] = {"value": "Information", "confidence": 85}   # ghost read into a declared-absent field
base = overall_confidence(withghost, WS)                          # (94+98+97+90+85+0)/6 = 77
v = overall_confidence(withghost, WS, exclude_keys={"item"})
fails += not check(f"valued hidden item counts as normal -> {v} == no-exclusion {base}", v == base == 77)
v = overall_confidence(withghost, WS, exclude_keys={"item", "serial_no"})
fails += not check(f"valued item kept (85 drags) + empty serial_no skipped -> {v} (expect 92, not 94)", v == 92)
lowghost = dict(FOUR); lowghost["item"] = {"value": "x", "confidence": 10}
v = overall_confidence(lowghost, WS, exclude_keys={"item", "serial_no"})
fails += not check(f"low-conf valued hidden still drags -> {v} (expect 77)", v == 77)

print("\n§5 required+hidden: scoring skips the 0, needs_review STILL forces review")
REQ = [{"key": "reference_number", "required": True}, {"key": "supplier_name", "required": False}]
only_sup = {"supplier_name": {"value": "X", "confidence": 90}}
v = overall_confidence(only_sup, REQ, exclude_keys={"reference_number"})
fails += not check(f"required key excluded+empty -> no scores -> {v} (expect 0 -> held)", v == 0)
fails += not check("needs_review still True on the empty required field",
                   needs_review(only_sup, REQ) is True)
fails += not check("needs_review NOT forced by an absent non-required field",
                   needs_review({"reference_number": {"value": "R-1", "confidence": 95}},
                                [{"key": "reference_number", "required": False},
                                 {"key": "item", "required": False}]) is False)

print("\n§6 all-excluded-empty -> 0 -> held (no ZeroDivisionError)")
v = overall_confidence({}, [{"key": "item", "required": False}], exclude_keys={"item"})
fails += not check(f"single excluded empty field -> {v} (expect 0)", v == 0)

print("\n§7 format_consistency_delta needs NO exclude support (empty fields never reach it)")
fails += not check("format_consistency_delta signature unchanged (no exclude_keys)",
                   "exclude_keys" not in inspect.signature(format_consistency_delta).parameters)
fails += not check("fc identical with/without the hidden empty fields present in schema",
                   format_consistency_delta(FOUR, WS, {"reference_number", "date", "customer"})
                   == format_consistency_delta(FOUR, WS[:4], {"reference_number", "date", "customer"}))

print("\n§8 shared JS↔Python parity vectors (tests/data/vis_norm_vectors.json)")
VEC = json.loads((Path(__file__).parent / "data" / "vis_norm_vectors.json").read_text(encoding="utf-8"))
for case in VEC["norm"]:
    got = _norm_name_for_vis(case["in"])
    fails += not check(f"norm({case['in']!r}) -> {got!r} (expect {case['out']!r})", got == case["out"])
for case in VEC["resolution"]:
    got = sorted(hidden_fields_for_scope(case["templates"], case["supplier"], case["slug"])["keys"])
    fails += not check(f"resolve[{case['name']}] -> {got} (expect {case['expect']})", got == case["expect"])

print("\n§9 resolver: NO branding arm, protected strip, trace metadata")
TPLS = [{"id": 33, "name": "Northgate Textiles", "document_type_slug": "service_worksheet",
         "group_id": None, "hidden_fields": ["item", "serial_no", "po_date", "supplier_name"],
         "keyword_fingerprint": ["northgate", "textiles", "fabric", "mill"]}]
# A fingerprint-only-resolvable scope must NOT resolve (deliberate: display may hide via the
# branding backup where scoring does not exclude — fail toward held).
r = hidden_fields_for_scope(TPLS, "Zzzz Unrelated", "service_worksheet")
fails += not check("no name match -> empty even though a fingerprint COULD match (no branding arm)",
                   r["keys"] == set() and r["template_ids"] == [] and r["arm"] is None)
# Protected keys (identity + the type's CURRENT ref/date roles) are stripped at consumption —
# closes the stale-row seam (role re-pointed onto an already-hidden key after the hide was saved).
r = hidden_fields_for_scope(TPLS, "Northgate Textiles", "service_worksheet",
                            protected_keys={"supplier_name", "customer_name", "po_date"})
fails += not check(f"protected strip -> {sorted(r['keys'])} (expect ['item','serial_no'])",
                   sorted(r["keys"]) == ["item", "serial_no"])
fails += not check("trace metadata: contributing template ids + arm",
                   r["template_ids"] == [33] and r["arm"] == "name")
# A template whose ONLY hidden keys are protected contributes nothing (ids stay clean).
r = hidden_fields_for_scope([{"id": 9, "name": "Northgate Textiles",
                              "document_type_slug": "service_worksheet", "group_id": None,
                              "hidden_fields": ["po_date"]}],
                            "Northgate Textiles", "service_worksheet", protected_keys={"po_date"})
fails += not check("all-protected template contributes nothing", r["keys"] == set() and r["template_ids"] == [])
# Missing hidden_fields key tolerated (old fixture rows).
r = hidden_fields_for_scope([{"id": 1, "name": "Northgate Textiles",
                              "document_type_slug": "service_worksheet", "group_id": None}],
                            "Northgate Textiles", "service_worksheet")
fails += not check("missing hidden_fields key tolerated", r["keys"] == set())

print()
if fails:
    print(f"FAILED: {fails} check(s)")
    sys.exit(1)
print("All hidden-field scoring checks passed.")
sys.exit(0)
