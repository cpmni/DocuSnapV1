"""
test_ref_prefix_retype.py — FIX B1 (suggest-only ref-prefix type resolution). Pins the pure
`ocr_corrector.resolve_type_by_ref_prefix` + `present_code_prefixes`. B1 picks the correct sibling
of an AMBIGUOUS same-letterhead cluster (Fix A's case) from the doc's own reference PREFIX, reusing
the SAME poison-barred learned model as _flag_prefix_outlier — but ONLY as a SUGGESTION: the caller
(process_docs) pre-selects the type + seeds its fields and STILL routes the doc to review. So a
mis-suggestion is benign; the safety is the kept hold (Oracle/gary 2026-07-13).

Pins:
  - decisive single match → that slug;
  - 0 matches → None (→ Fix A holds);
  - ≥2 sibling dominants present → None (the clean party/cross-reference case abstains);
  - a sibling with no learned dominant never matches (scope disarmed);
  - null/blank supplier or any empty input → None;
  - THE ACCEPTED TRADE-OFF (contamination): own dominant garbled to ABSENT while ONLY the OTHER
    sibling's dominant is present → returns the OTHER (wrong) slug — a MIS-SUGGESTION that is safe
    ONLY because the caller keeps needs_review=True. This is the load-bearing HONEST pin: B1 does
    NOT abstain here, so it must NEVER be wired to clear the review hold (the unbuilt B2 would need
    own-primary-ref corroboration for that).

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_ref_prefix_retype.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.ocr_corrector import resolve_type_by_ref_prefix, present_code_prefixes

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1

# A Cascade cluster spanning two sibling types under one letterhead.
SIBS  = {'purchase_order': {'id': 10, 'document_type_slug': 'purchase_order'},
         'sales_order':    {'id': 11, 'document_type_slug': 'sales_order'}}
SREF  = {'purchase_order': 'po_number', 'sales_order': 'sales_order_number'}
IDX   = {('cascade', 'purchase_order', 'po_number'):        {'dominant': 'PO', 'known': {'PO'}},
         ('cascade', 'sales_order',    'sales_order_number'): {'dominant': 'SO', 'known': {'SO'}}}
SUP   = 'Cascade'
R = lambda present, sibs=SIBS, sup=SUP, sref=SREF, idx=IDX: \
        resolve_type_by_ref_prefix(sibs, sup, sref, idx, present)

def main():
    # 1. Decisive single match — the doc's PO prefix resolves the purchase_order sibling.
    check('decisive: present {PO} → purchase_order', R({'PO'}) == 'purchase_order')
    check('decisive: present {SO} → sales_order',    R({'SO'}) == 'sales_order')

    # 2. Zero matches → abstain (Fix A holds).
    check('no sibling prefix present → None', R({'XX', 'ZZ'}) is None)

    # 3. ≥2 sibling dominants present (clean party/cross-reference: an SO printing BOTH its own
    #    SO-… AND the buyer's PO-…) → abstain, so a quoted cross-ref can't force a pick.
    check('both PO and SO present → None (party-guard)', R({'PO', 'SO'}) is None)

    # 4. A sibling with no learned dominant never matches (scope disarmed / mixed-numeric).
    idx_po_only = {('cascade', 'purchase_order', 'po_number'): {'dominant': 'PO', 'known': {'PO'}}}
    check('sales_order has no learned dominant; present {SO} → None', R({'SO'}, idx=idx_po_only) is None)
    check('sales_order disarmed; present {PO} → still resolves purchase_order',
          R({'PO'}, idx=idx_po_only) == 'purchase_order')

    # 5. Null / blank supplier and empty inputs → None (never guess a supplier — gary).
    check('null cluster_supplier → None', R({'PO'}, sup=None) is None)
    check('blank cluster_supplier → None', R({'PO'}, sup='') is None)
    check('empty present → None',          R(set()) is None)
    check('empty ambiguous_siblings → None', R({'PO'}, sibs={}) is None)
    check('empty prefix_index → None',       R({'PO'}, idx={}) is None)

    # 5b. A sibling missing from slug_ref_keys is skipped (no ref field to look up).
    check('sibling with no ref_field_key is skipped',
          R({'SO'}, sref={'purchase_order': 'po_number'}) is None)

    # 6. THE ACCEPTED TRADE-OFF PIN (contamination). An actual SALES ORDER whose own SO-… is skew-
    #    garbled to absent while the buyer's PO-… reads clean → present = {PO} only → B1 returns the
    #    WRONG slug (purchase_order). This is a MIS-SUGGESTION, NOT a misfile: the caller keeps the
    #    review hold, so a human still confirms/corrects. Pinned so a future dev can't "helpfully"
    #    act on the quoted ref to clear the hold and restore the HOLE.
    check('CONTAMINATION: own garbled-absent + only quoted PO present → returns purchase_order '
          '(benign MIS-SUGGESTION; safe ONLY because the caller keeps needs_review)',
          R({'PO'}) == 'purchase_order')

    # 7. present_code_prefixes — scans code-shaped tokens, ignores words and bare numbers.
    P = present_code_prefixes
    check('scan PO-24103 → PO',  'PO'  in P('Order No. PO-24103 dated 03/06/2026'))
    check('scan SO12345 → SO',   'SO'  in P('Reference SO12345'))
    check('scan INV/58225 → INV','INV' in P('Invoice INV/58225 total'))
    check('scan "PO 98765" (spaced) → PO', 'PO' in P('Your Purchase Order: PO 98765'))
    check('plain words yield no prefix', P('Delivery Note for Cascade Water Systems') == set())
    check('bare numbers yield no prefix', P('Total 12345 amount 900') == set())
    check('both own + quoted on one page → {SO, PO}',
          P('Sales Order SO-12345  Your PO: PO-98765') == {'SO', 'PO'})

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
