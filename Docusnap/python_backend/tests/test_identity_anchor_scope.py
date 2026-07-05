#!/usr/bin/env python3
"""
tests/test_identity_anchor_scope.py
-----------------------------------
Guards the identity-anchor scoping fix. A supplier_name/customer_name anchor is supplier-
SPECIFIC (its value + on-page position vary by supplier), so it must NOT cross-apply to a
DIFFERENT supplier via the doc-type sweep — a "Contoso" Document-Issuer teach must not read a
Profile invoice's issuer (and crop-garble it to "PROFLE CONSTRUCTION"). A POSITIONAL field's
anchor (invoice_number) STILL cross-applies (the doc-type IS its layout). Diagnosed on the
real-doc corpus; removing the cross-apply lifted supplier accuracy 95.6% -> 96.2%.

    py -3.12 python_backend/tests/test_identity_anchor_scope.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor  # noqa: E402

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")


def A(field, sup, dtype='invoice'):
    return {'field_key': field, 'supplier_name': sup, 'document_type': dtype, 'anchor_label': 'x'}


print("identity anchor (supplier_name) must NOT cross-apply to a different supplier:")
check("Contoso supplier_name anchor on a Profile doc -> NO match",
      anchor._anchor_matches(A('supplier_name', 'contoso asia'), 'profile construction', 'invoice') is False)
check("...but STILL applies to its OWN supplier (a Contoso doc)",
      anchor._anchor_matches(A('supplier_name', 'contoso asia'), 'contoso asia', 'invoice') is True)
check("...does NOT apply on an UNKNOWN-supplier doc (it can't resolve identity as Contoso)",
      anchor._anchor_matches(A('supplier_name', 'contoso asia'), '', 'invoice') is False)
check("a GLOBAL supplier_name anchor (no supplier) still applies (a fixed-position issuer teach)",
      anchor._anchor_matches(A('supplier_name', ''), 'profile construction', 'invoice') is True)
check("customer_name anchor cross-supplier -> NO match (identity)",
      anchor._anchor_matches(A('customer_name', 'acme', 'sales_order'), 'other co', 'sales_order') is False)

print("\npositional anchor (invoice_number / po_number) STILL cross-applies (doc-type IS its layout):")
check("Contoso invoice_number anchor on a Profile doc -> STILL matches",
      anchor._anchor_matches(A('invoice_number', 'contoso asia'), 'profile construction', 'invoice') is True)
check("...and on its own supplier",
      anchor._anchor_matches(A('invoice_number', 'contoso asia'), 'contoso asia', 'invoice') is True)
check("po_number cross-supplier -> STILL matches",
      anchor._anchor_matches(A('po_number', 'a co', 'purchase_order'), 'b co', 'purchase_order') is True)

print("\ndoc-type conflict still vetoes (unchanged):")
check("invoice_number anchor (type invoice) on a sales_order doc -> NO match",
      anchor._anchor_matches(A('invoice_number', 'a co', 'invoice'), 'a co', 'sales_order') is False)

if FAILS:
    print(f"\n{FAILS} FAILED")
    sys.exit(1)
print("\nAll identity-anchor-scope checks passed")
sys.exit(0)
