#!/usr/bin/env python3
"""
tests/test_confidence_empty_fields.py

Regression test for the empty-field confidence weighting (2026-06): when the scored
fields come from the document type's SCHEMA, a required/expected field that is EMPTY must
count as 0 — so a document with one good field and several empty required fields no longer
reports a high/green confidence. The hard-coded fallback (no schema) keeps the old
present-only average, since those keys may not exist for a given type.

Run:  py -3.12 python_backend/tests/test_confidence_empty_fields.py
Exit 0 = all checks passed.  Exit 1 = failure(s).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction.validator import overall_confidence


def check(label: str, cond: bool) -> bool:
    print(f"  {'OK ' if cond else 'BAD'}  {label}")
    return cond


fails = 0
fdefs = [
    {"key": "supplier_name",  "required": True},
    {"key": "invoice_date",   "required": True},
    {"key": "invoice_number", "required": True},
]

# 1) One filled (90), two empty required → (90+0+0)/3 = 30, NOT 90 (the bug this fixes).
res1 = {"supplier_name": {"value": "City Office NI", "confidence": 90}}
v1 = overall_confidence(res1, fdefs)
fails += not check(f"one filled + two empty required -> {v1} (expect 30, not 90)", v1 == 30)

# 2) All required filled → straight average (unchanged behaviour).
res2 = {k["key"]: {"value": "x", "confidence": 80} for k in fdefs}
fails += not check("all required filled -> 80", overall_confidence(res2, fdefs) == 80)

# 3) Empty-string / None values count as empty (0).
res3 = {
    "supplier_name":  {"value": "X",  "confidence": 90},
    "invoice_date":   {"value": "",   "confidence": 0},
    "invoice_number": {"value": None, "confidence": 0},
}
v3 = overall_confidence(res3, fdefs)
fails += not check(f"empty-string/None count as 0 -> {v3} (expect 30)", v3 == 30)

# 4) No schema (hard-coded fallback) keeps present-only averaging — no false 0s for keys
#    that may not exist for the type.
v4 = overall_confidence({"invoice_number": {"value": "INV-1", "confidence": 88}})
fails += not check(f"no schema -> present-only ({v4}, expect 88)", v4 == 88)

# 5) Nothing extracted at all → 0.
fails += not check("empty extractions -> 0", overall_confidence({}, fdefs) == 0)

print("\nAll checks passed." if not fails else f"\n{fails} check(s) failed.")
sys.exit(1 if fails else 0)
