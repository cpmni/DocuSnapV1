#!/usr/bin/env python3
"""
tests/test_anchor_qualify.py
----------------------------
Option A: learned-anchor (Stage 2) values are qualified against the field's
learned format (doc-type-scoped shape model). A confidently-wrong read no longer
commits — it's rejected (→ empty/review) or trimmed to the learned shape.

Tests the text-fallback path (no OCR needed): an anchor with no coordinates runs
the label search, then the new qualification gate decides.

Usage: py -3.12 python_backend/tests/test_anchor_qualify.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor                                   # noqa: E402
from extraction.format_anomaly_checker import classify_format   # noqa: E402


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


# Learned format for a reference field: confirmed values all "####-####-#".
refs = ["2602-0768-1", "2603-1351-1", "2605-0769-1"]
ENTRY = classify_format(refs, value_counts={r: 3 for r in refs})
FMT = lambda fk: ENTRY if fk == "refno" else None

# A label-only anchor (no coordinates → text-fallback path, direction "right").
ANCHOR = {"field_key": "refno", "anchor_label": "Ticket No.", "direction": "right",
          "supplier_name": "__global__", "document_type": "", "usage_count": 5, "confidence": 0.9}


def run(ocr_text, fmt):
    return anchor.extract_with_anchors(
        ocr_text, [ANCHOR], supplier_name=None, document_type="",
        page_images=None, field_patterns={"refno": {}}, validation_patterns={},
        format_lookup=fmt)


def main():
    fails = 0

    # 1. Garbage value ("Booking", wrong row) is REJECTED -> field not populated.
    r = run("Ticket No. Booking\nTicket Type Field", FMT)
    fails += not check("garbage 'Booking' rejected (refno empty)", "refno" not in r)

    # 2. Correct value is kept.
    r = run("Ticket No. 2605-0769-1", FMT)
    fails += not check("valid '2605-0769-1' kept",
                       r.get("refno", {}).get("value") == "2605-0769-1")

    # 3. Column-bleed value is TRIMMED to the learned shape.
    r = run("Ticket No. 2605-0769-1 Work Address Beaumont Care Homes Ltd - Belmont", FMT)
    fails += not check("column-bleed trimmed to '2605-0769-1'",
                       r.get("refno", {}).get("value") == "2605-0769-1")

    # 4. No learned format (no lookup) -> behaviour unchanged (value kept as-is).
    r = run("Ticket No. Booking", None)
    fails += not check("no format lookup -> 'Booking' passes through (unchanged behaviour)",
                       r.get("refno", {}).get("value") == "Booking")

    print()
    print(f"{fails} FAILED" if fails else "All anchor-qualify checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
