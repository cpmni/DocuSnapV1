"""test_money_strict_shape.py — the STRICT money predicates + the corroboration record's format-invalid
witness discount (2026-08-30, reggie design → Oracle).

WHY: `validator.parse_amount` and `validation_patterns.currency` are SEARCHES — a garbled zone read like
'£9 32632.76' "parses" as 9.0 and passes every loose gate, so it was recorded as a corroboration DISSENT
(8 of the 10 money dissents stored in the owner's DB were this class) and blocked `_corrob_licensed` for
no evidential reason. One whole-string predicate now serves the record discount, the Stage-0.5
format-fail yield's strict currency leg and the re-slice witness STOP.

Run: py -3.12 python_backend/tests/test_money_strict_shape.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import number_format as NF, engine as E, template_mapper as TM  # noqa: E402

fails = []


def check(label, ok):
    print(f"  {'OK ' if ok else 'BAD'} {label}")
    if not ok:
        fails.append(label)


print("money_strict_shape — accept:")
for s in ['2,363.76', '£2,363.76', '2363.76', '2,363.76 GBP', 'GBP2,363.76', '-£1.00', '£-1.00', '(160.32)',
          '160.32-', '160.32 CR', '2 363.76', '2, 363.76', '5,767 71', '1205', '1,205', '0,603.44',
          '£1,205.58', '-586.22', '(97.70)', '15,707.84']:
    check(f"accept {s!r}", NF.money_strict_shape(s))
print("money_strict_shape — reject (the discounted-witness class):")
for s in ['9 32632.76', '£9 32632.76', 'C9,262.76', '£2.205.60', '£0/2.0U', '3.765.72', '1,2345.67', '12.345',
          'L922.14', 'O.00', '--160.32', 'Total', '2,363.76 Total due', '', None, '£236376 x']:
    check(f"reject {s!r}", not NF.money_strict_shape(s))
# KNOWN NON-DISCOUNT (by the shipped cleaners' contract, pinned so nobody "fixes" it silently): a space-split
# the respacing pass can rejoin ('£9 242 76' → '£9,242.76' via rule 1 + rule 3) is a VALID shape here —
# deterministically indistinguishable from an OCR-split real amount, so it stays a live dissent.
check("known non-discount: '£9 242 76' respaces to a valid amount (stays a dissent)", NF.money_strict_shape('£9 242 76'))
print("region:")
NF.set_format('continental')
check("continental '2.363,76' accepted under continental", NF.money_strict_shape('2.363,76'))
check("continental documented trade-off: '1.234' (no decimals) is NOT recognised", not NF.money_strict_shape('1.234'))
NF.set_format('french')
check("french '2 363,76' accepted under french", NF.money_strict_shape('2 363,76'))
NF.set_format('indian')
check("indian '1,05,296.00' accepted under indian", NF.money_strict_shape('1,05,296.00'))
NF.set_format('anglo')
check("indian grouping NOT accepted under anglo", not NF.money_strict_shape('1,05,296.00'))

print("money_cents:")
check("2,363.76 -> 236376 positive", NF.money_cents('2,363.76') == (236376, False))
check("£2,363.76 == 2,363.76 GBP", NF.money_cents('£2,363.76') == NF.money_cents('2,363.76 GBP'))
check("1,205 == 1205.00", NF.money_cents('1,205') == NF.money_cents('1205.00'))
check("2,363.7 != 2,363.76 (a dropped digit is a different amount)", NF.money_cents('2,363.7') != NF.money_cents('2,363.76'))
check("-160.32 is negative", NF.money_cents('-160.32') == (16032, True))
check("(97.70) is negative", NF.money_cents('(97.70)') == (9770, True))
check("160.32 CR is negative", NF.money_cents('160.32 CR') == (16032, True))
check("garbage -> None", NF.money_cents('9 32632.76') is None)
check("template_mapper._money_wellformed is the hoisted predicate (snap-proof pins unchanged)",
      TM._money_wellformed is NF.money_wellformed and TM._money_wellformed('0,603.44') and not TM._money_wellformed('3.765.72'))

print("format_invalid_witness:")
check("currency exhibit -> invalid", E.format_invalid_witness('9 32632.76', 'currency', 'total_amount'))
check("currency 'C9,262.76' -> invalid", E.format_invalid_witness('C9,262.76', 'currency'))
check("currency '£2.205.60' -> invalid", E.format_invalid_witness('£2.205.60', 'currency'))
check("currency '29,242.76' (a VALID garble) -> NOT invalid (stays a live dissent)", not E.format_invalid_witness('29,242.76', 'currency'))
check("date '17/12/2026 :' -> valid", not E.format_invalid_witness('17/12/2026 :', 'date'))
check("date '17/12/202' -> invalid", E.format_invalid_witness('17/12/202', 'date'))
check("date '9 32632.76' -> invalid", E.format_invalid_witness('9 32632.76', 'date'))
check("code 'Account' -> NEVER discounted (no deterministic rule)", not E.format_invalid_witness('Account', 'alphanumeric', 'po_number'))
check("name-like -> never", not E.format_invalid_witness('Zzz Q', 'text', 'customer_name'))
check("empty -> False", not E.format_invalid_witness('', 'currency'))

print("_build_corroboration_emit — discount (CORROB_DISCOUNT_INVALID_WITNESS):")


class _Eng:
    pass


def emit(results, cands, val_types=None):
    e = _Eng()
    e._field_candidates = cands
    if val_types is not None:
        e._val_types = val_types
    return E.ExtractionEngine._build_corroboration_emit(e, results)


res = {'total_amount': {'value': '2,363.76', 'method': 'keyword_override', 'confidence': 93}}
cands = {'total_amount': [{'stage': '0.5_mapping', 'method': 'template_mapping', 'value': '9 32632.76', 'confidence': 90},
                          {'stage': '1_keyword', 'method': 'keyword_override', 'value': '£2,363.76', 'confidence': 93}]}
VT = {'total_amount': 'currency'}
r0 = emit(res, cands, VT)['total_amount']
check("OFF: the garble is a DISSENT (today's record)", r0['disagree'] == [{'family': 'mapping', 'value': '9 32632.76'}] and 'discounted' not in r0)
os.environ['CORROB_DISCOUNT_INVALID_WITNESS'] = '1'
try:
    r1 = emit(res, cands, VT)['total_amount']
    check("ON: the garble is DISCOUNTED, not a dissent", r1['disagree'] == [] and r1.get('discounted') == [{'family': 'mapping', 'value': '9 32632.76', 'reason': 'currency_format_invalid'}])
    check("ON: discount alone does NOT license (independent_agree stays False)", r1['independent_agree'] is False and not E._corrob_licensed(r1))
    cands2 = {'total_amount': cands['total_amount'] + [{'stage': '2_anchor', 'method': 'anchor_inline', 'value': '2,363.76', 'confidence': 88}]}
    r2 = emit(res, cands2, VT)['total_amount']
    check("ON + an independent crop read agrees -> licensed", r2['agree'] == ['crop'] and E._corrob_licensed(r2))
    r3 = emit({'total_amount': {'value': '2,363.76', 'method': 'keyword_override', 'confidence': 93}},
              {'total_amount': [{'stage': '0.5_mapping', 'method': 'template_mapping', 'value': '29,242.76', 'confidence': 90}]}, VT)['total_amount']
    check("ON: a VALID different amount stays a genuine dissent", r3['disagree'] == [{'family': 'mapping', 'value': '29,242.76'}] and 'discounted' not in r3)
    r4 = emit(res, cands)['total_amount']   # no _val_types on self (a bare unit-test self)
    check("ON but no field types known -> byte-identical to OFF (fail-closed)", r4['disagree'] == r0['disagree'] and 'discounted' not in r4)
    rd = emit({'invoice_date': {'value': '17-12-2026', 'method': 'template_mapping', 'confidence': 94}},
              {'invoice_date': [{'stage': '1_keyword', 'method': 'keyword', 'value': '17/12/202', 'confidence': 80}]},
              {'invoice_date': 'date'})['invoice_date']
    # Oracle C7 (2026-08-30): CURRENCY-ONLY in v1 — a date ROLE's record feeds live JS filing gates
    # (trust_role_disagreement_refuse, corroboration auto-file); the date leg of the predicate stays pinned
    # above and is routed at the emit only after its own census.
    check("ON: an unparseable DATE witness STAYS a dissent in v1 (currency-only routing)",
          rd['disagree'] == [{'family': 'keyword', 'value': '17/12/202'}] and 'discounted' not in rd)
    rc = emit({'po_number': {'value': 'PO-1', 'method': 'template_mapping', 'confidence': 90}},
              {'po_number': [{'stage': '1_keyword', 'method': 'keyword', 'value': 'Account', 'confidence': 80}]},
              {'po_number': 'alphanumeric'})['po_number']
    check("ON: a code witness is NEVER discounted", rc['disagree'] == [{'family': 'keyword', 'value': 'Account'}])
finally:
    os.environ.pop('CORROB_DISCOUNT_INVALID_WITNESS', None)

print("_stage05_format_fails — strict money leg (TEMPLATE_FORMAT_FAIL_YIELD_STRICT_MONEY):")
FP = {'total_amount': {'validation': 'currency'}}
check("legacy leg: '£9 32632.76' PASSES (the documented hole)", not E._stage05_format_fails('£9 32632.76', 'total_amount', 'currency', FP, {}))
E._FORMAT_FAIL_STRICT_MONEY_ON = True
try:
    check("strict leg: '£9 32632.76' FAILS", E._stage05_format_fails('£9 32632.76', 'total_amount', 'currency', FP, {}))
    check("strict leg: '-3 5982.70' FAILS (the docstring's claim, now true)", E._stage05_format_fails('-3 5982.70', 'total_amount', 'currency', FP, {}))
    check("strict leg: '£2.205.60' FAILS", E._stage05_format_fails('£2.205.60', 'total_amount', 'currency', FP, {}))
    check("strict leg: '-£662.18' passes", not E._stage05_format_fails('-£662.18', 'total_amount', 'currency', FP, {}))
    check("strict leg: '£-662.18' passes", not E._stage05_format_fails('£-662.18', 'total_amount', 'currency', FP, {}))
    check("strict leg: '29,242.76' passes (valid garble — not a FORMAT failure)", not E._stage05_format_fails('29,242.76', 'total_amount', 'currency', FP, {}))
    check("strict leg: 'L922.14' still FAILS", E._stage05_format_fails('L922.14', 'total_amount', 'currency', FP, {}))
    check("strict leg: keyword challenger 'Tel 01632' FAILS too (never adopted)", E._stage05_format_fails('Tel 01632', 'total_amount', 'currency', FP, {}))
finally:
    E._FORMAT_FAIL_STRICT_MONEY_ON = False
check("legacy leg restored: '-£662.18' passes", not E._stage05_format_fails('-£662.18', 'total_amount', 'currency', FP, {}))

print(f"\n{'FAIL ' + str(len(fails)) if fails else 'test_money_strict_shape: all checks passed'}")
sys.exit(1 if fails else 0)
