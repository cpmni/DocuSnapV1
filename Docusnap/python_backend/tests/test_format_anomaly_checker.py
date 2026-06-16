#!/usr/bin/env python3
"""
tests/test_format_anomaly_checker.py
--------------------------------------
Unit tests for Stage 1 of the field format cross-referencing feature.

Tests verify:
  1. digits_only history + slash anomaly detected (high severity)
  2. Mixed/ambiguous history -> freetext -> no anomaly even on weird value
  3. Fewer than 3 distinct values -> no index entry -> no check
  4. Strict (supplier_name, document_type, field_key) isolation
  5. Leading-zero numeric strings treated as digits_only (not parsed as int)
  6. upper_alphanum history: lowercase anomaly detected
  7. alphanum_sep history: unknown separator detected
  8. date_like history: non-date value flagged
  9. currency_like history: non-currency value flagged
 10. Plain digits string not wrongly classified as currency_like
 11. Field already carrying validation_note is skipped by check_value
 12. Engine set_formats populates format_class_index correctly

Usage:
    py -3.12 python_backend/tests/test_format_anomaly_checker.py

Exit 0 = all checks passed.  Exit 1 = failure(s).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction.format_anomaly_checker import (
    build_format_class_index,
    classify_format,
    classify_single,
    check_value,
    clean_digits_only,
    propose_correction,
    DIGITS_ONLY, UPPER_ALPHANUM, ALPHANUM, ALPHANUM_SEP,
    DATE_LIKE, CURRENCY_LIKE, FREETEXT,
)


def check(label: str, condition: bool) -> bool:
    status = 'OK ' if condition else 'BAD'
    print(f"  {status}  {label}")
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

    # ── 1. digits_only history + slash anomaly ────────────────────────────────
    section("1. digits_only history + slash anomaly")

    data = [_entry('Acme Ltd', 'invoice', 'invoice_number', ['1234', '2345', '5678'])]
    index = build_format_class_index(data)
    entry = index.get(('acme ltd', 'invoice', 'invoice_number'))

    if not check("index entry created for acme ltd / invoice / invoice_number", entry is not None):
        failures += 1
    if not check("format class is digits_only", entry and entry.get('class') == DIGITS_ONLY):
        failures += 1

    if entry:
        result = check_value('46/4', entry)
        if not check("check_value returns anomaly for '46/4'", result is not None):
            failures += 1
        if not check("anomaly severity is 'high'", result and result.get('severity') == 'high'):
            failures += 1
        if not check("anomaly text mentions digits_only", result and 'digits_only' in result.get('anomaly', '')):
            failures += 1

        # Clean value passes
        result_clean = check_value('9999', entry)
        if not check("clean digits-only value passes (no anomaly)", result_clean is None):
            failures += 1

    # ── 2. Mixed/ambiguous history -> freetext no-op ───────────────────────────
    section("2. Mixed history -> freetext -> no constraint applied")

    mixed_data = [_entry('Acme Ltd', 'invoice', 'invoice_number',
                         ['1234', 'INV-001', 'A5678'])]
    mixed_index = build_format_class_index(mixed_data)
    if not check("mixed history: no index entry (freetext dropped)",
                 ('acme ltd', 'invoice', 'invoice_number') not in mixed_index):
        failures += 1

    # Directly test classify_format with disagreeing values
    fmt = classify_format(['1234', 'INV-001', 'A5678'])
    if not check("classify_format with disagreeing sample -> freetext",
                 fmt['class'] == FREETEXT):
        failures += 1

    # ── 3. Fewer than 3 distinct values -> no-op ──────────────────────────────
    section("3. Fewer than 3 distinct values -> no index entry")

    thin_data = [_entry('Acme Ltd', 'invoice', 'invoice_number',
                        ['1234', '1234', '1234'])]  # only 1 distinct after dedup
    thin_index = build_format_class_index(thin_data)
    if not check("single distinct value: no index entry",
                 ('acme ltd', 'invoice', 'invoice_number') not in thin_index):
        failures += 1

    two_data = [_entry('Acme Ltd', 'invoice', 'invoice_number', ['1234', '5678'])]
    two_index = build_format_class_index(two_data)
    if not check("exactly 2 distinct values: no index entry",
                 ('acme ltd', 'invoice', 'invoice_number') not in two_index):
        failures += 1

    fmt_two = classify_format(['1234', '5678'])
    if not check("classify_format with 2 values -> freetext",
                 fmt_two['class'] == FREETEXT):
        failures += 1

    # ── 4. Strict supplier / document_type isolation ──────────────────────────
    section("4. Strict (supplier, document_type, field_key) isolation")

    isolation_data = [
        _entry('Acme Ltd',  'invoice',       'invoice_number', ['1234', '2345', '5678']),
        _entry('Bravo Inc', 'invoice',       'invoice_number', ['INV-001', 'INV-002', 'INV-003']),
        _entry('Acme Ltd',  'purchase_order', 'po_number',     ['PO-100', 'PO-200', 'PO-300']),
    ]
    iso_index = build_format_class_index(isolation_data)

    acme_inv  = iso_index.get(('acme ltd',  'invoice',        'invoice_number'))
    bravo_inv = iso_index.get(('bravo inc', 'invoice',        'invoice_number'))
    acme_po   = iso_index.get(('acme ltd',  'purchase_order', 'po_number'))

    if not check("Acme invoice_number: digits_only",
                 acme_inv and acme_inv['class'] == DIGITS_ONLY):
        failures += 1
    if not check("Bravo invoice_number: alphanum_sep (INV-xxx pattern)",
                 bravo_inv and bravo_inv['class'] == ALPHANUM_SEP):
        failures += 1
    if not check("Acme po_number: alphanum_sep (PO-xxx pattern)",
                 acme_po and acme_po['class'] == ALPHANUM_SEP):
        failures += 1

    # Anomaly for Acme should NOT be triggered when checking against Bravo's entry
    if bravo_inv:
        bravo_result = check_value('46/4', bravo_inv)
        # '46/4' has '/', which is not in Bravo's learned separator set {'-'}
        if not check("'46/4' is anomalous against Bravo's alphanum_sep (wrong sep)",
                     bravo_result is not None):
            failures += 1

    # 'INV-001' is valid for Bravo but should flag on Acme (digits_only)
    if acme_inv:
        acme_result = check_value('INV-001', acme_inv)
        if not check("'INV-001' anomalous against Acme's digits_only",
                     acme_result is not None):
            failures += 1

    # ── 5. Leading-zero numeric strings treated as digits_only ────────────────
    section("5. Leading-zero numeric strings -> digits_only (not parsed as int)")

    if not check("classify_single('001') -> digits_only",
                 classify_single('001') == DIGITS_ONLY):
        failures += 1
    if not check("classify_single('0001234') -> digits_only",
                 classify_single('0001234') == DIGITS_ONLY):
        failures += 1

    lz_entry = {'class': DIGITS_ONLY, 'separators': frozenset()}
    if not check("leading-zero value '001' passes digits_only check",
                 check_value('001', lz_entry) is None):
        failures += 1
    if not check("leading-zero value '00000' passes digits_only check",
                 check_value('00000', lz_entry) is None):
        failures += 1

    lz_data = [_entry('Acme Ltd', 'invoice', 'invoice_number', ['001', '002', '003'])]
    lz_index = build_format_class_index(lz_data)
    lz_fmt   = lz_index.get(('acme ltd', 'invoice', 'invoice_number'))
    if not check("index built for leading-zero history",
                 lz_fmt is not None and lz_fmt['class'] == DIGITS_ONLY):
        failures += 1

    # ── 6. upper_alphanum history: lowercase anomaly ──────────────────────────
    section("6. upper_alphanum history — lowercase character anomaly")

    ua_data = [_entry('Zeta', 'invoice', 'invoice_number',
                      ['INV001', 'INV002', 'INV003'])]
    ua_index = build_format_class_index(ua_data)
    ua_entry = ua_index.get(('zeta', 'invoice', 'invoice_number'))

    if not check("INV-style history: upper_alphanum class",
                 ua_entry and ua_entry['class'] == UPPER_ALPHANUM):
        failures += 1

    if ua_entry:
        if not check("'inv001' (lowercase) anomalous against upper_alphanum",
                     check_value('inv001', ua_entry) is not None):
            failures += 1
        if not check("'INV999' passes upper_alphanum",
                     check_value('INV999', ua_entry) is None):
            failures += 1

    # ── 7. alphanum_sep history: unknown separator flagged ────────────────────
    section("7. alphanum_sep — value with separator not in learned set")

    sep_data = [_entry('Gamma', 'invoice', 'invoice_number',
                       ['INV-001', 'INV-002', 'INV-003'])]
    sep_index = build_format_class_index(sep_data)
    sep_entry = sep_index.get(('gamma', 'invoice', 'invoice_number'))

    if not check("INV-xxx history: alphanum_sep class",
                 sep_entry and sep_entry['class'] == ALPHANUM_SEP):
        failures += 1
    if not check("learned separator set includes '-'",
                 sep_entry and '-' in sep_entry.get('separators', frozenset())):
        failures += 1

    if sep_entry:
        if not check("'INV/001' (slash not in learned set) flagged as anomaly",
                     check_value('INV/001', sep_entry) is not None):
            failures += 1
        if not check("'INV-999' passes alphanum_sep check",
                     check_value('INV-999', sep_entry) is None):
            failures += 1

    # ── 8. date_like history ──────────────────────────────────────────────────
    section("8. date_like history — non-date value flagged")

    dl_data = [_entry('Delta', 'invoice', 'invoice_date',
                      ['01-12-2025', '15-06-2024', '03-03-2023'])]
    dl_index = build_format_class_index(dl_data)
    dl_entry = dl_index.get(('delta', 'invoice', 'invoice_date'))

    if not check("date history: date_like class",
                 dl_entry and dl_entry['class'] == DATE_LIKE):
        failures += 1

    if dl_entry:
        if not check("non-date value 'not-a-date' flagged",
                     check_value('not-a-date', dl_entry) is not None):
            failures += 1
        if not check("valid date '01-12-2025' passes",
                     check_value('01-12-2025', dl_entry) is None):
            failures += 1

    # ── 9. currency_like history ──────────────────────────────────────────────
    section("9. currency_like history — non-currency value flagged")

    cl_data = [_entry('Epsilon', 'invoice', 'total_amount',
                      ['£1,250.00', '£500.00', '£875.50'])]
    cl_index = build_format_class_index(cl_data)
    cl_entry = cl_index.get(('epsilon', 'invoice', 'total_amount'))

    if not check("currency history: currency_like class",
                 cl_entry and cl_entry['class'] == CURRENCY_LIKE):
        failures += 1

    if cl_entry:
        if not check("non-currency value 'not-money' flagged",
                     check_value('not-money', cl_entry) is not None):
            failures += 1
        if not check("valid currency '£750.00' passes",
                     check_value('£750.00', cl_entry) is None):
            failures += 1

    # ── 10. Plain digits not wrongly classified as currency_like ─────────────
    section("10. Plain digits do not classify as currency_like")

    if not check("classify_single('1250') -> digits_only (no currency symbol)",
                 classify_single('1250') == DIGITS_ONLY):
        failures += 1
    if not check("classify_single('1250.00') -> freetext or alphanum_sep (no symbol)",
                 classify_single('1250.00') in (FREETEXT, ALPHANUM_SEP)):
        failures += 1
    if not check("classify_single('£1250') -> currency_like",
                 classify_single('£1250') == CURRENCY_LIKE):
        failures += 1

    # ── 11. Field with existing validation_note skipped by engine check ───────
    section("11. Field with existing validation_note not double-flagged")
    # check_value itself doesn't inspect validation_note — that guard is in
    # engine.py.  Here we verify check_value still returns an anomaly (so the
    # engine guard is doing the right thing by skipping, not check_value
    # silently swallowing it).
    pre_flagged_entry = {'class': DIGITS_ONLY, 'separators': frozenset()}
    result_pf = check_value('46/4', pre_flagged_entry)
    if not check("check_value still returns anomaly for bad value "
                 "(engine guard is responsible for the skip, not this function)",
                 result_pf is not None):
        failures += 1

    # ── 12. build_format_class_index requires doc_type + field_key (supplier may
    #        be empty: that's the document-agnostic doc-type-scoped key) ─────────
    section("12. doc-type-scoped (empty-supplier) entries ARE indexed; missing doc_type/field skipped")

    # Empty supplier is VALID — it's the document-agnostic key getFieldFormats
    # emits ('', doc_type, field). Only a missing doc_type or field_key is skipped.
    doctype_scoped = [
        {'supplier_name': '', 'document_type': 'invoice', 'field_key': 'x', 'sample_values': ['1','2','3']},
    ]
    if not check("empty-supplier doc-type-scoped entry IS indexed",
                 ('', 'invoice', 'x') in build_format_class_index(doctype_scoped)):
        failures += 1

    bad_entries = [
        {'supplier_name': 'Acme',  'document_type': '', 'field_key': 'x', 'sample_values': ['1','2','3']},
        {'supplier_name': 'Acme',  'document_type': 'invoice', 'field_key': '', 'sample_values': ['1','2','3']},
    ]
    if not check("entries missing doc_type / field_key are skipped",
                 len(build_format_class_index(bad_entries)) == 0):
        failures += 1

    # ── 13. Digits-only cleanup (Part 1) ─────────────────────────────────────
    section("13. clean_digits_only normalises common OCR noise to pure digits")
    if not check("'/ 36714' -> '736714' (slash->7, space stripped)",
                 clean_digits_only('/ 36714') == '736714'):
        failures += 1
    if not check("'I36714' -> '136714' (I->1)",
                 clean_digits_only('I36714') == '136714'):
        failures += 1
    if not check("'l36 714' -> '136714' (l->1, interior space removed)",
                 clean_digits_only('l36 714') == '136714'):
        failures += 1

    # ── 14. propose_correction confident vs candidate (Part 1) ───────────────
    section("14. propose_correction auto-applies safe repairs, holds uncertain ones as candidates")
    dig = {'class': DIGITS_ONLY, 'separators': frozenset()}
    c1 = propose_correction('/ 36714', dig)
    if not check("'/ 36714' is a CONFIDENT correction to '736714' with auto-correct note",
                 c1 and c1['confident'] and c1['corrected'] == '736714'
                 and c1['note'].startswith("Auto-corrected digits-only field")):
        failures += 1
    c2 = propose_correction('INV12345', dig)
    if not check("'INV12345' is a NON-confident candidate (I->1, then N/V dropped = '112345') — not auto-applied",
                 c2 and not c2['confident'] and c2['corrected'] == '112345'
                 and 'candidate' in c2['note']):
        failures += 1
    if not check("propose_correction returns None for a non-digits_only class",
                 propose_correction('INV-001', {'class': UPPER_ALPHANUM, 'separators': frozenset()}) is None):
        failures += 1
    if not check("propose_correction returns None when value is already clean digits",
                 propose_correction('12345', dig) is None):
        failures += 1

    # ── 15. Learned-format promotion after 3 distinct non-digit confirms (P3) ─
    # getFieldFormats feeds sample_values newest-first; once 3 distinct non-digit
    # values are the newest, classify_format no longer resolves digits_only —
    # the constraint (and thus the warning) is dropped. No format-rule redesign.
    section("15. format broadens away from digits_only once non-digit values dominate the recent pool")
    promoted = build_format_class_index([_entry(
        'Acme Ltd', 'invoice', 'invoice_number',
        # newest-first: 3 newly-confirmed alphanum exceptions, then old digits
        ['INV12345', 'INV12346', 'INV12347', '2345', '1234'])])
    cls_after = promoted.get(('acme ltd', 'invoice', 'invoice_number'), {}).get('class')
    if not check("after 3 distinct non-digit confirms, class is no longer digits_only",
                 cls_after != DIGITS_ONLY):
        failures += 1
    if not check("a still-digits value would NOT be flagged under the broadened class "
                 "(warning stops for matching future values)",
                 ('acme ltd', 'invoice', 'invoice_number') not in promoted
                 or check_value('999', promoted[('acme ltd', 'invoice', 'invoice_number')]) is None):
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
