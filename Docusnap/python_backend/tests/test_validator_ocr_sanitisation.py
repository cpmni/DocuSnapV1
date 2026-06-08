#!/usr/bin/env python3
"""
tests/test_validator_ocr_sanitisation.py
-----------------------------------------
Direct unit test for validator.validate_and_adjust's field-specific
OCR-noise cleanup (step "0b"): stray bracket/hash junk that crop+OCR
sweeps in alongside a date ("(01-12-2012", "#Dec 01 2012") or a
reference number ("(12345", ")12345").

This is deliberately scoped, not a global strip-all-punctuation pass:
- Date fields (type == "date"): only characters that can legitimately
  appear in a date (digits, letters, whitespace, -/. ,) survive; the
  cleaned string then flows through the existing parse_date/normalise
  pipeline untouched, so format detection and DD-MM-YYYY normalisation
  still do all the real work.
- Reference/number fields (key ends in "_number" — the convention every
  built-in and learned reference field already follows): only the
  leading/trailing non-alphanumeric runs are trimmed. The interior
  (internal separators, letter prefixes like "INV") is left exactly as
  captured, so legitimate formats are never reshaped.

Tested directly against validate_and_adjust (matching the approach in
test_validator_label_guard.py) so the guard's behaviour is verified at
its own boundary, independent of which upstream stage produced the
noisy value.

Usage:
    py -3.12 python_backend/tests/test_validator_ocr_sanitisation.py

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


def extract_one(field_key, value, confidence=90, method="anchor_crop", field_defs=FIELD_DEFS):
    base = {
        "invoice_number": {"value": "INV-1", "confidence": 90, "method": "keyword"},
        "invoice_date":   {"value": "01-01-2026", "confidence": 90, "method": "keyword"},
        "supplier_name":  {"value": "Acme Ltd", "confidence": 90, "method": "logo"},
    }
    base[field_key] = {"value": value, "confidence": confidence, "method": method}
    return validate_and_adjust(base, field_defs)[field_key]


def main():
    failures = 0

    # ── Date fields: junk stripped, then parsed/normalised as usual ──────────
    date_cases = [
        ("(01-12-2012",  "01-12-2012"),   # leading '(' — DD-MM-YYYY already
        ("#Dec 01 2012", "01-12-2012"),   # leading '#' — month-name format
        (")14/03/2012",  "14-03-2012"),   # leading ')' — DD/MM/YYYY
    ]
    print("Date fields: OCR junk stripped, then normalised to DD-MM-YYYY")
    for raw, expected in date_cases:
        result = extract_one("invoice_date", raw)
        if not check(f"{raw!r} -> {expected!r} (got {result['value']!r})",
                     result["value"] == expected):
            failures += 1

    # A clean date must pass through normalisation completely untouched —
    # proves the cleanup doesn't fire on values that have nothing to clean.
    clean = extract_one("invoice_date", "Monday, 01 May 2024")
    if not check("clean date 'Monday, 01 May 2024' -> '01-05-2024' untouched by cleanup",
                 clean["value"] == "01-05-2024"):
        failures += 1

    print()

    # ── Reference numbers: only edge noise trimmed, core left alone ──────────
    ref_cases = [
        ("(12345",   "12345"),       # leading '('
        (")12345",   "12345"),       # leading ')'
        ("#12345",   "12345"),       # leading '#'
        ("INV12345", "INV12345"),    # legitimate prefix — unchanged
        ("AB-12345", "AB-12345"),    # internal separator — unchanged
        ("(INV-99)", "INV-99"),      # noise on both edges, internal '-' kept
    ]
    print("invoice_number: edge noise trimmed, internal structure preserved")
    for raw, expected in ref_cases:
        result = extract_one("invoice_number", raw)
        if not check(f"{raw!r} -> {expected!r} (got {result['value']!r})",
                     result["value"] == expected):
            failures += 1

    print()

    # ── Interaction with the label-shape guard (step 0) ──────────────────────
    # A label-shaped value must be flagged on its ORIGINAL shape and left
    # completely untouched by this cleanup — not reshaped into something
    # that no longer looks like the garbage it is.
    flagged = extract_one("invoice_number", "Total:", confidence=85)
    print("Label-shaped value ('Total:') is flagged untouched, not cleaned")
    if not check("value left exactly as captured ('Total:')", flagged["value"] == "Total:"):
        failures += 1
    if not check("still carries the label validation_note",
                 "label" in flagged.get("validation_note", "").lower()):
        failures += 1

    print()
    if failures:
        print(f"{failures} check(s) failed — OCR sanitisation guard regressed.")
        return 1
    print("All checks passed — field-specific OCR sanitisation behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
