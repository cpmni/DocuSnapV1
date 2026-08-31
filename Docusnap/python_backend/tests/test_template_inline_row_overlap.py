"""Pins for TEMPLATE_INLINE_ROW_OVERLAP — "a taught label-ABOVE mapping may not commit a same-row
harvest" (2026-08-07 NIGHT2; 007 rounds 1+2, proven by arm C = 5 healed / 0 regressed).

`_target_inline_with_anchor` decided "is this taught model an inline key/value row?" against
`max(anchor_h, target_h, _DRIFT_FLOOR)` — a DRIFT constant (0.02 ~ 1.5-3 line pitches on A4) reused
as a SAME-ROW tolerance, so it admitted label-ABOVE mappings the docstring claims it excludes. It is
the sole gate of BOTH `_inline_code_reconcile` call sites (:1241 drift rung, :1880 absolute rung), so
one predicate fix closes both doors; `_inline()` is a third, unswitched door and is guarded here too.

ARMED: tol = (anchor_h + target_h) / 2 — the geometric definition of vertical overlap.

Geometry below is REAL, read from the live DB (read-only census 2026-08-07):
  template 33 Pelican Office Interiors / delivery_note / delivery_number ('Despatch Ref') = LABEL-ABOVE
  template 27 Larkspur Interiors / delivery_note / delivery_number ('Delivery Note No.') = INLINE

Run: py -3.12 python_backend/tests/test_template_inline_row_overlap.py
"""
import importlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


# ── REAL taught geometry ──────────────────────────────────────────────────────────────────────────
# Pelican t33 delivery_number: the exhibit. The boxes do not even overlap vertically (0.0045 gap).
ABOVE_ANCHOR = {"x_norm": 0.06746, "y_norm": 0.19140948, "w_norm": 0.07218, "h_norm": 0.00831354}
ABOVE_TARGET = {"x_norm": 0.06520, "y_norm": 0.20424488, "w_norm": 0.08105, "h_norm": 0.01299378}
# Larkspur t27 delivery_number: a genuine inline row (label left, value right, same line).
INLINE_ANCHOR = {"x_norm": 0.65997, "y_norm": 0.14992734, "w_norm": 0.13846, "h_norm": 0.01165162}
INLINE_TARGET = {"x_norm": 0.80772, "y_norm": 0.14899231, "w_norm": 0.08177, "h_norm": 0.01596083}


def _cy(b):
    return b["y_norm"] + b["h_norm"] / 2.0


D_ABOVE = abs(_cy(ABOVE_ANCHOR) - _cy(ABOVE_TARGET))
D_INLINE = abs(_cy(INLINE_ANCHOR) - _cy(INLINE_TARGET))
TOL_ABOVE = (ABOVE_ANCHOR["h_norm"] + ABOVE_TARGET["h_norm"]) / 2.0
TOL_INLINE = (INLINE_ANCHOR["h_norm"] + INLINE_TARGET["h_norm"]) / 2.0


class FakePage:
    size = (1000, 1000)

    def crop(self, box):
        return box


PAGE = FakePage()


def load(armed):
    """Reload the mapper with the switch in the requested state (module-level getenv)."""
    if armed:
        os.environ['TEMPLATE_INLINE_ROW_OVERLAP'] = '1'
    else:
        os.environ.pop('TEMPLATE_INLINE_ROW_OVERLAP', None)
    import extraction.template_mapper as tm
    importlib.reload(tm)
    return tm


# ══ 1. THE PREDICATE ══════════════════════════════════════════════════════════════════════════════
tm = load(armed=True)
check("switch arms", tm._INLINE_ROW_OVERLAP_ON is True)
check("armed: label-above REFUSED",
      tm._target_inline_with_anchor(ABOVE_ANCHOR, ABOVE_TARGET) is False)
check("armed: true inline row still ADMITTED",
      tm._target_inline_with_anchor(INLINE_ANCHOR, INLINE_TARGET) is True)
# Margin, not a knife edge: the refusal must not depend on the 4th decimal place.
check("armed: label-above refused with >=25%% margin (dcy %.5f vs tol %.5f)" % (D_ABOVE, TOL_ABOVE),
      D_ABOVE > TOL_ABOVE * 1.25)
check("armed: inline admitted with >=5x margin (dcy %.5f vs tol %.5f)" % (D_INLINE, TOL_INLINE),
      D_INLINE * 5 < TOL_INLINE)

# ══ 2. OFF PATH STILL REPRODUCES THE BUG ══════════════════════════════════════════════════════════
# The owner's guardrail: OFF must be byte-identical, which for this defect means the defect is STILL
# THERE. If this pin ever flips to "refused" with the switch off, the change stopped being dark.
tm_off = load(armed=False)
check("OFF: switch disarmed", tm_off._INLINE_ROW_OVERLAP_ON is False)
check("OFF: label-above STILL ADMITTED (the bug, pinned)",
      tm_off._target_inline_with_anchor(ABOVE_ANCHOR, ABOVE_TARGET) is True)
check("OFF: inline row admitted (unchanged)",
      tm_off._target_inline_with_anchor(INLINE_ANCHOR, INLINE_TARGET) is True)
check("OFF: tolerance is still the legacy _DRIFT_FLOOR expression",
      max(ABOVE_ANCHOR["h_norm"], ABOVE_TARGET["h_norm"], tm_off._DRIFT_FLOOR) == tm_off._DRIFT_FLOOR)


# ══ 3. DOORS A + B — BOTH _inline_code_reconcile CALL SITES ═══════════════════════════════════════
# The predicate is the FIRST statement of _inline_code_reconcile, so a refusal returns None before
# any OCR happens — stubs never get touched. Both call sites (:1241 drift rung, :1880 absolute rung)
# enter through this one function, which is why one predicate closes two doors.
def reconcile(tmod, anchor, target):
    def _boom(*a, **k):
        raise AssertionError("reconcile did work after a label-above refusal")
    return tmod._inline_code_reconcile(
        PAGE, "Delivery", anchor, target, "alphanumeric", "delivery_number",
        "Despatch Ref", _boom, _boom, {}, None, {}, None, 0)


tm = load(armed=True)
check("armed: reconcile DECLINES on the label-above mapping (doors A+B)",
      reconcile(tm, ABOVE_ANCHOR, ABOVE_TARGET) is None)
_reached = {"v": False}


def _lines_probe(*a, **k):
    _reached["v"] = True
    return []


tm._inline_code_reconcile(PAGE, "X", INLINE_ANCHOR, INLINE_TARGET, "alphanumeric",
                          "delivery_number", "Delivery Note No.", _lines_probe, _lines_probe,
                          {}, None, {}, None, 0)
check("armed: reconcile still RUNS on a true inline mapping (not a blanket kill)", _reached["v"])


# ══ 4. DOOR C — _inline() inside _relocate_and_read ═══════════════════════════════════════════════
# _inline() has no switch and had no layout guard at all. Drive _relocate_and_read with an
# ocr_text_fn that reads NOTHING, so _geometric() fails its gate and returns None and the inline
# harvest is the rung under test.
LOCATED = {"matched_text": "Despatch Ref",
           "x_norm": 0.06746, "y_norm": 0.19141, "w_norm": 0.07218, "h_norm": 0.00831,
           "label_box": {"x_norm": 0.06746, "y_norm": 0.19141,
                         "w_norm": 0.07218, "h_norm": 0.00831},
           "inline_value": "Delivery",
           "inline_box": {"x_norm": 0.15, "y_norm": 0.19141,
                          "w_norm": 0.08, "h_norm": 0.00831}}
# The SHIPPED alphanumeric pattern (config/keyword_patterns.json) — note it accepts 'Delivery'
# with full coverage, which is precisely why a caption can commit as a code once admitted.
PATTERNS = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}


def relocate(tmod, anchor, target, dx, dy):
    mapping = {"field_key": "delivery_number", "anchor_text": "Despatch Ref",
               "offset_dx_norm": dx, "offset_dy_norm": dy}
    return tmod._relocate_and_read(
        PAGE, mapping, anchor, target, LOCATED, "alphanumeric",
        lambda *a, **k: "",            # geometric read finds nothing -> falls to _inline()
        0.0, PATTERNS, None, None, 0, "delivery_number",
        ocr_lines_fn=None, line_cache={})


tm = load(armed=True)
_off_c = load(armed=False)
check("OFF: door C commits the same-row caption on a label-above mapping (the bug, pinned)",
      (relocate(_off_c, ABOVE_ANCHOR, ABOVE_TARGET, -0.00226, 0.01284) or {}).get("value") == "Delivery")
tm = load(armed=True)
check("armed: door C REFUSES the same-row harvest on a label-above mapping",
      relocate(tm, ABOVE_ANCHOR, ABOVE_TARGET, -0.00226, 0.01284) is None)
check("armed: door C still harvests on a true INLINE mapping",
      (relocate(tm, INLINE_ANCHOR, INLINE_TARGET, 0.14774, -0.00094) or {}).get("value") == "Delivery")

# ── THE PINNED TRADE-OFF ─────────────────────────────────────────────────────────────────────────
# A LEGACY offset-less mapping (dx=dy=0) reaches _inline() as its PRIMARY read and has NO geometric
# model behind it, so guarding it there would delete the read outright rather than route it to
# review. The guard is therefore scoped to `dx or dy`. Anyone who "generalises" it into the legacy
# path breaks this pin — that is the point.
check("armed: LEGACY offset-less mapping keeps _inline() as its primary read (trade-off PINNED)",
      (relocate(tm, ABOVE_ANCHOR, ABOVE_TARGET, 0.0, 0.0) or {}).get("value") == "Delivery")


print()
if FAILED:
    print("FAILED (%d): %s" % (len(FAILED), ", ".join(FAILED)))
    sys.exit(1)
print("ALL PASS")
