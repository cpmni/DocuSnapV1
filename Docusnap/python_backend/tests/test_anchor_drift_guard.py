#!/usr/bin/env python3
"""
tests/test_anchor_drift_guard.py
--------------------------------
The labelled-free-text DRIFT GUARD's detector (anchor._value_drifted_from_box): a
rigid crop that drifted onto a DIFFERENT row reads a plausible word that passes the
loose free-text gate, so the value must be re-read beside the LOCATED label. The
detector flags the case where the value's expected position (located label + taught
offset) is well off the rigid box's stored centre — conservatively, so a correctly
placed read is never flagged, and legacy NULL-offset anchors are inert.

    py -3.12 python_backend/tests/test_anchor_drift_guard.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.anchor import _value_drifted_from_box, _DRIFT_FLOOR  # noqa: E402

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


# h_norm of a one-line value box, e.g. customer field
H = 0.027

print(f"_value_drifted_from_box (floor {_DRIFT_FLOOR}):")

# CORRECTLY PLACED: located label + offset lands ~on the stored centre -> no drift.
# (Customer taught: stored centre y=0.617, offset_dy≈0.005; label located at 0.612.)
check("aligned read NOT flagged",
      _value_drifted_from_box({"y_norm": 0.612}, 0.005, 0.617, H) is False)

# DRIFTED: the real "Entity" row is much higher on this doc; expected value pos is far
# from the stored 0.617 (rigid box now sits on the Make row) -> drift.
check("off-row read flagged",
      _value_drifted_from_box({"y_norm": 0.505}, 0.005, 0.617, H) is True)

# Threshold is max(1.5*H, floor); for a thin one-line box the floor dominates (~0.0405).
check("just under tolerance NOT flagged",
      _value_drifted_from_box({"y_norm": 0.60}, 0.0, 0.617, H) is False)   # |0.60-0.617|=0.017 < 0.0405
check("clearly past tolerance flagged",
      _value_drifted_from_box({"y_norm": 0.55}, 0.0, 0.617, H) is True)    # 0.067 > 0.0405

# LEGACY / GUARD-OFF cases: never flag (so behaviour is byte-identical for these).
check("null offset -> never drift", _value_drifted_from_box({"y_norm": 0.40}, None, 0.617, H) is False)
check("no label_box -> never drift", _value_drifted_from_box(None, 0.005, 0.617, H) is False)
check("empty label_box -> never drift", _value_drifted_from_box({}, 0.005, 0.617, H) is False)

# Bad/garbage inputs are swallowed, not raised.
check("garbage offset -> False (no raise)", _value_drifted_from_box({"y_norm": 0.4}, "x", 0.617, H) is False)

# A taller drawn box widens the tolerance (1.5*h), so a small shift within it isn't drift.
check("tall box tolerates a small shift",
      _value_drifted_from_box({"y_norm": 0.55}, 0.0, 0.60, 0.10) is False)   # 0.05 < 1.5*0.10=0.15

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
