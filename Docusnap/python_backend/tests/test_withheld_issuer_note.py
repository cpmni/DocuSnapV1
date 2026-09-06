#!/usr/bin/env python3
"""
tests/test_withheld_issuer_note.py — Item 4(i) (log review 2026-09-05; Oracle: COPY only).

Castellan job sheets: the only KNOWN name on the page was the owner's own company in BILL TO, so the
Stage-2.5 withheld gate fired (correctly) but its note said "A known supplier's name appears on this
page…" — the wrong actor. When the matched name is ALSO the install's confirmed customer_name (a
`customer_name` hint with >= 3 uses), the note says what happened. The gate itself is untouched
(it is the C1 rescue for an implausible incumbent — suppressing it re-opens the silent-'IN' case).

Usage:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_withheld_issuer_note.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import (_withheld_issuer_note, _WITHHELD_ISSUER_NOTE,  # noqa: E402
                               _WITHHELD_OWN_COMPANY_NOTE, _OWN_COMPANY_MIN_CONFIRMS)

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


OWN = [{"field_key": "customer_name", "hint_value": "Beaumont Care Homes Ltd", "usage_count": 12, "supplier_name": "__global__"},
       {"field_key": "supplier_name", "hint_value": "Beaumont Care Homes Ltd", "usage_count": 5, "supplier_name": "Beaumont Care Homes Ltd"}]
check("matched == a >=3-confirmed customer_name → the own-company note", _withheld_issuer_note("Beaumont Care Homes Ltd", OWN) == _WITHHELD_OWN_COMPANY_NOTE)
check("…case/whitespace-insensitive (normalised compare)", _withheld_issuer_note("  beaumont   care homes ltd ", OWN) == _WITHHELD_OWN_COMPANY_NOTE)
check("a different known supplier → the generic note", _withheld_issuer_note("Castellan Security Systems", OWN) == _WITHHELD_ISSUER_NOTE)
FEW = [{"field_key": "customer_name", "hint_value": "Beaumont Care Homes Ltd", "usage_count": _OWN_COMPANY_MIN_CONFIRMS - 1}]
check(f"customer_name hint below {_OWN_COMPANY_MIN_CONFIRMS} uses → generic note (not yet 'own company')", _withheld_issuer_note("Beaumont Care Homes Ltd", FEW) == _WITHHELD_ISSUER_NOTE)
check("no hints → generic note", _withheld_issuer_note("Beaumont Care Homes Ltd", []) == _WITHHELD_ISSUER_NOTE)
check("empty match → generic note", _withheld_issuer_note("", OWN) == _WITHHELD_ISSUER_NOTE)
check("garbage hint rows never raise", _withheld_issuer_note("X", [None, "str", {"field_key": "customer_name"}]) == _WITHHELD_ISSUER_NOTE)
check("the generic text is byte-identical to the shipped note", _WITHHELD_ISSUER_NOTE.startswith("A known supplier's name appears on this page, but not in the letterhead area"))
check("neither note uses a renderer trigger phrase", all("please verify" not in n for n in (_WITHHELD_ISSUER_NOTE, _WITHHELD_OWN_COMPANY_NOTE)))

print(f"\n{'FAILED: ' + str(fails) if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
