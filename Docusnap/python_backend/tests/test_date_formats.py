#!/usr/bin/env python3
"""
tests/test_date_formats.py
--------------------------
Requirement: a date field must ALWAYS qualify a real date, in any of the
standard patterns people write — independent of learned history. This matrix
covers the common UK/EU + international variations (numeric day-first, ISO,
day+month-name, month-name+day, 2- and 4-digit years, '/.- ' separators, ordinal
suffixes, leading day names). All examples below are the same date — 6 August
2026 — so the expected normalisation is unambiguous: '06-08-2026'.

Day-first is the house default (UK), so '06/08/2026' is 6 Aug, not 8 Jun.

Usage: py -3.12 python_backend/tests/test_date_formats.py
Exit 0 = every standard pattern parses, 1 = a gap remains.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.validator import parse_date  # noqa: E402

EXPECT = "06-08-2026"

CASES = [
    # numeric, day-first
    "06/08/2026", "6/8/2026", "06-08-2026", "6-8-2026", "06.08.2026", "6.8.2026",
    "06/08/26", "6/8/26", "06-08-26", "6.8.26",
    # ISO / year-first
    "2026-08-06", "2026/08/06",
    # day + month-name, 4-digit year
    "6 August 2026", "06 August 2026", "6 Aug 2026", "06 Aug 2026",
    "6 August, 2026", "6 Aug, 2026", "6-Aug-2026", "6-August-2026", "6/Aug/2026",
    # day + month-name, 2-digit year
    "6 August 26", "6 Aug 26", "06 Aug 26", "6-Aug-26", "6/Aug/26",
    # ordinals, day-first
    "6th August 2026", "6th Aug 2026", "6th August 26", "1st"[:0] + "6th Aug 26",
    # month-name + day, 4-digit year
    "August 6, 2026", "Aug 6, 2026", "August 6 2026", "Aug 6 2026",
    "Aug-6-2026", "August-6-2026", "Aug 6th, 2026", "August 6th 2026",
    # month-name + day, 2-digit year
    "August 6 26", "Aug 6 26", "Aug 6, 26", "Aug 6th 26", "August 6th 26",
    # leading day name
    "Tuesday, 6 August 2026", "Tue 6 Aug 2026", "Tuesday 6 August 2026",
    "Tue, Aug 6, 2026",
]


def main():
    fails = []
    for c in CASES:
        d = parse_date(c)
        got = d.strftime("%d-%m-%Y") if d else None
        ok = got == EXPECT
        print(f"  {'OK ' if ok else 'BAD'}  {c!r:32} -> {got}")
        if not ok:
            fails.append((c, got))
    print()
    if fails:
        print(f"{len(fails)} FAILED:")
        for c, got in fails:
            print(f"   {c!r} -> {got} (expected {EXPECT})")
        return 1
    print(f"All {len(CASES)} standard date patterns parse to {EXPECT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
