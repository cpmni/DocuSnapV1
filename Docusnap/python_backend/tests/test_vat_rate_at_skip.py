"""tests/test_vat_rate_at_skip.py — VAT_RATE_AT_SKIP (reggie 2026-08-12, DEFAULT OFF).

THE BUG. A columned totals row reads "VAT @ 20%    £77.55". The bare "VAT" label matches, the
4+-space column split yields ["@ 20%", "£77.55"], and the rate-annotation segment skip — built for
"(10%):" / bare "20%" — fails its fullmatch on the leading '@'. "@ 20%" is taken as the value, dies
at currency validation, and the field commits NOTHING: MISSING(tax) (Silverbeck 0016), starving the
Stage-4 reconcile and the verified badge. The no-gap single-segment case already worked (search +
_clean_value); the starvation is specific to the COLUMNED reconstruction.

THE FIX. One char-class widening, flag-gated: the annotation may open with '(' OR '@', and '@'
joins the punctuation-residue class. The skip is only ever consulted while a FOLLOWING segment
exists, so it can never eat a last/only value column — pinned below.

End-to-end through keyword.extract_fields (the vat_reg_not_amount harness pattern — a
predicate-only test greens even when the arming is threaded wrongly).

Run: py -3.12 python_backend/tests/test_vat_rate_at_skip.py
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extraction import keyword          # noqa: E402

PATTERNS = json.loads((Path(__file__).resolve().parents[2] / 'config' /
                       'keyword_patterns.json').read_text(encoding='utf-8'))

FAILURES = []


def check(name, cond, detail=''):
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name}  {detail}')
        FAILURES.append(name)


def vat_of(text, on):
    prev = os.environ.get('VAT_RATE_AT_SKIP')
    if on:
        os.environ['VAT_RATE_AT_SKIP'] = '1'
    else:
        os.environ.pop('VAT_RATE_AT_SKIP', None)
    try:
        got = keyword.extract_fields(text, ['vat_tax'], PATTERNS) or {}
    finally:
        if prev is None:
            os.environ.pop('VAT_RATE_AT_SKIP', None)
        else:
            os.environ['VAT_RATE_AT_SKIP'] = prev
    d = got.get('vat_tax') or {}
    return d.get('value')


# The columned exhibit: 4+-space gap between the rate annotation and the amount.
AT_GAP = "Subtotal    £387.75\nVAT @ 20%    £77.55\nTotal Due    £465.30"

print('1. OFF — today: the @-rate column is taken as the value and dies at validation')
v = vat_of(AT_GAP, on=False)
check('OFF: "VAT @ 20% | £77.55" commits NOTHING (the starved class)', not v, f'got {v!r}')

print('2. ON — the @-rate annotation is skipped to the amount column')
v = vat_of(AT_GAP, on=True)
check('ON: reads £77.55', v is not None and '77.55' in str(v), f'got {v!r}')
v = vat_of("VAT @20%    77.55", on=True)
check('ON: tight "@20%" form also skipped', v is not None and '77.55' in str(v), f'got {v!r}')

print('3. The shipped forms are UNCHANGED in both arms')
for on in (False, True):
    v = vat_of("VAT (20%):    £64.56", on=on)
    check(f'"(20%)" skip works (on={on})', v is not None and '64.56' in str(v), f'got {v!r}')
    v = vat_of("VAT @ 20% £77.55", on=on)
    check(f'no-gap single segment reads the amount (on={on})', v is not None and '77.55' in str(v), f'got {v!r}')

print('4. The skip can never eat a LAST/ONLY segment (fail-toward-review pin)')
v = vat_of("VAT    @ 20%", on=True)
check('rate as the last segment: not skipped, fails validation, field stays empty',
      not v, f'got {v!r}')

print()
if FAILURES:
    print(f'{len(FAILURES)} FAILED')
    sys.exit(1)
print('ALL PASS')
