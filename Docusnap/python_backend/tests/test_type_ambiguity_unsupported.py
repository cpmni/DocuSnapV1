"""A2 of the type-split arc — the UNSUPPORTED-RIVAL WAIVER of Fix A (2026-08-22; gary → Oracle
SIGN-OFF-W/COND S2-py-1..3; DARK behind TYPE_AMBIG_UNSUPPORTED_WAIVER / `type_ambiguity_unsupported_waiver`).

THE INCIDENT: 17 Nordwind quotes HELD at oc 100 with every value right, because ONE mis-confirm bore a
purchase_order template (1 confirmed doc) on the quote-only letterhead (24 confirms) and
`_type_ambiguity` weighed the two slugs as equals; the bold QUOTATION banner is absent from the page
OCR so no trusted title could settle it. B1 already resolved the page's NRQ prefix to the quote
template — and C2 then forced the hold.

The waiver has TWO legs, decided ENTIRELY in the engine (process_docs' B1 block is skipped on a
reprocess of a typed doc — the "Reprocess N" path): (1) every rival slug in the same-letterhead cohort
is UNSUPPORTED (<2 confirmed docs, counts LIVE), the matched template after the B1 pin IS the pick and
the pick has ≥ DOMINANT_MIN_COUNT confirms; (2) the document's OWN reference, read by a LOCATED method,
carries the pick scope's dominant prefix (page-anywhere presence is B1's signal — common-mode).

Pins: the helper (rival 1 → unsupported; rival 2 → supported; max-per-slug; counts not live → abstain);
the kw arm attaches rival support only on the exact-tie cohort (never Lever 3); the own-ref leg
(fires / id mismatch / no candidate / memory-hint / dominant snap / class fix / prefix mismatch / empty
/ disarmed scope); the NEGATIVE CONTROL (rival 2 ⇒ the note IS planted — so the absence assertion is
not vacuous); the flag site's shape (`_type_ambiguous` never mutated by the waiver); OFF byte-identical; and the
TRADE-OFF PIN.

Run:  PYTHONIOENCODING=utf-8 py -3.12 tests/test_type_ambiguity_unsupported.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import template_matcher as TM
from extraction import ocr_corrector as OC
from extraction.engine import ExtractionEngine

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def tpl(tid, slug, count, live=True, sup='Nordwind Refrigeration Ltd', fp=None):
    return {'id': tid, 'document_type_slug': slug, 'confirmed_count': count, 'counts_live': live,
            'dominant_supplier': sup, 'keyword_fingerprint': fp or ['Nordwind', 'Refrigeration', 'Frostfield']}


PICK = tpl(10, 'quote', 24)

print("-- _unsupported_rival_slugs --")
check("rival purchase_order with 1 confirm → rivals ['purchase_order'], unsupported ['purchase_order']",
      TM._unsupported_rival_slugs([PICK, tpl(12, 'purchase_order', 1)], PICK) == (['purchase_order'], ['purchase_order']))
check("rival with 2 confirms → supported (unsupported empty)",
      TM._unsupported_rival_slugs([PICK, tpl(12, 'purchase_order', 2)], PICK) == (['purchase_order'], []))
check("per-slug MAX: one fresh + one supported template of the same slug → supported",
      TM._unsupported_rival_slugs([PICK, tpl(12, 'purchase_order', 0), tpl(13, 'purchase_order', 3)], PICK) == (['purchase_order'], []))
check("counts NOT live on a cohort template → abstain (unsupported None), rivals still named",
      TM._unsupported_rival_slugs([PICK, tpl(12, 'purchase_order', 0, live=False)], PICK) == (['purchase_order'], None))
check("no rivals → ([], [])", TM._unsupported_rival_slugs([PICK, tpl(11, 'quote', 1)], PICK) == ([], []))
check("two rivals, one supported → only the unsupported one listed",
      TM._unsupported_rival_slugs([PICK, tpl(12, 'purchase_order', 1), tpl(14, 'invoice', 5)], PICK) == (['invoice', 'purchase_order'], ['purchase_order']))

print("\n-- keyword arm: rival support only on the exact-tie cohort --")
FP = ['Nordwind', 'Refrigeration', 'Frostfield', 'Colderton']
text = "Nordwind Refrigeration Ltd\n9 Frostfield Estate Colderton\nQuotation Ref NRQ-5470\n"
a = tpl(10, 'quote', 24, fp=FP); b = tpl(12, 'purchase_order', 1, fp=FP)
best = TM._match_by_keywords(text, [a, b], detected_slug=None, title_trusted=False)
check("same-fingerprint siblings of two types tie → ambiguous_type with rival_slugs + unsupported_rival_slugs",
      bool(best) and best.get('ambiguous_type') is True and best.get('rival_slugs') == ['purchase_order']
      and best.get('unsupported_rival_slugs') == ['purchase_order'])
b2 = tpl(12, 'purchase_order', 2, fp=FP)
best2 = TM._match_by_keywords(text, [a, b2], detected_slug=None, title_trusted=False)
check("…rival with 2 confirms → still ambiguous, unsupported empty (NEGATIVE CONTROL for the waiver)",
      bool(best2) and best2.get('ambiguous_type') is True and best2.get('unsupported_rival_slugs') == [])
solo = TM._match_by_keywords(text, [a], detected_slug=None, title_trusted=False)
check("a single-slug match carries neither key (additive, non-ambiguous byte-identical)",
      bool(solo) and 'rival_slugs' not in solo and 'unsupported_rival_slugs' not in solo)
src_tm = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'extraction', 'template_matcher.py'), encoding='utf-8').read()
check("the kw arm attaches only when the EXACT-TIE cohort spans ≥2 slugs (a Lever-3 hold never waives)",
      "_tie = _kw_tie_cohort(scored, best['template']) or []" in src_tm
      and "if len({t.get('document_type_slug') or '' for t in _tie} - {''}) >= 2:" in src_tm)
check("the logo arm attaches over the SAME cohort band the ambiguity test used",
      "_a2_band = [t for (t, d) in cands if d <= cluster_dist + _AMBIG_LOGO_BAND]" in src_tm
      and "_attach_rival_support(result, _a2_band, best_t)" in src_tm)

print("\n-- engine: the candidate leg + the own-ref leg (_type_waiver_ok) --")
os.environ['TYPE_AMBIG_UNSUPPORTED_WAIVER'] = '1'
eng = object.__new__(ExtractionEngine)
eng.prefix_index = OC.build_prefix_index([{
    'field_key': 'quote_number', 'supplier_name': 'Nordwind Refrigeration Ltd', 'document_type': 'quote',
    'value_counts': {f'NRQ-{n}': 1 for n in range(1000, 1024)},
}])
check("fixture: the quote scope has a dominant NRQ prefix",
      (OC.lookup_prefix(eng.prefix_index, 'quote_number', 'Nordwind Refrigeration Ltd', 'quote') or {}).get('dominant') == 'NRQ')
PICK_T = {'id': 10, 'document_type_slug': 'quote', 'confirmed_count': 24, 'counts_live': True}
RIVAL_T = {'id': 12, 'document_type_slug': 'purchase_order', 'confirmed_count': 1, 'counts_live': True}
def match(rival_count=1, live=True, ambiguous=True, pick_count=24):
    pk = dict(PICK_T, confirmed_count=pick_count)
    rv = dict(RIVAL_T, confirmed_count=rival_count, counts_live=live)
    m = {'template': pk, 'ambiguous_type': ambiguous, 'method': 'logo'}
    if ambiguous:
        m['ambiguous_siblings'] = {'quote': pk, 'purchase_order': rv}
        m['rival_slugs'], m['unsupported_rival_slugs'] = TM._unsupported_rival_slugs([pk, rv], pk)
    return m
SUP, SLUG = 'Nordwind Refrigeration Ltd', 'quote'
def res(val, method='template_mapping'):
    return {'quote_number': {'value': val, 'confidence': 97, 'method': method}}
W = lambda r, m, mt=PICK_T: eng._type_waiver_ok(r, m, mt, 'quote_number', SUP, SLUG)
check("FIRES: rival 1 confirm, pick 24, matched == pick, own ref 'NRQ-5470' via template_mapping -> waived (returns the value)",
      W(res('NRQ-5470'), match()) == 'NRQ-5470')
check("...anchor_crop and keyword reads are located too",
      W(res('NRQ-5470', 'anchor_crop'), match()) == 'NRQ-5470' and W(res('NRQ-5470', 'keyword'), match()) == 'NRQ-5470')
check("rival with 2 confirms -> HOLD (the candidate leg)", W(res('NRQ-5470'), match(rival_count=2)) is None)
check("counts not live -> HOLD (abstain)", W(res('NRQ-5470'), match(live=False)) is None)
check("pick below DOMINANT_MIN_COUNT (4 confirms) -> HOLD", W(res('NRQ-5470'), match(pick_count=4)) is None)
check("match not ambiguous -> None (nothing to waive)", W(res('NRQ-5470'), match(ambiguous=False)) is None)
check("the B1 pin moved the matched template onto the RIVAL -> HOLD",
      W(res('NRQ-5470'), match(), mt={'id': 12, 'document_type_slug': 'purchase_order'}) is None)
check("memory/hint fill -> HOLD", W(res('NRQ-5470', 'hint'), match()) is None and W(res('NRQ-5470', 'template_mapping+memory'), match()) is None)
check("dominant-value snap -> HOLD (it manufactures the prefix)", W(res('NRQ-5470', 'template_mapping+snapped'), match()) is None)
check("prefix class fix -> HOLD (circular)", W(res('NRQ-5470', 'template_mapping_rawwitness+prefix_class_fix'), match()) is None)
check("own ref carries the RIVAL's prefix ('PO-65220') -> HOLD", W(res('PO-65220'), match()) is None)
check("empty own ref -> HOLD", W(res(''), match()) is None)
check("no ref role field -> HOLD", eng._type_waiver_ok(res('NRQ-5470'), match(), PICK_T, None, SUP, SLUG) is None)
check("scope with no learned dominant (disarmed) -> HOLD", eng._type_waiver_ok(res('NRQ-5470'), match(), PICK_T, 'quote_number', 'Other Co', SLUG) is None)
os.environ['TYPE_AMBIG_UNSUPPORTED_WAIVER'] = '0'
check("switch OFF -> HOLD (byte-identical)", W(res('NRQ-5470'), match()) is None)
os.environ['TYPE_AMBIG_UNSUPPORTED_WAIVER'] = '1'

print("\n-- the flag site: NEGATIVE CONTROL + shape --")
def flag_site(engine, results, m, mt=PICK_T):
    # mirrors extract()'s guarded statement exactly (pinned below against the source)
    engine._type_ambiguous = True
    engine._type_match = m
    if engine._type_ambiguous and os.environ.get('TYPE_AMBIGUITY_GUARD', '1') != '0':
        if not engine._type_waiver_ok(results, engine._type_match, mt, 'quote_number', SUP, SLUG):
            ExtractionEngine._flag_type_ambiguity(engine, results, 'quote_number')
    return results
r = res('NRQ-5470'); r['supplier_name'] = {'value': SUP, 'confidence': 95}
flag_site(eng, r, match(rival_count=2))
check("NEGATIVE CONTROL: rival supported (2 confirms) => the Fix A note IS planted on supplier_name",
      'used for several document types' in str(r['supplier_name'].get('validation_note') or ''))
r = res('NRQ-5470'); r['supplier_name'] = {'value': SUP, 'confidence': 95}
flag_site(eng, r, match())
check("waived => no note, no _needs_review from this guard", not r['supplier_name'].get('validation_note') and not r.get('_needs_review'))
check("...and _type_ambiguous itself is NOT cleared by the waiver (B' label-ownership reads it)", eng._type_ambiguous is True)
_here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src_en = open(os.path.join(_here, 'extraction', 'engine.py'), encoding='utf-8').read()
check("source: the flag site asks _type_waiver_ok with the Stage-0 match and otherwise calls _flag_type_ambiguity unchanged",
      "_waiver = self._type_waiver_ok(results, getattr(self, '_type_match', None), matched_tmpl," in src_en
      and "            else:\n                self._flag_type_ambiguity(results, ref_field_key)" in src_en)
check("source: the Stage-0 match is remembered beside _type_ambiguous (both arms: import AND reprocess)",
      "self._type_ambiguous = bool(match.get('ambiguous_type')) or (pinned_template_id is not None)\n                self._type_match     = match" in src_en)
check("source: the engine decides alone - process_docs threads nothing (its B1 block is skipped on a reprocess)",
      "type_ambiguity_waived_for" not in src_en
      and "type_ambiguity_waived_for" not in open(os.path.join(_here, 'process_docs.py'), encoding='utf-8').read())
check("source: templates.getAll marks counts_live only when the live map applied",
      "t.counts_live = true" in open(os.path.join(os.path.dirname(_here), 'database', 'modules', 'templates.js'), encoding='utf-8').read())

print("\n-- TRADE-OFF PIN (Oracle S2-py-3, accepted): --")
# A genuine rare-type doc (a real PO on the Nordwind letterhead) whose OWN ref is garbled-absent while a
# located read picks up a quoted NRQ reference, while the PO type has exactly ONE confirm -> WAIVED and
# typed Quote. This DELAYS Fix A's hold from the rival's 1st to its 2nd confirm - before the 1st confirm
# a single-slug cohort never fired Fix A at all, so the class is not widened. Closes at the 2nd confirm
# (rival becomes supported -> HOLD, the negative control above). Do NOT "fix" this by restoring the
# unconditional hold without re-opening the Oracle ruling.
check("rival at 1 confirm + a located read carrying the pick's prefix => WAIVED (the accepted window)",
      W(res('NRQ-9024', 'keyword'), match()) == 'NRQ-9024')
check("...the window CLOSES at the rival's 2nd confirm", W(res('NRQ-9024', 'keyword'), match(rival_count=2)) is None)
os.environ['TYPE_AMBIG_UNSUPPORTED_WAIVER'] = '0'

print()
if fails:
    print("FAILED: %d check(s)" % fails)
    sys.exit(1)
print("ALL PASS")
