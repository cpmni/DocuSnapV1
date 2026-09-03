"""
Pins FORMAT_VARIANCE_RELAX_REF (2026-09-03, gary + Oracle C1a) — the mapper DERIVED-rung
"manually mapped value differs from the usual format" shape-warn is suppressed ONLY when the
read is an EXACT confirmed in-scope literal (the Print Tracker reference_number re-import noise:
a value confirmed before whose fold-shape is a sub-quorum minority in the count-gated `shapes`
set). A never-confirmed value KEEPS the flag + cap + review — the ref is the filename token, so
fail-toward-review (Oracle C1a; docTrustGate's coarse _codeish does NOT re-catch a code bleed).

RED-first: on the pre-change code there is no FORMAT_VARIANCE_RELAX_REF handling, so the
"flag ON suppresses the confirmed literal" assertion (test 2) FAILS. OFF is byte-identical.

Entries are built through the REAL build_format_class_index path (Oracle C4), not a fabricated dict.

Run:  PYTHONIOENCODING=utf-8 py -3.12 tests/test_template_mapper_variance_ref.py
"""
import os, sys, importlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from extraction import format_anomaly_checker as fac

_PASS = 0
_FAIL = 0
def check(name, cond):
    global _PASS, _FAIL
    if cond:
        _PASS += 1
        print(f"  PASS  {name}")
    else:
        _FAIL += 1
        print(f"  FAIL  {name}")


SUP, DOC, FK = 'print tracker', 'print_tracker', 'reference_number'

# A high-variance ref scope: an accepted shape family (AB/CD/EF, 12 docs, one fold-shape) plus a
# minority confirmed literal ('782923124N3M2', 2 docs → below the count-gate) that re-flags.
VALUE_COUNTS = {
    'AB12345678':    5,
    'CD87654321':    4,
    'EF11223344':    3,
    '782923124N3M2': 2,     # the confirmed-but-minority-shape value (mirrors live doc58)
}
FORMATS_DATA = [{
    'supplier_name':   'Print Tracker',
    'document_type':   'print_tracker',
    'field_key':       FK,
    'sample_values':   list(VALUE_COUNTS.keys()),
    'value_counts':    dict(VALUE_COUNTS),
    'confirmed_count': sum(VALUE_COUNTS.values()),
}]

INDEX = fac.build_format_class_index(FORMATS_DATA)
ENTRY = INDEX.get((SUP, DOC, FK))

CONFIRMED_MINORITY = '782923124N3M2'    # IS a confirmed literal; shape below the accept bar
UNSEEN_SAME_SHAPE  = '782923124N3M9'    # NOT confirmed (last digit differs); same structure
ENTRY_NO_COUNTS    = {'class': fac.UPPER_ALPHANUM, 'shapes': (ENTRY or {}).get('shapes')}  # value_counts absent

print("=== preconditions (the shape check must actually fire, membership correct) ===")
check("entry built via build_format_class_index (non-freetext, has shapes)",
      bool(ENTRY) and bool(ENTRY.get('shapes')))
check("value_counts threaded onto the entry",
      bool(ENTRY) and bool(ENTRY.get('value_counts')))
check("check_value FLAGS the confirmed-minority value (low-severity shape miss)",
      bool(ENTRY) and (fac.check_value(CONFIRMED_MINORITY, ENTRY) or {}).get('severity') == 'low')
check("check_value FLAGS the unseen same-shape value (low-severity shape miss)",
      bool(ENTRY) and (fac.check_value(UNSEEN_SAME_SHAPE, ENTRY) or {}).get('severity') == 'low')
check("value_is_confirmed_literal True for the confirmed value",
      fac.value_is_confirmed_literal(CONFIRMED_MINORITY, ENTRY) is True)
check("value_is_confirmed_literal False for the unseen value",
      fac.value_is_confirmed_literal(UNSEEN_SAME_SHAPE, ENTRY) is False)
check("value_is_confirmed_literal False when value_counts absent (fail-toward-flagging)",
      fac.value_is_confirmed_literal(CONFIRMED_MINORITY, ENTRY_NO_COUNTS) is False)
# cosmetic-normalisation match (a re-read differing only in case still counts as the literal)
check("value_is_confirmed_literal matches through the compare-normaliser (case-insensitive)",
      fac.value_is_confirmed_literal('782923124n3m2', ENTRY) is True)


def _gate(module, value):
    """Call the DERIVED-rung gate (shape_mode='flag') with a scope lookup that returns ENTRY.
    val_type=None reaches the shape leg cleanly (only _SELF_VALIDATING_TYPES are excluded);
    the suppression is val_type-independent. Returns shape_warn."""
    lookup = lambda fk: ENTRY if fk == FK else None
    _text, _salvaged, shape_warn = module._gate_value(
        value, None, FK, {}, lookup, shape_mode='flag')
    return shape_warn


print("\n=== OFF: byte-identical (both values flagged; module flag False by default) ===")
os.environ.pop('FORMAT_VARIANCE_RELAX_REF', None)
import extraction.template_mapper as tm
tm = importlib.reload(tm)
check("default module flag is OFF", tm._FORMAT_VARIANCE_RELAX_REF is False)
check("OFF: confirmed-minority still shape_warn=True (legacy)", _gate(tm, CONFIRMED_MINORITY) is True)
check("OFF: unseen still shape_warn=True (legacy)",             _gate(tm, UNSEEN_SAME_SHAPE) is True)

print("\n=== ON: suppress ONLY the exact confirmed literal ===")
os.environ['FORMAT_VARIANCE_RELAX_REF'] = '1'
tm = importlib.reload(tm)
check("ON: module flag armed", tm._FORMAT_VARIANCE_RELAX_REF is True)
check("ON: confirmed-minority shape_warn=False (THE WIN — no cap/note)", _gate(tm, CONFIRMED_MINORITY) is False)
check("ON: unseen (non-literal) shape_warn=True (SAFETY — kept review-bound)", _gate(tm, UNSEEN_SAME_SHAPE) is True)

# restore + reload so the process leaves the module OFF for any downstream import
os.environ.pop('FORMAT_VARIANCE_RELAX_REF', None)
importlib.reload(tm)

print(f"\n{_PASS} passed, {_FAIL} failed")
sys.exit(1 if _FAIL else 0)
