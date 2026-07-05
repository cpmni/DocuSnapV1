#!/usr/bin/env python3
"""
tests/test_identity_anchor_scope.py
-----------------------------------
Guards the identity-anchor scoping fix. A supplier_name/customer_name anchor is supplier-
SPECIFIC (its value + on-page position vary by supplier), so a cross-supplier one must not
impose the wrong company — a "Contoso / Document Issuer" teach must not crop-garble a Profile
invoice's issuer to "PROFLE CONSTRUCTION". BUT the decision is made at the READ stage, not by
pre-filtering the anchor out: a supplier's OWN labelled anchor legitimately re-resolves identity,
CORRECTING a wrong template supplier guess (Greenfield reading "Supplier: Greenfield" over an
"Acme" template match — see test_supplier_identity_stability). So:

  - _anchor_matches (the FILTER) ADMITS an identity anchor on a same-type doc (like any field);
  - _is_blind_cross_supplier_identity (the READ gate) drops it ONLY when it's cross-supplier AND
    resolved as a BLIND read (its label absent here). A LOCATED read (the doc's own labelled
    value) is kept — that's what corrects a wrong template guess.

A POSITIONAL field's anchor (invoice_number) is never subject to the identity gate (the doc-type
IS its layout). Diagnosed on the real-doc corpus; the blind-crop drop lifted supplier accuracy
95.6% -> 96.2% while the located-read keep preserves legitimate identity re-resolution.

    py -3.12 python_backend/tests/test_identity_anchor_scope.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor  # noqa: E402
from extraction.anchor import _is_blind_cross_supplier_identity as blind  # noqa: E402

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")


def A(field, sup, dtype='invoice'):
    return {'field_key': field, 'supplier_name': sup, 'document_type': dtype, 'anchor_label': 'x'}


print("FILTER (_anchor_matches) admits a same-type identity anchor — the read stage decides:")
check("Contoso supplier_name anchor on a Profile doc -> ADMITTED by the filter",
      anchor._anchor_matches(A('supplier_name', 'contoso asia'), 'profile construction', 'invoice') is True)
check("...and on its own supplier",
      anchor._anchor_matches(A('supplier_name', 'contoso asia'), 'contoso asia', 'invoice') is True)
check("a GLOBAL supplier_name anchor (no supplier) still applies",
      anchor._anchor_matches(A('supplier_name', ''), 'profile construction', 'invoice') is True)

print("\nREAD gate (_is_blind_cross_supplier_identity) — drop a BLIND cross-supplier identity read:")
check("BLIND cross-supplier supplier_name (Contoso crop on a Profile doc) -> DROP",
      blind('supplier_name', A('supplier_name', 'contoso asia'), 'profile construction', located_ok=False) is True)
check("LOCATED cross-supplier supplier_name (reads the doc's OWN 'Supplier:' value) -> KEEP",
      blind('supplier_name', A('supplier_name', 'greenfield logistics ltd'), 'acme corp holdings', located_ok=True) is False)
check("BLIND SAME-supplier supplier_name (its own anchor) -> KEEP",
      blind('supplier_name', A('supplier_name', 'contoso asia'), 'contoso asia', located_ok=False) is False)
check("BLIND cross-supplier on an UNKNOWN-supplier doc -> DROP (don't impose Contoso blindly)",
      blind('supplier_name', A('supplier_name', 'contoso asia'), '', located_ok=False) is True)
check("GLOBAL identity anchor (no scope) blind -> KEEP (a fixed-position issuer teach)",
      blind('supplier_name', A('supplier_name', ''), 'profile construction', located_ok=False) is False)
check("customer_name is an identity field too (blind cross-supplier) -> DROP",
      blind('customer_name', A('customer_name', 'acme', 'sales_order'), 'other co', located_ok=False) is True)

print("\nREAD gate — a BLIND identity anchor whose label IS the field's own display name (artifact):")
# The captured label is the field's DISPLAY name ("Document Issuer"), never a printed caption — a
# teaching artifact. In the BLIND (not-located) path it's dropped regardless of supplier scope.
# (This does NOT extend to a fuzzy-inline 'located' read off the same label: dropping that
#  net-regresses the real corpus — see the #119 note in _is_blind_cross_supplier_identity.)
_ID_LABELS = {'document issuer'}
def AL(field, sup, label, dtype='invoice'):
    a = A(field, sup, dtype); a['anchor_label'] = label; return a
check("BLIND GLOBAL identity anchor labelled 'Document Issuer' -> DROP (positional artifact)",
      blind('supplier_name', AL('supplier_name', '', 'Document Issuer'), 'profile construction',
            located_ok=False, identity_labels=_ID_LABELS) is True)
check("BLIND SAME-supplier identity anchor labelled 'Document Issuer' -> DROP (still an artifact)",
      blind('supplier_name', AL('supplier_name', 'contoso asia', 'Document Issuer'), 'contoso asia',
            located_ok=False, identity_labels=_ID_LABELS) is True)
check("BLIND identity anchor with a REAL caption ('Supplier') -> falls to scope check (same-sup KEEP)",
      blind('supplier_name', AL('supplier_name', 'contoso asia', 'Supplier'), 'contoso asia',
            located_ok=False, identity_labels=_ID_LABELS) is False)
check("LOCATED 'Document Issuer' read -> KEEP here (guard is not-located only; corpus-proven)",
      blind('supplier_name', AL('supplier_name', '', 'Document Issuer'), 'profile construction',
            located_ok=True, identity_labels=_ID_LABELS) is False)
check("no identity_labels passed -> label branch inert, scope logic unchanged (same-sup KEEP)",
      blind('supplier_name', AL('supplier_name', 'contoso asia', 'Document Issuer'), 'contoso asia',
            located_ok=False) is False)
check("positional field labelled 'Document Issuer' -> KEEP (not an identity field)",
      blind('invoice_number', AL('invoice_number', '', 'Document Issuer'), 'profile construction',
            located_ok=False, identity_labels=_ID_LABELS) is False)

print("\nPOSITIONAL field (invoice_number / po_number) is NEVER subject to the identity gate:")
check("Contoso invoice_number anchor still cross-applies at the filter",
      anchor._anchor_matches(A('invoice_number', 'contoso asia'), 'profile construction', 'invoice') is True)
check("BLIND cross-supplier invoice_number -> NOT dropped (positional, doc-type IS its layout)",
      blind('invoice_number', A('invoice_number', 'contoso asia'), 'profile construction', located_ok=False) is False)
check("po_number cross-supplier -> still matches at the filter",
      anchor._anchor_matches(A('po_number', 'a co', 'purchase_order'), 'b co', 'purchase_order') is True)

print("\ndoc-type conflict still vetoes at the filter (unchanged):")
check("invoice_number anchor (type invoice) on a sales_order doc -> NO match",
      anchor._anchor_matches(A('invoice_number', 'a co', 'invoice'), 'a co', 'sales_order') is False)

if FAILS:
    print(f"\n{FAILS} FAILED")
    sys.exit(1)
print("\nAll identity-anchor-scope checks passed")
sys.exit(0)
