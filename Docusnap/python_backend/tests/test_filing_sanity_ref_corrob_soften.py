"""test_filing_sanity_ref_corrob_soften.py — PINs for FILING_SANITY_REF_CORROB_SOFTEN
(reggie + gary → Oracle SIGN-OFF-W/COND 2026-09-03, C1 = REVIEW-BOUND).

Gate C's "'752923124N3M2' doesn't appear on this page as written" is FALSE + alarming on doc196: the
crop and template-mapping families both read the confirmed literal '752923124N3M2', the full-page pass
slipped one glyph to '782923124N3M2' (5<->8, UNBACKED so page-match v2 can't heal), and the value IS
visibly on the page. This arc swaps that note for a TRUTHFUL one naming both readings. IT STAYS A NOTE,
so the doc is REVIEW-BOUND (trust.isAutoFileEligible unchanged) — the MIRROR (where the true value is the
minority spelling) is HELD for a human, never silently filed. That review-bound property is the whole
Oracle C1 safety and is pinned by the MIRROR test below.

RED-first: the heal (test 2) FAILS on pre-change code (it writes the scary absent-note). OFF is byte-
identical. The corroboration record is built through the REAL _build_corroboration_emit off a populated
_field_candidates; the format entry through the REAL build_format_class_index (Oracle C4).

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_filing_sanity_ref_corrob_soften.py
"""
import os, sys, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import engine
from extraction import format_anomaly_checker as fac

passed = failed = 0
def check(name, ok):
    global passed, failed
    if ok: passed += 1; print(f'  ok  {name}')
    else:  failed += 1; print(f'  FAIL {name}')

PAD = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt '
       'ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ' * 2)

FK, SUP, SLUG = 'reference_number', 'Print Tracker', 'print_tracker'

# Real Print Tracker human value_counts + the live confirmed_at-DESC sample order (so
# build_format_class_index resolves upper_alphanum with value_counts, not freetext). Carries both
# '752923124N3M2' (doc196 recovery) and '782923124N3M2' (the mirror's true value) as confirmed literals.
VALUE_COUNTS = {
    'RFH0738865': 3, 'H572413963': 2, '1984800049': 2, 'H7R5326676': 1, 'RGS0512662': 1,
    'VG37308169': 1, '752923124N3M2': 1, 'G726M930140': 1, 'G706M430179': 1, 'G696J500513': 1,
    'C738JB00279': 1, 'RFC9509752': 1, 'C738M125203': 1, 'H573429209': 1, 'H7R5427479': 1,
    'H574951967': 1, 'H574951892': 1, '782923124N3M2': 1, 'H571Y07217': 1,
}
SAMPLE_VALUES = ['RFH0738865','H571Y07217','782923124N3M2','H574951892','H574951967','H572413963',
                 'H7R5427479','H573429209','C738M125203','RFC9509752','C738JB00279','G696J500513',
                 'G706M430179','1984800049','G726M930140','752923124N3M2','VG37308169','RGS0512662','H7R5326676']
INDEX = fac.build_format_class_index([{
    'supplier_name': SUP, 'document_type': SLUG, 'field_key': FK,
    'sample_values': SAMPLE_VALUES, 'value_counts': dict(VALUE_COUNTS),
    'confirmed_count': sum(VALUE_COUNTS.values()),
}])

# A second scope where a 6-char confirmed literal 'VXS986' exists — for the CLIP orthogonality pin.
CLIP_INDEX = fac.build_format_class_index([{
    'supplier_name': 'Veltrix', 'document_type': 'sales_order', 'field_key': FK,
    'sample_values': ['VXS986', 'VXS985', 'VXS111', 'VXS222', 'VXS333'],
    'value_counts': {'VXS986': 4, 'VXS985': 3, 'VXS111': 2, 'VXS222': 2, 'VXS333': 2},
    'confirmed_count': 13,
}])


def run(value, page_line, candidates, *, soften=True, corrob=True, index=INDEX,
        sup=SUP, slug=SLUG, extra_lines=()):
    """Drive Gate C with a populated candidate ledger + a real format index; return the ref note."""
    os.environ['FILING_VALUE_SANITY_FLAGS'] = '1'
    os.environ.pop('FILING_SANITY_PAGE_MATCH_V2', None)     # isolate: v2 off, only the soften under test
    if soften: os.environ['FILING_SANITY_REF_CORROB_SOFTEN'] = '1'
    else:      os.environ.pop('FILING_SANITY_REF_CORROB_SOFTEN', None)
    if corrob: os.environ.pop('FIELD_CORROBORATION_EMIT', None)
    else:      os.environ['FIELD_CORROBORATION_EMIT'] = '0'
    fake = types.SimpleNamespace(
        prefix_index={}, format_class_index=index, _field_candidates={FK: candidates},
        _trace=False, _t=lambda *a, **k: None, log=lambda *a, **k: None)
    for m in ('_ref_corrob_soften', '_build_corroboration_emit', '_make_format_lookup', '_page_match_v2'):
        setattr(fake, m, (lambda mm: (lambda *a, **k: getattr(engine.ExtractionEngine, mm)(fake, *a, **k)))(m))
    results = {FK: {'value': value, 'method': candidates[0]['method'], 'confidence': candidates[0].get('confidence', 85)}}
    page = '\n'.join([PAD, page_line, *extra_lines, PAD])
    try:
        engine.ExtractionEngine._flag_filing_value_sanity(fake, results, FK, [], page,
                                                          supplier_name=sup, document_slug=slug)
    finally:
        for k in ('FILING_VALUE_SANITY_FLAGS', 'FILING_SANITY_REF_CORROB_SOFTEN', 'FIELD_CORROBORATION_EMIT'):
            os.environ.pop(k, None)
    return results[FK].get('validation_note')

# doc196 candidate ledger: crop winner 752, mapping agrees 752, keyword (full-text) disagrees 782.
def cand196(win='752923124N3M2', kw='782923124N3M2', with_mapping=True):
    c = [{'stage': '2',   'method': 'anchor_crop',            'value': win, 'confidence': 85}]
    if with_mapping:
        c.append({'stage': '0.5', 'method': 'template_mapping_edgegrow', 'value': win, 'confidence': 90})
    c.append({'stage': '1', 'method': 'keyword_override', 'value': kw, 'confidence': 85})
    return c

ABSENT = engine._FILING_SANITY_ABSENT_MARK
SOFT   = engine._FILING_SANITY_SOFTEN_MARK

print('0. precondition — the real corroboration emit reproduces the live doc196 record')
_fake = types.SimpleNamespace(_field_candidates={FK: cand196()}, _trace=False, _t=lambda *a, **k: None)
_rec = engine.ExtractionEngine._build_corroboration_emit(_fake, {FK: {'value': '752923124N3M2', 'method': 'anchor_crop'}}).get(FK)
check("emit: winner=crop, mapping agrees, keyword dissents 782, independent_agree",
      _rec and _rec['winner_family'] == 'crop' and 'mapping' in _rec['agree']
      and any(d['family'] == 'keyword' and d['value'] == '782923124N3M2' for d in _rec['disagree'])
      and _rec['independent_agree'] is True)
check("is_lit True for 752… and 782… (both confirmed)",
      fac.value_is_confirmed_literal('752923124N3M2', INDEX[(SUP.lower(), SLUG, FK)]) and
      fac.value_is_confirmed_literal('782923124N3M2', INDEX[(SUP.lower(), SLUG, FK)]))

print('\n1. OFF byte-identical — the scary absent-note still fires')
_off = run('752923124N3M2', 'Serial number 782923124N3M2', cand196(), soften=False)
check('OFF: doc196 keeps the scary "doesn\'t appear" note', _off is not None and ABSENT in _off)

print('\n2. HEAL (RED-first) — soften ON swaps to the truthful note, still review-bound')
_heal = run('752923124N3M2', 'Serial number 782923124N3M2', cand196())
check('ON: doc196 note is the SOFT note (names both, no "doesn\'t appear")',
      _heal is not None and SOFT in _heal and ABSENT not in _heal
      and '752923124N3M2' in _heal and '782923124N3M2' in _heal)
check('ON: a note is STILL present (review-bound — value cannot auto-file)', _heal is not None)

print('\n3. MIRROR (Oracle C1 ship-blocker pin) — true value = the minority 782; committed 752 is a')
print('   confirmed literal from a common-mode crop+mapping slip. Structurally identical to doc196 —')
print('   the fix cannot distinguish them, so it MUST keep a note (held), never silently auto-file.')
_mirror = run('752923124N3M2', 'Serial number 782923124N3M2', cand196())
check('MIRROR: a note is present ⇒ held for a human, NEVER silently filed', _mirror is not None)

print('\n4. CLIP still flags (Oracle C2 — clause 4 orthogonal, not redundant)')
# rv VXS986 is a confirmed literal, corroborated, AND a same-length one-glyph variant (VXS985) is on the
# page (clause 3 would pass) — but a LONGER container VXS98624 is also printed, so clause 4 must keep it scary.
_clipc = [{'stage': '2', 'method': 'anchor_crop', 'value': 'VXS986', 'confidence': 85},
          {'stage': '0.5', 'method': 'template_mapping_edgegrow', 'value': 'VXS986', 'confidence': 90},
          {'stage': '1', 'method': 'keyword_override', 'value': 'VXS985', 'confidence': 85}]
_clip = run('VXS986', 'Order VXS985 line then VXS98624 total', _clipc, index=CLIP_INDEX,
            sup='Veltrix', slug='sales_order')
check('CLIP: longer container present → stays SCARY (clause 4 blocks the soften)',
      _clip is not None and ABSENT in _clip)

print('\n5. NEVER-CONFIRMED still flags (clause 2)')
_nc = run('ZY2923124N3M2', 'Serial number ZY8923124N3M2',
          cand196(win='ZY2923124N3M2', kw='ZY8923124N3M2'))
check('never-confirmed same-length slip → stays SCARY (not a confirmed literal)',
      _nc is not None and ABSENT in _nc)

print('\n6. UNCORROBORATED still flags (clause 1 — <2 page families)')
_unc = run('752923124N3M2', 'Serial number 782923124N3M2', cand196(with_mapping=False))
check('only ONE page family read it → stays SCARY', _unc is not None and ABSENT in _unc)

print('\n7. fail-closed when the corroboration emit is off')
_fc = run('752923124N3M2', 'Serial number 782923124N3M2', cand196(), corrob=False)
check('FIELD_CORROBORATION_EMIT=0 → no record → stays SCARY', _fc is not None and ABSENT in _fc)

print('\n8. Gate A untouched with soften ON (a non-reference shape still flags)')
_ga = run('VyYoa', 'nothing here', [{'stage': '2', 'method': 'anchor_crop', 'value': 'VyYoa', 'confidence': 85}])
check('Gate A: mixed-case no-digit shape still flags (soften never reaches non-absent gates)',
      _ga is not None and 'reference number' in _ga)

print('\n9. source-order pins')
_src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'), encoding='utf-8').read()
check('soften sits INSIDE the `if _absent:` block, gated, and only sets _witness / swaps the note',
      "_witness = (self._ref_corrob_soften(" in _src and "FILING_SANITY_REF_CORROB_SOFTEN" in _src)
check('the scary absent-note remains the ELSE branch (soften never deletes the hold, only rewords)',
      "else:\n" in _src and "_FILING_SANITY_ABSENT_NOTE.format(rv)" in _src)
check('soften mark is DISTINCT from the absent mark (the 3 absent-consumers must not match it)',
      SOFT not in ABSENT and ABSENT not in engine._FILING_SANITY_SOFTEN_NOTE)

print(f'\n{"ALL PASS" if failed == 0 else str(failed) + " FAILED"}  ({passed} ok)')
sys.exit(1 if failed else 0)
