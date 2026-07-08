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
                 entry.get('shapes') == frozenset({'####-####-#'})):
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
    if not check("class still learned (alphanum_sep) but no shape constraint",
                 v_entry and v_entry.get('class') == ALPHANUM_SEP and not v_entry.get('shapes')):
        failures += 1
    if not check("an oddly-shaped but in-class value is NOT flagged on shape grounds",
                 check_value('999-99', v_entry) is None):
        failures += 1

    # ── 5. digits_only: LENGTH is folded (a number's length is variable) ──────
    # A pure-numeric field's digit COUNT is length-invariant: '######'/'#######' fold
    # to '#', so a legitimately longer/shorter number is NOT a "wrong shape" anomaly.
    # (This is the fix for the 6-digit-invoice-in-a-5-digit-corpus reject + the
    # thousands-currency truncation — encoding exact digit count into the veto was
    # rejecting/truncating valid values whose length was rarer than the corpus norm.)
    section("5. digits_only: digit-count is length-invariant (folded to '#')")
    dd = [_entry('Beta Co', 'invoice', 'code', ['123456', '234567', '345678'])]
    d_entry = build_format_class_index(dd).get(('beta co', 'invoice', 'code'))
    if not check("learned shape folds to '#' (any digit run)",
                 d_entry.get('shapes') == frozenset({'#'})):
        failures += 1
    if not check("'1234567' (7 digits) NOT flagged — length varies legitimately",
                 check_value('1234567', d_entry) is None):
        failures += 1
    if not check("'12' (2 digits) NOT flagged either", check_value('12', d_entry) is None):
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
    # Ref separators '-' '/' '.' are INTERCHANGEABLE (trust-first): a '/' where the corpus learned
    # '-' is a formatting/OCR variant, not an anomaly — the group STRUCTURE still matches.
    if not check("interchangeable ref separator '1111/1111-1' is TOLERATED (not flagged)",
                 check_value('1111/1111-1', entry) is None):
        failures += 1
    # A NON-ref separator (space) is still an unexpected character on the char path.
    space_anom = check_value('1111 1111-1', entry)
    if not check("a non-ref separator (space) still flagged LOW (char path)",
                 space_anom and space_anom.get('severity') == 'low'
                 and 'unexpected character' in space_anom.get('anomaly', '')):
        failures += 1

    # ── 6b. Count-gated multi-shape learning (STRUCTURED shapes) ──────────────
    # Numeric LENGTH now folds (test 5), so a second digit-length is not a distinct
    # shape. Count-gated multi-shape learning still applies to STRUCTURED shapes,
    # where the separator layout IS meaningful and a poisoned structure must stay
    # flagged until it has proportional support.
    section("6b. a second STRUCTURED shape is accepted once confirmed enough times")
    base = {'11-1111': 4, '22-2222': 3, '33-3333': 2}   # '##-####' confirmed 9x
    mc_entry = build_format_class_index([{
        'supplier_name': 'Gamma Co', 'document_type': 'invoice', 'field_key': 'ref',
        'sample_values': list(base), 'confirmed_count': 9, 'value_counts': base,
    }]).get(('gamma co', 'invoice', 'ref'))
    if not check("only the well-supported '##-####' shape learned",
                 mc_entry and mc_entry.get('shapes') == frozenset({'##-####'})):
        failures += 1
    if not check("a stray '###-###' value is flagged while under the threshold",
                 check_value('999-999', mc_entry) is not None):
        failures += 1

    # Now the '###-###' shape has been confirmed _SHAPE_ACCEPT_MIN times.
    both = {**base, '999-999': 3, '888-888': 1}         # '###-###' confirmed 4x (>=3)
    mc2 = build_format_class_index([{
        'supplier_name': 'Gamma Co', 'document_type': 'invoice', 'field_key': 'ref',
        'sample_values': list(both), 'confirmed_count': 13, 'value_counts': both,
    }]).get(('gamma co', 'invoice', 'ref'))
    if not check("both structured shapes now accepted",
                 mc2 and mc2.get('shapes') == frozenset({'##-####', '###-###'})):
        failures += 1
    if not check("a '###-###' value is no longer flagged", check_value('111-222', mc2) is None):
        failures += 1
    if not check("a '##-####' value is still accepted", check_value('55-5555', mc2) is None):
        failures += 1
    if not check("a never-confirmed '#-##' shape is still flagged",
                 check_value('1-22', mc2) is not None):
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
