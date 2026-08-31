"""
test_corrob_date_fold.py — Chris round 19, Oracle gate item (d) (2026-08-23).

The corroboration record compared a validator-normalised winner ('17-12-2026') with a raw keyword
candidate ('17/12/2026') through _cmp_norm, which never folds date separators — so EVERY date read as
a "disagreement" (independent_agree False on correct rows; no date was ever corroborated), and the four
genuine disagreements on the wrong Copperfield dates were indistinguishable from the artefact.

Pins: separator/padding differences agree; a real different date disagrees; non-dates keep the token
normaliser's verdict; the kill switch restores the old compare; _build_corroboration_emit produces
`agree:['keyword']` / independent_agree True for a same-date keyword candidate and a `disagree` entry
for a different one.

Script-style: PYTHONIOENCODING=utf-8 py -3.12 -m tests.test_corrob_date_fold   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import engine as E  # noqa: E402

fails = 0


def check(label, ok):
    global fails
    print(f"  {'OK ' if ok else 'BAD'} {label}")
    if not ok:
        fails += 1


print("_corrob_values_agree:")
check("'17/12/2026' vs '17-12-2026' agree (the artefact)", E._corrob_values_agree('17/12/2026', '17-12-2026'))
check("'1/2/2026' vs '01-02-2026' agree (padding)", E._corrob_values_agree('1/2/2026', '01-02-2026'))
check("'12/10/2026' vs '02-10-2026' DISAGREE (the real r19 case: keyword right, box wrong)", not E._corrob_values_agree('12/10/2026', '02-10-2026'))
check("non-dates keep the token normaliser: '6 102' == '6102'", E._corrob_values_agree('6 102', '6102'))
check("non-dates: 'INV-1' != 'INV-2'", not E._corrob_values_agree('INV-1', 'INV-2'))
check("a date vs a non-date never folds", not E._corrob_values_agree('17/12/2026', 'INV-1712'))
os.environ['FIELD_CORROBORATION_DATE_FOLD'] = '0'
check("kill switch: '17/12/2026' vs '17-12-2026' disagree again (the old compare)", not E._corrob_values_agree('17/12/2026', '17-12-2026'))
del os.environ['FIELD_CORROBORATION_DATE_FOLD']

print("\n_build_corroboration_emit:")


class _Eng:
    pass


eng = _Eng()
eng._field_candidates = {
    'invoice_date': [
        {'stage': 1, 'method': 'keyword', 'value': '17/12/2026'},
    ],
    'other_date': [
        {'stage': 1, 'method': 'keyword', 'value': '12/10/2026'},
    ],
}
results = {
    'invoice_date': {'value': '17-12-2026', 'method': 'template_mapping', 'confidence': 94},
    'other_date': {'value': '02-10-2026', 'method': 'template_mapping', 'confidence': 94},
    '_meta': 'ignored',
}
out = E.ExtractionEngine._build_corroboration_emit(eng, results)
rec = out.get('invoice_date') or {}
check("a same-date keyword candidate → agree:['keyword'], independent_agree True", rec.get('agree') == ['keyword'] and rec.get('independent_agree') is True and rec.get('disagree') == [])
rec2 = out.get('other_date') or {}
check("a different-date keyword candidate → disagree:[{keyword, '12/10/2026'}], independent_agree False", rec2.get('independent_agree') is False and rec2.get('disagree') == [{'family': 'keyword', 'value': '12/10/2026'}])

print("\nAll corroboration date-fold checks passed." if not fails else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
