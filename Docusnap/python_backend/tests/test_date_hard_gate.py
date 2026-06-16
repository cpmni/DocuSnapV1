#!/usr/bin/env python3
"""
tests/test_date_hard_gate.py
----------------------------
A date-typed field must NEVER hold a non-date. A genuinely non-date value
(e.g. "Colour Issues") is withheld (value cleared) and flagged for manual
entry, rather than populated at low confidence. A real date — in any standard
format — is kept and normalised. Applies to built-in AND custom date fields
(identified by field type == "date").

Usage: py -3.12 python_backend/tests/test_date_hard_gate.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import validator  # noqa: E402


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def main():
    fails = 0
    # A custom date field (type == 'date') — same handling as a built-in one.
    field_defs = [{"key": "service_date", "type": "date"}]

    # 1. A pure non-date (no digits/month) is withheld + flagged.
    r = validator.validate_and_adjust(
        {"service_date": {"value": "Colour Issues", "confidence": 88, "method": "anchor"}},
        field_defs)
    sd = r["service_date"]
    fails += not check("pure non-date value withheld (value cleared)", sd.get("value") in (None, ""))
    fails += not check("flagged for manual entry", bool(sd.get("validation_note")))

    # 1b. A date-like-but-unparseable value is KEPT (flagged), not blanked — so a
    #     taught date that OCR'd noisily still shows for the user to fix.
    r = validator.validate_and_adjust(
        {"service_date": {"value": "l6/O3/2O26 ??", "confidence": 80, "method": "anchor_crop"}},
        field_defs)
    sd = r["service_date"]
    fails += not check("date-like noisy value KEPT (not blanked)", bool(sd.get("value")))
    fails += not check("and flagged for verification", bool(sd.get("validation_note")))

    # 1c. A date with OCR spaces around separators is salvaged cleanly.
    r = validator.validate_and_adjust(
        {"service_date": {"value": "16 / 03 / 2026", "confidence": 80, "method": "anchor_crop"}},
        field_defs)
    fails += not check("spaced date '16 / 03 / 2026' salvaged to 16-03-2026",
                       r["service_date"].get("value") == "16-03-2026")

    # 2. A real date in a standard format is kept + normalised.
    r = validator.validate_and_adjust(
        {"service_date": {"value": "Aug 6th 26", "confidence": 80, "method": "anchor"}},
        field_defs)
    fails += not check("valid date kept + normalised to 06-08-2026",
                       r["service_date"].get("value") == "06-08-2026")

    # 3. A date with extra characters / buried in noise is EXTRACTED, not withheld
    #    — "if a date can be pulled from the detected text, it will be."
    for noisy in ["logged 6/8/26 ok", "31/03/2026x", "Date: 6/8/2026",
                  "6/8/2026 Belfast", "logged Aug 6th 26 here", "6th August 2026!!"]:
        r = validator.validate_and_adjust(
            {"service_date": {"value": noisy, "confidence": 70, "method": "anchor"}},
            field_defs)
        got = r["service_date"].get("value")
        expected = "31-03-2026" if "31/03" in noisy else "06-08-2026"
        fails += not check(f"date extracted from {noisy!r} -> {expected}", got == expected)

    print()
    print(f"{fails} FAILED" if fails else "All date hard-gate checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
