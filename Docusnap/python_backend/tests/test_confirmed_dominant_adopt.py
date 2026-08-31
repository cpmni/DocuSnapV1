#!/usr/bin/env python3.12
"""tests/test_confirmed_dominant_adopt.py — CONFIRMED_DOMINANT_ADOPT (gary → Oracle
SIGN-OFF-W/COND B1-B5, 2026-08-12; owner: "minimise customer interaction where positive
confirmation exists", variability guard owner-ruled STRICT).

Unit-level: drives engine._adopt_confirmed_dominant directly with a constructed ledger +
counts index (the method is terminal and self-contained). Both live exhibit shapes pinned.
Run: py -3.12 python_backend/tests/test_confirmed_dominant_adopt.py
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import ExtractionEngine, _cmp_norm

fails = 0
def check(label, cond, extra=''):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}{('  [' + str(extra) + ']') if (not cond and extra) else ''}")
    if not cond: fails += 1

DOM = 'Bramblewood Joinery Ltd'
JUNK_NOTE = 'doesn’t read like a name — please verify'

def make_engine(candidates, counts, sup='ironclad tool hire', slug='statement'):
    eng = ExtractionEngine(mode='smart', emit_fn=lambda *_a: None)
    eng._field_candidates = {'customer_name': candidates}
    eng.confirmed_counts_index = {(sup, slug, 'customer_name'): counts}
    return eng

def run(committed, candidates, counts, armed=True, ocr='Bramblewood Joinery Ltd Unit 4', corrob=None):
    old = os.environ.get('CONFIRMED_DOMINANT_ADOPT')
    if armed: os.environ['CONFIRMED_DOMINANT_ADOPT'] = '1'
    else: os.environ.pop('CONFIRMED_DOMINANT_ADOPT', None)
    try:
        eng = make_engine(candidates, counts)
        results = {'customer_name': dict(committed),
                   '_supplier_name': 'Ironclad Tool Hire', '_document_slug': 'statement'}
        cr = corrob if corrob is not None else {'customer_name': {
            'winner_family': 'mapping', 'agree': [], 'disagree': [], 'independent_agree': False}}
        eng._adopt_confirmed_dominant(results, ocr, cr)
        return results['customer_name'], cr
    finally:
        if old is None: os.environ.pop('CONFIRMED_DOMINANT_ADOPT', None)
        else: os.environ['CONFIRMED_DOMINANT_ADOPT'] = old

CAND_OK = [{'value': DOM, 'method': 'keyword', 'confidence': 78, 'box': {'x': 0.1}}]
COUNTS_20 = {_cmp_norm(DOM): 20}

print('1. Exhibit A — taught-box garble vs 20x confirmed literal => ADOPTED')
r, cr = run({'value': 'Sramblewood Joinery Ltg', 'method': 'template_mapping', 'confidence': 70,
             'validation_note': JUNK_NOTE}, CAND_OK, COUNTS_20)
check('value adopted', r.get('value') == DOM, r.get('value'))
check("method = keyword+confirmed_adopt", r.get('method') == 'keyword+confirmed_adopt')
check('confidence = min(90, earned 78) — no boost', r.get('confidence') == 78)
check('note dead (premise-failure)', r.get('validation_note') is None)
check('corrected_to set', r.get('corrected_to') == DOM)

print('2. B2 — corroboration record rewritten: memory family, never independent, dead value retained')
check("winner_family == 'memory'", cr['customer_name'].get('winner_family') == 'memory')
check('independent_agree False', cr['customer_name'].get('independent_agree') is False)
check('dead value retained as disagreement',
      any(d.get('value') == 'Sramblewood Joinery Ltg' for d in cr['customer_name'].get('disagree', [])))

print('3. Exhibit B — code-in-name (ref_bleed) vs 38x => ADOPTED (beyond any distance corrector)')
r, _ = run({'value': 'MDW.-315', 'method': 'keyword', 'confidence': 69,
            'validation_note': 'looks like a reference/code, not a name — please verify'},
           CAND_OK, {_cmp_norm(DOM): 38})
check('adopted', r.get('value') == DOM, r.get('value'))

print('4. B4 STRICT variability — ANY second distinct key refuses')
r, _ = run({'value': 'MDW.-315', 'method': 'keyword', 'confidence': 69,
            'validation_note': 'looks like a reference/code, not a name — please verify'},
           CAND_OK, {_cmp_norm(DOM): 20, _cmp_norm('Fernbank Veterinary Clinic'): 1})
check('dominant 20x + unrelated key at count 1 => REFUSE (multi-party bound)',
      r.get('value') == 'MDW.-315')
# cmp_norm variants of ONE value are the SAME key by construction — assert the premise:
check('cmp_norm folds case/ws variants to one key (companion premise)',
      _cmp_norm('BRAMBLEWOOD  Joinery ltd') == _cmp_norm(DOM))

print('5. Refusals — each falls to today (value + note untouched)')
r, _ = run({'value': 'MDW.-315', 'method': 'keyword_override', 'confidence': 69,
            'validation_note': 'looks like a reference/code, not a name — please verify'},
           CAND_OK, COUNTS_20)
check('operator-VALUE method (keyword_override) refuses', r.get('value') == 'MDW.-315')
r, _ = run({'value': 'MDW.-315', 'method': 'template_fixed', 'confidence': 95,
            'validation_note': 'looks like a reference/code, not a name — please verify'},
           CAND_OK, COUNTS_20)
check('template_fixed refuses', r.get('value') == 'MDW.-315')
r, _ = run({'value': 'Fernbank Veterinary Clinic', 'method': 'keyword', 'confidence': 69,
            'validation_note': 'two different names were read here — please verify'},
           CAND_OK, COUNTS_20)
check('non-junk value (plausible name, non-junk note) refuses', r.get('value') == 'Fernbank Veterinary Clinic')
r, _ = run({'value': 'MDW.-315', 'method': 'keyword', 'confidence': 69,
            'validation_note': 'looks like a reference/code, not a name — please verify'},
           CAND_OK, {_cmp_norm(DOM): 4})
check('count 4 < 5 refuses', r.get('value') == 'MDW.-315')
r, _ = run({'value': 'MDW.-315', 'method': 'keyword', 'confidence': 69,
            'validation_note': 'looks like a reference/code, not a name — please verify'},
           [{'value': DOM, 'method': 'keyword', 'confidence': 78, 'box': None}], COUNTS_20,
           ocr='totally different page text')
check('off-page unboxed witness refuses (Guard-A reuse)', r.get('value') == 'MDW.-315')
r, _ = run({'value': 'MDW.-315', 'method': 'keyword', 'confidence': 69,
            'validation_note': 'looks like a reference/code, not a name — please verify'},
           [{'value': 'MDW.-315', 'method': 'keyword', 'confidence': 78, 'box': {'x': 1}}],
           {_cmp_norm('MDW.-315'): 20})
check('B1: junk adoptee (dominant itself code-shaped) refuses — falls to the picker',
      r.get('value') == 'MDW.-315')

print('6. supplier_name exclusion + OFF byte-identical')
old = os.environ.get('CONFIRMED_DOMINANT_ADOPT'); os.environ['CONFIRMED_DOMINANT_ADOPT'] = '1'
try:
    eng = make_engine(CAND_OK, COUNTS_20)
    eng._field_candidates = {'supplier_name': CAND_OK}
    eng.confirmed_counts_index = {('ironclad tool hire', 'statement', 'supplier_name'): COUNTS_20}
    res = {'supplier_name': {'value': 'MDW.-315', 'method': 'keyword', 'confidence': 69,
                             'validation_note': 'looks like a reference/code, not a name — please verify'},
           '_supplier_name': 'Ironclad Tool Hire', '_document_slug': 'statement'}
    eng._adopt_confirmed_dominant(res, 'Bramblewood Joinery Ltd', {})
    check('supplier_name is NEVER adopted', res['supplier_name'].get('value') == 'MDW.-315')
finally:
    if old is None: os.environ.pop('CONFIRMED_DOMINANT_ADOPT', None)
    else: os.environ['CONFIRMED_DOMINANT_ADOPT'] = old
committed = {'value': 'Sramblewood Joinery Ltg', 'method': 'template_mapping', 'confidence': 70,
             'validation_note': JUNK_NOTE}
r, cr = run(committed, CAND_OK, COUNTS_20, armed=False)
check('OFF: value untouched', r.get('value') == 'Sramblewood Joinery Ltg')
check('OFF: note survives', r.get('validation_note') == JUNK_NOTE)
check('OFF: corrob record untouched', cr['customer_name'].get('winner_family') == 'mapping')

print('7. Picker suppression seam — note=None means _build_candidate_emit skips the field')
old = os.environ.get('CONFIRMED_DOMINANT_ADOPT'); os.environ['CONFIRMED_DOMINANT_ADOPT'] = '1'
try:
    eng = make_engine(CAND_OK, COUNTS_20)
    res = {'customer_name': dict(committed),
           '_supplier_name': 'Ironclad Tool Hire', '_document_slug': 'statement'}
    cr = {'customer_name': {'winner_family': 'mapping', 'agree': [], 'disagree': [], 'independent_agree': False}}
    eng._adopt_confirmed_dominant(res, 'Bramblewood Joinery Ltd Unit 4', cr)
    emit = eng._build_candidate_emit(res, 'Bramblewood Joinery Ltd Unit 4')
    check('post-adoption picker emit has NO entry for the field', 'customer_name' not in emit, emit)
finally:
    if old is None: os.environ.pop('CONFIRMED_DOMINANT_ADOPT', None)
    else: os.environ['CONFIRMED_DOMINANT_ADOPT'] = old

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(0 if fails == 0 else 1)
