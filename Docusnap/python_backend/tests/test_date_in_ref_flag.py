#!/usr/bin/env python3
"""tests/test_date_in_ref_flag.py — S-A DATE-IN-REF guard pins (Oracle SIGN-OFF-W/COND
2026-08-01; kill DATE_IN_REF_FLAG). Flag-only, never null, floor-independent via the note.

PINNED: the belt keeps '20260731' / '21/07' / 'DN-24/07/26' safe; '12.05.11' FLAGS until the
scope's own confirmed shape covers it (the accepted trade-off); keyword_override is NOT exempt
(DELIBERATE ASYMMETRY vs _flag_prefix_outlier — label authority is not value authority).

    cd python_backend && PYTHONIOENCODING=utf-8 py -3.12 tests/test_date_in_ref_flag.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['DATE_IN_REF_FLAG'] = '1'

from extraction.engine import ExtractionEngine

CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                      'config', 'keyword_patterns.json')

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


FIELDS = [
    {"key": "delivery_number", "type": "text", "required": 1},
    {"key": "invoice_date",    "type": "date", "required": 1},
    {"key": "reference_number", "type": "text", "required": 0},
]


def run(value, method='anchor_registration', key='delivery_number', note=None,
        formats=None, env_on=True):
    os.environ['DATE_IN_REF_FLAG'] = '1' if env_on else '0'
    eng = ExtractionEngine(config_path=CONFIG)
    if formats:
        eng.set_formats(formats)
    row = {'value': value, 'confidence': 88, 'method': method}
    if note:
        row['validation_note'] = note
    results = {key: row}
    eng._flag_date_shaped_ref(results, FIELDS, 'Ridgeway Plant Hire', 'delivery_note')
    return results[key]


print('§1 the #141 class')
r = run('21/07/2026')
check('date value in a ref field FLAGS (cap 69 + note)',
      r['confidence'] == 69 and 'looks like a date' in r['validation_note'])
check('value NEVER nulled', r['value'] == '21/07/2026')
check('dash form flags', run('21-07-2026')['confidence'] == 69)
check('month-name form flags', run('14 Nov 2026')['confidence'] == 69)

print('§2 belt pins — never widened')
check("PIN: '20260731' (bare digit run) NOT flagged", 'validation_note' not in run('20260731'))
check("PIN: '21/07' (2-component) NOT flagged", 'validation_note' not in run('21/07'))
check("PIN: 'DN-24/07/26' (prefixed) NOT flagged", 'validation_note' not in run('DN-24/07/26'))
check("mixed separators NOT flagged ('21/07-2026')", 'validation_note' not in run('21/07-2026'))
check('a real ref untouched', 'validation_note' not in run('DN-24408'))

print('§3 scope + method exemptions')
check('date FIELD untouched', 'validation_note' not in run('21/07/2026', key='invoice_date'))
check('manual method exempt', 'validation_note' not in run('21/07/2026', method='manual'))
check('template_fixed exempt', 'validation_note' not in run('21/07/2026', method='template_fixed'))
check('PIN (Oracle asymmetry): keyword_override is NOT exempt — it still FLAGS',
      run('21/07/2026', method='keyword_override')['confidence'] == 69)
check('pre-existing note preserved (one note per field)',
      run('21/07/2026', note='earlier note')['validation_note'] == 'earlier note')

print('§4 self-disarm + trade-off + kill')
DATE_LIKE_FORMATS = [{'supplier_name': 'Ridgeway Plant Hire', 'document_type': 'delivery_note',
                      'field_key': 'delivery_number',
                      'sample_values': [f'12.05.{i:02d}' for i in range(1, 13)],
                      'value_counts': {f'12.05.{i:02d}': 2 for i in range(1, 13)}}]
check("PIN trade-off: '12.05.11' FLAGS on a scope with NO such history",
      run('12.05.11')['confidence'] == 69)
check("…and self-disarms once the scope's OWN shape covers it",
      'validation_note' not in run('12.05.11', formats=DATE_LIKE_FORMATS))
check('kill switch OFF = untouched', 'validation_note' not in run('21/07/2026', env_on=False))

print()
if fails:
    print(f'{fails} CHECK(S) FAILED')
    sys.exit(1)
print('ALL PINS PASS')
