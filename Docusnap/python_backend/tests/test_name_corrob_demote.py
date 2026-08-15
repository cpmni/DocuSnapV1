"""test_name_corrob_demote.py — PINs for NAME_CORROB_NOTE_DEMOTE (corroboration STEP 3,
slice 3 — the Layer-A name-guard caption-disagreement note; gary design → Oracle
SIGN-OFF-W/COND B1-B3, 2026-08-13; DEFAULT OFF).

Slice-3 boundary vs slices 1/2: names have no calendar-parse/penny-exact content gate and the
name-repair machinery rewrites values, so the bar is deliberately STRICTER — BOTH a crop-side
ledger witness (W1, minus memory-masquerade methods) AND a keyword-family read (W2, the
flush-clip crop↔crop common-mode breaker) AND a RECORDED guard-rejection (D1, the always-on
B1 recorder) AND ledger unanimity (D2). supplier_name NEVER demotes. NO confidence minting.

Run:  py -3.12 python_backend/tests/test_name_corrob_demote.py
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


NOTE = anchor.NAME_GUARD_DISAGREE_NOTE
FIELD_DEFS = [{'key': 'customer_name', 'type': 'text'},
              {'key': 'supplier_name', 'type': 'text'},
              {'key': 'quote_number', 'type': 'text'}]
REJ = [{'method': 'anchor_crop_relocated', 'value': 'scone',
        'reason': 'name_guard_junk_candidate'}]


def mk_results(key='customer_name', value='Bramblewood Joinery Ltd', note=NOTE,
               method='anchor_crop', conf=70):
    return {key: {'value': value, 'confidence': conf, 'method': method,
                  'validation_note': note}}


def mk_w1(value='Bramblewood Joinery Ltd', method='template_mapping', stage='0.5_mapping',
          located=False, noted=False, conf=90):
    return {'value': value, 'method': method, 'stage': stage,
            'located': located, 'noted': noted, 'confidence': conf,
            'authoritative': True, 'box': None}


def mk_w2(value='Bramblewood Joinery Ltd', method='keyword_override', stage='1_keyword',
          noted=False, conf=78):
    return {'value': value, 'method': method, 'stage': stage,
            'located': False, 'noted': noted, 'confidence': conf,
            'authoritative': False, 'box': None}


def run(results, cands, key='customer_name', armed=True, rejected=None):
    if armed:
        os.environ['NAME_CORROB_NOTE_DEMOTE'] = '1'
    else:
        os.environ.pop('NAME_CORROB_NOTE_DEMOTE', None)
    fake = types.SimpleNamespace(_field_candidates={key: cands},
                                 _rejected_reads=({key: rejected} if rejected else {}),
                                 _trace=False, _t=lambda *a, **k: None,
                                 log=lambda *a, **k: None)
    corrob = {}
    try:
        fired = engine.ExtractionEngine._demote_name_guard_corroborated_note(
            fake, results, FIELD_DEFS, corrob)
    finally:
        os.environ.pop('NAME_CORROB_NOTE_DEMOTE', None)
    return fired, corrob


print('1. the exhibit — mapping + keyword agree, dissenters guard-rejected')
r = mk_results()
fired, corrob = run(r, [mk_w1(), mk_w2()], rejected=REJ)
d = r['customer_name']
check('demote fired', fired is True)
check('note cleared (was_corrected/corrected_to popped defensively too)',
      'validation_note' not in d and 'was_corrected' not in d and 'corrected_to' not in d)
check("method gains '+corrob_clear'", d['method'] == 'anchor_crop+corrob_clear')
check('confidence EXACTLY unchanged (70 stays 70 — the no-minting pin; the dark keyword '
      'clear mints, this deliberately does not)', d['confidence'] == 70)
nd = (corrob.get('customer_name') or {}).get('note_demoted') or {}
check('note_demoted carries BOTH witnesses AND the guard-rejected dissenters (census retro-audit)',
      nd.get('witness_method') == 'template_mapping'
      and nd.get('keyword_method') == 'keyword_override'
      and nd.get('rejected_reads') == REJ)
check('independent_agree NEVER written (C4 — behavioural pin, the real guard; the slice-1 '
      'structural window pin is DEAD per Oracle 2026-08-13)',
      'independent_agree' not in (corrob.get('customer_name') or {}))

print('2. supplier_name NEVER demotes (pinned trade-off — identity machinery gets its own '
      'slice or never)')
r = mk_results(key='supplier_name')
fired, _ = run(r, [mk_w1(), mk_w2()], key='supplier_name', rejected=REJ)
check('identical setup on supplier_name → NO demote, note stands',
      fired is False and r['supplier_name'].get('validation_note') == NOTE)

print('3. flush-clip equality — alnum-core EXACT, no fuzzy tier (both directions)')
r = mk_results()
fired, _ = run(r, [mk_w1(value='Bramblewood Joinery Lt'), mk_w2()], rejected=REJ)
check('clipped W1 witness never licenses the full committed value', fired is False)
r = mk_results(value='Bramblewood Joinery Lt')
fired, _ = run(r, [mk_w1(), mk_w2()], rejected=REJ)
check('full witnesses never license a clipped committed value (dissent leg also trips)',
      fired is False)
r = mk_results()
fired, _ = run(r, [mk_w1(value='Bramblewood Joinery Ltd.'), mk_w2()], rejected=REJ)
check("'Ltd.' vs 'Ltd' still equal (punctuation variance is not identity variance)",
      fired is True)

print('4. W2 is MANDATORY (Oracle Q1 — the crop↔crop common-mode refusal a widening change '
      'must consciously delete)')
r = mk_results()
fired, _ = run(r, [mk_w1()], rejected=REJ)
check('W1 mapping witness alone (no keyword agreement) → NO demote', fired is False)
r = mk_results()
fired, _ = run(r, [mk_w1(), mk_w1(method='anchor_crop_relocated', stage='2_anchor',
                          located=True, conf=85)], rejected=REJ)
check('TWO crop witnesses, still no keyword → NO demote (a second crop read is not W2)',
      fired is False)

print('5. W1 hygiene — memory never masquerades as pixels')
r = mk_results()
fired, _ = run(r, [mk_w1(method='template_fixed', stage='0_template'), mk_w2()], rejected=REJ)
check('template_fixed witness refused (frozen MEMORY name buckets as mapping — the F8 hole, '
      'the Quillstone poison channel)', fired is False)
r = mk_results()
fired, _ = run(r, [mk_w1(method='anchor_crop+corrected', stage='2_anchor', located=True),
                   mk_w2()], rejected=REJ)
check("'+corrected' witness refused (learned-corrector rewrite is memory-influenced)",
      fired is False)
r = mk_results()
fired, _ = run(r, [mk_w1(noted=True), mk_w2()], rejected=REJ)
check('a NOTED W1 never licenses', fired is False)
r = mk_results()
fired, _ = run(r, [mk_w1(conf=79), mk_w2()], rejected=REJ)
check('a sub-80 W1 never licenses', fired is False)
r = mk_results()
fired, _ = run(r, [mk_w1(method='anchor_crop', stage='2_anchor', located=False), mk_w2()],
               rejected=REJ)
check('an unlocated CROP-family W1 never licenses (mapping exempt by construction)',
      fired is False)
r = mk_results()
fired, _ = run(r, [mk_w1(method='anchor_crop', stage='2_anchor', located=True), mk_w2()],
               rejected=REJ)
check('a LOCATED crop-family W1 licenses', fired is True)

print('6. W2 hygiene')
r = mk_results()
fired, _ = run(r, [mk_w1(), mk_w2(noted=True)], rejected=REJ)
check('a NOTED W2 never licenses', fired is False)
r = mk_results()
fired, _ = run(r, [mk_w1(), mk_w2(conf=69)], rejected=REJ)
check('a sub-70 W2 never licenses', fired is False)
r = mk_results()
fired, _ = run(r, [mk_w1(), mk_w2(method='hint_fill', stage='2.5_hint')], rejected=REJ)
check('a hint read is not W2 (memory never licenses)', fired is False)

print('7. dissent legs')
r = mk_results()
fired, _ = run(r, [mk_w1(), mk_w2()], rejected=None)
check('D1: NO recorded guard-rejection → NO demote (dissent must be DISQUALIFIED, '
      'not merely absent)', fired is False)
r = mk_results()
fired, _ = run(r, [mk_w1(), mk_w2(),
                   {'value': 'SITE ADDRESS', 'method': 'anchor_inline', 'stage': '2_anchor',
                    'located': False, 'noted': False, 'confidence': 70,
                    'authoritative': False, 'box': None}], rejected=REJ)
check('D2: a surviving un-noted ≥60 DISAGREEING read of any family → NO demote (unanimity)',
      fired is False)
r = mk_results()
fired, _ = run(r, [mk_w1(), mk_w2(),
                   {'value': 'SITE ADDRESS', 'method': 'anchor_inline', 'stage': '2_anchor',
                    'located': False, 'noted': True, 'confidence': 70,
                    'authoritative': False, 'box': None}], rejected=REJ)
check('a NOTED disagreeing read does not block (it already carries its own warning)',
      fired is True)

print('8. eligibility bars')
r = mk_results(note=NOTE + ' Second warning.')
fired, _ = run(r, [mk_w1(), mk_w2()], rejected=REJ)
check('a COMPOSED note is ineligible (exact equality only)', fired is False)
for other in ("This value may include text from the field's label — please verify.",
              'The name here looks like a document heading — please verify.'):
    r = mk_results(note=other)
    fired, _ = run(r, [mk_w1(), mk_w2()], rejected=REJ)
    check(f'a different guard note is ineligible ({other[:40]}…)', fired is False)
r = mk_results(method='anchor_crop_relocated')
fired, _ = run(r, [mk_w1(), mk_w2()], rejected=REJ)
check("method must be 'anchor_crop' exactly (the note's own cap site)", fired is False)
r = mk_results(key='quote_number')
fired, _ = run(r, [mk_w1(), mk_w2()], key='quote_number', rejected=REJ)
check('a non-name field never demotes', fired is False)
r = mk_results(value='Sso#')
fired, _ = run(r, [mk_w1(value='Sso#'), mk_w2(value='Sso#')], rejected=REJ)
check('a junk-shaped committed value never demotes (Layer A re-asserted)', fired is False)

print('9. flag OFF = byte-identical')
r = mk_results()
before = dict(r['customer_name'])
fired, corrob = run(r, [mk_w1(), mk_w2()], armed=False, rejected=REJ)
check('dark: nothing fires, results untouched, record untouched',
      fired is False and r['customer_name'] == before and corrob == {})

print('10. structural pins (shipped source)')
eng_src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'),
               encoding='utf-8').read()
anc_src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'anchor.py'),
               encoding='utf-8').read()
check('single-source constant: the note literal appears once in anchor.py (the definition); '
      'the write site references NAME_GUARD_DISAGREE_NOTE',
      anc_src.count("The value found beside this document's own ") == 1
      and '_relocate_guard_note = NAME_GUARD_DISAGREE_NOTE' in anc_src)
check('constant text matches the historic literal byte-for-byte (the keyword-clear suite pins '
      'the same text)',
      NOTE == ("The value found beside this document's own caption disagreed "
               "with the taught position — please verify."))
check('eligibility is EXACT equality in the demoter (a startswith/in refactor goes RED)',
      '!= anchor.NAME_GUARD_DISAGREE_NOTE' in eng_src)
check('B1: the Stage-2b parallel predicate NEVER references on_reject (an `on_reject is None` '
      'leg would silently force-serialise every production run — read-determinism)',
      not re.search(r"_parallel = \([\s\S]{0,400}on_reject", anc_src)
      and re.search(r"_parallel = \([\s\S]{0,400}force_serial", anc_src))
check('B1: both engine call sites pass force_serial + the always-on recorder writes '
      '_rejected_reads at both sites',
      eng_src.count('force_serial=bool(self._trace)') == 2
      and eng_src.count('self._rejected_reads.setdefault(fk, []).append') == 2)
check('recorder reset per doc beside the candidate ledger',
      re.search(r"_recon_displaced = \{\}[\s\S]{0,900}_rejected_reads = \{\}", eng_src))
check('B1 recompute shared: _d3 feeds the same block',
      re.search(r"_d3 = self\._demote_name_guard_corroborated_note", eng_src)
      and re.search(r"if _d1 or _d2 or _d3( or _d4)?:", eng_src))   # _d4 = 2026-08-15 corrob resolver, same block
check('B3: the keyword-clear door names the slice-3 interaction (both doors governed by the '
      '#259 precondition)',
      re.search(r"_name_guard_keyword_clears[\s\S]{0,3000}SLICE-3 INTERACTION", eng_src))

print(f'\n{passed} ok, {failed} failed')
sys.exit(1 if failed else 0)
