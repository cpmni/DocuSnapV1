#!/usr/bin/env python3
"""
tests/test_label_overrides.py
-----------------------------
Covers keyword.merge_label_overrides — the admin keyword label overrides
(Settings -> Advanced, migration 19) merged onto the shipped patterns at
Stage 1, scoped to the detected doc-type slug.

Usage: py -3.12 python_backend/tests/test_label_overrides.py
Exit 0 = pass, 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import keyword  # noqa: E402


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def main():
    fails = 0
    base = {
        "field_patterns": {
            "invoice_number": {"labels": ["Invoice No"], "directions": ["right"],
                               "base_confidence": 88, "validation": "alphanumeric"},
        },
        "validation_patterns": {"alphanumeric": ["x"]},
    }

    # 1. No overrides / no slug -> SAME object back (no copy, no-op).
    print("1. no-op when there is nothing to merge")
    fails += not check("empty overrides -> identical object",
                       keyword.merge_label_overrides(base, [], "invoice") is base)
    fails += not check("no doc_slug -> identical object",
                       keyword.merge_label_overrides(base, [{"doc_type_slug": "invoice",
                           "field_key": "invoice_number", "label": "Bill No"}], None) is base)

    # 2. Additive: shipped labels kept, override appended (matching slug).
    print("2. override label appended to an existing field, shipped labels kept")
    ov = [{"doc_type_slug": "invoice", "field_key": "invoice_number", "label": "Bill No"}]
    merged = keyword.merge_label_overrides(base, ov, "invoice")
    labels = merged["field_patterns"]["invoice_number"]["labels"]
    fails += not check("shipped 'Invoice No' still present", "Invoice No" in labels)
    fails += not check("override 'Bill No' added", "Bill No" in labels)
    fails += not check("validation preserved",
                       merged["field_patterns"]["invoice_number"].get("validation") == "alphanumeric")
    fails += not check("original patterns NOT mutated",
                       base["field_patterns"]["invoice_number"]["labels"] == ["Invoice No"])

    # 3. Doc-type scoping: an override for a DIFFERENT slug does not apply.
    print("3. doc-type scoping")
    ov2 = [{"doc_type_slug": "worksheet", "field_key": "invoice_number", "label": "Ticket No"}]
    fails += not check("non-matching slug -> no-op (same object)",
                       keyword.merge_label_overrides(base, ov2, "invoice") is base)
    fails += not check("slug match is case-insensitive",
                       "Ticket No" in keyword.merge_label_overrides(
                           base, ov2, "WORKSHEET")["field_patterns"]["invoice_number"]["labels"])

    # 4. Custom field with NO shipped pattern gets an entry created -> extractable.
    print("4. custom field key (no shipped pattern) becomes extractable")
    ov3 = [{"doc_type_slug": "worksheet", "field_key": "serial_number", "label": "Serial No"}]
    merged3 = keyword.merge_label_overrides(base, ov3, "worksheet")
    sn = merged3["field_patterns"].get("serial_number")
    fails += not check("serial_number entry created", sn is not None)
    fails += not check("created entry carries the override label", sn and "Serial No" in sn["labels"])
    fails += not check("created entry has a usable direction default",
                       sn and sn.get("directions"))

    # 5. End-to-end: extract_fields then actually USES the override label.
    print("5. extract_fields picks up the override label on a custom field")
    ocr = "Job Worksheet\nSerial No: SN-99213\nCustomer: Acme"
    res = keyword.extract_fields(ocr, ["serial_number"], merged3)
    fails += not check("serial_number extracted via the override label",
                       res.get("serial_number", {}).get("value") == "SN-99213")

    print()
    print(f"{fails} FAILED" if fails else "All label-override checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
