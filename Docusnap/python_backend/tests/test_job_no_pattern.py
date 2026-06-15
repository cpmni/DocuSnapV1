#!/usr/bin/env python3
"""
tests/test_job_no_pattern.py
----------------------------
Stage 1 now has a job_no / reference pattern: a label-captured value of the
recurring four-four-one digit shape (observed across the Debug worksheets, e.g.
"2603-0670-1") is validated and normalised to a canonical "NNNN-NNNN-N",
tolerating OCR separator noise ('.', spaces, '_', '/', mixed). Generic to the
shape — not tied to any one supplier/document.

    py -3.12 python_backend/tests/test_job_no_pattern.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import keyword

CONFIG = str(Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")
PATTERNS = keyword.load_patterns(CONFIG)


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def _job_no(ocr_text):
    return keyword.extract_fields(ocr_text, ["job_no"], PATTERNS).get("job_no", {}).get("value")


def test_recurring_shape_and_separator_normalisation():
    print("job_no: recurring 4-4-1 shape captured and normalised to NNNN-NNNN-N")
    failures = 0
    cases = [
        ("Job No: 2603-0670-1",            "2603-0670-1", "canonical hyphens"),
        ("Job No 2603 0670 1",             "2603-0670-1", "space separators"),
        ("Job Number: 2603.0670.1",        "2603-0670-1", "dot separators"),
        ("Job No 2603_0670 1",             "2603-0670-1", "mixed _/space"),
        ("Job No\n2604-0511-1",            "2604-0511-1", "value on the line below"),
        ("Ref No: 2605-0815-1",            "2605-0815-1", "Ref No label variant"),
    ]
    for text, expected, why in cases:
        got = _job_no(text)
        if not check(f"{why}: {text!r} -> {got!r} (== {expected!r})", got == expected):
            failures += 1
    print()
    return failures


def test_non_shape_values_rejected():
    """A label present but no 4-4-1 shape (a word/garbage) must NOT produce a
    job_no candidate — better no candidate than a confident wrong one."""
    print("job_no: non-shaped captures produce no Stage 1 candidate")
    failures = 0
    for text in ["Job No: Booking", "Job No: see attached", "Job No: 12"]:
        got = _job_no(text)
        if not check(f"{text!r} -> {got!r} (no candidate)", got is None):
            failures += 1
    print()
    return failures


def main():
    failures = 0
    failures += test_recurring_shape_and_separator_normalisation()
    failures += test_non_shape_values_rejected()
    if failures:
        print(f"{failures} check(s) failed — job_no pattern regressed.")
        return 1
    print("All checks passed — job_no Stage 1 pattern behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
