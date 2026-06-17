"""
_repair_single_token guards (hermetic — these branches return before any OCR):
a value is only re-read to strip a spurious separator when it is a SINGLE token
carrying / \\ | and the field is not a date. Multi-word values, date fields,
clean tokens and empties are returned untouched (no Tesseract needed).

The positive repair path (PSM7 + alphanumeric whitelist re-read) is covered by
the OCR smoke test run during development; it is not exercised here to keep this
suite independent of Tesseract.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import anchor


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


fails = 0
# Multi-word value (has a space) is left alone even with a slash present.
fails += not check("multi-word value untouched",
                   anchor._repair_single_token(None, "Ship/Bill To Acme", "text") == "Ship/Bill To Acme")
# Date field: '/' is legitimate, never repaired.
fails += not check("date value untouched",
                   anchor._repair_single_token(None, "20/02/2026", "date") == "20/02/2026")
# Date-SHAPED token in a NON-date field (custom/mistyped): the '/' must survive —
# this is the "22/06/2025 -> 2206225" regression guard. Shape-based, val_type None.
fails += not check("date-shaped token untouched even when val_type is not 'date'",
                   anchor._repair_single_token(None, "22/06/2025", None) == "22/06/2025")
fails += not check("dotted date-shaped token untouched (val_type None)",
                   anchor._repair_single_token(None, "5.5.26", None) == "5.5.26")
# A pure-numeric serial with a SPURIOUS slash is NOT date-shaped -> still repairable
# (returns unchanged here only because img=None makes the re-read no-op).
fails += not check("non-date slashed serial still enters the repair path",
                   anchor._repair_single_token(None, "12/34567", None) == "12/34567")
# Single token with no separator: nothing to do.
fails += not check("clean token untouched",
                   anchor._repair_single_token(None, "H7R5326676", None) == "H7R5326676")
# Empty / falsy.
fails += not check("empty untouched", anchor._repair_single_token(None, "", None) == "")

print("\n" + ("All crop-repair guard checks passed" if not fails else f"{fails} FAILED"))
sys.exit(1 if fails else 0)
