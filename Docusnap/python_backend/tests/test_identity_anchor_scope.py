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
  - _is_blind_cross_supplier_anchor (the READ gate) drops it ONLY when it's cross-supplier AND
    resolved as a BLIND read (its label absent here). A LOCATED read (the doc's own labelled
    value) is kept — that's what corrects a wrong template guess.

GENERALISED (2026-07): the read gate now drops a NAMED cross-supplier BLIND read for ANY field, not
just identity — fixing the #1 bug where an authoritative invoice_number anchor taught for supplier A
blind-read at its absolute position on supplier B's same-type doc (A's top-right INVOICE NUMBER
locking B's top-left "Invoice To"). A LOCATED read (label found here -> same layout) is still kept
for every field; a SAME-supplier or (for positional) GLOBAL anchor is kept; identity keeps its extra
display-name-artifact drop. Original identity fix: the blind-crop drop lifted supplier accuracy
95.6% -> 96.2% while the located-read keep preserves legitimate identity re-resolution.

    py -3.12 python_backend/tests/test_identity_anchor_scope.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor  # noqa: E402
from extraction.anchor import _is_blind_cross_supplier_anchor as blind  # noqa: E402

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

print("\nREAD gate (_is_blind_cross_supplier_anchor) — drop a BLIND cross-supplier identity read:")
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
# Preserved status-quo asymmetry: for IDENTITY the literal '__global__' sentinel is a named scope
# (truthy) so it DROPS, whereas '' (above) stays KEEP. (Positional exempts BOTH — see below.)
check("'__global__' sentinel identity anchor blind -> DROP (identity treats the sentinel as scoped)",
      blind('supplier_name', A('supplier_name', '__global__'), 'profile construction', located_ok=False) is True)
check("customer_name is an identity field too (blind cross-supplier) -> DROP",
      blind('customer_name', A('customer_name', 'acme', 'sales_order'), 'other co', located_ok=False) is True)

print("\nREAD gate — a BLIND identity anchor whose label IS the field's own display name (artifact):")
# The captured label is the field's DISPLAY name ("Document Issuer"), never a printed caption — a
# teaching artifact. In the BLIND (not-located) path it's dropped regardless of supplier scope.
# (This does NOT extend to a fuzzy-inline 'located' read off the same label: dropping that
#  net-regresses the real corpus — see the #119 note in _is_blind_cross_supplier_anchor.)
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
check("GLOBAL positional labelled 'Document Issuer' -> KEEP (global exempt; artifact branch is identity-only)",
      blind('invoice_number', AL('invoice_number', '', 'Document Issuer'), 'profile construction',
            located_ok=False, identity_labels=_ID_LABELS) is False)
# POSITION-ONLY teach (Fix B, 2026-07-10): the ⊕ issuer teach now saves an EMPTY label
# instead of the display name. The artifact branch must be INERT on '' (a_lbl falsy) so the
# read falls to the scope rule — same-supplier positional teach KEPT, cross-supplier dropped.
check("BLIND SAME-supplier identity anchor with '' label (position-only teach) -> KEEP",
      blind('supplier_name', AL('supplier_name', 'contoso asia', ''), 'contoso asia',
            located_ok=False, identity_labels=_ID_LABELS) is False)
check("BLIND CROSS-supplier identity anchor with '' label -> still DROP (scope rule holds)",
      blind('supplier_name', AL('supplier_name', 'contoso asia', ''), 'profile construction',
            located_ok=False, identity_labels=_ID_LABELS) is True)

print("\nPOSITIONAL / structured fields — cross-supplier now FILTERED at admission (2026-07-09, user direction):")
# _anchor_matches (the FILTER) now REFUSES a cross-supplier POSITIONAL anchor: layouts differ per
# supplier, so a positional cross-supplier read is ~never right and only bleeds (Anconia's top-right
# INVOICE NUMBER teach reading a wrong region of a City Office / Cloud VPS doc). IDENTITY fields stay
# admitted (a supplier's own labelled identity anchor must be able to correct a wrong supplier guess).
# The READ-stage guard below is UNCHANGED and REMAINS as defence-in-depth (it still drops a blind
# cross-supplier read should one ever reach the read stage, e.g. via a __global__ anchor).
check("invoice_number cross-supplier is now FILTERED at admission (positional, different supplier)",
      anchor._anchor_matches(A('invoice_number', 'contoso asia'), 'profile construction', 'invoice') is False)
check("SAME-supplier invoice_number still admitted at the filter",
      anchor._anchor_matches(A('invoice_number', 'contoso asia'), 'contoso asia', 'invoice') is True)
check("BLIND cross-supplier invoice_number (different layout) -> DROP  [#1 bug fix; was intended-KEEP]",
      blind('invoice_number', A('invoice_number', 'contoso asia'), 'profile construction', located_ok=False) is True)
check("LOCATED cross-supplier invoice_number (its label found here) -> KEEP (authoritative-wins holds)",
      blind('invoice_number', A('invoice_number', 'contoso asia'), 'profile construction', located_ok=True) is False)
check("BLIND SAME-supplier invoice_number (its own layout) -> KEEP",
      blind('invoice_number', A('invoice_number', 'contoso asia'), 'contoso asia', located_ok=False) is False)
check("BLIND GLOBAL invoice_number (supplier-agnostic, fixed position) -> KEEP (global exempt)",
      blind('invoice_number', A('invoice_number', ''), 'profile construction', located_ok=False) is False)
check("BLIND cross-supplier invoice_DATE (structured non-identity) -> DROP (placement, not shape)",
      blind('invoice_date', A('invoice_date', 'contoso asia'), 'profile construction', located_ok=False) is True)
check("po_number cross-supplier is now FILTERED at admission (positional)",
      anchor._anchor_matches(A('po_number', 'a co', 'purchase_order'), 'b co', 'purchase_order') is False)
check("supplier_name (IDENTITY) cross-supplier is STILL admitted (re-resolution preserved)",
      anchor._anchor_matches(A('supplier_name', 'a co', 'purchase_order'), 'b co', 'purchase_order') is True)

print("\ndoc-type conflict still vetoes at the filter (unchanged):")
check("invoice_number anchor (type invoice) on a sales_order doc -> NO match",
      anchor._anchor_matches(A('invoice_number', 'a co', 'invoice'), 'a co', 'sales_order') is False)

if FAILS:
    print(f"\n{FAILS} FAILED")
    sys.exit(1)
print("\nAll identity-anchor-scope checks passed")
sys.exit(0)
