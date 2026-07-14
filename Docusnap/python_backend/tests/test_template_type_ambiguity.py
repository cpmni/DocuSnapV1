"""
test_template_type_ambiguity.py — FIX A: the type-ambiguity predicate `_type_ambiguity`
(Oracle SIGN-OFF-WITH-CONDITIONS). A same-letterhead supplier issuing several doc types on ONE logo
lets a skew-garbled title resolve the type by a popularity coin-flip → wrong-type silent auto-file.
This predicate flags that so the engine holds the doc for review. Pins:
  - multi-type cluster + no trusting title → ambiguous;
  - an UNTRUSTED detected_slug does NOT resolve (that IS the skew failure) → still ambiguous;
  - a TRUSTED title resolving a sibling → NOT ambiguous;
  - single-type cluster → NEVER ambiguous (backward-compat: still auto-files);
  - THE SEAM (Oracle #1): a real sibling whose stored phash drifted OUTSIDE the pick margin-3 but
    within the wider _AMBIG_LOGO_BAND is STILL counted → the flip can't escape un-flagged.

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_template_type_ambiguity.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.template_matcher import _type_ambiguity, _AMBIG_LOGO_BAND, _LOGO_AMBIG_MARGIN

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1

def T(slug): return {'document_type_slug': slug}
# cands = [(template, logo_distance)]

def main():
    check(f'the ambiguity band ({_AMBIG_LOGO_BAND}) is WIDER than the pick margin ({_LOGO_AMBIG_MARGIN})',
          _AMBIG_LOGO_BAND > _LOGO_AMBIG_MARGIN)

    po_so = [(T('purchase_order'), 1), (T('sales_order'), 2)]
    check('multi-type cluster + no title → ambiguous',
          _type_ambiguity(po_so, 1, None, False) is True)
    check('UNTRUSTED detected_slug does NOT resolve → still ambiguous (the coin-flip pin)',
          _type_ambiguity(po_so, 1, 'sales_order', False) is True)
    check('TRUSTED title resolving a sibling → NOT ambiguous (backward-compat)',
          _type_ambiguity(po_so, 1, 'purchase_order', True) is False)
    check('TRUSTED title for a type NO sibling carries → predicate says ambiguous, but identify_template REFUSES first',
          _type_ambiguity(po_so, 1, 'credit_note', True) is True)   # moot: the refuse (return None) is ordered before this

    po_only = [(T('purchase_order'), 1), (T('purchase_order'), 2)]
    check('single-type cluster → NOT ambiguous (no title)',        _type_ambiguity(po_only, 1, None, False) is False)
    check('single-type cluster → NOT ambiguous (untrusted slug)',  _type_ambiguity(po_only, 1, 'sales_order', False) is False)
    check('single-type cluster → NOT ambiguous (trusted title)',   _type_ambiguity(po_only, 1, 'purchase_order', True) is False)

    # THE SEAM (Oracle #1): a genuine sibling whose stored phash drifted to dist 8 — OUTSIDE the pick
    # margin-3 (would be missed by the pick cluster) but INSIDE the wider band — must STILL be counted.
    drifted = [(T('purchase_order'), 1), (T('sales_order'), 8)]
    check(f'SEAM: sibling at dist 8 (> margin {_LOGO_AMBIG_MARGIN}, < band {_AMBIG_LOGO_BAND}) → STILL flagged',
          _type_ambiguity(drifted, 1, None, False) is True)
    beyond = [(T('purchase_order'), 1), (T('sales_order'), 20)]
    check('a sibling BEYOND the band (dist 20, a different supplier) is excluded → NOT ambiguous',
          _type_ambiguity(beyond, 1, None, False) is False)

    check('a null-slug sibling does not manufacture false ambiguity',
          _type_ambiguity([(T('purchase_order'), 1), (T(None), 2)], 1, None, False) is False)
    check('two layouts of the SAME type are not ambiguous',
          _type_ambiguity([(T('invoice'), 1), (T('invoice'), 5)], 1, None, False) is False)

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
