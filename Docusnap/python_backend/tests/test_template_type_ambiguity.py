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
from extraction.template_matcher import (_type_ambiguity, _band_siblings, _letterhead_cohort,
                                         _AMBIG_LOGO_BAND, _LOGO_AMBIG_MARGIN)

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

    # ── TYPE_AMBIG_COHESION (2026-07-31, herald→Oracle W/COND): single-supplier cohesion, the kw
    # arm's C1 guard mirrored onto the logo band. 64-bit phash cannot scope the band by supplier
    # (measured: cross-supplier at Hamming 4-12), so the fingerprint/dominant-supplier cohort does.
    def TT(slug, sup=None, fp=None):
        return {'document_type_slug': slug, 'dominant_supplier': sup,
                'keyword_fingerprint': fp if fp is not None else []}
    print('\nTYPE_AMBIG_COHESION (dark; ON only under the env):')
    IRON = TT('purchase_order', 'Ironbridge Fabrication', ['ironbridge', 'foundry', 'telford'])
    # Doc-180's measured band shape: the pick + three OTHER suppliers' templates inside band-13.
    BAND_180 = [(IRON, 0),
                (TT('purchase_order', 'Copperfield Electrical', ['copperfield', 'voltage']), 4),
                (TT('invoice',        'Copperfield Electrical', ['copperfield', 'voltage']), 8),
                (TT('worksheet',      'Ridgeway Plant Hire',    ['ridgeway', 'plant']), 8),
                (TT('delivery_note',  'Copperfield Electrical', ['copperfield', 'voltage']), 12)]
    os.environ['TYPE_AMBIG_COHESION'] = '0'
    try:
        check('OFF (kill switch): doc-180 band still flags (byte-identical legacy — the FP baseline)',
              _type_ambiguity(BAND_180, 0, None, False, best_t=IRON) is True)
    finally:
        del os.environ['TYPE_AMBIG_COHESION']
    check('DEFAULT (flipped ON 2026-07-31): doc-180 band → NOT ambiguous without any env',
          _type_ambiguity(BAND_180, 0, None, False, best_t=IRON) is False)
    os.environ['TYPE_AMBIG_COHESION'] = '1'
    try:
        check('ON: doc-180 band → NOT ambiguous (3 of 4 "types" were other suppliers\' letterheads)',
              _type_ambiguity(BAND_180, 0, None, False, best_t=IRON) is False)
        # POSITIVE CONTROL (Oracle B3): a GENUINE same-supplier multi-type letterhead with an
        # untrusted title must STILL flag — the designed case survives the cohesion filter.
        COPP_FP = ['copperfield', 'voltage', 'birmingham']
        COPP_BAND = [(TT('purchase_order', 'Copperfield Electrical', COPP_FP), 0),
                     (TT('invoice',        'Copperfield Electrical', COPP_FP), 5),
                     (TT('delivery_note',  'Copperfield Electrical', COPP_FP), 9)]
        check('ON positive control: genuine multi-type letterhead + untrusted title → STILL ambiguous',
              _type_ambiguity(COPP_BAND, 0, None, False, best_t=COPP_BAND[0][0]) is True)
        # Fresh sibling whose dominant_supplier is still null joins via FINGERPRINT equality.
        FRESH = [(TT('purchase_order', 'Copperfield Electrical', COPP_FP), 0),
                 (TT('sales_order', None, COPP_FP), 6)]
        check('ON: fresh null-dominant identical-fingerprint sibling still groups → ambiguous',
              _type_ambiguity(FRESH, 0, None, False, best_t=FRESH[0][0]) is True)
        # Two-known-suppliers bail (the kw arm's belt-and-braces, mirrored verbatim): a cohort that
        # somehow spans two non-null suppliers is a cross-supplier tie, never a coin-flip.
        SHARED_FP = ['shared', 'words']
        TWO_SUP = [(TT('purchase_order', 'Alpha Ltd', SHARED_FP), 0),
                   (TT('sales_order',    'Beta Ltd',  SHARED_FP), 4)]
        check('ON: cohort spanning two known suppliers → bail, NOT ambiguous',
              _type_ambiguity(TWO_SUP, 0, None, False, best_t=TWO_SUP[0][0]) is False)
        # PIN the accepted trade-off (Oracle B3): a POISONED shared dominant_supplier (two letterheads
        # mis-confirmed under one name) still groups → over-flag — the SAFE direction, deliberate.
        POISON = [(TT('purchase_order', 'Cascade Water Systems', ['cascade']), 0),
                  (TT('sales_order',    'Cascade Water Systems', ['northgate']), 6)]
        check('ON trade-off PIN: shared poisoned dominant_supplier still groups → over-flag (safe direction)',
              _type_ambiguity(POISON, 0, None, False, best_t=POISON[0][0]) is True)
        # _band_siblings coherence (Oracle B1): cross-supplier band members never offered as siblings.
        sibs = _band_siblings(BAND_180, 0, best_t=IRON)
        check('ON: _band_siblings scoped by the same cohort (only the pick\'s own slug survives)',
              set(sibs.keys()) == {'purchase_order'})
    finally:
        del os.environ['TYPE_AMBIG_COHESION']
    os.environ['TYPE_AMBIG_COHESION'] = '0'
    try:
        sibs_off = _band_siblings(BAND_180, 0, best_t=IRON)
        check('OFF (kill switch): _band_siblings byte-identical legacy (all four slugs offered)',
              set(sibs_off.keys()) == {'purchase_order', 'invoice', 'worksheet', 'delivery_note'})
    finally:
        del os.environ['TYPE_AMBIG_COHESION']

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
