#!/usr/bin/env python3
"""tests/test_date_labels.py — pins the "Dated" caption in the order_date bank (2026-07-11).

Live gap (KO_sal_18): sales orders printing "Dated  30-07-2026" read NO order date —
"Dated" was shipped in invoice_date's label bank but not order_date's, and the "Date"
needle correctly refuses to match inside the word "Dated" (word-boundary). Adding
"Dated" to order_date is system-wide (any supplier printing that caption) and carries
zero novel risk — the identical label has shipped in invoice_date since the start.

    py -3.12 tests/test_date_labels.py    (from python_backend/)
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import keyword

CFG = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "config",
                                  "keyword_patterns.json"), encoding="utf-8"))

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def od(text):
    res = keyword.extract_fields(text, ["order_date"], CFG)
    return (res.get("order_date") or {}).get("value")


def inv_date(text):
    res = keyword.extract_fields(text, ["invoice_date"], CFG)
    return (res.get("invoice_date") or {}).get("value")


print("order_date bank — the 'Dated' caption (the KO_sal_18 class):")
check("'Dated 30-07-2026' -> reads",            od("Dated 30-07-2026\n") == "30-07-2026")
check("'Dated: 30-07-2026' -> reads",           od("Dated: 30-07-2026\n") == "30-07-2026")
check("existing 'Order Date: 30-07-2026' still reads",
      od("Order Date: 30-07-2026\n") == "30-07-2026")
check("existing bare 'Date 30-07-2026' still reads",
      od("Date 30-07-2026\n") == "30-07-2026")

print("boundary pins — 'Dated' must not fire inside larger words:")
check("'Updated 30-07-2026' does NOT read",     od("Updated 30-07-2026\n") is None)
check("'Validated 30-07-2026' does NOT read",   od("Validated 30-07-2026\n") is None)

print("invoice_date twin unchanged (its 'Dated' predates this fix):")
check("'Dated 21-02-2026' -> invoice_date reads",
      inv_date("Dated 21-02-2026\n") == "21-02-2026")

print()
print(f"{fails} FAILED" if fails else "All date-label checks passed")
sys.exit(1 if fails else 0)
