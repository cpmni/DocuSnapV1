#!/usr/bin/env python3
"""
tests/test_document_confidence_weighting.py
-------------------------------------------
Unit tests for document-level confidence weighting by per-field format
consistency (validator.format_consistency_adjustment / format_consistency_delta).

Covers:
  1. A single field mismatch lowers the document score (penalty)
  2. More mismatches = bigger penalty (capped)
  3. All fields matching, well-supported -> a boost above baseline
  4. Sparse document (too few fields) is NOT boosted
  5. Weakly-supported document (clean but no historical evidence) is NOT boosted
  6. Penalty always outweighs the most generous boost (conservative)
  7. format_consistency_delta builds signals from results + supported_keys
  8. A penalty applies on a mismatch even with strong support elsewhere

Usage:
    py -3.12 python_backend/tests/test_document_confidence_weighting.py

Exit 0 = all checks passed.  Exit 1 = failure(s).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction.validator import (
    format_consistency_adjustment,
    format_consistency_delta,
    overall_confidence,
)


def check(label: str, condition: bool) -> bool:
    print(f"  {'OK ' if condition else 'BAD'}  {label}")
    return condition


def section(title: str):
    print(f"\n{title}")


def _sig(mismatch=False, supported=False):
    return {"mismatch": mismatch, "supported": supported}


def main() -> int:
    failures = 0

    # ── 1. Single mismatch -> penalty ─────────────────────────────────────────
    section("1. a single field mismatch lowers the document score")
    one_bad = [_sig(supported=True), _sig(supported=True), _sig(mismatch=True, supported=True)]
    d = format_consistency_adjustment(one_bad)
    if not check("one mismatch returns a negative delta", d < 0):
        failures += 1

    # ── 2. More mismatches -> bigger (capped) penalty ─────────────────────────
    section("2. more mismatches = larger penalty, but capped")
    two_bad   = [_sig(mismatch=True), _sig(mismatch=True), _sig(supported=True)]
    many_bad  = [_sig(mismatch=True) for _ in range(8)]
    if not check("two mismatches penalise more than one",
                 format_consistency_adjustment(two_bad) < format_consistency_adjustment(one_bad)):
        failures += 1
    if not check("penalty is capped (never below -25)",
                 format_consistency_adjustment(many_bad) >= -25):
        failures += 1

    # ── 3. All match, well supported -> boost ─────────────────────────────────
    section("3. a fully consistent, well-supported document is boosted")
    all_good = [_sig(supported=True), _sig(supported=True), _sig(supported=True)]
    boost = format_consistency_adjustment(all_good)
    if not check("clean + 3 supported fields returns a positive delta", boost > 0):
        failures += 1
    # And that it raises the document score above the plain average baseline.
    fields = [{"key": "a"}, {"key": "b"}, {"key": "c"}]
    clean_results = {k["key"]: {"value": "x", "confidence": 80} for k in fields}
    baseline = overall_confidence(clean_results, fields)
    delta = format_consistency_delta(clean_results, fields, supported_keys={"a", "b", "c"})
    if not check("weighted score (baseline+delta) is higher than the raw average",
                 baseline + delta > baseline):
        failures += 1

    # ── 4. Sparse document is NOT boosted ─────────────────────────────────────
    section("4. a sparse document is not over-rewarded")
    sparse = [_sig(supported=True), _sig(supported=True)]   # only 2 valued fields
    if not check("clean but only 2 fields -> no boost (0)",
                 format_consistency_adjustment(sparse) == 0):
        failures += 1
    one_field = [_sig(supported=True)]
    if not check("a single clean field -> no boost (0)",
                 format_consistency_adjustment(one_field) == 0):
        failures += 1

    # ── 5. Weakly-supported document is NOT boosted ───────────────────────────
    section("5. a clean but unverified document is not boosted")
    unsupported = [_sig(), _sig(), _sig(), _sig()]   # 4 clean fields, none supported
    if not check("4 clean fields with no historical support -> no boost (0)",
                 format_consistency_adjustment(unsupported) == 0):
        failures += 1
    one_support = [_sig(supported=True), _sig(), _sig()]   # only 1 supported
    if not check("only 1 supported match -> no boost (0)",
                 format_consistency_adjustment(one_support) == 0):
        failures += 1

    # ── 6. Conservative: worst penalty outweighs best boost ───────────────────
    section("6. penalties outweigh boosts (conservative)")
    best_boost  = format_consistency_adjustment([_sig(supported=True)] * 10)
    worst_pen   = format_consistency_adjustment([_sig(mismatch=True)] * 10)
    if not check("max boost <= 10 and max penalty <= -25 (asymmetric, downside-biased)",
                 best_boost <= 10 and worst_pen <= -25):
        failures += 1

    # ── 7. delta builder reads validation_note + supported_keys ───────────────
    section("7. format_consistency_delta builds signals from results")
    fdefs = [{"key": "invoice_number", "required": True},
             {"key": "invoice_date",   "required": True},
             {"key": "total_amount",   "required": True}]
    # one field flagged with a validation_note -> mismatch -> penalty
    flagged = {
        "invoice_number": {"value": "INV-1", "confidence": 90},
        "invoice_date":   {"value": "01-12-2025", "confidence": 90},
        "total_amount":   {"value": "12/3", "confidence": 40, "validation_note": "format anomaly"},
    }
    if not check("a results dict with one flagged field yields a negative delta",
                 format_consistency_delta(flagged, fdefs, {"invoice_number", "invoice_date", "total_amount"}) < 0):
        failures += 1
    # all clean + all supported -> boost
    clean = {
        "invoice_number": {"value": "INV-1", "confidence": 90},
        "invoice_date":   {"value": "01-12-2025", "confidence": 90},
        "total_amount":   {"value": "120.00", "confidence": 90},
    }
    if not check("all-clean, all-supported results yield a positive delta",
                 format_consistency_delta(clean, fdefs, {"invoice_number", "invoice_date", "total_amount"}) > 0):
        failures += 1
    if not check("same clean results with NO supported keys -> no boost (0)",
                 format_consistency_delta(clean, fdefs, set()) == 0):
        failures += 1

    # ── 8. mismatch dominates even amid strong support ────────────────────────
    section("8. a mismatch penalises even when other fields are well supported")
    mixed = [_sig(supported=True), _sig(supported=True), _sig(supported=True), _sig(mismatch=True)]
    if not check("3 supported matches + 1 mismatch still nets a penalty",
                 format_consistency_adjustment(mixed) < 0):
        failures += 1

    # ── 9. empty input is safe ────────────────────────────────────────────────
    section("9. empty / no-field input returns 0")
    if not check("no fields -> 0", format_consistency_adjustment([]) == 0):
        failures += 1
    if not check("delta with no field_defs -> 0", format_consistency_delta({}, None) == 0):
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
