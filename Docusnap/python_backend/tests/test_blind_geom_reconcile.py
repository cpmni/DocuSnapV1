#!/usr/bin/env python3
"""tests/test_blind_geom_reconcile.py — S-C BLIND-GEOMETRY DISAGREEMENT RECONCILIATION pins
(Oracle SIGN-OFF-W/COND 2026-08-01; kill BLIND_GEOM_DISAGREE_RECONCILE, ships DARK).

The #141 class: an anchor_registration Tier-A winner that FAILS its own scope's learned shape
while independent-stage witnesses agree on a shape-PASSING value. ADOPT on >=2 DISTINCT stage
families; FLAG (both values named) on one. PINNED: two same-family candidates never count as
two witnesses; anchor_inline / anchor_crop_relocated winners are untouched (the 2026-07-26
Tier-A re-teach fix depends on it); the adopted result is NON-authoritative with the witness's
own confidence; the engine pass ORDER is suffix-reconcile -> S-C -> S-A -> prefix-outlier ->
S-B (source-pinned below).

    cd python_backend && PYTHONIOENCODING=utf-8 py -3.12 tests/test_blind_geom_reconcile.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['BLIND_GEOM_DISAGREE_RECONCILE'] = '1'

from extraction.engine import ExtractionEngine

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG = os.path.join(ROOT, 'config', 'keyword_patterns.json')

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


FORMATS = [{'supplier_name': 'Ridgeway Plant Hire', 'document_type': 'delivery_note',
            'field_key': 'delivery_number',
            'sample_values': [f'DN-{20000 + i}' for i in range(12)],
            'value_counts': {f'DN-{20000 + i}': 1 for i in range(12)}}]
FIELDS = [{'key': 'delivery_number', 'type': 'text', 'required': 1}]


def run(winner, cands, env_on=True, note=None):
    os.environ['BLIND_GEOM_DISAGREE_RECONCILE'] = '1' if env_on else '0'
    eng = ExtractionEngine(config_path=CONFIG)
    eng.set_formats(FORMATS)
    eng._field_candidates = {'delivery_number': cands}
    row = dict(winner)
    if note:
        row['validation_note'] = note
    results = {'delivery_number': row}
    eng._reconcile_blind_geometry(results, FIELDS, 'Ridgeway Plant Hire', 'delivery_note')
    return results['delivery_number']


WIN = {'value': '21/07/2026', 'confidence': 88, 'method': 'anchor_registration', 'authoritative': True}
KW  = {'stage': '1_keyword',   'value': '. DN-24408', 'method': 'keyword_override', 'confidence': 93}
MAP = {'stage': '0.5_mapping', 'value': 'DN-24408',   'method': 'template_mapping', 'confidence': 90}

print('§1 the #141 replay — ADOPT lane')
r = run(WIN, [KW, MAP])
check("two distinct families agreeing -> ADOPT 'DN-24408'", r['value'] == 'DN-24408')
check('adopted method = best witness', r['method'] == 'keyword_override')
check("adopted confidence = the witness's own (93, never boosted)", r['confidence'] == 93)
check('PIN: adopted result is NON-authoritative', r['authoritative'] is False)
check('marker present', r.get('blind_geom_reconciled') is True)

print('§2 FLAG lane + witness discipline')
f = run(WIN, [KW])
check('one witness -> FLAG lane: winner value KEPT', f['value'] == '21/07/2026')
check('  cap 69 + note naming both values',
      f['confidence'] == 69 and 'DN-24408' in f['validation_note'] and '21/07/2026' in f['validation_note'])
check('PIN: two SAME-family candidates count as ONE witness (FLAG, never adopt)',
      run(WIN, [KW, {**KW, 'confidence': 91}])['value'] == '21/07/2026')
check('witness that FAILS the scope shape is no witness (untouched)',
      'validation_note' not in run(WIN, [{**KW, 'value': '21-07-26'}]))
check('agreeing candidate is no witness (untouched)',
      'validation_note' not in run(WIN, [{**KW, 'value': '21/07/2026'}]))
check('late-anchor stage is not an admissible family',
      'validation_note' not in run(WIN, [{**KW, 'stage': '2.6_late_anchor'}]))

print('§3 scope pins')
check('PIN: anchor_inline winner untouched (2026-07-26 Tier-A re-teach fix)',
      'validation_note' not in run({**WIN, 'method': 'anchor_inline'}, [KW, MAP])
      and run({**WIN, 'method': 'anchor_inline'}, [KW, MAP])['value'] == '21/07/2026')
check('PIN: anchor_crop_relocated winner untouched',
      run({**WIN, 'method': 'anchor_crop_relocated'}, [KW, MAP])['value'] == '21/07/2026')
check('shape-PASSING winner untouched (nothing to arbitrate)',
      run({**WIN, 'value': 'DN-99999'}, [KW, MAP])['value'] == 'DN-99999')
check('pre-existing note -> untouched (one note per field)',
      run(WIN, [KW, MAP], note='earlier')['value'] == '21/07/2026')
check('kill OFF -> untouched', run(WIN, [KW, MAP], env_on=False)['value'] == '21/07/2026')

print('§4 engine pass ORDER pin (source inspection)')
src = open(os.path.join(ROOT, 'python_backend', 'extraction', 'engine.py'), encoding='utf-8').read()
i_suffix = src.index('self._reconcile_clipped_suffix(results')
i_geom   = src.index('self._reconcile_blind_geometry(results')
i_date   = src.index('self._flag_date_shaped_ref(results')
i_prefix = src.index('self._flag_prefix_outlier(results')
i_len    = src.index('self._flag_ref_length_outlier(results')
check('PIN order: suffix-reconcile -> S-C -> S-A -> prefix-outlier -> S-B',
      i_suffix < i_geom < i_date < i_prefix < i_len)

print()
if fails:
    print(f'{fails} CHECK(S) FAILED')
    sys.exit(1)
print('ALL PINS PASS')
