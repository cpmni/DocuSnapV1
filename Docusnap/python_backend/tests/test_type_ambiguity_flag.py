"""
test_type_ambiguity_flag.py — FIX A: `_flag_type_ambiguity` lands the HOLD signal so the auto-file
gate blocks (Oracle/gary: trust.isAutoFileEligible honours a persisted validation_note, NOT a bare
_needs_review). Pins: the note lands on a guaranteed-present field; it APPENDS (composes with
_flag_prefix_outlier / branding — Oracle C2); it survives a null ref role (worksheet — Oracle C3);
it sets _needs_review; and it never changes a value (HOLD-only).

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_type_ambiguity_flag.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import ExtractionEngine

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1

# _flag_type_ambiguity uses no self state → call unbound with self=None.
flag = lambda results, ref: ExtractionEngine._flag_type_ambiguity(None, results, ref)
NOTE = 'could not be confirmed'   # substring of the fixed note

def main():
    # 1. Note lands on supplier_name (the guaranteed-present identity field); value untouched.
    r = {'supplier_name': {'value': 'Cascade Water Systems', 'confidence': 95},
         'po_number': {'value': 'PO-24103', 'confidence': 90}}
    flag(r, 'po_number')
    check('note lands on supplier_name', NOTE in (r['supplier_name'].get('validation_note') or ''))
    check('supplier_name VALUE untouched (HOLD-only)', r['supplier_name']['value'] == 'Cascade Water Systems')
    check('_needs_review set', r.get('_needs_review') is True)
    check('the ref field is NOT clobbered when supplier carries the note', not r['po_number'].get('validation_note'))

    # 2. APPEND — an existing note (e.g. from _flag_prefix_outlier) is preserved.
    r2 = {'supplier_name': {'value': 'X', 'confidence': 95, 'validation_note': 'Prefix looks off.'}}
    flag(r2, 'ref')
    note2 = r2['supplier_name']['validation_note']
    check('APPEND: existing note preserved AND ambiguity note added',
          'Prefix looks off.' in note2 and NOTE in note2)

    # 3. No supplier_name → falls back to the ref-role field.
    r3 = {'po_number': {'value': 'PO-24103', 'confidence': 90}}
    flag(r3, 'po_number')
    check('no supplier_name → note lands on the ref-role field', NOTE in (r3['po_number'].get('validation_note') or ''))

    # 4. Null ref role (worksheet, Oracle C3) + no supplier_name → any valued field carries it.
    r4 = {'some_custom_field': {'value': 'v', 'confidence': 80}}
    flag(r4, None)
    check('null ref role → note still lands on a present field (flag never evaporates)',
          NOTE in (r4['some_custom_field'].get('validation_note') or '') and r4.get('_needs_review') is True)

    # 5. Nothing at all → a persisted carrier is synthesised so the note can't vanish.
    r5 = {'_supplier_name': 'Cascade Water Systems'}
    flag(r5, None)
    check('empty results → synthesised supplier_name row carries the note',
          isinstance(r5.get('supplier_name'), dict) and NOTE in (r5['supplier_name'].get('validation_note') or ''))

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
