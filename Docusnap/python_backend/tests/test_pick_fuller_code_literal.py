"""
Pins FORMAT_VARIANCE_RELAX_REF_INLINE (2026-09-03, gary + Oracle SIGN-OFF-W/COND) — the SIBLING of
FORMAT_VARIANCE_RELAX_REF at a SECOND choke point that BYPASSES _gate_value: _pick_fuller_code's
box-drift `inline_disagree_flag`. When the absolute drawn-box read is garbage and the label-anchored
INLINE read RECOVERED an EXACT confirmed in-scope literal, the disagreement flag is provenance noise —
commit CLEAN (no cap, no note). The Print Tracker exhibit doc121: rigid '10RARNNNAD'@44 (garbage box),
inline '1984800049'@96 (correct, a confirmed literal) — flagged today, should heal.

BINDING GUARD (Oracle R2): fire ONLY when the RIGID dissent is NON-CREDIBLE (rigid_conf present AND
below _INLINE_DISAGREE_RIGID_CREDIBLE_FLOOR). A CREDIBLE rigid read of THIS doc's own value that loses
the conf race to an inline reading a DIFFERENT confirmed serial must STAY flagged (a wrong-device
filing the human should catch) — the exact-literal predicate alone does not separate that case.

RED-first: pre-change code has no INLINE handling, so the doc121 heal (test A) FAILS on it (it mints the
flag). OFF is byte-identical. Entries are built through the REAL build_format_class_index (Oracle C4).

Run:  PYTHONIOENCODING=utf-8 py -3.12 tests/test_pick_fuller_code_literal.py
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

# The live Print Tracker reference_number HUMAN value_counts (machine confirms excluded, as they are at
# runtime). This exact set resolves to a non-freetext (upper_alphanum) class in build_format_class_index
# and threads value_counts — the same entry the live engine hands _pick_fuller_code. '1984800049' is the
# doc121 recovery; 'RFH0738865' is a confirmed literal used as the credible-rigid competitor (R2).
VALUE_COUNTS = {
    'RFH0738865': 3, 'H572413963': 2, '1984800049': 2, 'H7R5326676': 1, 'RGS0512662': 1,
    'VG37308169': 1, '752923124N3M2': 1, 'G726M930140': 1, 'G706M430179': 1, 'G696J500513': 1,
    'C738JB00279': 1, 'RFC9509752': 1, 'C738M125203': 1, 'H573429209': 1, 'H7R5427479': 1,
    'H574951967': 1, 'H574951892': 1, '782923124N3M2': 1, 'H571Y07217': 1,
}
# sample_values in the exact live confirmed_at-DESC order getFieldFormats emits — classify_format is
# order-sensitive at the shape-fold count gate, and this order is what the live engine actually fed the
# mapper for doc121 (so the entry resolves upper_alphanum with value_counts threaded, not freetext).
SAMPLE_VALUES = [
    'RFH0738865', 'H571Y07217', '782923124N3M2', 'H574951892', 'H574951967', 'H572413963',
    'H7R5427479', 'H573429209', 'C738M125203', 'RFC9509752', 'C738JB00279', 'G696J500513',
    'G706M430179', '1984800049', 'G726M930140', '752923124N3M2', 'VG37308169', 'RGS0512662',
    'H7R5326676',
]
FORMATS_DATA = [{
    'supplier_name':   'Print Tracker',
    'document_type':   'print_tracker',
    'field_key':       FK,
    'sample_values':   SAMPLE_VALUES,
    'value_counts':    dict(VALUE_COUNTS),
    'confirmed_count': sum(VALUE_COUNTS.values()),
}]
INDEX = fac.build_format_class_index(FORMATS_DATA)
ENTRY = INDEX.get((SUP, DOC, FK))
LOOKUP = lambda fk: ENTRY if fk == FK else None

# Exhibit-shaped inputs (from the live-engine probe).
RIGID_GARBAGE  = '10RARNNNAD'      # doc121 absolute drawn-box read (drifted)
INLINE_LITERAL = '1984800049'      # doc121 inline recovery — IS a confirmed literal
RIGID_138      = 'DELINJ2Q2Q64'    # doc138 garbage box
INLINE_138     = 'RFHO738865'      # doc138 inline (letter-O misread) — NOT a confirmed literal
CREDIBLE_RIGID = 'RFH0738865'      # a confirmed serial read credibly by the box (R2)
UNSEEN         = 'ZZ99999999'      # never confirmed


def _pick(module, rigid, rigid_conf, inline, inline_conf):
    """Drive the reconcile decision directly. anchor/inline_geom None (no diag markers)."""
    return module._pick_fuller_code(rigid, rigid_conf, inline, inline_conf,
                                    None, 'reference_code', None,
                                    field_key=FK, format_lookup=LOOKUP)

print("=== preconditions ===")
check("entry built via build_format_class_index (non-freetext, has shapes)",
      bool(ENTRY) and bool(ENTRY.get('shapes')))
check("value_counts threaded onto the entry", bool(ENTRY) and bool(ENTRY.get('value_counts')))
check("is_lit True for the doc121 recovery '1984800049'",
      fac.value_is_confirmed_literal(INLINE_LITERAL, ENTRY) is True)
check("is_lit False for the doc138 letter-O misread 'RFHO738865'",
      fac.value_is_confirmed_literal(INLINE_138, ENTRY) is False)
check("is_lit True for the credible-rigid competitor 'RFH0738865'",
      fac.value_is_confirmed_literal(CREDIBLE_RIGID, ENTRY) is True)


print("\n=== OFF: byte-identical (module flag False by default) ===")
os.environ.pop('FORMAT_VARIANCE_RELAX_REF_INLINE', None)
import extraction.template_mapper as tm
tm = importlib.reload(tm)
check("default module flag is OFF", tm._FORMAT_VARIANCE_RELAX_REF_INLINE is False)
_off = _pick(tm, RIGID_GARBAGE, 44.0, INLINE_LITERAL, 96.0)
check("OFF: doc121 stays FLAGGED (legacy inline_disagree_flag)",
      bool(_off) and _off.get('_heal') == 'inline_disagree_flag'
      and _off.get('method', '').endswith('_shapewarn')
      and _off.get('validation_note') == tm._SHAPE_WARN_NOTE
      and _off.get('confidence', 999) <= 70)


print("\n=== ON: suppress ONLY exact confirmed literal + non-credible rigid ===")
os.environ['FORMAT_VARIANCE_RELAX_REF_INLINE'] = '1'
tm = importlib.reload(tm)
check("ON: module flag armed", tm._FORMAT_VARIANCE_RELAX_REF_INLINE is True)

# A) THE WIN — doc121 heals to a clean commit
_a = _pick(tm, RIGID_GARBAGE, 44.0, INLINE_LITERAL, 96.0)
check("A ON: doc121 CLEAN commit (method template_mapping, no note, conf 90)",
      bool(_a) and _a.get('method') == 'template_mapping'
      and not _a.get('validation_note') and _a.get('confidence') == 90)
check("A ON: distinct census marker inline_disagree_literal", bool(_a) and _a.get('_heal') == 'inline_disagree_literal')

# B) SAFETY — doc138 letter-O misread is NOT a literal → stays flagged
_b = _pick(tm, RIGID_138, 51.0, INLINE_138, 67.0)
check("B ON: doc138 non-literal STAYS flagged (letter-O != zero)",
      bool(_b) and _b.get('_heal') == 'inline_disagree_flag'
      and _b.get('method', '').endswith('_shapewarn'))

# C) R2 GUARD — credible rigid reads THIS doc's own serial, inline slid to a DIFFERENT confirmed
#    literal; rigid_conf 82 >= 70 credibility floor → must STAY flagged (accepted-trade-off PIN).
_c = _pick(tm, CREDIBLE_RIGID, 82.0, INLINE_LITERAL, 86.0)
check("C ON: credible competing rigid (82) NOT overturned — stays flagged (R2 guard)",
      bool(_c) and _c.get('_heal') == 'inline_disagree_flag')

# D) fail-toward-flagging — inline is not a confirmed literal
_d = _pick(tm, RIGID_GARBAGE, 44.0, UNSEEN, 96.0)
check("D ON: never-confirmed inline STAYS flagged (fail-toward-review)",
      bool(_d) and _d.get('_heal') == 'inline_disagree_flag')

# E) containment — the conf-race guard is untouched: a literal inline that does NOT out-confidence
#    the rigid keeps the rigid (None). The fix only converts a flag → clean, never overturns keep-rigid.
_e = _pick(tm, RIGID_GARBAGE, 44.0, INLINE_LITERAL, 40.0)
check("E ON: inline_conf <= rigid_conf → keep rigid (None), even for a literal", _e is None)

# F) rigid_conf None (a test stub / no confidence signal) → not eligible → flagged
_f = _pick(tm, RIGID_GARBAGE, None, INLINE_LITERAL, 96.0)
check("F ON: rigid_conf None → not eligible for clean commit → flagged",
      bool(_f) and _f.get('_heal') == 'inline_disagree_flag')

# G) value_counts absent → predicate False → flagged (fail-toward-flagging at the entry level)
_lookup_nc = lambda fk: {'class': fac.UPPER_ALPHANUM, 'shapes': (ENTRY or {}).get('shapes')}
_g = tm._pick_fuller_code(RIGID_GARBAGE, 44.0, INLINE_LITERAL, 96.0, None, 'reference_code', None,
                          field_key=FK, format_lookup=_lookup_nc)
check("G ON: entry without value_counts → flagged", bool(_g) and _g.get('_heal') == 'inline_disagree_flag')

# restore
os.environ.pop('FORMAT_VARIANCE_RELAX_REF_INLINE', None)
importlib.reload(tm)

print(f"\n{_PASS} passed, {_FAIL} failed")
sys.exit(1 if _FAIL else 0)
