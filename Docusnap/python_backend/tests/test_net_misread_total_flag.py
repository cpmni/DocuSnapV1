#!/usr/bin/env python3
"""
Guards engine._net_misread_verdict + ExtractionEngine._flag_net_misread_total — the DEFAULT-OFF
net-misread total FLAG (NET_MISREAD_TOTAL_FLAG). A taught Stage-0.5 total that landed on the NET row
of a variable-line-count credit note can commit the net at high confidence when VAT didn't read (both
existing reconcile safeties starve because total_reconciles(net) FALSELY balances net==subtotal+0).
This pass FLAGS (caps to 50 + a review note) — NEVER swaps — when the committed total ≈ the subtotal
AND a distinct larger VAT-plausible confident total was also read.

THE SEAM THIS PINS (Oracle SIGN-OFF-W/COND 2026-08-06):
 - It must NOT gate on total_reconciles (the original design did -> inert on the vat-missing target).
   Test #2 is the critical regression pin: net==subtotal with NO vat still fires.
 - It must NOT flag a correct GROSS (differs from the net by a real VAT > tol) — test #5.
 - It must NOT flag a zero-VAT doc (net==gross, no larger candidate) — test #3.
 - It must NOT flag when the larger candidate is out of the VAT band (a running balance) — test #4.
 - It caps but NEVER swaps the value (fail-toward-review, preserves authoritative-anchor invariant).
 - OFF ⇒ byte-identical.

Run: py -3.12 python_backend/tests/test_net_misread_total_flag.py   (exit 0 = pass)
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as engine_mod
from extraction.engine import ExtractionEngine, _net_misread_verdict

fails = []
def check(label, cond):
    if not cond:
        fails.append(label)
    print(f"  {'OK ' if cond else 'BAD'} {label}")

def cand(v, c):
    return {"value": v, "confidence": c, "method": "keyword"}

# ── Pure verdict pins ──────────────────────────────────────────────────────────
NET = 1235.80
TOL = max(NET * 0.02, 0.05)            # 24.716
GROSS20 = "1482.96"                     # 1.20× (20% VAT)

print("1. net-misread with a 20% gross candidate -> fires")
v = _net_misread_verdict(NET, NET, [cand(GROSS20, 85)], TOL)
check("returns the gross candidate", v is not None and abs(v[0] - 1482.96) < 0.01)

print("2. CRITICAL regression pin — SAME case with NO vat considered (the original total_reconciles")
print("   design would early-return here and MISS it) -> still fires")
# The verdict function takes no vat at all; a vat-absent net-misread is exactly case 1 -> must fire.
v2 = _net_misread_verdict(NET, NET, [cand(GROSS20, 85)], TOL)
check("vat-absent net-misread still fires (no total_reconciles gate)", v2 is not None)

print("3. zero-VAT / no larger candidate -> no flag")
check("empty candidates -> None", _net_misread_verdict(NET, NET, [], TOL) is None)
check("only equal/smaller candidates -> None",
      _net_misread_verdict(NET, NET, [cand("1235.80", 90), cand("0.00", 90)], TOL) is None)

print("4. running-balance out of the VAT band (2.0×) -> no flag")
check("candidate at 2.0× rejected", _net_misread_verdict(NET, NET, [cand("2471.60", 90)], TOL) is None)

print("5. a CORRECT gross (differs from subtotal by real VAT > tol) -> no flag")
TOLg = max(1482.96 * 0.02, 0.05)
check("gross vs net-subtotal -> None (abs diff > tol protects it)",
      _net_misread_verdict(1482.96, NET, [cand(GROSS20, 85)], TOLg) is None)

print("6. a WEAK larger candidate (< conf floor 70) -> no flag")
check("gross candidate at conf 60 rejected", _net_misread_verdict(NET, NET, [cand(GROSS20, 60)], TOL) is None)

print("7. reggie's £0.00 'Amount Due' candidate is harmless (smaller than net)")
check("0.00 candidate ignored -> None", _net_misread_verdict(NET, NET, [cand("0.00", 95)], TOL) is None)

print("8. nearest-above wins (5% gross chosen over a far-larger figure)")
v8 = _net_misread_verdict(NET, NET, [cand("1297.59", 80), cand(GROSS20, 85)], TOL)   # 1.05× and 1.20×
check("nearest-above (1297.59) picked", v8 is not None and abs(v8[0] - 1297.59) < 0.01)

print("9. None inputs / non-positive -> no flag (never throws)")
check("None total -> None", _net_misread_verdict(None, NET, [cand(GROSS20, 85)], TOL) is None)
check("None subtotal -> None", _net_misread_verdict(NET, None, [cand(GROSS20, 85)], TOL) is None)
check("zero total -> None", _net_misread_verdict(0.0, 0.0, [cand(GROSS20, 85)], TOL) is None)

# ── Method-level wiring pins (_flag_net_misread_total) ──────────────────────────
class _Stub:
    """Duck-typed self — the method only touches _field_candidates + _t + module globals."""
    def __init__(self, cands):
        self._field_candidates = cands
        self.traces = []
    def _t(self, ev, **kw):
        self.traces.append((ev, kw))

FIELDS = [{"key": "total_amount", "type": "currency"}, {"key": "subtotal", "type": "currency"}]

def run_method(flag_on, results, cands):
    prev = engine_mod.NET_MISREAD_TOTAL_FLAG
    engine_mod.NET_MISREAD_TOTAL_FLAG = flag_on
    s = _Stub(cands)
    try:
        ExtractionEngine._flag_net_misread_total(s, results, FIELDS)
    finally:
        engine_mod.NET_MISREAD_TOTAL_FLAG = prev
    return s

print("10. flag ON: a net-misread total is capped to 50 + noted, value UNCHANGED (never swapped)")
res = {"total_amount": {"value": "1235.80", "confidence": 92, "method": "anchor_crop_relocated"},
       "subtotal":     {"value": "1235.80", "confidence": 90, "method": "keyword"}}
run_method(True, res, {"total_amount": [cand(GROSS20, 85)]})
t = res["total_amount"]
check("value unchanged (no swap)", t["value"] == "1235.80")
check("confidence capped to 50", t["confidence"] == 50)
check("review note names BOTH the filed value and the larger total (Chris copy)",
      "1482.96" in (t.get("validation_note") or "") and "1235.80" in (t.get("validation_note") or "")
      and "part-total" in (t.get("validation_note") or ""))

print("11. flag OFF: byte-identical (no cap, no note)")
res2 = {"total_amount": {"value": "1235.80", "confidence": 92, "method": "anchor_crop_relocated"},
        "subtotal":     {"value": "1235.80", "confidence": 90, "method": "keyword"}}
run_method(False, res2, {"total_amount": [cand(GROSS20, 85)]})
check("untouched when OFF", res2["total_amount"]["confidence"] == 92
      and not res2["total_amount"].get("validation_note"))

print("12. double-cap guard: an already-noted total is left alone")
res3 = {"total_amount": {"value": "1235.80", "confidence": 92, "method": "anchor",
                          "validation_note": "already flagged upstream"},
        "subtotal":     {"value": "1235.80", "confidence": 90}}
run_method(True, res3, {"total_amount": [cand(GROSS20, 85)]})
check("existing note preserved, not re-capped",
      res3["total_amount"]["confidence"] == 92
      and res3["total_amount"]["validation_note"] == "already flagged upstream")

print("13. no subtotal witness -> no flag (fail-safe)")
res4 = {"total_amount": {"value": "1235.80", "confidence": 92, "method": "anchor"}}
run_method(True, res4, {"total_amount": [cand(GROSS20, 85)]})
check("no cap without a subtotal witness", res4["total_amount"]["confidence"] == 92
      and not res4["total_amount"].get("validation_note"))

print("14. correct gross end-to-end: not flagged (abs diff > tol)")
res5 = {"total_amount": {"value": "1482.96", "confidence": 92, "method": "anchor"},
        "subtotal":     {"value": "1235.80", "confidence": 90}}
run_method(True, res5, {"total_amount": [cand(GROSS20, 85)]})
check("correct gross kept, unflagged", res5["total_amount"]["confidence"] == 92
      and not res5["total_amount"].get("validation_note"))

print()
if fails:
    print(f"{len(fails)} FAILED:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("All net-misread-total-flag pins passed")
sys.exit(0)
