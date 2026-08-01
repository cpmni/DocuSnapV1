#!/usr/bin/env python3
"""tests/test_ref_length_outlier.py — S-B ref digit-run LENGTH profile pins (Oracle
SIGN-OFF-W/COND 2026-08-01; kill REF_LENGTH_OUTLIER_GUARD, built OFF).

The length-FOLDED learned shape is blind to digit accretion/duplication BY DESIGN (the fold
cured the INV999->INV1000 rollover withhold — do NOT revert; pinned here by construction:
these cases pass the shape and only THIS guard sees them). Flag-only, value never touched.

PINNED TRADE-OFF: a genuine rollover ('INV-1000' vs a uniform 3-digit history) FLAGS its
first ~_PREFIX_ACCEPT_MIN docs then self-heals — exempting +1-length would reopen the
accretion hole.

    cd python_backend && PYTHONIOENCODING=utf-8 py -3.12 tests/test_ref_length_outlier.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['REF_LENGTH_OUTLIER_GUARD'] = '1'

from extraction import ocr_corrector as oc
from extraction.engine import ExtractionEngine

CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                      'config', 'keyword_patterns.json')

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def formats(counts, sup='Ridgeway Plant Hire', dt='delivery_note', key='delivery_number'):
    return [{'supplier_name': sup, 'document_type': dt, 'field_key': key,
             'sample_values': list(counts)[:12], 'value_counts': counts}]


print('§1 profile extraction (pure)')
check("'DN-24408' -> (5,)", oc.digit_run_profile('DN-24408') == (5,))
check("'7602-1354-4' -> (4,4,1)", oc.digit_run_profile('7602-1354-4') == (4, 4, 1))
check("'INV-121' -> (3,)", oc.digit_run_profile('INV-121') == (3,))
check('no digits -> None', oc.digit_run_profile('nope') is None)

print('§2 index dominance + support bars')
UNI = {f'DN-{20000 + i}': 1 for i in range(12)}                     # 12× (5,)
idx = oc.build_length_index(formats(UNI))
rec = oc.lookup_length(idx, 'delivery_number', 'Ridgeway Plant Hire', 'delivery_note')
check('uniform scope indexes with dominant (5,)', rec and rec['dominant'] == (5,))
check('4 confirms -> below DOMINANT_MIN_COUNT -> no index',
      oc.build_length_index(formats({f'DN-{20000 + i}': 1 for i in range(4)})) == {})
MIXED = {**{f'DN-{20000 + i}': 1 for i in range(6)}, **{f'DN-{200000 + i}': 1 for i in range(4)}}
check('60/40 mixed scope DISARMED (no ≥80% share)', oc.build_length_index(formats(MIXED)) == {})
check('exact-scope lookup only (no fallback)',
      oc.lookup_length(idx, 'delivery_number', 'Other Supplier', 'delivery_note') is None)

print('§3 outlier decision + self-heal')
check('#33 class: (5,) read vs (3,) dominant is an outlier',
      oc.is_length_outlier((5,), {'dominant': (3,), 'counts': {(3,): 12}, 'total': 12}))
check('dup class: (6,) vs (5,) dominant is an outlier', oc.is_length_outlier((6,), rec))
check('matching profile is not', not oc.is_length_outlier((5,), rec))
check('self-heal: a new length with 8 confirms clears the ABS bar',
      not oc.is_length_outlier((6,), {'dominant': (5,), 'counts': {(5,): 40, (6,): 8}, 'total': 48}))
check('a 2-confirm stray still flags',
      oc.is_length_outlier((6,), {'dominant': (5,), 'counts': {(5,): 40, (6,): 2}, 'total': 42}))
check('multi-run: run COUNT change is an outlier ((4,4,1) vs (4,4))',
      oc.is_length_outlier((4, 4), {'dominant': (4, 4, 1), 'counts': {(4, 4, 1): 10}, 'total': 10}))

print('§4 engine pass')


def run(value, method='anchor_crop', note=None, env_on=True, fmts=None):
    os.environ['REF_LENGTH_OUTLIER_GUARD'] = '1' if env_on else '0'
    eng = ExtractionEngine(config_path=CONFIG)
    eng.set_formats(fmts if fmts is not None else formats(UNI))
    row = {'value': value, 'confidence': 92, 'method': method}
    if note:
        row['validation_note'] = note
    results = {'delivery_number': row}
    eng._flag_ref_length_outlier(results, [{'key': 'delivery_number', 'type': 'text'}],
                                 'Ridgeway Plant Hire', 'delivery_note')
    return results['delivery_number']


r = run('DN-244088')
check('accretion read FLAGS (cap 69 + note)', r['confidence'] == 69 and 'digits' in r['validation_note'])
check('value untouched', r['value'] == 'DN-244088')
check('conforming read untouched', 'validation_note' not in run('DN-24408'))
check("PIN rollover trade-off: 'DN-1000' (4,) vs (5,) dominant FLAGS until confirmed",
      run('DN-1000')['confidence'] == 69)
check('taught anchor NOT exempt (doctrine: the teach fixed the position, not the value)',
      run('DN-244088', method='anchor_registration')['confidence'] == 69)
check('keyword_override exempt (prefix-outlier parity)',
      'validation_note' not in run('DN-244088', method='keyword_override'))
check('note precedence: pre-existing note preserved',
      run('DN-244088', note='S-A spoke')['validation_note'] == 'S-A spoke')
check('kill OFF untouched', 'validation_note' not in run('DN-244088', env_on=False))

print()
if fails:
    print(f'{fails} CHECK(S) FAILED')
    sys.exit(1)
print('ALL PINS PASS')
