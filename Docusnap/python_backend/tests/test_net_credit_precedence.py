"""tests/test_net_credit_precedence.py — Oracle C1 (2026-08-07, BLOCKING).

A SIGN incoherence outranks a MAGNITUDE one.

THE SEAM. `validator.py:727` refuses to overwrite an existing validation_note, and
`_flag_net_misread_total` runs BEFORE Stage 4 — so a net-misread note pre-empts the credit-sign note
entirely. That matters because `_net_misread_verdict` is sign-BLIND (parse_amount's CURRENCY_RE drops
the minus) and a credit note whose taught total box sits on the NET row satisfies total≈subtotal with
a larger candidate — exactly the layout the net flag targets. The operator would then be told "a
larger total (£Y) was also found; please check which is the real total", with no mention of the sign
and with £Y itself sign-stripped, so the likeliest action files a credit note as a LARGER POSITIVE
charge: the 2026-08-06 incident, with the software recommending it.

This test PINS the precedence. It is written to FAIL on the pre-C1 build.

Run: cd python_backend && py -3.12 tests/test_net_credit_precedence.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAILURES = []


def check(name, cond, detail=''):
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name}  {detail}')
        FAILURES.append(name)


def run_case(credit_expected, net_on, sign_on):
    """Build the exact layout Oracle specified — a credit-typed doc whose total sits on the net row,
    with a larger VAT-plausible candidate — and return the note the total ends up carrying."""
    os.environ['NET_MISREAD_TOTAL_FLAG'] = '1' if net_on else '0'
    os.environ['CREDIT_SIGN_COHERENCE'] = '1' if sign_on else '0'
    for m in [m for m in list(sys.modules) if m.startswith('extraction')]:
        del sys.modules[m]                       # both flags are read at import
    from extraction import engine as _e, validator as _v

    results = {
        'total_amount': {'value': '854.70', 'raw_value': '854.70', 'confidence': 93, 'method': 'template_mapping'},
        'subtotal':     {'value': '854.70', 'confidence': 87, 'method': 'shadow_reconcile'},
    }
    eng = _e.ExtractionEngine.__new__(_e.ExtractionEngine)
    eng._trace = None
    eng._t = lambda *a, **k: None
    eng._field_candidates = {'total_amount': [{'value': '1,025.64', 'confidence': 80, 'method': 'keyword'}]}
    field_defs = [{'key': 'total_amount', 'type': 'currency'}, {'key': 'subtotal', 'type': 'currency'}]
    try:
        eng._flag_net_misread_total(results, field_defs, credit_expected)
    except TypeError:
        # pre-C1 signature: the helper cannot even see credit_expected
        eng._flag_net_misread_total(results, field_defs)
    net_note = (results['total_amount'].get('validation_note') or '').strip()

    out = _v.validate_and_adjust(results, field_defs, credit_expected=credit_expected)
    final = (out['total_amount'].get('validation_note') or '').strip()
    return net_note, final


print('== C1: on a CREDIT-typed doc, the credit-sign note must survive ==')
net_note, final = run_case(credit_expected=True, net_on=True, sign_on=True)
check('the net-misread helper ABSTAINS on a credit-sign-noteworthy total',
      not net_note, f'net helper wrote: {net_note[:70]!r}')
check('the committed note mentions the SIGN, not just the magnitude',
      'negative' in final.lower() or 'credit note' in final.lower(),
      f'committed note: {final[:90]!r}')
check('the committed note is NOT the part-total note alone',
      'part-total' not in final.lower() or 'negative' in final.lower(),
      f'committed note: {final[:90]!r}')

print('\n== the magnitude flag still works where no sign question exists ==')
# Same layout, but an INVOICE-typed doc: no sign incoherence, so the net note is the right one.
net_note2, final2 = run_case(credit_expected=False, net_on=True, sign_on=True)
check('an invoice-typed net misread STILL gets the part-total note',
      bool(net_note2) and 'part-total' in final2.lower(),
      f'net={net_note2[:60]!r} final={final2[:80]!r}')

print('\n== both flags OFF stays byte-identical ==')
net_note3, final3 = run_case(credit_expected=True, net_on=False, sign_on=False)
check('no note at all when both switches are off', not net_note3 and not final3,
      f'net={net_note3[:50]!r} final={final3[:50]!r}')


def main():
    print(f'\n{"-" * 68}')
    if FAILURES:
        print(f'FAILED {len(FAILURES)}: {", ".join(FAILURES)}')
    else:
        print('all green')
    return len(FAILURES)


if __name__ == '__main__':
    sys.exit(main())
