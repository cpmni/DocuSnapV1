#!/usr/bin/env python3
"""Guards for the two Stage-1 label hardenings (from reggie's review of the preset catalog):
  1. _label_pattern single-word BOUNDARY GUARD — a short caption must not anchor on a
     substring of a longer word ("Total" inside "Subtotal" — the silent subtotal-as-total
     bug; "Date" inside "Mandate"; "From" inside "Frome").
  2. merge_label_overrides infers a FORMAT GATE by field-key role, so an override-seeded
     custom field (e.g. *_date / *_number) is validated, not accepted blind.

  cd python_backend && py -3.12 tests/test_keyword_label_guard.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import keyword


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def main():
    f = 0

    # ── 1. boundary guard (single alpha word) ──
    total = keyword._label_pattern("Total")
    f += not check('"Total" matches "total: 120"', bool(total.search("total: 120.00")))
    f += not check('"Total" matches "grand total 120"', bool(total.search("grand total 120.00")))
    f += not check('"Total" matches glued "total£120" (£ not alnum)', bool(total.search("total£120.00")))
    f += not check('"Total" does NOT match "subtotal 100"', not total.search("subtotal 100.00"))
    date = keyword._label_pattern("Date")
    f += not check('"Date" matches "date: 14/03/2026"', bool(date.search("date: 14/03/2026")))
    f += not check('"Date" does NOT match "direct debit mandate"', not date.search("direct debit mandate"))
    f += not check('"From" does NOT match "frome depot"', not keyword._label_pattern("From").search("frome depot"))
    # multi-word labels are unchanged (still whitespace-tolerant substring)
    f += not check('multi-word "Bill From" still matches', bool(keyword._label_pattern("Bill From").search("bill from: acme ltd")))

    # integration: the subtotal can no longer win over the real total.
    patterns = keyword.load_patterns()
    ocr = "Subtotal £100.00\nVAT £20.00\nTotal £120.00"
    got = (keyword.extract_fields(ocr, ["total_amount"], patterns).get("total_amount") or {}).get("value", "")
    f += not check(f'total_amount reads the Total (120), not the Subtotal (100) [got {got!r}]',
                   "120" in got and "100" not in got)

    # ── 2. validation inferred by field-key role ──
    f += not check('_infer_validation(remittance_date) = date', keyword._infer_validation("remittance_date") == "date")
    f += not check('_infer_validation(remittance_number) = alphanumeric', keyword._infer_validation("remittance_number") == "alphanumeric")
    f += not check('_infer_validation(statement_number) = alphanumeric', keyword._infer_validation("statement_number") == "alphanumeric")
    f += not check('_infer_validation(supplier_name) = None (free text)', keyword._infer_validation("supplier_name") is None)

    merged = keyword.merge_label_overrides(
        patterns,
        [{"doc_type_slug": "remittance_advice", "field_key": "remittance_date", "label": "Remittance Date"}],
        "remittance_advice")
    entry = merged["field_patterns"].get("remittance_date")
    f += not check('override-seeded remittance_date got validation=date', bool(entry) and entry.get("validation") == "date")

    # the seeded gate rejects a non-date value and accepts a date.
    rb = keyword.extract_fields("Remittance Date: Acme Industrial Park", ["remittance_date"], merged)
    rg = keyword.extract_fields("Remittance Date: 14/03/2026", ["remittance_date"], merged)
    f += not check('non-date value rejected for remittance_date', "remittance_date" not in rb)
    f += not check('date value accepted for remittance_date', "remittance_date" in rg)

    print("\nALL PASS" if f == 0 else f"\n{f} FAILURE(S)")
    sys.exit(0 if f == 0 else 1)


main()
