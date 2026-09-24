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
# mig 214 reliance (Oracle C3, 2026-09-24): the taught-name disagreement refusal in trust.js does NO punctuation fold of
# its own — it relies on this record. EDGE punctuation is already folded by the shared normaliser (`Ltd.` == `Ltd`);
# an INTERNAL difference (`& Company` vs `and Company`) is a real disagreement by design (documented trade-off).
check("names: 'Ashcombe Care Homes Ltd.' == 'Ashcombe Care Homes Ltd' (edge punctuation folded)", E._corrob_values_agree('Ashcombe Care Homes Ltd.', 'Ashcombe Care Homes Ltd'))
check("names: 'Harvey & Company' vs 'Harvey and Company' DISAGREE (internal difference, by design)", not E._corrob_values_agree('Harvey & Company', 'Harvey and Company'))
check("names: 'Fernbank Veterinary Clinic' vs 'Fembank Veterinary Clinic' DISAGREE (the pinned trade-off: no rn->m fold)", not E._corrob_values_agree('Fernbank Veterinary Clinic', 'Fembank Veterinary Clinic'))
check("non-dates: 'INV-1' != 'INV-2'", not E._corrob_values_agree('INV-1', 'INV-2'))
check("a date vs a non-date never folds", not E._corrob_values_agree('17/12/2026', 'INV-1712'))
os.environ['FIELD_CORROBORATION_DATE_FOLD'] = '0'
check("kill switch: '17/12/2026' vs '17-12-2026' disagree again (the old compare)", not E._corrob_values_agree('17/12/2026', '17-12-2026'))
del os.environ['FIELD_CORROBORATION_DATE_FOLD']

# CORROB_DATE_FOLD_WIDE (2026-09-22; gary → Oracle SIGN-OFF-W/COND): a worded / month-name date form
# ('November 2, 2026') fails the numeric shape gate, so the SAME calendar date read two ways was logged as a
# page-family DISAGREEMENT → held forever (`disagreeing-read`) + never corroborated (the Print Tracker flood).
# ON => fall through to the SAME strict parse_date fold; OFF => byte-identical.
print("\n_corrob_values_agree — CORROB_DATE_FOLD_WIDE (worded / month-name dates):")
check("OFF (default): 'November 2, 2026' vs '02-11-2026' DISAGREE (byte-identical to before)",
      not E._corrob_values_agree('November 2, 2026', '02-11-2026'))
os.environ['CORROB_DATE_FOLD_WIDE'] = '1'
check("ON: 'November 2, 2026' vs '02-11-2026' AGREE (same calendar date, different format — the heal)",
      E._corrob_values_agree('November 2, 2026', '02-11-2026'))
check("ON: 'Nov 2, 2026' vs '02-11-2026' AGREE (abbreviated month form)",
      E._corrob_values_agree('Nov 2, 2026', '02-11-2026'))
check("ON: 'March 4, 2026' vs '02-11-2026' DISAGREE (different day — PIN the trade-off)",
      not E._corrob_values_agree('March 4, 2026', '02-11-2026'))
check("ON: '11-02-2026' vs 'November 2, 2026' DISAGREE (dmy polarity 11 Feb != 2 Nov — PIN)",
      not E._corrob_values_agree('11-02-2026', 'November 2, 2026'))
check("ON: fail-closed — 'Novaber 2, 2026' (typo) vs '02-11-2026' DISAGREE (unparseable side)",
      not E._corrob_values_agree('Novaber 2, 2026', '02-11-2026'))
check("ON: a CODE pair is unaffected — 'DN-93159' vs 'N-93159' DISAGREE (parse_date None → self-scoped out)",
      not E._corrob_values_agree('DN-93159', 'N-93159'))
del os.environ['CORROB_DATE_FOLD_WIDE']

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
