#!/usr/bin/env python3
"""tests/test_digit_disagree.py — D1 in-band digit-disagreement flag pins (Oracle
SIGN-OFF-W/COND 2026-08-01; kill DIGIT_DISAGREE_FLAG, default ON — census gate: 300 docs,
1 fire = the #291 true catch, 0.00% false fires vs the ≤3% bar).

The interior-digit-substitution class is same-length + shape-valid + prefix-valid —
invisible to S-A/S-B/prefix-outlier/learned shape BY CONSTRUCTION. D1 fires only when a
DISTINCT-STAGE candidate-ledger read differs from the winner by 1-2 substituted digits on
an IDENTICAL non-digit skeleton. FLAG-ONLY (cap 69 + corrected_to): the C3 pin — a digit
substitution may NEVER silently adopt (both readings can be wrong: #65@400).

PINNED: the comparator (suffix_reconcile.digit_substitution_diff) is SHARED with the
future D2 second-render witness — one implementation. Length-change pairs return -1 here
(that axis belongs to S-B); a suffix-adopted winner equals its keyword ancestor so D1
structurally can't fire on it; REF-ROLE field only (two dates on one page legitimately
differ only in digits — date fields must never enter this guard).

    cd python_backend && PYTHONIOENCODING=utf-8 py -3.12 tests/test_digit_disagree.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['DIGIT_DISAGREE_FLAG'] = '1'

from extraction import suffix_reconcile as sr
from extraction.engine import ExtractionEngine

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG = os.path.join(ROOT, 'config', 'keyword_patterns.json')

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


print('§1 shared comparator (pure — ONE implementation for D1 + future D2)')
dd = sr.digit_substitution_diff
check('identical -> 0', dd('WS-95390', 'WS-95390') == 0)
check('case/whitespace normalised -> 0', dd('ws-95390 ', 'WS-95390') == 0)
check("#291 pair -> 1 ('WS-95990'/'WS-95390')", dd('WS-95990', 'WS-95390') == 1)
check("#299 pair -> 2 ('WS-72093'/'WS-72055')", dd('WS-72093', 'WS-72055') == 2)
check("#154 pair -> 2 ('DN-38884'/'DN-28854')", dd('DN-38884', 'DN-28854') == 2)
check('3 substitutions counted (caller rejects >2)', dd('AB-11122', 'AB-22222') == 3)
check("PIN length change is NOT this shape ('WS-7354'/'WS-73541' = S-B territory) -> -1",
      dd('WS-7354', 'WS-73541') == -1)
check("letter (skeleton) diff -> -1 ('PO-24729'/'DO-24729')", dd('PO-24729', 'DO-24729') == -1)
check("separator diff -> -1 ('WS.95390'/'WS-95390')", dd('WS.95390', 'WS-95390') == -1)
check("PIN garble is not substitution: letter-O vs digit-0 -> -1 ('WS-9539O'/'WS-95390')",
      dd('WS-9539O', 'WS-95390') == -1)
check('empty -> -1', dd('', 'WS-95390') == -1)


print('§2 engine pass (the #291 catch + every no-fire lane)')

KW = {'stage': '1_keyword', 'value': 'WS-95390', 'method': 'keyword', 'confidence': 85}


def run(value='WS-95990', method='anchor_inline', conf=97, key='ref_no', ref_key='ref_no',
        cands=None, note=None, env_on=True, authoritative=False, win_ledger=True):
    os.environ['DIGIT_DISAGREE_FLAG'] = '1' if env_on else '0'
    eng = ExtractionEngine(config_path=CONFIG)
    ledger = list(cands if cands is not None else [KW])
    if win_ledger:
        # the winner's own ledger entry (its producing stage) — same-stage witnesses skip
        ledger.append({'stage': '2_anchor', 'value': value, 'method': method, 'confidence': conf})
    eng._field_candidates = {key: ledger}
    row = {'value': value, 'confidence': conf, 'method': method}
    if authoritative:
        row['authoritative'] = True
    if note:
        row['validation_note'] = note
    results = {key: row}
    eng._flag_digit_disagreement(results, [{'key': key, 'type': 'text'}],
                                 'Vellum & Crane Stationers', 'worksheet', ref_key)
    return results[key]


r = run()
check('#291 pin: 1-digit distinct-stage disagreement FLAGS (cap 69)', r['confidence'] == 69)
check('C3 PIN: value NEVER changed', r['value'] == 'WS-95990')
check("suggestion = the witness ('corrected_to')", r.get('corrected_to') == 'WS-95390')
check('note names both readings + directs to the DOCUMENT',
      "'WS-95990'" in r['validation_note'] and "'WS-95390'" in r['validation_note']
      and 'check the document' in r['validation_note'])
r2 = run(value='PO-27401', cands=[{'stage': '1_keyword', 'value': 'PO-27491',
                                   'method': 'keyword', 'confidence': 85}])
check('259-signature pin: PO-27401 vs ledger PO-27491 fires', r2['confidence'] == 69
      and r2.get('corrected_to') == 'PO-27491')
check('2-digit disagreement fires (within the census-validated bound)',
      run(value='WS-72093', cands=[{'stage': '1_keyword', 'value': 'WS-72055',
                                    'method': 'keyword', 'confidence': 85}])['confidence'] == 69)
check('3-digit disagreement does NOT fire',
      'validation_note' not in run(value='AB-11122',
                                   cands=[{'stage': '1_keyword', 'value': 'AB-22222',
                                           'method': 'keyword', 'confidence': 85}]))
check('PIN S-B territory untouched: length-change witness does NOT fire here',
      'validation_note' not in run(value='WS-7354',
                                   cands=[{'stage': '1_keyword', 'value': 'WS-73541',
                                           'method': 'keyword', 'confidence': 85}]))
check('PIN suffix-adopt interplay: clipped ledger ancestor (length diff) does NOT fire',
      'validation_note' not in run(value='INV-69523', method='keyword',
                                   cands=[{'stage': '2_anchor', 'value': 'V-69523',
                                           'method': 'anchor_crop', 'confidence': 90}]))
check('same-stage witness does NOT fire (must be a DISTINCT stage)',
      'validation_note' not in run(cands=[{'stage': '2_anchor', 'value': 'WS-95390',
                                           'method': 'anchor_crop', 'confidence': 85}]))
check('witness below the credibility floor (60) does NOT fire',
      'validation_note' not in run(cands=[{'stage': '1_keyword', 'value': 'WS-95390',
                                           'method': 'keyword', 'confidence': 50}]))
check('PIN ref-role only: a non-ref-role field NEVER fires (date-field hazard)',
      'validation_note' not in run(key='other_no', ref_key='ref_no', cands=[KW]))
check('no ref role resolved -> no-op', 'validation_note' not in run(ref_key=None))
check('pre-existing note preserved (one note per field; D1 runs LAST)',
      run(note='S-B spoke')['validation_note'] == 'S-B spoke')
check('keyword_override winner exempt (label-authority parity with S-B)',
      'validation_note' not in run(method='keyword_override'))
check('template_fixed winner exempt (human-set literal)',
      'validation_note' not in run(method='template_fixed'))
check('taught anchor NOT exempt (doctrine: the teach fixed the position, not the value)',
      run(method='anchor_registration', authoritative=True)['confidence'] == 69)
check('kill OFF -> untouched', 'validation_note' not in run(env_on=False))
best = run(cands=[{'stage': '1_keyword', 'value': 'WS-95390', 'method': 'keyword', 'confidence': 85},
                  {'stage': '0.5_mapping', 'value': 'WS-15390', 'method': 'template_mapping',
                   'confidence': 70}])
check('strongest witness wins the suggestion (conf 85 over 70)',
      best.get('corrected_to') == 'WS-95390')

print('§3 engine pass ORDER pin (source inspection): D1 LAST, after S-B')
src = open(os.path.join(ROOT, 'python_backend', 'extraction', 'engine.py'), encoding='utf-8').read()
i_len = src.index('self._flag_ref_length_outlier(results')
i_d1 = src.index('self._flag_digit_disagreement(results')
check('PIN order: ... -> S-B length guard -> D1 digit-disagreement',
      i_len < i_d1)

print()
if fails:
    print(f'{fails} CHECK(S) FAILED')
    sys.exit(1)
print('ALL PINS PASS')
