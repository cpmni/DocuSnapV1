#!/usr/bin/env python3
"""
tests/test_qualify_gate.py
--------------------------
Increment 2: learned-shape value qualification.

extract_accepted_shape trims column-bleed junk wrapped around a value to the
substring that matches the field's learned accepted SHAPE — universal, driven by
confirmed history, no per-field pattern. This is what turns the misread
"2605-0769-1 Work Address Beaumont Care Homes Ltd - Belmont" back into
"2605-0769-1" at Stage 4.5.

Usage: py -3.12 python_backend/tests/test_qualify_gate.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.format_anomaly_checker import (  # noqa: E402
    classify_format, extract_accepted_shape, shape_signature,
)


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def main():
    fails = 0

    # Learned format for a reference field: confirmed values all "####-####-#".
    refs = ["2602-0768-1", "2603-1351-1", "2605-0769-1"]
    entry = classify_format(refs, value_counts={r: 3 for r in refs})
    fails += not check("learned shape is {'####-####-#'}",
                       entry.get("shapes") == frozenset({"####-####-#"}))

    # 1. The real bug: value + column bleed -> trimmed to the reference.
    bleed = "2605-0769-1 Work Address Beaumont Care Homes Ltd - Belmont"
    fails += not check("column-bleed value trimmed to '2605-0769-1'",
                       extract_accepted_shape(bleed, entry) == "2605-0769-1")

    # 2. A clean value (already the accepted shape) -> nothing to extract (None).
    fails += not check("already-clean value -> None", extract_accepted_shape("2605-0769-1", entry) is None)

    # 3. No accepted-shape substring present -> None (can't rescue; caller withholds).
    fails += not check("no shape match -> None", extract_accepted_shape("Booking", entry) is None)

    # 4. Word-boundary guard: don't grab 4-of-5 digit groups out of a longer run.
    fails += not check("does not extract from a longer digit run",
                       extract_accepted_shape("12605-0769-12", entry) is None)

    # 5. No shapes learned (thin/varied history) -> None (no constraint).
    nohist = classify_format(["ab", "cd"])   # <3 distinct, freetext, no shapes
    fails += not check("no learned shapes -> None", extract_accepted_shape(bleed, nohist) is None)

    # 6. Picks the LONGER match when value carries a partial too.
    multi = "x 12-34 and 2605-0769-1 here"
    two_shape = classify_format(["2602-0768-1", "2603-1351-1", "2605-0769-1"],
                                value_counts={"2602-0768-1": 3, "2603-1351-1": 3, "2605-0769-1": 3})
    fails += not check("longest accepted-shape run chosen",
                       extract_accepted_shape(multi, two_shape) == "2605-0769-1")

    print()
    print(f"{fails} FAILED" if fails else "All qualify-gate checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
