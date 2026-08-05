#!/usr/bin/env python3
"""tests/test_total_gross_labels.py — TOTAL_GROSS_LABELS (reggie 2026-08-06, DEFAULT OFF).

The shipped total_amount label bank misses common grand-total captions ("Total to Pay",
"Balance to Pay", "Amount Now Due", "Net to Pay", "Total (inc VAT)", "Total Charge"), so on those
layouts keyword reads NO gross — tanking the total lane (measured cold 40.6%->50.0%, M=0) and
starving the net-misread flag (no gross candidate). This adds them in CODE, behind the flag, config
unchanged so OFF => byte-identical. reggie cleared each of subtotal collision; the OFF/ON pins below
use captions bare "Total" CANNOT reach (no "total" word) so the difference is decisive.

    py -3.12 python_backend/tests/test_total_gross_labels.py
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
    if v is None: os.environ.pop("TOTAL_GROSS_LABELS", None)
    else: os.environ["TOTAL_GROSS_LABELS"] = v
def _has(v, digits): return digits in (v or "")
def tot(text): return (keyword.extract_fields(text, ["total_amount"], CFG).get("total_amount") or {}).get("value")
def both(text):
    r = keyword.extract_fields(text, ["total_amount", "subtotal"], CFG)
    return ((r.get("total_amount") or {}).get("value"), (r.get("subtotal") or {}).get("value"))

BLOCK = "Net Total £551.82\nVAT @ 20% £110.36\n{gross} £662.18\n"

setflag("1")
print("ON — grand-total captions the shipped bank lacks are read as the gross:")
check("'Balance to Pay' -> 662.18",  _has(tot(BLOCK.format(gross="Balance to Pay")), "662.18"))
check("'Amount Now Due' -> 662.18",  _has(tot(BLOCK.format(gross="Amount Now Due")), "662.18"))
check("'Total to Pay' -> 662.18",    _has(tot(BLOCK.format(gross="Total to Pay")), "662.18"))
check("'Total (inc VAT)' paren literal -> 662.18", _has(tot(BLOCK.format(gross="Total (inc VAT)")), "662.18"))
check("'Total Incl. VAT' period literal -> 662.18", _has(tot(BLOCK.format(gross="Total Incl. VAT")), "662.18"))
check("'Total Charge' (residual) -> 662.18", _has(tot(BLOCK.format(gross="Total Charge")), "662.18"))

print("ON — 'Net to Pay' is the GROSS, and does NOT steal the 'Net Total' subtotal (reggie's safety claim):")
gtot, gsub = both(BLOCK.format(gross="Net to Pay"))
check("total_amount = Net to Pay value 662.18", _has(gtot, "662.18"))
check("subtotal still = Net Total value 551.82 (not stolen)", _has(gsub, "551.82"))

print("OFF (TOTAL_GROSS_LABELS=0) — byte-identical: the captions bare 'Total' can't reach are NOT read:")
setflag("0")
check("OFF: 'Balance to Pay' -> total_amount None (pre-fix state)", tot(BLOCK.format(gross="Balance to Pay")) is None)
check("OFF: 'Amount Now Due' -> total_amount None", tot(BLOCK.format(gross="Amount Now Due")) is None)
check("OFF: a shipped 'Grand Total £662.18' still reads (bank untouched)",
      _has(tot("Net Total £551.82\nGrand Total £662.18\n"), "662.18"))
check("OFF: bare 'Total £662.18' still reads (shipped behaviour intact)",
      _has(tot("Total £662.18\n"), "662.18"))
setflag(None)

print()
print(f"{fails} FAILED" if fails else "All TOTAL_GROSS_LABELS checks passed")
sys.exit(1 if fails else 0)
