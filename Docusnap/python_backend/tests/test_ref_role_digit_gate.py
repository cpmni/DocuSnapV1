#!/usr/bin/env python3
"""tests/test_ref_role_digit_gate.py — REF_ROLE_DIGIT_GATE (reggie slice 1, 2026-08-07, DEFAULT OFF).

PO_REF_DIGIT_GATE says an order-family reference is a CODE — a spaceless run bearing >=2 digits —
never a caption or footer prose. The predicate is corpus-proven, but its ARMING was the hardcoded
pair ('po_number', 'sales_order_number'), so every OTHER reference field on every type was left
ungated: `delivery_number` committed the caption 'Delivery' at conf 70, and the teach sample of the
Pelican delivery-note template stored 'Your PO' and seeded Learning History with it.

This widens the ARMING (not the predicate) to the REF ROLE via `_infer_validation(field_key) ==
'alphanumeric'` — the same role inference Stage 1 already uses to seed a custom field's format gate.
Newly armed on this install: credit_note_number, delivery_number, invoice_number, reference_number.
A read-only census over every CONFIRMED value of those fields (713 rows) found ZERO that fail the
digit predicate, so the recall cost on real ground truth is nil.

STRICT SUBSET of PO_REF_DIGIT_GATE: the parent kill switch still turns everything off.
Default OFF; OFF = byte-identical (the legacy pair is gated exactly as before).

    py -3.12 tests/test_ref_role_digit_gate.py   (from python_backend/)
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import keyword                                            # noqa: E402

CFG = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "config",
                                 "keyword_patterns.json"), encoding="utf-8"))
fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def setflag(name, v):
    if v is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = v


def read(key, text):
    return (keyword.extract_fields(text, [key], CFG).get(key) or {}).get("value")


# The role inference is the whole arming rule — pin what it claims about these keys.
print("role inference (the arming predicate):")
for k in ("delivery_number", "invoice_number", "reference_number", "credit_note_number",
          "po_number", "sales_order_number"):
    check("_infer_validation(%r) == 'alphanumeric'" % k,
          keyword._infer_validation(k) == "alphanumeric")
check("_infer_validation('supplier_name') is None (a NAME is never digit-gated)",
      keyword._infer_validation("supplier_name") is None)
check("_infer_validation('invoice_date') == 'date' (a DATE is never digit-gated)",
      keyword._infer_validation("invoice_date") == "date")
check("_infer_validation('total_amount') == 'currency' (money is never digit-gated)",
      keyword._infer_validation("total_amount") == "currency")

# ── OFF: the defect must still reproduce, or the change stopped being dark ────────────────────────
print()
print("OFF (REF_ROLE_DIGIT_GATE unset) — the bug is still there, pinned:")
setflag("REF_ROLE_DIGIT_GATE", None)
check("OFF: 'Delivery No: Delivery' commits the CAPTION as delivery_number (the bug)",
      read("delivery_number", "Delivery No: Delivery\n") == "Delivery")
check("OFF: 'Invoice No: Invoice' commits the caption as invoice_number (the bug)",
      read("invoice_number", "Invoice No: Invoice\n") == "Invoice")
check("OFF: the LEGACY pair is still gated (po_number unchanged)",
      read("po_number", "PO Number: Purchase\n") is None)
check("OFF: a real delivery code still reads",
      (read("delivery_number", "Delivery No: PD/26/6680\n") or "").startswith("PD"))

# ── ARMED ────────────────────────────────────────────────────────────────────────────────────────
print()
print("ARMED — captions and prose are refused on EVERY reference field:")
setflag("REF_ROLE_DIGIT_GATE", "1")
check("armed: 'Delivery No: Delivery' -> None (caption refused)",
      read("delivery_number", "Delivery No: Delivery\n") is None)
check("armed: 'Invoice No: Invoice' -> None (caption refused)",
      read("invoice_number", "Invoice No: Invoice\n") is None)
check("armed: 'Delivery No: Despatch' -> None (a neighbouring caption is not a code)",
      read("delivery_number", "Delivery No: Despatch\n") is None)

print()
print("ARMED — real reference codes are UNAFFECTED (the recall side):")
check("armed: 'Delivery No: PD/26/6680' still reads",
      (read("delivery_number", "Delivery No: PD/26/6680\n") or "").startswith("PD"))
check("armed: 'Delivery No: DN-98447' still reads",
      (read("delivery_number", "Delivery No: DN-98447\n") or "").startswith("DN"))
check("armed: 'Invoice No: INV-2026-0412' still reads",
      (read("invoice_number", "Invoice No: INV-2026-0412\n") or "").startswith("INV"))
check("armed: OCR-split 'Delivery No: PO 22954' still reads (space-tolerant search)",
      bool(read("delivery_number", "Delivery No: PO 22954\n")))
check("armed: the legacy pair behaves exactly as before",
      read("po_number", "PO Number: PO-1234\n") == "PO-1234"
      and read("po_number", "PO Number: Purchase\n") is None)

print()
print("ARMED — non-reference roles are NOT digit-gated (the arming is by ROLE, not by field count):")
check("armed: a DATE field still reads a date",
      bool(read("invoice_date", "Invoice Date: 04/06/2026\n")))
check("armed: a NAME-role field is untouched by this gate",
      keyword._infer_validation("customer_name") is None)

# ── STRICT SUBSET of the parent switch ───────────────────────────────────────────────────────────
print()
print("PARENT KILL SWITCH — PO_REF_DIGIT_GATE=0 turns the widened tier off too (strict subset):")
setflag("PO_REF_DIGIT_GATE", "0")
check("parent off: the caption commits again on the widened tier",
      read("delivery_number", "Delivery No: Delivery\n") == "Delivery")
check("parent off: the caption commits again on the LEGACY tier",
      read("po_number", "PO Number: Purchase\n") == "Purchase")
setflag("PO_REF_DIGIT_GATE", None)
setflag("REF_ROLE_DIGIT_GATE", None)

print()
print("%d FAILED" % fails if fails else "All REF_ROLE_DIGIT_GATE checks passed")
sys.exit(1 if fails else 0)
