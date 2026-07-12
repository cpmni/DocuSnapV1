"""Relocation position VETO (anchor.py) - the "remember the taught quadrant" fix.

On a skewed/clipped scan the true caption can fragment below the fuzzy threshold, so the PAGE-WIDE
relocate fallback grabs a same-PREFIX caption in the WRONG COLUMN ("Delivery Note No." -> "Deliver To")
and inline-harvests a wrong-column value - a confident-wrong read no cross-supplier gate catches (a
supplier's own doc bypasses them all). The veto: when a ⊕ anchor carries a usable label->value OFFSET,
verify the RE-LOCATED caption is at its TAUGHT position (value_centre - offset, LOOSER _RELOC tolerances
because this rung EXISTS to follow large legitimate drift); if it landed a whole column away, DROP the
relocation -> the field keeps its weak rigid read -> review. Never selects a value -> fail-toward-review.

007 + reggie designed; Oracle SIGN OFF WITH CONDITIONS (2026-07-12): C1 gate on offset PRESENT+non-zero
as a SEPARATE precondition (the helper also returns False for no-offset, so a naive veto would kill EVERY
legacy anchor); C2 a SEPARATE looser tolerance; C3 on_reject + only sets located=None.

Run:  py -3.12 tests/test_relocation_quadrant.py   (from python_backend/)
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import anchor
from extraction.anchor import (_located_at_taught_position, _RELOC_TOL_X, _RELOC_TOL_Y,
                               _SAME_LAYOUT_TOL_X, _SAME_LAYOUT_TOL_Y)

fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond: fails += 1

# ── C2: the tolerance is a SEPARATE, LOOSER constant (pinned so a future dev can't collapse it back
#        into _SAME_LAYOUT_TOL - Oracle: same-layout PROOF vs same-supplier DRIFT budget are different) ──
check("C2 _RELOC_TOL_X == 0.22 (pinned)", _RELOC_TOL_X == 0.22)
check("C2 _RELOC_TOL_Y == 0.14 (pinned)", _RELOC_TOL_Y == 0.14)
check("C2 _RELOC_TOL_X is LOOSER than _SAME_LAYOUT_TOL_X", _RELOC_TOL_X > _SAME_LAYOUT_TOL_X)
check("C2 _RELOC_TOL_Y is LOOSER than _SAME_LAYOUT_TOL_Y", _RELOC_TOL_Y > _SAME_LAYOUT_TOL_Y)

# ── The position predicate under the RELOCATION tolerances ──────────────────────────────────────
# Cascade delivery_number: value centre (0.831, 0.143), offset (0.195, -0.001) -> expected label
# top-left = value_centre - offset = (0.636, 0.144).
VX, VY, ODX, ODY = 0.831, 0.143, 0.195, -0.001
def loc(lx, ly): return {"label_box": {"x_norm": lx, "y_norm": ly, "w_norm": 0.12, "h_norm": 0.02}}
def at(l): return _located_at_taught_position(l, VX, VY, ODX, ODY, tol_x=_RELOC_TOL_X, tol_y=_RELOC_TOL_Y)

check("the taught 'Delivery Note No.' (0.636,0.144) -> KEPT", at(loc(0.636, 0.144)) is True)
check("the skew grab 'Deliver To' (0.18,0.34) -> VETOED (DX .456, DY .196)", at(loc(0.18, 0.34)) is False)
check("small tilt drift (D0.03,D0.02) -> KEPT", at(loc(0.636 + 0.03, 0.144 + 0.02)) is True)
# Oracle class-1: the relocate rung EXISTS to follow a clipped/shifted scan; a LARGE-but-legit drift
# up to the bound must still be recovered, not false-vetoed.
check("large legit drift within bound (DX0.20<0.22, DY0.12<0.14) -> KEPT",
      at(loc(0.636 + 0.20, 0.144 + 0.12)) is True)
check("beyond X bound (DX0.25>0.22) -> VETOED", at(loc(0.636 + 0.25, 0.144)) is False)
check("beyond Y bound (DY0.16>0.14) -> VETOED", at(loc(0.636, 0.144 + 0.16)) is False)

# ── C1: the load-bearing trap. The helper returns False for BOTH "off position" AND "no offset",
#        so the veto MUST gate on offset present+non-zero SEPARATELY, else every legacy anchor dies. ──
check("C1 helper returns False for NO offset (documents the trap the precondition guards)",
      _located_at_taught_position(loc(0.636, 0.144), VX, VY, None, None) is False)
check("C1 helper returns False for BOTH-zero offset (also can't verify)",
      _located_at_taught_position(loc(0.636, 0.144), VX, VY, 0.0, 0.0) is False)
# The precondition the veto uses (mirrors the helper's own can-verify guard):
def can_verify(odx, ody): return odx is not None and ody is not None and (odx or ody)
check("C1 precondition: (None,None) -> cannot verify -> no veto", can_verify(None, None) is False)
check("C1 precondition: (0.0,0.0) -> cannot verify -> no veto", not can_verify(0.0, 0.0))
check("C1 precondition: real offset -> can verify", bool(can_verify(0.195, -0.001)))
check("C1 precondition: one-axis offset (above/below teach) -> can verify", bool(can_verify(0.0, 0.15)))

# ── Integration: drive extract_with_anchors, stub the locate, prove the veto's downstream effect ──
class _FakePage:
    size = (1000, 1000)
    def crop(self, *a, **k): return self

VP = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}
FP = {"delivery_number": {"validation": "alphanumeric"}}

def _anchor(offset):
    a = {"field_key": "delivery_number", "anchor_label": "Delivery Note No.", "direction": "right",
         "x_norm": 0.831, "y_norm": 0.143, "w_norm": 0.128, "h_norm": 0.02,
         "supplier_name": "Cascade Water Systems", "document_type": "delivery_note",
         "usage_count": 1, "confidence": 0.9}
    if offset is not None:
        a["offset_dx_norm"], a["offset_dy_norm"] = offset
    return a

def run(offset, label_xy):
    """Rigid crop fails (-> relocation fires); _locate_for_relocation is stubbed to 'find' the label
    at label_xy carrying value 'DN-11354'. Returns (result, rejects)."""
    rejects = []
    lx, ly = label_xy
    located = {"label_box": {"x_norm": lx, "y_norm": ly, "w_norm": 0.12, "h_norm": 0.02},
               "inline_value": "DN-11354",
               "inline_box": {"x_norm": lx + 0.20, "y_norm": ly, "w_norm": 0.10, "h_norm": 0.02},
               "matched_text": "Deliver To"}
    o_cao, o_loc = anchor._crop_and_ocr, anchor._locate_for_relocation
    anchor._crop_and_ocr = lambda *a, **k: None            # rigid read weak -> relocation attempted
    anchor._locate_for_relocation = lambda *a, **k: dict(located)
    try:
        # ocr_text deliberately does NOT contain the value, so the stubbed relocation harvest is the
        # ONLY source of "DN-11354" -> a text-search fallback can't mask the veto's effect.
        r = anchor.extract_with_anchors(
            "Delivery Note No. Deliver To Larch Hollow", [_anchor(offset)],
            "Cascade Water Systems", "delivery_note",
            page_images=[_FakePage()], field_patterns=FP, validation_patterns=VP,
            on_reject=lambda fk, m, v, why: rejects.append((fk, m, v, why)))
    finally:
        anchor._crop_and_ocr, anchor._locate_for_relocation = o_cao, o_loc
    return r, rejects

# VETO FIRES: offset present, caption located a whole column away -> relocation dropped, value NOT taken.
r, rej = run((0.195, -0.001), (0.18, 0.34))
check("veto FIRES: wrong-column relocated value NOT committed",
      r.get("delivery_number", {}).get("value") != "DN-11354")
check("veto FIRES: on_reject records label_off_taught_position",
      any(x[0] == "delivery_number" and x[3] == "label_off_taught_position" for x in rej))

# C1 LEGACY INERT: same far locate but NO offset -> veto cannot fire -> relocation proceeds (byte-identical).
r2, rej2 = run(None, (0.18, 0.34))
check("C1 legacy no-offset anchor: relocation PROCEEDS (harvests the value) - byte-identical",
      r2.get("delivery_number", {}).get("value") == "DN-11354")
check("C1 legacy no-offset anchor: NO label_off_taught_position reject",
      not any(x[3] == "label_off_taught_position" for x in rej2))

# VETO PASSES: offset present, caption located AT the taught position -> relocation proceeds.
r3, rej3 = run((0.195, -0.001), (0.636, 0.144))
check("veto PASSES: caption at taught position -> relocation proceeds, value committed",
      r3.get("delivery_number", {}).get("value") == "DN-11354")

print()
print(f"{fails} FAILED" if fails else "All relocation-quadrant checks passed")
sys.exit(1 if fails else 0)
