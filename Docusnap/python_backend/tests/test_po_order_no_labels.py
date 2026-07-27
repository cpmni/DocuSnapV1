#!/usr/bin/env python3
"""tests/test_po_order_no_labels.py — PO_ORDER_NO_LABELS (reggie/Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-27).

po_number lacked "Order No."/"Order Number" labels, so a PO whose printed ref label is the bare
"Order No." had NO Stage-1 reader and depended solely on the skew-fragile anchor crop (007's measured
PO-78399 -> PO-78309 misread). This adds the labels (code-injected under the flag; config unchanged) +
a qualified-caption guard: a bare "Order …" caption is rejected when preceded by a KIND/PARTY qualifier
("Sales/Delivery/Purchase/Your Order No"), so it can't cross-grab a foreign ref. The guard is
bidirectional — it also closes the LATENT bug where sales_order_number's pre-existing bare "Order No"
grabbed a "Purchase Order No. PO-…".

    py -3.12 tests/test_po_order_no_labels.py   (from python_backend/)
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
    if v is None: os.environ.pop("PO_ORDER_NO_LABELS", None)
    else: os.environ["PO_ORDER_NO_LABELS"] = v
def po(text):  return (keyword.extract_fields(text, ["po_number"], CFG).get("po_number") or {}).get("value")
def son(text): return (keyword.extract_fields(text, ["sales_order_number"], CFG).get("sales_order_number") or {}).get("value")

setflag("1")
print("ON — po_number reads the bare 'Order No' the shipped bank lacked:")
check("'Order No. PO-78399' -> PO-78399 (007's doc 669)",  po("Order No. PO-78399\n") == "PO-78399")
check("'Order No: PO-500' -> PO-500",                       po("Order No: PO-500\n") == "PO-500")
check("'Order Number 4500012345' -> 4500012345",           po("Order Number 4500012345\n") == "4500012345")
check("explicit 'Purchase Order No. PO-78399' still reads (explicit label ordered before bare; "
      "the config label keeps a pre-existing leading '. ' — out of this slice's scope)",
      "PO-78399" in (po("Purchase Order No. PO-78399\n") or ""))

print("ON — the qualified-caption guard rejects a foreign KIND/PARTY of order:")
check("'Sales Order No. SO-77608' -> NOT po_number",  po("Sales Order No. SO-77608\n") is None)
check("'Customer Order No. CO-9' -> NOT po_number",   po("Customer Order No. CO-9\n") is None)
check("'Delivery Order No DO-9' -> NOT po_number",    po("Delivery Order No DO-9\n") is None)
check("'Your Order No 12' -> NOT po_number",          po("Your Order No 12\n") is None)

print("ON — the LATENT sales_order_number leak is closed (bidirectional guard):")
check("'Purchase Order No. PO-78399' -> NOT sales_order_number (was a cross-grab)",
      son("Purchase Order No. PO-78399\n") is None)
check("'Sales Order No. SO-77608' still reads sales_order_number (its explicit label, unguarded)",
      "SO-77608" in (son("Sales Order No. SO-77608\n") or ""))

print("OFF (PO_ORDER_NO_LABELS=0) — byte-identical to before the fix:")
setflag("0")
check("OFF: 'Order No. PO-78399' -> po_number NOT read (pre-fix state)", po("Order No. PO-78399\n") is None)
check("OFF: 'Purchase Order No. PO-78399' still reads (shipped label untouched)",
      "PO-78399" in (po("Purchase Order No. PO-78399\n") or ""))
check("OFF: sales_order_number's bare 'Order Number: 512' still reads (guard inert)",
      son("Order Number: 512\n") == "512")
setflag(None)

print()
print(f"{fails} FAILED" if fails else "All PO Order-No label checks passed")
sys.exit(1 if fails else 0)
