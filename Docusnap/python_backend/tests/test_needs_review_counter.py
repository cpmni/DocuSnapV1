#!/usr/bin/env python3
"""Pin the results-dict 'found' counter fix (gary root-cause). A bool `_`-metadata value —
`results["_needs_review"] = True`, injected mid-pipeline by the logo text-gate 'suggest' branch
(engine.py ~:2605) — must NOT crash the Stage 0/1/2 diagnostic counters. The old unguarded
comprehension `[v for v in results.values() if v.get("value")]` raised
'bool object has no attribute get'; `_count_valued_fields` skips `_` keys / non-dicts.

    py -3.12 python_backend/tests/test_needs_review_counter.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction.engine import _count_valued_fields   # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


# The exact shape that crashed on the customer's SuperStore invoices: real fields + a BOOL metadata
# key (the logo 'suggest' injection) + a dict metadata sibling + a numeric metadata key.
RESULTS = {
    'supplier_name':       {'value': 'SuperStore', 'confidence': 80, 'method': 'logo'},
    'invoice_number':      {'value': 'INV-1', 'confidence': 90, 'method': 'keyword'},
    'invoice_date':        {'value': None},                 # a field present but with no value
    '_needs_review':       True,                            # <-- the bool that crashed .get()
    '_logo_abstained':     {'suppressed': 'Y'},             # dict metadata (the safe sibling branch)
    '_overall_confidence': 88,                              # numeric metadata
}

# 1. THE FIX: counts only the 2 valued real fields and never raises on the bool.
try:
    n = _count_valued_fields(RESULTS)
    check("counts 2 valued fields, skips _needs_review bool (no crash)", n == 2)
except Exception as e:
    check(f"must not raise (raised {e!r})", False)

# 2. PIN THE REGRESSION: the pre-fix unguarded comprehension DID raise on this exact input, so a
#    future dev can't 'simplify' the counter back to it.
raised = False
try:
    _ = len([v for v in RESULTS.values() if v.get('value')])
except AttributeError:
    raised = True
check("pre-fix unguarded comprehension raises 'bool has no attribute get' (regression pinned)", raised)

# 3. Edges / byte-identical intent: metadata never counted, falsy values never counted.
check("empty results -> 0", _count_valued_fields({}) == 0)
check("all-metadata results -> 0", _count_valued_fields({'_a': True, '_b': {'x': 1}, '_c': 5}) == 0)
check("field with empty-string value -> not counted", _count_valued_fields({'f': {'value': ''}}) == 0)
check("field with a value -> counted", _count_valued_fields({'f': {'value': 'X'}}) == 1)

print("\n" + ("ALL PASS" if fails == 0 else f"{fails} FAILED"))
sys.exit(1 if fails else 0)
