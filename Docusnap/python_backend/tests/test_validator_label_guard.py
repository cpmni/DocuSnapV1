#!/usr/bin/env python3
"""
tests/test_validator_label_guard.py
-----------------------------------
Direct unit test for validator.validate_and_adjust's label-shaped-value guard.

Context: live processing.log showed an anchor_crop landing on a field's LABEL
instead of its value — e.g. invoice_number resolved to "Total:" at 85%
confidence, which is ABOVE the default 70% review threshold, so the document
would auto-confirm with a garbage reference number stamped into its filename.

This guard (validator.py, step 0) down-weights any value ending in ':' —
a shape no legitimate field value (reference number, date, amount, name)
ever has — regardless of which stage produced it or which field it landed
in. That makes it a layout- and supplier-agnostic safety net, not a
one-document patch.

Tested directly against validate_and_adjust (rather than through
ExtractionEngine.extract, like run_regression.py's fixtures) because the
condition this guards against — a wrong value reaching Stage 4 — can arise
from several different upstream stages (crop+OCR, keyword regex drift,
poisoned hints); the guard's job is to catch the *shape* of the result
regardless of provenance, so testing it at its own boundary is the more
direct and durable regression net.

Usage:
    py -3.12 python_backend/tests/test_validator_label_guard.py

Exit code 0 = guard behaves correctly. Exit code 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.validator import validate_and_adjust  # noqa: E402

FIELD_DEFS = [
    {"key": "invoice_number", "label": "Invoice Number", "type": "text",
     "required": 1, "is_variable": 1, "confidence_threshold": 70},
    {"key": "invoice_date", "label": "Invoice Date", "type": "date",
     "required": 1, "is_variable": 1, "confidence_threshold": 70},
    {"key": "supplier_name", "label": "Supplier Name", "type": "text",
     "required": 1, "is_variable": 0, "confidence_threshold": 70},
]


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def main():
    failures = 0

    # Case 1: a label-shaped value at HIGH confidence must be slashed below
    # the review threshold — this is the exact live scenario (85% "Total:").
    extractions = {
        "invoice_number": {"value": "Total:", "confidence": 85, "method": "anchor_crop"},
        "invoice_date":   {"value": "12-08-2026", "confidence": 90, "method": "anchor_crop"},
        "supplier_name":  {"value": "Greenfield Logistics Ltd", "confidence": 90, "method": "logo"},
    }
    result = validate_and_adjust(extractions, FIELD_DEFS)
    inv = result["invoice_number"]
    print("Case 1: high-confidence label-shaped value ('Total:')")
    if not check("confidence reduced below review threshold (<=35)", inv["confidence"] <= 35):
        failures += 1
    if not check("validation_note explains why", "label" in inv.get("validation_note", "").lower()):
        failures += 1
    if not check("value left intact for user review (not silently discarded)", inv["value"] == "Total:"):
        failures += 1

    # Case 2: a normal data-shaped value must NOT be touched by this guard —
    # proves the check is narrowly scoped to the ':' shape, not values broadly.
    extractions2 = {
        "invoice_number": {"value": "INV-88213", "confidence": 92, "method": "keyword"},
        "invoice_date":   {"value": "12-08-2026", "confidence": 90, "method": "keyword"},
        "supplier_name":  {"value": "Greenfield Logistics Ltd", "confidence": 90, "method": "logo"},
    }
    result2 = validate_and_adjust(extractions2, FIELD_DEFS)
    inv2 = result2["invoice_number"]
    print("Case 2: normal data-shaped value ('INV-88213') must pass through untouched")
    if not check("confidence unchanged", inv2["confidence"] == 92):
        failures += 1
    if not check("no validation_note added", "validation_note" not in inv2):
        failures += 1

    # Case 3: a value containing ':' but NOT at the end (e.g. a time-stamped
    # reference) must NOT be flagged — the guard checks shape (trailing ':'),
    # not mere presence of the character, to avoid false positives on
    # legitimately punctuated values.
    extractions3 = {
        "invoice_number": {"value": "REF:2026-1188", "confidence": 88, "method": "keyword"},
        "invoice_date":   {"value": "12-08-2026", "confidence": 90, "method": "keyword"},
        "supplier_name":  {"value": "Greenfield Logistics Ltd", "confidence": 90, "method": "logo"},
    }
    result3 = validate_and_adjust(extractions3, FIELD_DEFS)
    inv3 = result3["invoice_number"]
    print("Case 3: ':' present but not trailing ('REF:2026-1188') must pass through untouched")
    if not check("confidence unchanged", inv3["confidence"] == 88):
        failures += 1
    if not check("no validation_note added", "validation_note" not in inv3):
        failures += 1

    # Case 4: a genuine DATE that picked up a STRAY trailing colon from a
    # neighbouring label ("12/01/2026 :", crop bleed) is NOT a mis-captured label.
    # It must be cleaned + normalised and pass WITHOUT the label flag — the exact
    # false-positive fixed here (a Purchase Order's invoice_date wrongly flagged).
    extractions4 = {
        "invoice_number": {"value": "INV-88213", "confidence": 92, "method": "keyword"},
        "invoice_date":   {"value": "12/01/2026 :", "confidence": 90, "method": "anchor_crop"},
        "supplier_name":  {"value": "Greenfield Logistics Ltd", "confidence": 90, "method": "logo"},
    }
    d4 = validate_and_adjust(extractions4, FIELD_DEFS)["invoice_date"]
    print("Case 4: date with a stray trailing colon ('12/01/2026 :') is cleaned, not flagged")
    if not check("not flagged as a label", "label" not in d4.get("validation_note", "").lower()):
        failures += 1
    if not check("normalised to a clean date (12-01-2026)", d4["value"] == "12-01-2026"):
        failures += 1

    # Case 5: a coded value (reference) with a stray trailing colon still carries a
    # digit → a real value with crop noise → trimmed, not flagged.
    extractions5 = {
        "invoice_number": {"value": "2601-0371-1 :", "confidence": 88, "method": "anchor_crop"},
        "invoice_date":   {"value": "12-08-2026", "confidence": 90, "method": "keyword"},
        "supplier_name":  {"value": "Greenfield Logistics Ltd", "confidence": 90, "method": "logo"},
    }
    inv5 = validate_and_adjust(extractions5, FIELD_DEFS)["invoice_number"]
    print("Case 5: coded value with a stray trailing colon ('2601-0371-1 :') is cleaned, not flagged")
    if not check("no label validation_note", "label" not in inv5.get("validation_note", "").lower()):
        failures += 1
    if not check("trailing colon trimmed", inv5["value"] == "2601-0371-1"):
        failures += 1

    print()
    if failures:
        print(f"{failures} check(s) failed — label-shaped-value guard regressed.")
        return 1
    print("All checks passed — label-shaped-value guard behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
