#!/usr/bin/env python3
"""
tests/test_harvest_heading.py
-----------------------------
Pins keyword._harvest_top_band_heading — the conservative top-band heading harvest that seeds the
"Add <type>" nudge (Slice 1b-nudge) when the type-presence gate/veto leaves a doc UNTYPED. It must
recover a clear ALL-CAPS standalone banner (WORKSHEET -> "Worksheet") and return None on ANY doubt
(a wrong harvest = a confusing nudge; None = plain untyped, which is always safe).

    py -3.12 python_backend/tests/test_harvest_heading.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.keyword import _harvest_top_band_heading

WORKSHEET = ["Ridgeway Plant Hire", "Unit 5, Quarry Road Estate", "Dudley DY2 8SP",
             "T 01384 552910", "WORKSHEET    Reference No. WS-14395", "Date 12/04/2026"]
INSTALLED = ["Invoice", "Purchase Order", "Sales Order", "Delivery Note"]

CASES = [
    ("real worksheet OCR -> Worksheet", WORKSHEET, INSTALLED, "Worksheet"),
    ("two-word banner on its own line", ["Acme Ltd", "1 High St", "DELIVERY DOCKET"], INSTALLED, "Delivery Docket"),
    ("installed type is NOT harvested", ["Acme Ltd", "INVOICE"], INSTALLED, None),
    ("captions / numbers -> None", ["Acme Ltd", "Date 12/04/2026", "Reference No. 5"], INSTALLED, None),
    ("title-case (not all-caps) -> None (conservative)", ["Acme Ltd", "Worksheet"], INSTALLED, None),
    ("heading at line 0 is skipped (letterhead) -> None", ["WORKSHEET", "Reference"], INSTALLED, None),
    ("address line (has digits) -> None", ["Acme Ltd", "123 Main Road"], INSTALLED, None),
    ("stop-word banner -> None", ["Acme Ltd", "PAGE"], INSTALLED, None),
    ("empty -> None", [], INSTALLED, None),
]


def main():
    f = 0
    for label, lines, installed, expected in CASES:
        got = _harvest_top_band_heading(lines, installed)
        ok = got == expected
        print(f"  {'OK ' if ok else 'BAD'} {label} -> {got!r}" + ("" if ok else f"   (expected {expected!r})"))
        if not ok:
            f += 1
    print(f"\n{'ALL PASS' if f == 0 else str(f) + ' FAILED'}")
    sys.exit(1 if f else 0)


main()
