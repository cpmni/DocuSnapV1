#!/usr/bin/env python3
"""
tests/test_format_rules_pipeline.py
-----------------------------------
Stage 7 Stage 3 — persistent learned format model (field_format_rules).

Verifies the PYTHON read side of the persistent model:
  1. A persisted rule OVERRIDES per-run inference for its exact key.
  2. A persisted rule can ADD a constraint where inference learned none.
  3. Keys with no persisted rule FALL BACK to the inferred entry unchanged.
  4. Strict (supplier, document_type, field_key) scoping — no cross-leak.
  5. freetext / malformed persisted rules are ignored (no constraint).
  6. Stage 1 (check_value) is UNCHANGED: identical result whether the
     {class, separators} entry came from inference or from a persisted rule.
  7. Stage 2 (propose_correction) is UNCHANGED: same, source-independent.
  8. ExtractionEngine.set_formats(formats, format_rules) applies the overlay.

Usage:
    py -3.12 python_backend/tests/test_format_rules_pipeline.py

Exit 0 = all checks passed.  Exit 1 = failure(s).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction.format_anomaly_checker import (
    build_format_class_index,
    merge_format_rules,
    check_value,
    propose_correction,
    DIGITS_ONLY, UPPER_ALPHANUM, ALPHANUM_SEP, FREETEXT,
)
from extraction.engine import ExtractionEngine


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'}  {label}")
    return bool(condition)


def section(title):
    print(f"\n{title}")


def _fmt_entry(supplier, doc_type, field_key, samples, confirmed_count=10):
    return {
        'supplier_name': supplier, 'document_type': doc_type,
        'field_key': field_key, 'sample_values': samples,
        'confirmed_count': confirmed_count,
    }


def _rule(supplier, doc_type, field_key, cls, seps='', count=12):
    return {
        'supplier_name': supplier, 'document_type': doc_type, 'field_key': field_key,
        'format_class': cls, 'allowed_separators': seps, 'confirmed_count': count,
    }


def main():
    fail = 0

    # Inference sees Acme/invoice/invoice_number as alphanum_sep (history has
    # "INV-001" style values), and Acme/invoice/po_ref as digits_only.
    inferred = build_format_class_index([
        _fmt_entry('Acme', 'invoice', 'invoice_number', ['INV-001', 'INV-002', 'INV-003']),
        _fmt_entry('Acme', 'invoice', 'po_ref',         ['1001', '1002', '1003']),
    ])

    section("1-3. Override / add / fallback")
    rules = [
        # Override: force invoice_number to digits_only (supplier changed scheme)
        _rule('Acme', 'invoice', 'invoice_number', DIGITS_ONLY),
        # Add: a brand-new constraint for a field inference never saw
        _rule('Acme', 'invoice', 'order_code', UPPER_ALPHANUM),
    ]
    merged = merge_format_rules(inferred, rules)

    fail += not check("persisted rule overrides inferred class (alphanum_sep -> digits_only)",
                      merged[('acme', 'invoice', 'invoice_number')]['class'] == DIGITS_ONLY)
    fail += not check("persisted rule adds a constraint inference lacked (order_code)",
                      merged[('acme', 'invoice', 'order_code')]['class'] == UPPER_ALPHANUM)
    fail += not check("key with no persisted rule keeps inferred entry (po_ref still digits_only)",
                      merged[('acme', 'invoice', 'po_ref')]['class'] == DIGITS_ONLY)
    fail += not check("inference index itself is NOT mutated by merge",
                      inferred[('acme', 'invoice', 'invoice_number')]['class'] == ALPHANUM_SEP)

    section("4. Strict scoping — no cross-supplier / cross-type / cross-field leak")
    scoped = merge_format_rules({}, [_rule('Acme', 'invoice', 'invoice_number', DIGITS_ONLY)])
    fail += not check("rule present for its own key", ('acme', 'invoice', 'invoice_number') in scoped)
    fail += not check("does NOT leak to another supplier", ('beta', 'invoice', 'invoice_number') not in scoped)
    fail += not check("does NOT leak to another document type", ('acme', 'purchase_order', 'invoice_number') not in scoped)
    fail += not check("does NOT leak to another field", ('acme', 'invoice', 'po_ref') not in scoped)

    section("5. freetext / malformed rules ignored")
    ignored = merge_format_rules({}, [
        _rule('Acme', 'invoice', 'notes', FREETEXT),     # no constraint
        _rule('', 'invoice', 'x', DIGITS_ONLY),          # missing supplier
        {'supplier_name': 'Acme', 'document_type': 'invoice'},  # missing field/class
    ])
    fail += not check("freetext rule produces no index entry", ('acme', 'invoice', 'notes') not in ignored)
    fail += not check("malformed rules produce an empty overlay", len(ignored) == 0)

    section("6. Stage 1 (check_value) unchanged — source-independent")
    # Build the SAME entry two ways: inferred-from-history vs persisted-rule.
    via_inference = build_format_class_index(
        [_fmt_entry('S', 'invoice', 'ref', ['1001', '1002', '1003'])]
    )[('s', 'invoice', 'ref')]
    via_rule = merge_format_rules({}, [_rule('S', 'invoice', 'ref', DIGITS_ONLY)])[('s', 'invoice', 'ref')]
    bad = 'INV12345'
    good = '12345'
    fail += not check("digits_only entry flags a lettered value (inferred)", check_value(bad, via_inference) is not None)
    fail += not check("digits_only entry flags a lettered value (persisted)", check_value(bad, via_rule) is not None)
    fail += not check("check_value result identical for inferred vs persisted (anomaly)",
                      check_value(bad, via_inference) == check_value(bad, via_rule))
    fail += not check("check_value result identical for inferred vs persisted (clean)",
                      check_value(good, via_inference) == check_value(good, via_rule) is None)

    section("7. Stage 2 (propose_correction) unchanged — source-independent")
    prop_inf  = propose_correction(bad, via_inference)
    prop_rule = propose_correction(bad, via_rule)
    fail += not check("propose_correction yields the same candidate from either source",
                      prop_inf == prop_rule and prop_inf is not None)
    fail += not check("candidate for a lettered digits_only value is digits-only + non-confident",
                      prop_inf and prop_inf['corrected'].isdigit() and prop_inf['confident'] is False)

    section("8. ExtractionEngine.set_formats applies the overlay")
    engine = ExtractionEngine(mode='fast')
    engine.set_formats(
        [_fmt_entry('Acme', 'invoice', 'invoice_number', ['INV-001', 'INV-002', 'INV-003'])],
        [_rule('Acme', 'invoice', 'invoice_number', DIGITS_ONLY)],
    )
    fail += not check("engine overlays persisted rule onto inferred index",
                      engine.format_class_index[('acme', 'invoice', 'invoice_number')]['class'] == DIGITS_ONLY)

    engine_no_rules = ExtractionEngine(mode='fast')
    engine_no_rules.set_formats(
        [_fmt_entry('Acme', 'invoice', 'invoice_number', ['INV-001', 'INV-002', 'INV-003'])],
        [],
    )
    fail += not check("engine falls back to inference when no rules supplied",
                      engine_no_rules.format_class_index[('acme', 'invoice', 'invoice_number')]['class'] == ALPHANUM_SEP)

    print(f"\n{fail} FAILED" if fail else "\nAll format-rules pipeline checks passed")
    sys.exit(1 if fail else 0)


if __name__ == '__main__':
    main()
