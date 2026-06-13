#!/usr/bin/env python3
"""
tests/test_format_shape_consistency.py
--------------------------------------
Unit tests for the stricter within-class SHAPE consistency check added to the
Stage 4.5 format anomaly system. Beyond the coarse class (digits_only,
alphanum_sep, …), a value can now be flagged when its normalised structure
(digit-group lengths + separator positions) deviates from the unanimous shape
learned from confirmed history — even when it still fits the coarse class.

Covers:
  1. Consistent history '1111-1111-1' -> current '11111-1111-1' flagged (low)
  2. A correctly-shaped value is NOT flagged
  3. Separator corruption: missing hyphen and extra hyphen flagged
  4. False-positive guard: shape-varying history learns no shape -> no flag
  5. digits_only digit-count: wrong length flagged, right length passes
  6. Existing coarse behaviour preserved (digits_only letter = high severity;
     alphanum_sep unexpected char = low severity) and short on this path
  7. shape_signature itself is correct and deterministic

Usage:
    py -3.12 python_backend/tests/test_format_shape_consistency.py

Exit 0 = all checks passed.  Exit 1 = failure(s).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction.format_anomaly_checker import (
    build_format_class_index,
    classify_format,
    check_value,
    shape_signature,
    ALPHANUM_SEP, DIGITS_ONLY,
)


def check(label: str, condition: bool) -> bool:
    print(f"  {'OK ' if condition else 'BAD'}  {label}")
    return condition


def section(title: str):
    print(f"\n{title}")


def _entry(supplier, doc_type, field_key, samples, confirmed_count=10):
    return {
        'supplier_name': supplier,
        'document_type': doc_type,
        'field_key':     field_key,
        'sample_values': samples,
        'confirmed_count': confirmed_count,
    }


def main() -> int:
    failures = 0

    # ── 1. Learn shape from consistent history; flag the wrong-shape value ─────
    section("1. consistent '####-####-#' history flags an extra-digit value")
    data  = [_entry('Acme Ltd', 'invoice', 'account_ref',
                    ['1111-1111-1', '2222-3333-4', '9876-5432-1'])]
    index = build_format_class_index(data)
    entry = index.get(('acme ltd', 'invoice', 'account_ref'))

    if not check("index entry learned for the field", entry is not None):
        return 1
    if not check("coarse class is alphanum_sep (the broad class still fits)",
                 entry.get('class') == ALPHANUM_SEP):
        failures += 1
    if not check("learned shape signature is '####-####-#'",
                 entry.get('shape') == '####-####-#'):
        failures += 1

    anomaly = check_value('11111-1111-1', entry)   # the task's example
    if not check("'11111-1111-1' (5-digit first group) is flagged", anomaly is not None):
        failures += 1
    if not check("shape mismatch is low severity (review, not auto-correct)",
                 anomaly and anomaly.get('severity') == 'low'):
        failures += 1

    # ── 2. Correctly-shaped value passes ──────────────────────────────────────
    section("2. a correctly-shaped value is NOT flagged")
    if not check("'5555-6666-7' matches the learned shape -> no anomaly",
                 check_value('5555-6666-7', entry) is None):
        failures += 1

    # ── 3. Separator corruption (missing / extra hyphen) ──────────────────────
    section("3. separator corruption is flagged")
    if not check("missing separator '11111111-1' flagged",
                 check_value('11111111-1', entry) is not None):
        failures += 1
    if not check("extra separator '1111--1111-1' flagged",
                 check_value('1111--1111-1', entry) is not None):
        failures += 1

    # ── 4. False-positive guard: shape-varying history learns no shape ────────
    section("4. shape-varying history -> no shape constraint -> no false flag")
    varied = [_entry('Acme Ltd', 'invoice', 'ref2',
                     ['11-1', '1111-1111-1', '12-1234'])]   # all alphanum_sep, diff shapes
    v_entry = build_format_class_index(varied).get(('acme ltd', 'invoice', 'ref2'))
    if not check("class still learned (alphanum_sep) but shape is None",
                 v_entry and v_entry.get('class') == ALPHANUM_SEP and v_entry.get('shape') is None):
        failures += 1
    if not check("an oddly-shaped but in-class value is NOT flagged on shape grounds",
                 check_value('999-99', v_entry) is None):
        failures += 1

    # ── 5. digits_only digit-count shape ──────────────────────────────────────
    section("5. digits_only: wrong digit count flagged, right count passes")
    dd = [_entry('Beta Co', 'invoice', 'code', ['123456', '234567', '345678'])]
    d_entry = build_format_class_index(dd).get(('beta co', 'invoice', 'code'))
    if not check("learned shape is '######' (six digits)", d_entry.get('shape') == '######'):
        failures += 1
    if not check("'1234567' (7 digits) flagged even though still all-digits",
                 check_value('1234567', d_entry) is not None):
        failures += 1
    if not check("'555666' (6 digits) passes", check_value('555666', d_entry) is None):
        failures += 1

    # ── 6. Existing coarse behaviour preserved (and wins before shape) ────────
    section("6. coarse-class behaviour unchanged")
    letter_anom = check_value('12X456', d_entry)   # letter in digits_only
    if not check("letter in digits_only still flagged HIGH severity",
                 letter_anom and letter_anom.get('severity') == 'high'
                 and 'unexpected character' in letter_anom.get('anomaly', '')):
        failures += 1
    sep_anom = check_value('1111/1111-1', entry)   # '/' not in learned seps {'-'}
    if not check("unexpected separator in alphanum_sep still flagged LOW (char path)",
                 sep_anom and sep_anom.get('severity') == 'low'
                 and 'unexpected character' in sep_anom.get('anomaly', '')):
        failures += 1

    # ── 7. shape_signature is correct + deterministic ─────────────────────────
    section("7. shape_signature mapping")
    if not check("'1111-1111-1' -> '####-####-#'", shape_signature('1111-1111-1') == '####-####-#'):
        failures += 1
    if not check("letters -> '@', 'AB12-3' -> '@@##-#'", shape_signature('AB12-3') == '@@##-#'):
        failures += 1
    if not check("whitespace stripped before signing", shape_signature('  12-3 ') == '##-#'):
        failures += 1
    if not check("deterministic (same input -> same output)",
                 shape_signature('X9/9') == shape_signature('X9/9')):
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
