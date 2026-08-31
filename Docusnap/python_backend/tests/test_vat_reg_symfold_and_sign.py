"""test_vat_reg_symfold_and_sign.py — PINs for the two keyword-mint legs of Chris round-7 card 3
(gary → Oracle SIGN-OFF-W/COND 2026-08-16; both DEFAULT OFF, migration-72 seeds).

B2 — VAT_REG_SYMBOL_CONFUSABLE: the Meadowvale exhibit "VAT Reg No GB 118 $540 63" (the reg's own
'5' misread as '$') used to DISARM the vat-reg guard via its own money-witness veto, minting $540
as a tax amount. Armed, a '$'-only, all-mid-run witness folds '$'→'5' and the existing leg ladder
judges the folded tail ('+symfold'). Hard witnesses (cents/codes) and £/€/¥ and any tail-leading
'$' keep the absolute veto. The guard remains SUPPRESS-ONLY (returns a leg name or None — never a
value; pinned mechanically below).

B1 — MONEY_SIGN_CAPTURE: "£-428.58" matched bare "428.58" (no currency pattern admits a leading
'-'), so a credit-note operand lost its sign at the mint and the reconcile falsely "disagreed"
with a CORRECT signed total. Armed, a single '-' immediately before the matched amount is kept.
parse_amount stays magnitude-only BY DESIGN (pinned — signing it flips total>0 gates
validator-wide).

Run:  py -3.12 python_backend/tests/test_vat_reg_symfold_and_sign.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import keyword  # noqa: E402
from extraction import validator  # noqa: E402

passed = failed = 0


def check(name, ok):
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok  {name}')
    else:
        failed += 1
        print(f'  FAIL {name}')


def tail(t, armed):
    if armed:
        os.environ['VAT_REG_SYMBOL_CONFUSABLE'] = '1'
    else:
        os.environ.pop('VAT_REG_SYMBOL_CONFUSABLE', None)
    try:
        return keyword._vat_identifier_tail(t)
    finally:
        os.environ.pop('VAT_REG_SYMBOL_CONFUSABLE', None)


MEADOWVALE = "Reg No GB 118 $540 63"

print('B2. the symfold carve-out')
check('OFF control: the Meadowvale tail stays VETOED (today, the $ disarms the guard)',
      tail(MEADOWVALE, False) is None)
v = tail(MEADOWVALE, True)
check("ON: the folded reg fires with a '+symfold' verdict", bool(v) and v.endswith('+symfold'))
check('ON: cents group still vetoes (hard witness)', tail('VAT $540.00 due', True) is None)
check('ON: currency CODE still vetoes', tail('GBP 540 63 118', True) is None)
check("ON: tail-LEADING '$' still vetoes (money position — protects OCR-split money)",
      tail('$1 234 567 89', True) is None)
check("ON: a mid-run '£' still vetoes (no digit target in its class)",
      tail('Reg No GB 118 £540 63', True) is None)
check("ON: MIXED witness ($ mid-run PLUS a cents group) still vetoes (Oracle B2-2)",
      tail('GB 118 $540 63 total 12.50', True) is None)
check("ON: MIXED witness ($ mid-run PLUS a leading $) still vetoes",
      tail('$12 GB 118 $540 63', True) is None)
# The suppress-only invariant, mechanically (Oracle B2-1): the guard returns LEG NAMES, never a
# value — the folded '5540' must be unreachable as output from this path.
_all_outputs = [tail(t, a) for a in (False, True) for t in (
    MEADOWVALE, 'VAT GB 774 2093 55', 'Reg No 651 0027 84', '$1 234 567 89', 'VAT $540.00')]
check('suppress-only: every output is a leg name or None — no digits, no folded value',
      all(o is None or (isinstance(o, str) and not any(ch.isdigit() for ch in o))
          for o in _all_outputs))
check('shipped behaviour untouched off the symbol path: "VAT GB 774 2093 55" still fires',
      bool(tail('GB 774 2093 55', False)))

print('B1. money sign capture at _clean_value')
VAL = {'currency': [r"[£$€¥]\s*-?[\d,]+\.?\d{0,2}", r"-?[\d,]+\.\d{2}"]}
# NOTE: the SHIPPED patterns don't admit '-'; this fixture mirrors config/keyword_patterns.json's
# shape closely enough that the '£-428.58' case matches the bare-digits pattern exactly like live.
SHIPPED_VAL = {'currency': [r"[£$€¥]\s*[\d,]+\.?\d{0,2}", r"[\d,]+\.\d{2}"]}


def clean(v, armed, val=SHIPPED_VAL):
    if armed:
        os.environ['MONEY_SIGN_CAPTURE'] = '1'
    else:
        os.environ.pop('MONEY_SIGN_CAPTURE', None)
    try:
        return keyword._clean_value(v, 'currency', val)
    finally:
        os.environ.pop('MONEY_SIGN_CAPTURE', None)


check("OFF control: '£-428.58' loses its sign (today)", clean('£-428.58', False) == '428.58')
check("ON: '£-428.58' keeps the minus", clean('£-428.58', True) == '-428.58')
check("ON: bare '-428.58' keeps the minus", clean('-428.58', True) == '-428.58')
check("ON: spaced dash 'Total - 160.32' stays UNSIGNED (dash not against the digits)",
      clean('Total - 160.32', True) == '160.32')
check("ON: dash-run 'TOTAL------160.32' stays UNSIGNED",
      clean('TOTAL------160.32', True) == '160.32')
check("ON: parens '(428.58)' stay unsigned (accounting negatives are arm 2's flag, this slice)",
      clean('(428.58)', True) == '428.58')
check("ON: a plain positive is untouched", clean('£428.58', True) == '£428.58')
check('parse_amount stays MAGNITUDE-ONLY (pinned — the wrong layer to sign)',
      validator.parse_amount('-428.58') == 428.58)
check('…and _is_negative_value reads the committed string (the sign the C arm compares)',
      validator._is_negative_value('-428.58') is True
      and validator._is_negative_value('428.58') is False)

print(f'\n{"ALL PASS" if failed == 0 else str(failed) + " FAILED"}  ({passed} ok)')
sys.exit(0 if failed == 0 else 1)
