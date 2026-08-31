#!/usr/bin/env python3
"""
tests/test_date_salvage.py
--------------------------
Unit tests for salvaging a valid date embedded inside noisy OCR text
(validator.salvage_date + its wiring into validate_and_adjust).

Covers:
  1. Noisy "2_ 2/4/26bf" -> 22-04-2026: a SINGLE date in junk is a clean capture, NOT
     forced to review (junk stripped; the OCR digit-split "2 2" rejoins to day 22 — see
     _date_preclean / test_date_preclean; still salvage-tier + review-held, never auto-filed)
  1b. Several dates in the crop -> salvage had to CHOOSE one -> kept in review
  2. A clean date passes through unchanged (no false review)
  3. A non-date string is NOT coerced into a date
  4. Another common format (ISO, embedded in junk) is salvaged (single -> clean)
  5. A month-name date embedded in junk is salvaged
  6. salvage_date is conservative: plain digit runs / partial dates -> None
  7. A true non-date in a date field is withheld (cleared) + flagged for manual entry

Usage:
    py -3.12 python_backend/tests/test_date_salvage.py

Exit 0 = all checks passed.  Exit 1 = failure(s).
"""

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction.validator import salvage_date, salvage_date_detail, validate_and_adjust


def check(label: str, condition: bool) -> bool:
    print(f"  {'OK ' if condition else 'BAD'}  {label}")
    return condition


def section(title: str):
    print(f"\n{title}")


# Minimal field schema: one date field with the default 70 threshold.
DATE_FIELDS = [{"key": "invoice_date", "type": "date", "confidence_threshold": 70}]


def _run(value, confidence=90):
    """Run the date field through validate_and_adjust and return its result."""
    results = {"invoice_date": {"value": value, "confidence": confidence, "method": "test"}}
    out = validate_and_adjust(results, DATE_FIELDS)
    return out["invoice_date"]


def main() -> int:
    failures = 0

    # ── 1. Headline: a SINGLE embedded date is a clean capture, NOT forced to review ──
    # NOTE (2026-07-16, _date_preclean): the junk-strip removes '_' -> '2 2/4/26', and the
    # OCR digit-split rejoin then reads the day as '22' (a single date field is far more likely
    # '22/4/26' than a stray '2' + '2/4/26'). Still a single candidate -> salvage tier (conf 80),
    # review-held — never a silent auto-file (Oracle residual (2), 2026-07-16). See test_date_preclean.
    section("1. noisy '2_ 2/4/26bf' is recovered (OCR-split rejoined) and NOT forced to review")
    r = _run("2_ 2/4/26bf")
    if not check("value normalised to 22-04-2026 (junk stripped, '2 2' rejoined to day 22)", r["value"] == "22-04-2026"):
        failures += 1
    if not check("no junk characters survive (digits + hyphens only)",
                 all(c.isdigit() or c == '-' for c in r["value"])):
        failures += 1
    if not check("clean verbatim capture -> NOT forced to review (confidence >= 70)",
                 r["confidence"] >= 70):
        failures += 1
    if not check("no 'please verify' review note attached",
                 "verify" not in (r.get("validation_note") or "")):
        failures += 1

    # ── 1b. Several dates present -> salvage chose one -> KEEP review ──────────
    section("1b. multiple dates in the crop stay in review (salvage had to choose)")
    r = _run("Invoice 02/04/2026 Due 02/05/2026")
    if not check("a real date is recovered", r["value"] in ("02-04-2026", "02-05-2026")):
        failures += 1
    if not check("forced to review (confidence <= 45)", r["confidence"] <= 45):
        failures += 1
    if not check("'please verify' note attached", "verify" in (r.get("validation_note") or "")):
        failures += 1
    if not check("salvage_date_detail reports 2 distinct dates",
                 salvage_date_detail("Invoice 02/04/2026 Due 02/05/2026")[1] == 2):
        failures += 1

    # ── 2. Clean date unchanged (no false review) ─────────────────────────────
    section("2. a clean date passes through unchanged")
    r = _run("15/06/2026", confidence=95)
    if not check("normalised to 15-06-2026", r["value"] == "15-06-2026"):
        failures += 1
    if not check("confidence untouched (no review forced)", r["confidence"] == 95):
        failures += 1
    if not check("no validation note added", not r.get("validation_note")):
        failures += 1

    # ── 2b. A clean date read at LOW confidence is floored to High ─────────────
    # The screenshot case: an anchor read "29/05/2026" correctly at only 50%, Stage 4
    # normalised the separator (29/05/2026 -> 29-05-2026), and the field was left at
    # 50% -> "Check". A well-formed date must not be voted down for a cosmetic format
    # normalisation.
    section("2b. a clean date read at low confidence is floored to High (not reviewed)")
    r = _run("29/05/2026", confidence=50)
    if not check("normalised to 29-05-2026", r["value"] == "29-05-2026"):
        failures += 1
    if not check("low (50) floored to High -> clears review (>= 70)", r["confidence"] >= 70):
        failures += 1
    if not check("no review note added", not r.get("validation_note")):
        failures += 1

    # ── 3. Non-date string is NOT coerced ─────────────────────────────────────
    section("3. a non-date string is not turned into a date")
    if not check("salvage_date('Customer Copy') is None", salvage_date("Customer Copy") is None):
        failures += 1
    if not check("salvage_date('Order 12345') is None", salvage_date("Order 12345") is None):
        failures += 1
    r = _run("Customer Copy")
    # A date field must never hold a non-date: the value is now WITHHELD (cleared)
    # and flagged for manual entry, rather than kept at low confidence.
    if not check("non-date in a date field is withheld + flagged for manual entry",
                 r.get("value") in (None, "") and bool(r.get("validation_note"))):
        failures += 1

    # ── 4. Another common format (ISO) embedded in junk: single -> clean ──────
    section("4. ISO date embedded in junk is salvaged (single date -> not reviewed)")
    r = _run("xx2025-12-01yy")
    if not check("'xx2025-12-01yy' -> 01-12-2025", r["value"] == "01-12-2025"):
        failures += 1
    if not check("not forced to review (single verbatim date)", r["confidence"] >= 70):
        failures += 1

    # ── 5. Month-name date embedded in junk ───────────────────────────────────
    section("5. month-name date embedded in junk is salvaged")
    if not check("salvage_date('Inv01-May-2024x') -> 01 May 2024",
                 salvage_date("Inv01-May-2024x") == datetime(2024, 5, 1)):
        failures += 1
    if not check("salvage_date('paid May 01, 2024 ok') -> 01 May 2024",
                 salvage_date("paid May 01, 2024 ok") == datetime(2024, 5, 1)):
        failures += 1

    # ── 6. Conservative: partial / bare-number inputs are rejected ────────────
    section("6. salvage_date stays conservative")
    if not check("a bare run of digits '20251201' is NOT a date", salvage_date("20251201") is None):
        failures += 1
    if not check("a partial date '2/4' (no year) is NOT salvaged", salvage_date("2/4") is None):
        failures += 1
    if not check("an impossible date '45/67/89' is rejected by parse_date",
                 salvage_date("45/67/89") is None):
        failures += 1
    if not check("a reference like 'INV-2024-001' is not read as a date",
                 salvage_date("INV-2024-001") is None):
        failures += 1

    # ── 7. salvage_date direct on the headline value ──────────────────────────
    section("7. salvage_date direct return")
    if not check("salvage_date('2_ 2/4/26bf') == 2 Apr 2026",
                 salvage_date("2_ 2/4/26bf") == datetime(2026, 4, 2)):
        failures += 1

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    if failures:
        print(f"{failures} check(s) FAILED.")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
