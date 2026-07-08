#!/usr/bin/env python3
"""
tests/test_slipfix_to_shape.py — anchor._slipfix_to_shape (the "$02"->"S02" recovery).

Recovers a crop read that FAILED the credibility gate when it is exactly ONE known OCR-confusion
substitution from the field's UNIFORM learned shape — and ONLY then. Precision-first.

    py -3.12 python_backend/tests/test_slipfix_to_shape.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.anchor import _slipfix_to_shape  # noqa: E402

FAILS = 0
def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")

# Generic alphanumeric ref pattern (mirrors config/keyword_patterns.json).
PATS = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}

# Field "code": uniform learned shape "@##" (a letter + two digits, e.g. S01/S02/S03).
ENTRY_UNIFORM = {"class": "upper_alphanum", "separators": frozenset(), "shapes": frozenset({"@##"})}
ENTRY_MULTI   = {"class": "upper_alphanum", "separators": frozenset(), "shapes": frozenset({"@##", "@@###"})}
ENTRY_EMPTY   = {"class": "freetext", "separators": frozenset(), "shapes": frozenset()}

def _fmt(entry):
    return lambda fk: entry if fk == "code" else None

def slip(v, entry=ENTRY_UNIFORM, tfk=None):
    return _slipfix_to_shape(v, "code", _fmt(entry), "alphanumeric", PATS, None, tfk or set())

print("anchor._slipfix_to_shape:")
# THE FIX — the reported case.
check("'$02' -> 'S02' ($->S, one substitution, matches @##)", slip("$02") == "S02")
check("'S0Z' -> 'S02' (Z->2 at a digit slot)", slip("S0Z") == "S02")

# NON-matches that MUST stay rejected (return None).
check("'$0Z' -> None (TWO violating positions)", slip("$0Z") is None)
check("'$002' -> None (length 4 != shape length 3)", slip("$002") is None)
check("'?02' -> None (no known confusion for '?')", slip("?02") is None)
check("multi-shape history -> None (not uniform)", slip("$02", entry=ENTRY_MULTI) is None)
check("thin/empty history -> None", slip("$02", entry=ENTRY_EMPTY) is None)
check("free-text field (in text_field_keys) -> None", slip("$02", tfk={"code"}) is None)
check("already-valid 'S02' -> None (no substitution needed)", slip("S02") is None)
check("empty value -> None", slip("") is None)

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
