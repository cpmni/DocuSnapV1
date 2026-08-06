#!/usr/bin/env python3
"""tests/test_customer_po_labels.py — CUSTOMER_PO_LABELS (reggie 2026-08-09, DEFAULT OFF).

A seller's invoice / delivery note cross-references the BUYER's purchase order under captions the
shipped po_number label list misses ("Your PO", "Customer PO", "Cust PO"). Out of the box po_number
never reads it (systemic recall gap). This adds those captions (code-injected under the flag, config
unchanged); the value side is unchanged (PO_REF_DIGIT_GATE + alphanumeric _validate). The "Your Order"
family is EXCLUDED (activates a pre-existing sales_order_number double-fill); "Your Ref" EXCLUDED (too
generic). The …No/…Number form precedes the bare form (Larkspur caption-punctuation rule).

    py -3.12 tests/test_customer_po_labels.py   (from python_backend/)
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import keyword

CFG = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "config", "keyword_patterns.json"), encoding="utf-8"))
fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond: fails += 1
def setflag(v):
    if v is None: os.environ.pop("CUSTOMER_PO_LABELS", None)
    else: os.environ["CUSTOMER_PO_LABELS"] = v
def po(text):  return (keyword.extract_fields(text, ["po_number"], CFG).get("po_number") or {}).get("value")
def son(text): return (keyword.extract_fields(text, ["sales_order_number"], CFG).get("sales_order_number") or {}).get("value")

setflag("1")
print("ON — po_number now reads the buyer's cross-referenced PO:")
check("'Your PO: 4471-22' -> 4471-22",                 po("Your PO: 4471-22\n") == "4471-22")
check("'Your PO No. PO-1234' -> PO-1234 (No + dot consumed by the label, not the value)",
      po("Your PO No. PO-1234\n") == "PO-1234")
check("'Customer PO Number  40021985' -> 40021985",    po("Customer PO Number  40021985\n") == "40021985")
check("'Cust PO 22954' -> 22954",                      po("Cust PO 22954\n") == "22954")
check("'Your PO Number 887766' -> 887766",             po("Your PO Number 887766\n") == "887766")

print("ON — the value-side gates still reject non-PO tails:")
check("'Your PO: A1' -> None (one digit, fails PO_REF_DIGIT_GATE)", po("Your PO: A1\n") is None)
check("'Please quote your PO on all correspondence' -> None (no 2-digit run)",
      po("Please quote your PO on all correspondence\n") is None)

print("ON — excluded captions never read as po_number:")
check("'Your Ref: ACC-5567' -> None (Your Ref excluded — it is an account/foreign ref)",
      po("Your Ref: ACC-5567\n") is None)
check("'Your Order No 12' -> None (Your Order family excluded — sales_order collision)",
      po("Your Order No 12\n") is None)

print("ON — no sales_order_number double-fill from the PO family:")
check("'Your PO No: PO-1234' does NOT fill sales_order_number",
      son("Your PO No: PO-1234\n") is None)

print("OFF (CUSTOMER_PO_LABELS unset) — byte-identical to before the fix:")
setflag(None)
check("OFF: 'Your PO: 4471-22' -> po_number NOT read (pre-fix state)", po("Your PO: 4471-22\n") is None)
check("OFF: shipped 'PO Number: PO-1234' still reads", po("PO Number: PO-1234\n") == "PO-1234")

print()
print(f"{fails} FAILED" if fails else "All CUSTOMER_PO_LABELS checks passed")
sys.exit(1 if fails else 0)
