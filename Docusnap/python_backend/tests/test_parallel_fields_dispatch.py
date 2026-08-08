#!/usr/bin/env python3
"""
tests/test_parallel_fields_dispatch.py — Option C (2026-07-17): extract_with_anchors evaluates
anchors GROUPED BY field_key and, when DS_OCR_PARALLEL_FIELDS is set, runs the groups across a
thread pool (each field's crop OCR is a GIL-releasing tesseract.exe). The output MUST be
byte-identical to the sequential path because a reprocess feeds learning + auto-file.

Pins the risky dispatch logic WITHOUT real OCR/DB by stubbing _eval_field_group and _filter_anchors:
  1. same-field anchors land in ONE group (the priority short-circuit stays intra-group),
  2. OFF (sequential) == ON (pooled) merged results,
  3. the per-task sequential-retry belt recovers a group whose pooled task raises,
  4. trace (on_reject set) forces the sequential path even with the flag on.

Run: cd python_backend && py -3.12 tests/test_parallel_fields_dispatch.py
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import extraction.anchor as A

fails = 0
def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}" + (f"  [{extra}]" if extra and not cond else ""))
    if not cond: fails += 1

ANCHORS = [
    {"field_key": "invoice_number", "anchor_label": "inv",  "direction": "right"},   # group A, anchor 1
    {"field_key": "invoice_number", "anchor_label": "inv2", "direction": "right"},   # group A, anchor 2 (same key)
    {"field_key": "invoice_date",   "anchor_label": "date", "direction": "right"},   # group B
    {"field_key": "total_amount",   "anchor_label": "tot",  "direction": "right"},   # group C
]

_orig_filter = A._filter_anchors
_orig_eval   = A._eval_field_group

def run(stub, flag, on_reject=None):
    A._filter_anchors = lambda anchors, s, d: list(anchors)      # pass-through: relevant == ANCHORS
    A._eval_field_group = stub
    if flag: os.environ["DS_OCR_PARALLEL_FIELDS"] = "1"
    else:    os.environ.pop("DS_OCR_PARALLEL_FIELDS", None)
    try:
        return A.extract_with_anchors("a\nb", ANCHORS, "ACME", "invoice",
                                      page_images=None, on_reject=on_reject)
    finally:
        os.environ.pop("DS_OCR_PARALLEL_FIELDS", None)
        A._filter_anchors = _orig_filter
        A._eval_field_group = _orig_eval

# 1 + 2: grouping + OFF==ON
groups_seen = []
def stub(ga, *ctx):
    fk = ga[0]["field_key"]
    groups_seen.append(tuple(a["field_key"] for a in ga))
    return {fk: {"value": "V_" + fk, "confidence": 90, "method": "anchor"}}

off = run(stub, False)
groups_seen.clear()
on = run(stub, True)
check("same-field anchors form ONE group (short-circuit stays intra-group)",
      ("invoice_number", "invoice_number") in groups_seen)
check("3 distinct field-key groups",
      sorted(set(groups_seen)) == [("invoice_date",), ("invoice_number", "invoice_number"), ("total_amount",)])
check("OFF (sequential) == ON (pooled) merged results", off == on and off is not on)
check("all three fields committed", set(off) == {"invoice_number", "invoice_date", "total_amount"})

# 3: retry belt — a group whose POOLED task raises is re-run sequentially, result recovered
_raised = set()
def flaky(ga, *ctx):
    fk = ga[0]["field_key"]
    if fk == "invoice_date" and fk not in _raised:   # first (pooled) call raises; retry succeeds
        _raised.add(fk); raise RuntimeError("simulated pool-task failure")
    return {fk: {"value": "V_" + fk, "confidence": 90, "method": "anchor"}}
belt = run(flaky, True)
check("retry belt recovers a failed pooled group (no silent drop)",
      belt.get("invoice_date") == {"value": "V_invoice_date", "confidence": 90, "method": "anchor"})
check("belt run still committed all fields", set(belt) == {"invoice_number", "invoice_date", "total_amount"})

# 4: trace (on_reject set) forces sequential even with the flag on -> still correct
traced = run(stub, True, on_reject=lambda *a, **k: None)
check("trace + flag on still yields correct results (sequential forced)",
      set(traced) == {"invoice_number", "invoice_date", "total_amount"})

print(f"\n{'PASS' if not fails else 'FAIL'} — {fails} failure(s)")
sys.exit(1 if fails else 0)
