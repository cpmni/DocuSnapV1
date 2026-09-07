#!/usr/bin/env python3
"""tests/test_buyer_issued_convention_one_confirm.py — BUYER_ISSUED_CONVENTION_ONE_CONFIRM (owner 2026-09-07
"after 1 confirm the system would learn"; gary → Oracle SIGN-OFF-W/COND C1-C8; DARK, mig 125).

Leg 1 of `_buyer_issued_convention_licensed` needs THREE generic same-type supplier_name confirms
(a hint bump cannot tell a NOTED confirm from any other). Leg 2: a `buyer_issued_convention` record —
written by the confirm ONLY when a human answered the note and kept the letterhead on the same type —
licenses at usage >= 1. THE TRADE-OFF PIN (both directions): one noted answer licenses; one or two
generic confirms still do NOT.
    PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_buyer_issued_convention_one_confirm.py
"""
import io
import os
import re
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction.engine import ExtractionEngine                            # noqa: E402

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def arm(v):
    if v is None:
        os.environ.pop("BUYER_ISSUED_CONVENTION_ONE_CONFIRM", None)
    else:
        os.environ["BUYER_ISSUED_CONVENTION_ONE_CONFIRM"] = v


norm = ExtractionEngine._accept_norm
lic = ExtractionEngine._buyer_issued_convention_licensed
H = lambda fk, dt, val, use: {"field_key": fk, "document_type": dt, "hint_value": val, "usage_count": use}
REC = lambda dt, val, use=1: H("buyer_issued_convention", dt, val, use)
SUP = lambda dt, val, use: H("supplier_name", dt, val, use)
X = "Ironbridge Fabrication"

print("-- leg 2 ON --")
arm("1")
check("record usage 1, same type, same company -> LICENSED (one noted answer)", lic(X, "purchase_order", [REC("purchase_order", X)], norm))
check("record usage 1 + a different case/spacing of the company -> LICENSED (normalised)", lic("ironbridge   fabrication", "purchase_order", [REC("purchase_order", X)], norm))
check("record on a DIFFERENT type -> not", not lic(X, "purchase_order", [REC("invoice", X)], norm))
check("record for a DIFFERENT company -> not", not lic(X, "purchase_order", [REC("purchase_order", "Ashcombe Care Homes Ltd")], norm))
check("record usage 0 -> not", not lic(X, "purchase_order", [REC("purchase_order", X, 0)], norm))
check("THE TRADE-OFF: supplier_name usage 1 alone -> NOT licensed (leg 1 still needs 3)", not lic(X, "purchase_order", [SUP("purchase_order", X, 1)], norm))
check("…usage 2 -> NOT licensed", not lic(X, "purchase_order", [SUP("purchase_order", X, 2)], norm))
check("…usage 3 -> licensed (leg 1 untouched)", lic(X, "purchase_order", [SUP("purchase_order", X, 3)], norm))
check("no resolved value -> not", not lic("", "purchase_order", [REC("purchase_order", X)], norm))
check("record + unrelated hints in the same list -> licensed (the row is found among real-field rows)",
      lic(X, "purchase_order", [SUP("invoice", X, 9), H("customer_name", "purchase_order", "Someone", 5), REC("purchase_order", X)], norm))

print("-- leg 2 OFF (unset) and OFF (explicit '0') == today --")
for v in (None, "0"):
    arm(v)
    check(f"env {'unset' if v is None else v!r}: record usage 1 -> NOT licensed (the leg is dark)", not lic(X, "purchase_order", [REC("purchase_order", X)], norm))
    check(f"env {'unset' if v is None else v!r}: record usage 5 -> still NOT (no leakage into leg 1)", not lic(X, "purchase_order", [REC("purchase_order", X, 5)], norm))
    check(f"env {'unset' if v is None else v!r}: leg 1 usage 3 -> licensed (byte-identical)", lic(X, "purchase_order", [SUP("purchase_order", X, 3)], norm))
arm(None)

print("-- the parent switch owns the leg (source pin, Oracle C4) --")
src = io.open(os.path.join(os.path.dirname(__file__), "..", "extraction", "engine.py"), encoding="utf-8").read()
calls = [m.start() for m in re.finditer(r"ExtractionEngine\._buyer_issued_convention_licensed\(", src)]
check("the predicate is called from exactly ONE site in the engine", len(calls) == 1)
if calls:
    before = src[:calls[0]]
    blk = before.rfind('os.environ.get("BUYER_ISSUED_CONVENTION_NOTE", "0") != "0"')
    check("…and that site sits inside the BUYER_ISSUED_CONVENTION_NOTE block (parent OFF => leg 2 inert)", blk != -1 and (calls[0] - blk) < 2500)
check("leg 2 reads BUYER_ISSUED_CONVENTION_ONE_CONFIRM with the != '0' idiom", 'os.environ.get("BUYER_ISSUED_CONVENTION_ONE_CONFIRM", "0") != "0"' in src)
check("the pseudo key is exactly 'buyer_issued_convention' in the engine", '_fk == "buyer_issued_convention"' in src)

print()
print("FAILED: %d" % fails if fails else "ALL PASS")
sys.exit(1 if fails else 0)
