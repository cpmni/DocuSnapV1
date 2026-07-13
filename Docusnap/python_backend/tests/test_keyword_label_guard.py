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

    # ── 1c. MULTI-WORD totals-block role collision (the "Sub Total"/"Total VAT" bug) ──
    # The bare "Total" label is a standalone WORD inside longer phrases for a DIFFERENT money role;
    # the single-word boundary guard doesn't catch these (space, not a glued substring), and they
    # sit ABOVE the grand total so first-match grabbed them. _total_role_collision fixes it.
    def _tot(ocr):
        return (keyword.extract_fields(ocr, ["total_amount"], patterns).get("total_amount") or {}).get("value", "")
    g1 = _tot("Sub Total    3,299.90\nSales Tax 0%    0.00\nTotal    3,799.90")
    f += not check(f'"Sub Total 3299.90 / Total 3799.90" reads 3799.90, not the sub total [got {g1!r}]',
                   "3,799.90".replace(",", "") in g1.replace(",", "") and "3,299.90".replace(",", "") not in g1.replace(",", ""))
    g2 = _tot("Subtotal 482,499.75\nTotal VAT 96,499.95\nTotal 578,999.70")
    f += not check(f'"Total VAT 96499.95 / Total 578999.70" reads 578999.70, not the VAT line [got {g2!r}]',
                   "578999.70" in g2.replace(",", "") and "96499.95" not in g2.replace(",", ""))
    # precision: the grand-total senses "Total Amount" / "Total Inc VAT" (their own labels) still read.
    g3 = _tot("Total Amount 118.83")
    f += not check(f'"Total Amount 118.83" still reads 118.83 [got {g3!r}]', "118.83" in g3)
    g4 = _tot("Sub Total 500.00\nTotal Inc VAT 600.00")
    f += not check(f'"Total Inc VAT 600" reads 600, not the Sub Total [got {g4!r}]',
                   "600" in g4.replace(",", "") and "500" not in g4.replace(",", ""))
    # pure-function guard
    f += not check('_total_role_collision: "Sub Total" -> True', keyword._total_role_collision("Sub Total  9", 4, 9) is True)
    f += not check('_total_role_collision: "Total VAT" -> True', keyword._total_role_collision("Total VAT 9", 0, 5) is True)
    f += not check('_total_role_collision: standalone "Total" -> False', keyword._total_role_collision("Total  9", 0, 5) is False)

    # ── 1d. parenthetical PERCENTAGE annotation column (the "Discount (10%): $231.81" bug) ──
    # A money line's "(10%):" annotation sits AHEAD of the amount; the value-picker grabbed it and
    # failed currency validation, so discount/tax read NOTHING — leaving total reconciliation blind
    # (the "total < subtotal, no discount to explain it" false flag on a correct total).
    dsc = (keyword.extract_fields("Discount (10%):    $231.81", ["discount"], patterns).get("discount") or {}).get("value", "")
    f += not check(f'"Discount (10%): $231.81" reads 231.81, not the "(10%):" annotation [got {dsc!r}]',
                   "231.81" in dsc.replace(",", "") and "%" not in dsc)
    dsc2 = (keyword.extract_fields("Discount: $50.00", ["discount"], patterns).get("discount") or {}).get("value", "")
    f += not check(f'plain "Discount: $50.00" (no annotation) still reads 50.00 [got {dsc2!r}]', "50.00" in dsc2)

    # ── 1b. leading pure-punctuation residue column (reggie) ──
    # A caption ending in "." ("Invoice No.") isn't consumed by the label pattern, so the "."
    # lands as its OWN wide-gap column ahead of the value; the residue must be dropped so the
    # real value in the next column is read (was: took ".", the same-row read failed, and the
    # "below" fallback grabbed a wrong column — the City Office "G2" bug).
    inv = (keyword.extract_fields("Invoice No.        152574", ["invoice_number"], patterns)
           .get("invoice_number") or {}).get("value", "")
    f += not check(f'"Invoice No.  <gap>  152574" reads 152574, not the "." residue [got {inv!r}]',
                   inv == "152574")
    # precision 1: a value that legitimately starts with a symbol ("#152574") is NOT skipped
    # (the residue rule only drops PURE-punctuation columns).
    inv2 = (keyword.extract_fields("Invoice No.        #152574", ["invoice_number"], patterns)
            .get("invoice_number") or {}).get("value", "")
    f += not check(f'"#152574" (punct+digits) preserved [got {inv2!r}]', "152574" in inv2)
    # precision 2: a normal single-column value is byte-identical (rule doesn't fire).
    inv3 = (keyword.extract_fields("Invoice No: INV-2044", ["invoice_number"], patterns)
            .get("invoice_number") or {}).get("value", "")
    f += not check(f'normal single-column value unchanged [got {inv3!r}]', inv3 == "INV-2044")

    # ── 1e. identity caption vs BUYER-side reference caption (the "Supplier Ref" → "Ref" bug) ──
    # A bare "Supplier"/"Vendor"/"Seller" label matches inside "Supplier Ref 4118" (the following
    # SPACE is a valid word boundary) and the right-read grabbed "Ref" as the Document Issuer —
    # a plausible-looking junk name that even suppressed the confirmed-hint recovery downstream.
    # _identity_ref_caption skips the reference caption; a real "Supplier: Acme" still reads.
    def _sup(ocr):
        return (keyword.extract_fields(ocr, ["supplier_name"], patterns).get("supplier_name") or {}).get("value", "")
    s1 = _sup("Supplier Ref    4118")
    f += not check(f'"Supplier Ref 4118" does NOT read "Ref" as the issuer [got {s1!r}]', "Ref" not in s1)
    s2 = _sup("Supplier No.   88421")
    f += not check(f'"Supplier No. 88421" does NOT read a value [got {s2!r}]', "88421" not in s2 and "No" not in s2)
    s3 = _sup("Supplier #4118")
    f += not check(f'"Supplier #4118" (glued #) does NOT read [got {s3!r}]', "4118" not in s3)
    # precision: a REAL issuer caption still reads its value inline.
    s4 = _sup("Supplier: Acme Industrial Ltd")
    f += not check(f'"Supplier: Acme Industrial Ltd" still reads the name [got {s4!r}]', "Acme" in s4)
    # pure-function guard
    f += not check('_identity_ref_caption: "Supplier Ref …" -> True', keyword._identity_ref_caption("Supplier Ref 4118", 8) is True)
    f += not check('_identity_ref_caption: "Supplier Account …" -> True', keyword._identity_ref_caption("Supplier Account 8", 8) is True)
    f += not check('_identity_ref_caption: "Supplier #…" -> True', keyword._identity_ref_caption("Supplier #4118", 8) is True)
    f += not check('_identity_ref_caption: "Supplier: Acme" -> False', keyword._identity_ref_caption("Supplier: Acme Ltd", 8) is False)
    f += not check('_identity_ref_caption: below-read (empty tail) -> False', keyword._identity_ref_caption("Supplier", 8) is False)

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
