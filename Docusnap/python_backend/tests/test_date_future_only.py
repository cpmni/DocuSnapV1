#!/usr/bin/env python3
"""
tests/test_date_future_only.py
------------------------------
Date sanity check should flag FUTURE dates only — never old dates. This system
files historical paperwork, so old document dates are expected.

Covers:
  1. A clearly old date (10 / 20 years ago) is NOT flagged
  2. A clearly future date IS flagged (note + reduced confidence -> review)
  3. Today's date is fine
  4. A near-future date within tolerance is NOT flagged (conservative)
  5. Normalisation of a valid date still happens (unchanged behaviour)

Dates are built relative to "now" so the test stays correct over time.

Usage:
    py -3.12 python_backend/tests/test_date_future_only.py

Exit 0 = all checks passed.  Exit 1 = failure(s).
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction.validator import validate_and_adjust


def check(label: str, condition: bool) -> bool:
    print(f"  {'OK ' if condition else 'BAD'}  {label}")
    return condition


def section(title: str):
    print(f"\n{title}")


DATE_FIELDS = [{"key": "invoice_date", "type": "date", "confidence_threshold": 70}]


def _run(value, confidence=90):
    results = {"invoice_date": {"value": value, "confidence": confidence, "method": "test"}}
    return validate_and_adjust(results, DATE_FIELDS)["invoice_date"]


def main() -> int:
    failures = 0
    now = datetime.now()

    # ── 1. Old dates are NOT flagged ──────────────────────────────────────────
    section("1. clearly old dates are not flagged")
    for years in (10, 20):
        d = (now - timedelta(days=365 * years + 5)).strftime("%d/%m/%Y")
        r = _run(d)
        if not check(f"{years}-year-old date '{d}' has no validation note", not r.get("validation_note")):
            failures += 1
        # Not penalised for age: a clean parse floors to _CLEAN_DATE_CONF (>=90),
        # never reduced below the input for being old.
        if not check(f"{years}-year-old date keeps its confidence (>=90, not penalised for age)", r["confidence"] >= 90):
            failures += 1

    # ── 2. Future dates ARE flagged ───────────────────────────────────────────
    section("2. a clearly future date is flagged")
    fut = (now + timedelta(days=365 * 3)).strftime("%d/%m/%Y")
    r = _run(fut)
    if not check(f"future date '{fut}' carries the 'in the future' note",
                 r.get("validation_note") == "date is in the future"):
        failures += 1
    if not check("future date confidence reduced (<= 40 -> review)", r["confidence"] <= 40):
        failures += 1

    # ── 3. Today is fine ──────────────────────────────────────────────────────
    section("3. today's date is fine")
    today = now.strftime("%d/%m/%Y")
    r = _run(today)
    if not check(f"today '{today}' has no validation note", not r.get("validation_note")):
        failures += 1

    # ── 4. Near-future within tolerance is NOT flagged (conservative) ─────────
    section("4. a near-future date within tolerance is not flagged")
    soon = (now + timedelta(days=30)).strftime("%d/%m/%Y")   # ~1 month ahead
    r = _run(soon)
    if not check(f"~1-month-future date '{soon}' is not flagged (merely unusual, not clearly future)",
                 not r.get("validation_note")):
        failures += 1

    # ── 5. Normalisation still happens ────────────────────────────────────────
    section("5. valid dates are still normalised to DD-MM-YYYY")
    r = _run("2020-03-09")  # ISO, clearly old
    if not check("'2020-03-09' normalised to 09-03-2020 with no flag",
                 r["value"] == "09-03-2020" and not r.get("validation_note")):
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
