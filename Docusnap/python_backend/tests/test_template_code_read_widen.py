#!/usr/bin/env python3
"""tests/test_template_code_read_widen.py — READ-WIDEN (Slice 1c, 2026-09-09; 007 root cause + gary design).

Page-width variance freezes a taught code/ref box's NORMALISED left edge, so on any docket WIDER than the
teach sample the box clips the leading glyph and a code-shaped garble commits under shape_mode='ignore'.
`_widen_code_read` replaces a shape-INVALID tight read with a shape-VALID wider ROW-BOUNDED re-read of the
SAME spot — and ONLY that.

FIRING ENVELOPE (pinned): the discriminator is `shape_match_score == 1.0`, built on the LENGTH- and
letter-count-INVARIANT folded shape (shape_signature + _fold_shape). So the arc fires when the clip changes
the STRUCTURE — leading letters lost ('-57601' -> '-#####'), a symbol garble ('UN-5033¢' -> '@@-####¢'), a
lost/extra separator. It DELIBERATELY does NOT fire on a same-length letter substitution ('UN-5033' folds to
the same '@@-#' as 'DN-#####') — that is the documented fail-safe (a shape-valid wrong value the shape model
cannot see; left to the corroboration net, never silently swapped here). This test pins BOTH: the heal on a
structural clip AND the no-op on a same-shape near-miss.

Run: py -3.12 python_backend/tests/test_template_code_read_widen.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper as tm
from extraction import format_anomaly_checker as fac

fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1

def entry_for(values):
    """A REAL format entry: the folded shapes shape_match_score matches against (the SAME functions it uses)."""
    return {'shapes': {fac._fold_shape(fac.shape_signature(v)) for v in values}}

LEARNED = entry_for(['DN-50338', 'DN-57601', 'DN-61002'])   # a confirmed DN-##### shape family (folds to '@@-#')
BOX = {"x_norm": 0.8, "y_norm": 0.13, "w_norm": 0.08, "h_norm": 0.015}
VP = {"reference_code": "x"}   # inert — _read_pad_window_code is stubbed

_orig_pad = tm._read_pad_window_code
def widen(tight, pad, *, pad_conf=95, entry=LEARNED, anchor_text=None, on=True):
    tm._CODE_READ_WIDEN_ON = on
    tm._read_pad_window_code = (lambda page, box, vp: (pad, pad_conf)) if pad is not None else (lambda *a: None)
    fl = (lambda fk: entry) if entry is not None else (lambda fk: None)
    try:
        return tm._widen_code_read(None, BOX, tight, "delivery_number", anchor_text, VP, fl)
    finally:
        tm._read_pad_window_code = _orig_pad

# sanity: the discriminator behaves as the arc needs — a STRUCTURAL clip fails the shape, a same-length
# letter substitution does NOT (else the pins below are vacuous / mis-stated).
check('shape: DN-50338 fits; the structural clips -57601 and UN-5033¢ do NOT',
      fac.shape_match_score('DN-50338', LEARNED) == 1.0
      and fac.shape_match_score('-57601', LEARNED) != 1.0
      and fac.shape_match_score('UN-5033¢', LEARNED) != 1.0)
check('shape: the same-length letter substitution UN-5033 folds to the SAME shape (arc cannot see it)',
      fac.shape_match_score('UN-5033', LEARNED) == 1.0)

# HEAL: a structural leading clip is replaced by the shape-valid wider read (the docket_18 exhibit).
check('HEAL: -57601 (leading letters clipped) -> the shape-valid wider read DN-57601',
      widen('-57601', 'DN-57601') == ('DN-57601', 95))
# HEAL: the symbol-garble exhibit (docket_14).
check('HEAL: UN-5033¢ (symbol garble) -> DN-50338',
      widen('UN-5033¢', 'DN-50338') == ('DN-50338', 95))

# BYTE-IDENTICAL: a tight read that already fits the shape is never re-read, regardless of pad.
check('BYTE-IDENTICAL: a tight read that already matches the shape is never re-read (None)',
      widen('DN-50338', 'DN-99999') is None)
# FAIL-SAFE (documented): a same-length letter substitution folds to the learned shape -> arc does NOT
# fire (never silently swaps a shape-valid value; the corroboration net owns this residual).
check('FAIL-SAFE: a same-shape letter substitution (UN-5033) is NOT swapped (None) — documented limit',
      widen('UN-5033', 'DN-50338') is None)

# ABSTAIN / nothing recovered
check("ABSTAIN: _read_pad_window_code None (two-equidistant / no code) -> None (today's FLAG path)",
      widen('-57601', None) is None)
check('nothing recovered: pad norm == tight norm -> None', widen('UN-5033¢', 'UN-5033¢') is None)

# the recovery MUST exactly match the confirmed shape
check('shape-fail recovery: a wider read whose shape != learned is NEVER adopted',
      widen('-57601', 'DN-50338X') is None)

# cold field / joined entry (no shapes) -> fail-closed, never bootstrap
check('cold field: no confirmed shapes -> None (fail-closed, never bootstraps a shape model)',
      widen('-57601', 'DN-57601', entry={'shapes': set()}) is None
      and widen('-57601', 'DN-57601', entry=None) is None)

# label-tail glue defence-in-depth: even a shape-VALID candidate that swallowed the label tail is refused
glued = entry_for(['NoDN50338', 'NoDN57601', 'NoDN61002'])
check('label-glue: a shape-valid candidate that begins with the label tail is refused (defence-in-depth)',
      widen('-57601', 'NoDN50338', entry=glued, anchor_text='Delivery Note No.') is None)

# OFF == byte-identical (the switch is DARK)
check('OFF: the arc never fires when _CODE_READ_WIDEN_ON is False',
      widen('-57601', 'DN-57601', on=False) is None)

# the CALL SITE: scoped to code/ref types + the pure (non-expanded) absolute read, and committed UPSTREAM
# of the inline reconcile so the garble never reaches a downstream healer.
src = (Path(__file__).parent.parent / "extraction" / "template_mapper.py").read_text(encoding="utf-8")
check('call site is scoped to code types + the non-expanded absolute read',
      "_CODE_READ_WIDEN_ON and abs_text and val_type in _CODE_CROSSCHECK_TYPES and not abs_expanded" in src)
check('the widen CALL runs UPSTREAM of the inline-reconcile CALL (before _pick_fuller_code fires)',
      src.index("_w = _widen_code_read(") < src.index("if (abs_text and _INLINE_CODE_RECONCILE_ON"))

tm._CODE_READ_WIDEN_ON = False   # leave the module clean
print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
