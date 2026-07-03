#!/usr/bin/env python3.12
# Stage 3: validator total-reconciliation guardrail. The total is cross-checked against
# the subtotal (+ tax/shipping/discount when present) so a positional misread of a
# neighbouring currency is FLAGGED for review instead of auto-filing at high confidence,
# while a total that reconciles is TRUSTED even on a mediocre scan.
# Run: py -3.12 python_backend/tests/test_total_reconciliation.py
import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from extraction import validator

fail = 0
def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1

FIELDS = [{"key": "total_amount", "type": "currency"},
          {"key": "subtotal",     "type": "currency"},
          {"key": "vat_tax",      "type": "currency"}]

def run(**vals):
    ex = {k: {"value": v, "confidence": 90, "method": "keyword"} for k, v in vals.items() if v is not None}
    r = validator.validate_and_adjust(ex, FIELDS)
    t = r.get("total_amount", {})
    return t.get("confidence"), t.get("validation_note")

# CLOSE — reconciles -> trusted (confidence kept, no note).
c, n = run(subtotal="100.00", vat_tax="9.00", total_amount="109.00")
check("CLOSE (100+9=109) -> trusted, no note", c == 90 and not n)

c, n = run(subtotal="105.96", total_amount="105.96")
check("CLOSE (no tax, total==subtotal) -> trusted", c == 90 and not n)

# CONTRADICT — total < subtotal (a smaller line read as the total) -> flagged + review.
c, n = run(subtotal="105.96", total_amount="3.17")
check("total < subtotal -> flagged + capped", c <= 50 and n and "less than the subtotal" in n)

# CONTRADICT — tax present but total == subtotal (grabbed the subtotal row).
c, n = run(subtotal="105.96", vat_tax="9.00", total_amount="105.96")
check("subtotal-grab (tax present, total==subtotal) -> flagged", c <= 50 and n and "subtotal" in n)

# CONTRADICT — components present but nothing reconciles.
c, n = run(subtotal="100.00", vat_tax="9.00", total_amount="200.00")
check("doesn't add up (100+9!=200) -> flagged", c <= 50 and n and "add up" in n)

# CONTRADICT — total wildly larger than subtotal, no tax/shipping to explain it.
c, n = run(subtotal="105.96", total_amount="3446.16")
check("total >> subtotal (>2.5x), no components -> flagged", c <= 50 and n and "much larger" in n)

# NEUTRAL — only subtotal known, total a plausible subtotal+shipping (<2.5x) -> no penalty.
c, n = run(subtotal="100.00", total_amount="112.00")
check("plausible uncaptured shipping (112 vs 100) -> NOT flagged", c == 90 and not n)

# NO CHECK — no subtotal to reconcile against -> left as-is.
c, n = run(total_amount="109.13")
check("no subtotal -> no reconciliation, left as-is", c == 90 and not n)

print("\n" + ("FAILED" if fail else "All total-reconciliation checks passed."))
sys.exit(1 if fail else 0)
