#!/usr/bin/env python3
"""
Guards engine._reconciliation_pick_total: when the resolved `total` does NOT balance against the
components (subtotal + tax + shipping - discount) but a CONFIDENT remembered candidate DOES, the
engine swaps to it — so a drifted total-mapping / wrong-row anchor that displaced a correct keyword
read ("total grabbed the Net-Total 84.40 over the Invoice-Total 101.28") is corrected by objective
arithmetic. A correct total (incl. a correct ⊕ teach) reconciles, so it's never touched; a weak /
garbage candidate can't win; no subtotal -> no swap.

Run: py -3.12 python_backend/tests/test_reconciliation_pick.py   (exit 0 = pass)
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as engine_mod
from extraction.engine import ExtractionEngine

CONFIG = str(Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")
FIELDS = [{"key": "total", "type": "currency"},
          {"key": "subtotal", "type": "currency"},
          {"key": "vat_tax", "type": "currency"}]

fails = []
def check(label, cond):
    if not cond:
        fails.append(label)
    print(f"  {'OK ' if cond else 'BAD'} {label}")

def run(kw, anchor):
    """Run the pipeline with keyword + anchor stages mocked (real validator + reconciliation pick)."""
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    ok, oa = engine_mod.keyword.extract_fields, engine_mod.anchor.extract_with_anchors
    engine_mod.keyword.extract_fields = lambda *a, **k: {kk: dict(vv) for kk, vv in kw.items()}
    engine_mod.anchor.extract_with_anchors = lambda *a, **k: {kk: dict(vv) for kk, vv in anchor.items()}
    try:
        return eng.extract(ocr_text="stub", page_images=[], filename="t.pdf", field_defs=FIELDS,
                           hints=[], anchors=[{"field_key": "total"}], logos=[], templates=[],
                           document_type="Invoice", document_slug="invoice")
    finally:
        engine_mod.keyword.extract_fields, engine_mod.anchor.extract_with_anchors = ok, oa

def _f(r, k):
    return r.get(k) or {}

# 1) DRIFT corrected: authoritative anchor total 84.40 (doesn't balance) displaced the keyword
#    101.28 (which balances 84.40 + 16.88) -> reconciliation swaps it back.
print("1. a non-balancing authoritative total is swapped to the balancing candidate")
kw = {"total": {"value": "101.28", "confidence": 93, "method": "keyword"},
      "subtotal": {"value": "84.40", "confidence": 90, "method": "keyword"},
      "vat_tax": {"value": "16.88", "confidence": 90, "method": "keyword"}}
anc = {"total": {"value": "84.40", "confidence": 85, "method": "anchor",
                 "authoritative": True, "located": True}}
r = run(kw, anc)
tot = _f(r, "total")
check("total corrected to the balancing 101.28", tot.get("value") == "101.28")
check("swap is review-flagged ('balances … please verify')",
      "balances" in (tot.get("validation_note") or ""))

# 2) A CORRECT total (reconciles) is NEVER touched — even authoritative, even with a distinct candidate.
print("2. a correct (balancing) total is left alone")
kw2 = {"total": {"value": "999.99", "confidence": 93, "method": "keyword"},   # a distinct candidate
       "subtotal": {"value": "84.40", "confidence": 90, "method": "keyword"},
       "vat_tax": {"value": "16.88", "confidence": 90, "method": "keyword"}}
anc2 = {"total": {"value": "101.28", "confidence": 85, "method": "anchor",
                  "authoritative": True, "located": True}}
r2 = run(kw2, anc2)
check("correct total 101.28 kept (not swapped to the distinct 999.99)",
      _f(r2, "total").get("value") == "101.28")
check("no reconciliation note on a correct total",
      "balances" not in (_f(r2, "total").get("validation_note") or ""))

# 3) A WEAK balancing candidate (< conf floor) does NOT win — no swap to a low-confidence read.
print("3. a weak balancing candidate can't win")
kw3 = {"total": {"value": "101.28", "confidence": 40, "method": "keyword"},   # balances but weak
       "subtotal": {"value": "84.40", "confidence": 90, "method": "keyword"},
       "vat_tax": {"value": "16.88", "confidence": 90, "method": "keyword"}}
anc3 = {"total": {"value": "84.40", "confidence": 85, "method": "anchor",
                  "authoritative": True, "located": True}}
r3 = run(kw3, anc3)
check("weak candidate did NOT win — total stays 84.40", _f(r3, "total").get("value") == "84.40")

# 4) No subtotal -> can't reconcile -> no swap.
print("4. no subtotal -> no swap (can't verify)")
kw4 = {"total": {"value": "101.28", "confidence": 93, "method": "keyword"}}
anc4 = {"total": {"value": "84.40", "confidence": 85, "method": "anchor",
                  "authoritative": True, "located": True}}
r4 = run(kw4, anc4)
check("with no subtotal the total is not swapped", _f(r4, "total").get("value") == "84.40")

if fails:
    print(f"\n{len(fails)} FAILED"); sys.exit(1)
print("\nAll reconciliation-pick checks passed.")
