"""
test_kw_type_ambiguity.py — FIX A/B1 on the KEYWORD FALLBACK path (Oracle/gary SIGN-OFF-WITH-CONDITIONS
2026-07-13). Pins the pure `template_matcher._kw_type_ambiguity`. On a weak-logo skew scan
identify_template falls to _match_by_keywords, where a same-letterhead supplier's identical-fingerprint
siblings TIE at the top score and the garbled title makes the winner ORDER-decided — a silent type
coin-flip the logo-path Fix A/B1 never see. This predicate flags it (→ engine HOLD) and exposes the
SINGLE-SUPPLIER sibling set (→ B1 ref-prefix suggestion).

Pins:
  - same-supplier identical-fp siblings, order-decided winner → ambiguous + both slugs + cluster_supplier;
  - a SLUG-DECIDED winner (title resolved the tie) → NOT ambiguous (Option A, byte-identical to today);
  - CROSS-SUPPLIER tie (different fingerprints + different suppliers) → NOT ambiguous — the LOAD-BEARING
    C1 guard against pinning a FOREIGN template into the engine;
  - same-supplier via the dominant_supplier FALLBACK (different fp, same non-null supplier) → ambiguous;
  - identical-fp sibling whose dominant_supplier is still NULL → ambiguous (Oracle: cohesion works on a
    fresh sibling; the HOLD is the safe direction even though B1 will then abstain on the null supplier);
  - two DIFFERENT non-null suppliers sharing an fp (contrived) → NOT ambiguous (sups>1 belt-and-braces);
  - single-type tie / no tie → NOT ambiguous.

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_kw_type_ambiguity.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.template_matcher import _kw_type_ambiguity

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1

def T(slug, sup, fp, tid):
    return {'document_type_slug': slug, 'dominant_supplier': sup, 'keyword_fingerprint': fp, 'id': tid}

CFP = ['cascade', 'water', 'systems', 'springfield']       # one letterhead → identical sibling fp

def main():
    # 1. Same-supplier identical-fp siblings, order-decided winner (slug_match=0) → AMBIGUOUS.
    inv = T('invoice', 'Cascade Water Systems', CFP, 2)
    dn  = T('delivery_note', 'Cascade Water Systems', CFP, 4)
    amb, sibs, sup = _kw_type_ambiguity([(inv, 1.0), (dn, 1.0)], inv, 0)
    check('same-supplier identical-fp tie, order-decided → ambiguous', amb is True)
    check('  exposes both sibling slugs', set(sibs) == {'invoice', 'delivery_note'})
    check('  cluster_supplier is the winner\'s supplier', sup == 'Cascade Water Systems')
    check('  each sibling carries its template id (B1 pin needs it)',
          sibs.get('invoice', {}).get('id') == 2 and sibs.get('delivery_note', {}).get('id') == 4)

    # 2. Winner was SLUG-decided (title resolved the tie) → NOT ambiguous (Option A).
    amb2, sibs2, _ = _kw_type_ambiguity([(inv, 1.0), (dn, 1.0)], inv, 1)
    check('slug-decided winner → NOT ambiguous (byte-identical to today)', amb2 is False and sibs2 == {})

    # 3. CROSS-SUPPLIER tie (different fp AND different supplier) → NOT ambiguous. LOAD-BEARING C1 pin:
    #    without the cohesion filter this would group + let B1 pin a foreign template.
    cascade_inv = T('invoice', 'Cascade Water Systems', CFP, 2)
    thornbury_so = T('sales_order', 'Thornbury Textiles', ['thornbury', 'textiles', 'dockets'], 9)
    amb3, sibs3, _ = _kw_type_ambiguity([(cascade_inv, 1.0), (thornbury_so, 1.0)], cascade_inv, 0)
    check('CROSS-SUPPLIER tie → NOT ambiguous (no foreign pin — C1)', amb3 is False and sibs3 == {})

    # 4. Same-supplier via the dominant_supplier FALLBACK (slightly different fp, same non-null supplier).
    inv_fp2 = T('invoice', 'Cascade Water Systems', CFP + ['reservoir'], 2)
    dn_fp3  = T('delivery_note', 'Cascade Water Systems', CFP + ['reading'], 4)
    amb4, sibs4, sup4 = _kw_type_ambiguity([(inv_fp2, 1.0), (dn_fp3, 1.0)], inv_fp2, 0)
    check('same non-null supplier, differing fp → ambiguous (supplier fallback)',
          amb4 is True and set(sibs4) == {'invoice', 'delivery_note'} and sup4 == 'Cascade Water Systems')

    # 5. Identical-fp sibling with a NULL dominant_supplier → ambiguous (Oracle: cohesion on fingerprint
    #    works for a fresh sibling; HOLD is safe; B1 then abstains because cluster_supplier is null).
    inv_c = T('invoice', 'Cascade Water Systems', CFP, 2)
    dn_null = T('delivery_note', None, CFP, 4)
    amb5, sibs5, sup5 = _kw_type_ambiguity([(inv_c, 1.0), (dn_null, 1.0)], inv_c, 0)
    check('identical-fp + null-supplier sibling → ambiguous (HELD; safe direction)',
          amb5 is True and set(sibs5) == {'invoice', 'delivery_note'})

    # 6. Two DIFFERENT non-null suppliers that happen to share an fp (contrived) → NOT ambiguous.
    a = T('invoice', 'Cascade Water Systems', CFP, 2)
    b = T('sales_order', 'Thornbury Textiles', CFP, 9)      # same fp, different confirmed supplier
    amb6, _, _ = _kw_type_ambiguity([(a, 1.0), (b, 1.0)], a, 0)
    check('shared fp but two DIFFERENT suppliers → NOT ambiguous (sups>1 belt-and-braces)', amb6 is False)

    # 7. Single-type tie (two layouts of the SAME slug) → NOT ambiguous.
    inv_a = T('invoice', 'Cascade Water Systems', CFP, 2)
    inv_b = T('invoice', 'Cascade Water Systems', CFP, 7)
    amb7, _, _ = _kw_type_ambiguity([(inv_a, 1.0), (inv_b, 1.0)], inv_a, 0)
    check('single-type tie (same slug) → NOT ambiguous', amb7 is False)

    # 8. No tie (winner strictly above the other), same-supplier identical-fp, 2 slugs.
    #    LEVER 3 (KW_TYPE_NONDISTINCTIVE_HOLD, default ON, Herald/Oracle 2026-07-26): the winner's
    #    DISTINCTIVE fingerprint is a subset (here EQUAL) of the different-type sibling's → non-distinctive
    #    → HOLD, WITHOUT any exact tie (the pure-letterhead sibling that wins 1.0 on every page). This
    #    FLIPPED from the pre-Lever-3 behaviour (Oracle C1) — 8b pins the OFF/legacy exact-tie-only result.
    os.environ.pop('KW_TYPE_NONDISTINCTIVE_HOLD', None)     # default ON
    amb8, sibs8, sup8 = _kw_type_ambiguity([(inv, 1.0), (dn, 0.5)], inv, 0)
    check('LEVER 3 ON: non-tie subset-fingerprint winner → ambiguous (silent-misfile backstop)',
          amb8 is True and set(sibs8) == {'invoice', 'delivery_note'} and sup8 == 'Cascade Water Systems')

    # 8b. OFF/legacy pin — with Lever 3 disabled the non-tie case is NOT ambiguous (exact-tie-only, the
    #     pre-2026-07-26 behaviour) ⇒ byte-identical off.
    os.environ['KW_TYPE_NONDISTINCTIVE_HOLD'] = '0'
    amb8b, _, _ = _kw_type_ambiguity([(inv, 1.0), (dn, 0.5)], inv, 0)
    check('LEVER 3 OFF: non-tie (1.0 vs 0.5) → NOT ambiguous (exact-tie-only, byte-identical)', amb8b is False)
    os.environ.pop('KW_TYPE_NONDISTINCTIVE_HOLD', None)

    # 9. GATE — a TRUSTED title skips Lever 3 (defers to the trusted-title REFUSE / the resolved type, so
    #    Lever 1 and Lever 3 compose with no double-hold). winner_slug_match=0 but title_trusted=True.
    amb9, _, _ = _kw_type_ambiguity([(inv, 1.0), (dn, 0.5)], inv, 0, True)
    check('LEVER 3 gate: title_trusted=True → NOT held here (defers to Lever 1 refuse/resolve)', amb9 is False)

    # 10. GATE — a slug-decided winner (winner_slug_match=1) skips Lever 3 (existing resolution stands).
    amb10, _, _ = _kw_type_ambiguity([(inv, 1.0), (dn, 0.5)], inv, 1)
    check('LEVER 3 gate: slug-decided winner → NOT held (byte-identical to today)', amb10 is False)

    # 11. STRICT subset (⊂, not equal), NO tie — the live Northgate shape (invoice fp ⊂ PO fp) → HOLD.
    po_super = T('purchase_order', 'Northgate Textiles', ['mill', 'northgate', 'preston', 'bluefin', 'marine'], 30)
    inv_sub  = T('invoice', 'Northgate Textiles', ['mill', 'northgate', 'preston'], 25)
    amb11, sibs11, _ = _kw_type_ambiguity([(inv_sub, 1.0), (po_super, 0.6)], inv_sub, 0)
    check('LEVER 3: strict-subset winner (invoice ⊂ PO, no tie) → ambiguous (the Northgate hole)',
          amb11 is True and set(sibs11) == {'invoice', 'purchase_order'})

    # 12. NOT a subset — the winner carries a distinctive word the sibling lacks → has its OWN identity → NOT held.
    inv_own = T('invoice', 'Northgate Textiles', ['mill', 'northgate', 'ledger'], 25)   # 'ledger' ∉ PO fp
    amb12, _, _ = _kw_type_ambiguity([(inv_own, 1.0), (po_super, 0.6)], inv_own, 0)
    check('LEVER 3: winner with its OWN distinctive word (not a subset) → NOT ambiguous', amb12 is False)

    # 13. C5 empty-distinctive-set — a winner whose fingerprint is ALL generic/type words (∅ distinctive):
    #     ∅ ⊆ anything, so a >=2-slug same-supplier cohort → HOLD (no identity evidence ⇒ ambiguous). The
    #     cohort forms via the SAME-SUPPLIER fallback (the two junk fps share no word).
    inv_junk = T('invoice', 'Northgate Textiles', ['invoice', 'order'], 25)        # both stopwords → ∅ distinctive
    dn_junk  = T('delivery_note', 'Northgate Textiles', ['delivery', 'note'], 26)  # both stopwords → ∅ distinctive
    amb13, sibs13, _ = _kw_type_ambiguity([(inv_junk, 1.0), (dn_junk, 0.6)], inv_junk, 0)
    check('LEVER 3 C5: ∅-distinctive winner + >=2-slug same-supplier cohort → ambiguous (no identity evidence)',
          amb13 is True and set(sibs13) == {'invoice', 'delivery_note'})

    # 14. C5 corollary — ∅-distinctive winner but a SINGLE-type cohort (only same-slug siblings) → NOT held.
    inv_junk2 = T('invoice', 'Northgate Textiles', ['invoice', 'copy'], 27)        # same slug as the winner
    amb14, _, _ = _kw_type_ambiguity([(inv_junk, 1.0), (inv_junk2, 0.6)], inv_junk, 0)
    check('LEVER 3 C5: ∅-distinctive winner but only a same-SLUG cohort → NOT ambiguous (nothing to confuse)',
          amb14 is False)

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
