"""test_both_forms_parity.py — the Python half of the cross-language both-forms pin.

Oracle 2026-08-19 rejected "one evidence set, literally the same object" as a PREMISE ERROR: the
engine's value-head twin consumes `confirmed_counts_index`, whose keys are `_cmp_norm`-collapsed,
while the JS side consumes raw `value_counts` keys. Written over raw keys with a case-sensitive
compare those are different predicates, and a fixture of plain uppercase rows greens on the
divergence. Hence: ONE shared corpus (both_forms_corpus.json) carrying a MIXED-CASE row and a
SEPARATOR-VARIANT row, read verbatim by this suite and by src/services/test_ref_class_fix.js.

Run: py -3.12 tests/test_both_forms_parity.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import ocr_corrector  # noqa: E402

passed = failed = 0


def check(name, ok):
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok  {name}')
    else:
        failed += 1
        print(f'  FAIL {name}')


CORPUS = json.load(open(os.path.join(os.path.dirname(__file__), 'both_forms_corpus.json'),
                        encoding='utf-8'))

print('SHARED CORPUS — every case, exactly as the JS twin reads it')
for case in CORPUS['cases']:
    got = ocr_corrector.both_forms_established(case['counts'], case['head'])
    check(f"{case['name']} -> {case['expected']}", got is case['expected'])

print('\nthe fixture still carries the two rows the pin exists for')
_names = {c['name'] for c in CORPUS['cases']}
check('mixed_case_head present (deleting it would let a case-sensitive divergence green)',
      any(n.startswith('mixed_case_head') for n in _names))
check('separator_variant present (deleting it would let a whitespace divergence green)',
      any(n.startswith('separator_variant') for n in _names))

print('\nnormalisation happens INSIDE the predicate (idempotent — a pre-collapsed bucket is safe)')
# The engine hands it collapsed keys; a caller may hand it raw ones. Same answer, or the two
# callers are asking different questions.
raw = {'PI/25/8496': 4, 'pi/26/1001': 3, 'XX/1': 1}
collapsed = {ocr_corrector._cmp_norm_local(k): v for k, v in raw.items()}
check('raw keys and pre-collapsed keys give the same verdict',
      ocr_corrector.both_forms_established(raw, 'pi')
      is ocr_corrector.both_forms_established(collapsed, 'PI'))
check('_cmp_norm_local is idempotent (the property that makes the above true)',
      all(ocr_corrector._cmp_norm_local(ocr_corrector._cmp_norm_local(v))
          == ocr_corrector._cmp_norm_local(v)
          for v in ('PI/25/8496', 'SB ORD 7 4238', '  Mixed Case  ', 'PI-26-1001')))

print('\nthe engine lane consumes the SHARED predicate, not its own arithmetic')
eng_src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'),
               encoding='utf-8').read()
_lane = eng_src[eng_src.index('def _try_prefix_confusable_adopt'):]
_lane = _lane[:_lane.index('\n    def ', 10)]
check('the value-head twin calls ocr_corrector.both_forms_established',
      'ocr_corrector.both_forms_established(' in _lane)
check('...and no longer hand-rolls the bar (a second copy is how the two drift apart)',
      'math.ceil(0.10' not in _lane and 'same_head' not in _lane)

print(f'\n{passed} ok, {failed} failed')
sys.exit(1 if failed else 0)
