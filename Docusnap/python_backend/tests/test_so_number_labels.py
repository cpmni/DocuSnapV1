#!/usr/bin/env python3
"""tests/test_so_number_labels.py — pins the "SO #" caption slice (reggie, 2026-07-10).

1. The shipped sales_order_number bank's new S/O, S.O., "SO #" forms read the value with
   the '#' consumed by the LABEL (the value never carries it), and "SOLD TO" can't
   false-fire any of them.
2. template_mapper._label_score's conditional boundary guard: a '#'-terminal taught label
   ("so #") scores 1.0 on a value-glued row ("so #12345") — previously the `needle in
   haystack` branch rejected it outright (0.0) so relocation skipped the offset path.
   Alnum-edged needles are byte-identical ("total" still never matches inside "subtotal").

    py -3.12 tests/test_so_number_labels.py    (from python_backend/)
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import keyword
from extraction import template_mapper

CFG = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "config",
                                  "keyword_patterns.json"), encoding="utf-8"))

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def so(text):
    res = keyword.extract_fields(text, ["sales_order_number"], CFG)
    return (res.get("sales_order_number") or {}).get("value")


print("shipped bank — the new short forms read, '#' consumed by the label:")
check("'SO # 40012' -> '40012'",        so("SO # 40012\n") == "40012")
check("'SO #40012' (glued) -> '40012'", so("SO #40012\n") == "40012")
check("'S.O. No. 40012' -> '40012'",    so("S.O. No. 40012\n") == "40012")
check("'S/O # 40012' -> '40012'",       so("S/O # 40012\n") == "40012")
check("existing 'Order Number: 512' still reads", so("Order Number: 512\n") == "512")
check("'SOLD TO: Acme Corp' does NOT fire the SO bank", so("SOLD TO: Acme Corp\n") is None)

print("_label_score — conditional boundary guard:")
score = template_mapper._label_score
check("'so #' vs 'so # 40012' = 1.0",          score("so #", "so # 40012") == 1.0)
check("'so #' vs 'so #12345' (glued) = 1.0",   score("so #", "so #12345") == 1.0)
check("'total' inside 'subtotal' still 0.0",   score("total", "subtotal 118.83") == 0.0)
check("'total' vs its own row still 1.0",      score("total", "total 118.83") == 1.0)
check("'so #' vs an unrelated row scores low", score("so #", "customer formby & sons") < 0.6)

print()
print(f"{fails} FAILED" if fails else "All SO-number label checks passed")
sys.exit(1 if fails else 0)
