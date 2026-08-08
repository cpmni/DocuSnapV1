"""test_same_supplier_layout_gate.py — SAME_SUPPLIER_LAYOUT_GATE (gary-designed, DARK, default OFF).

A same-supplier authoritative rigid ABSOLUTE read is certified Tier-A on caption PRESENCE alone, so a
digital doc that reuses a scanned template's geometry reads the wrong region and can auto-file a wrong
value silently (the digital<->scanned bleed class). The gate, when armed, additionally requires the
caption at the TAUGHT position (looser relocate budget + offset-present precondition), failing a
displaced read toward review. This pins the mechanism + the OFF-is-inert discipline; the FLIP is
gated on Oracle + a realdoc M=0 run with the switch ON (see pendingfeatures.md).

Run:  py -3.12 python_backend/tests/test_same_supplier_layout_gate.py
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)   # embeddable-python: never bare-import; seat the backend dir first

from extraction import anchor   # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


# ── The predicate the gate leans on — at the LOOSER same-supplier relocate budget ──────────────
# taught value centre (0.5, 0.5), offset (0.10, 0.05) → expected label top-left (0.40, 0.45).
VX, VY, ODX, ODY = 0.5, 0.5, 0.10, 0.05
TOL = dict(tol_x=anchor._RELOC_TOL_X, tol_y=anchor._RELOC_TOL_Y)

aligned = {"label_box": {"x_norm": 0.41, "y_norm": 0.46}}   # ~0.01 off → same layout
check("aligned caption is AT the taught position (own-layout read keeps winning)",
      anchor._located_at_taught_position(aligned, VX, VY, ODX, ODY, **TOL) is True)

displaced = {"label_box": {"x_norm": 0.75, "y_norm": 0.46}}  # ΔX 0.35 > 0.22 → different layout
check("a caption displaced past the relocate budget is NOT at the taught position (→ review)",
      anchor._located_at_taught_position(displaced, VX, VY, ODX, ODY, **TOL) is False)

check("a legacy anchor with NO offset can't be placed → predicate False (precondition also guards)",
      anchor._located_at_taught_position(aligned, VX, VY, None, None, **TOL) is False)

# ── Source discipline: the gate is env-flagged, uses the looser budget + offset precondition, is a
# demotion-only (located_ok=False), and defaults OFF so an unset install is byte-identical. ─────
src = open(os.path.join(_BACKEND, "extraction", "anchor.py"), encoding="utf-8").read()
gate = src[src.index("SAME_SUPPLIER_LAYOUT_GATE"):]
gate = gate[:gate.index("HEADING-GARBLE NAME DEMOTION")]   # bound to the elif block

check("the gate is an env kill-switch defaulting OFF",
      'os.environ.get("SAME_SUPPLIER_LAYOUT_GATE", "0") != "0"' in gate)
check("the gate requires the offset-present precondition (legacy no-offset anchors exempt)",
      'anchor.get("offset_dx_norm") is not None' in gate
      and 'anchor.get("offset_dy_norm") is not None' in gate)
check("the gate uses the LOOSER same-supplier relocate budget, not the tight same-layout tol",
      "tol_x=_RELOC_TOL_X" in gate and "tol_y=_RELOC_TOL_Y" in gate)
check("the gate is demotion-only (located_ok = False; value still commits capped / loses, never blanked)",
      "located_ok = False" in gate)
check("it is an elif on the cross-supplier branch (same-supplier path only — cross-supplier unchanged)",
      gate.lstrip().startswith("(") or "elif (located_ok" in src[:src.index("HEADING-GARBLE NAME DEMOTION")])

print(f"\n{fails} FAILED" if fails else "\nAll SAME_SUPPLIER_LAYOUT_GATE pins passed")
sys.exit(1 if fails else 0)
