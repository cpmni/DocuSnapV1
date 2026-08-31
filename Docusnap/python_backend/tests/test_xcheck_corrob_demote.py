"""test_xcheck_corrob_demote.py — PINs for XCHECK_CORROB_NOTE_DEMOTE (corroboration STEP 3,
slice 1; gary design → Oracle SIGN-OFF-W/COND B1-B3 + C1-C5, 2026-08-12 NIGHT; DEFAULT OFF).

Run:  py -3.12 python_backend/tests/test_xcheck_corrob_demote.py
"""
import os
import re
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import anchor, engine  # noqa: E402

passed = failed = 0


def check(name, ok):
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok  {name}')
    else:
        failed += 1
        print(f'  FAIL {name}')


FIELD_DEFS = [{'key': 'quote_date', 'type': 'date'}, {'key': 'quote_number', 'type': 'text'}]
DATE_KEYS = {'quote_date'}
NOTE = anchor.XCHECK_DISAGREE_NOTE


def mk_results(key='quote_date', note=NOTE, value='23-04-2026', method='anchor_crop_crosscheck'):
    return {key: {'value': value, 'confidence': 94, 'method': method,
                  'validation_note': note, 'was_corrected': True, 'corrected_to': value}}


def mk_witness(value='23-04-2026', method='template_mapping', stage='0.5_mapping',
               located=False, noted=False, conf=90):
    # located=False DEFAULT deliberately: template_mapper never sets the ledger bit, so the
    # DEFAULT witness shape here is the live Nordwind one — a mapping candidate WITHOUT the
    # flag must license (the first armed import proved requiring it makes the step inert).
    return {'value': value, 'method': method, 'stage': stage,
            'located': located, 'noted': noted, 'confidence': conf, 'authoritative': True, 'box': None}


def run(results, cands, key='quote_date', armed=True, rejected=None):
    if armed:
        os.environ['XCHECK_CORROB_NOTE_DEMOTE'] = '1'
    else:
        os.environ.pop('XCHECK_CORROB_NOTE_DEMOTE', None)
    fake = types.SimpleNamespace(_field_candidates={key: cands}, _trace=False,
                                 _t=lambda *a, **k: None, log=lambda *a, **k: None)
    corrob = {}
    try:
        fired = engine.ExtractionEngine._demote_xcheck_corroborated_note(
            fake, results, FIELD_DEFS, DATE_KEYS, rejected or {}, corrob)
    finally:
        os.environ.pop('XCHECK_CORROB_NOTE_DEMOTE', None)
    return fired, corrob


print('1. the exhibit — eligible date demotes')
r = mk_results()
fired, corrob = run(r, [mk_witness()], rejected={'quote_date': '23.04.2028'})
d = r['quote_date']
check('demote fired', fired is True)
check('note / was_corrected / corrected_to all cleared (trust.js blocks on note OR corrected_to)',
      'validation_note' not in d and 'was_corrected' not in d and 'corrected_to' not in d)
check('confidence never minted above earned (94 kept, not lifted to 90)', d['confidence'] == 94)
check("method gains '+corrob_clear' (lineage visible)", d['method'] == 'anchor_crop_crosscheck+corrob_clear')
nd = (corrob.get('quote_date') or {}).get('note_demoted') or {}
check('dissent survives: note_demoted carries witness AND the REJECTED crop read (Oracle C1)',
      nd.get('witness_method') == 'template_mapping' and nd.get('rejected_read') == '23.04.2028')
check('independent_agree NEVER written (Oracle C4 — the floor-lowering back door stays shut)',
      'independent_agree' not in (corrob.get('quote_date') or {}))

print('2. conf lift to the E2 constant when earned was lower')
r = mk_results()
r['quote_date']['confidence'] = 70
fired, _ = run(r, [mk_witness()])
check('conf lifted to exactly 90 (_CROSSCHECK_CORROB_CONF), never higher',
      fired and r['quote_date']['confidence'] == 90)

print('3. witness quality bars (Oracle B3)')
r = mk_results()
fired, _ = run(r, [mk_witness(noted=True)])
check('a NOTED witness never licenses (flag-only @70 edge-grow class)', fired is False
      and r['quote_date'].get('validation_note') == NOTE)
r = mk_results()
fired, _ = run(r, [mk_witness(conf=79)])
check('a sub-80 witness never licenses', fired is False)
r = mk_results()
fired, _ = run(r, [mk_witness(method='anchor_crop', stage='2_anchor', located=False)])
check('an unlocated CROP-family witness never licenses (mapping family is located by construction)',
      fired is False)

print('4. independence bars — keyword/hint NEVER license (the Pelican Gate-C lesson)')
r = mk_results()
fired, _ = run(r, [mk_witness(method='keyword', stage='1_keyword')])
check('keyword-only agreement → note STANDS (restoring this witness restores the Gate-C bug: '
      'the full-page text carries the flip\'s own pixels — 08-10 EVENING3)', fired is False)
r = mk_results()
fired, _ = run(r, [mk_witness(method='hint_fill', stage='2.5_hint')])
check('hint agreement → note STANDS (memory never licenses, 08-11 ruling)', fired is False)

print('5. value/parse gates')
r = mk_results()
fired, _ = run(r, [mk_witness(value='24-04-2026')])
check('a DISAGREEING crop witness → note stands', fired is False)
r = mk_results()
fired, _ = run(r, [mk_witness(value='not a date')])
check('an unparseable witness → note stands (calendar-parse both sides)', fired is False)

print('6. eligibility bars')
r = mk_results(note=NOTE + ' Second unrelated warning.')
fired, _ = run(r, [mk_witness()])
check('a COMPOSED note is ineligible (exact equality only — Oracle C3)', fired is False)
r = mk_results(note='unexpected characters (]) - please verify')
fired, _ = run(r, [mk_witness()])
check('a charset note is ineligible (deterministic-property notes bind)', fired is False)
r = mk_results(note="the raw scan reads this as 'PI/26/3711' — one character differs (1/I); please check which is printed")
fired, _ = run(r, [mk_witness()])
check('the raw-witness note is ineligible (a two-read consensus the value is WRONG — Oracle C2)',
      fired is False)
r = {'quote_number': {'value': 'NRQ-3901', 'confidence': 94, 'method': 'anchor_crop_crosscheck',
                      'validation_note': NOTE, 'was_corrected': True, 'corrected_to': 'NRQ-3901'}}
fired, _ = run(r, [mk_witness(value='NRQ-3901')], key='quote_number')
check('a REF field never demotes (Oracle B2: dates only — refs wait for the I→1 ladder fix)',
      fired is False and r['quote_number'].get('validation_note') == NOTE)
r = mk_results(method='template_mapping')
fired, _ = run(r, [mk_witness()])
check('a non-crosscheck method never demotes', fired is False)

print('7. flag OFF = byte-identical')
r = mk_results()
before = dict(r['quote_date'])
fired, corrob = run(r, [mk_witness()], armed=False)
check('dark: nothing fires, results untouched, record untouched',
      fired is False and r['quote_date'] == before and corrob == {})

print('8. structural pins (shipped source)')
eng_src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'), encoding='utf-8').read()
anc_src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'anchor.py'), encoding='utf-8').read()
val_src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'validator.py'), encoding='utf-8').read()
check('single-source constant: the anchor writer uses XCHECK_DISAGREE_NOTE, no inline copy',
      '"validation_note": XCHECK_DISAGREE_NOTE' in anc_src
      and anc_src.count('The taught position and the full-page read disagreed') == 1)
check('eligibility is EXACT equality in the demoter (a startswith/in refactor goes RED — Oracle C3)',
      '!= anchor.XCHECK_DISAGREE_NOTE' in eng_src)
# Shadow-attribution standing rule, both directions (Oracle scoped reading): the shadow note
# is an interpolated f-string and can NEVER equal the constant; assert the shapes differ.
check('shadow-attribution note can never equal the demote constant (scoped standing rule)',
      'was read the same way by two' in val_src
      and 'was read the same way by two' not in NOTE)
# B1 recompute present at the call site. This asserted a CHARACTER DISTANCE (<=1800) between the
# demoter call and the recompute, which is a proxy for the thing that matters and breaks on comment
# edits alone — it went red twice for added prose while the mechanism was untouched (2026-08-15,
# 2026-08-19). Assert the STRUCTURE instead: every demoter feeds the one shared guard, and the
# recompute lives inside it. Deleting the recompute, or dropping a demoter out of the guard,
# still goes red — which is the whole point of the pin.
_dem = eng_src.find('_demote_xcheck_corroborated_note(results')
_guard = eng_src.find('if _d1 or _d2 or _d3 or _d4:', _dem)
check('B1 recompute present at the call site (overall + needs_review refreshed after a demote)',
      _dem > 0 and _guard > _dem
      and '_overall_confidence' in eng_src[_guard:_guard + 2000])
check('every note demoter is pre-evaluated into the ONE shared recompute guard (no inline `or`, '
      'which would short-circuit and skip a later demoter entirely)',
      all(re.search(rf"\n\s+{d} = self\._(demote|resolve)\w+\(", eng_src)
          for d in ('_d1', '_d2', '_d3', '_d4')))
check('demoter never reads/writes independent_agree (C4)',
      not re.search(r"_demote_xcheck_corroborated_note[\s\S]{0,4000}?independent_agree[\s\S]{0,2000}?def _build_corroboration_emit", eng_src)
      or 'independent_agree' not in eng_src[eng_src.index('def _demote_xcheck_corroborated_note'):eng_src.index('def _build_corroboration_emit')])
check("ledger gains the additive 'noted' bit (B3)", "'noted':" in eng_src)

print(f'\n{passed} ok, {failed} failed')
sys.exit(1 if failed else 0)
