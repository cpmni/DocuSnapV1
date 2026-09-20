#!/usr/bin/env python3
"""
tests/test_anchor_code_left_grow.py
-----------------------------------
Pins the env-var parameterisation of `_grow_code_left_read` (mig 192, anchor_code_left_grow). The Stage-2
anchor crosscheck reuses the SAME mig-161 recovery under its OWN dark switch `ANCHOR_CODE_LEFT_GROW`; the
Stage-0.5 template caller keeps self-gating on `TEMPLATE_CODE_LEFT_GROW` (byte-identical). Proven:
  - the recovery FIRES when ANCHOR_CODE_LEFT_GROW=1 (env_var='ANCHOR_CODE_LEFT_GROW');
  - OFF (switch unset) -> None;
  - NO cross-leak: TEMPLATE_CODE_LEFT_GROW=1 but ANCHOR unset, called with env_var='ANCHOR_CODE_LEFT_GROW' -> None;
  - the template caller (default env_var) is unchanged -> still gates on TEMPLATE_CODE_LEFT_GROW;
  - a label-glued recovery is refused through the anchor path too (same guard, reused).

The recovery's own placement/shape guards are pinned in test_template_code_left_grow.py; the anchor DECISION
(converge -> clean, non-converge -> flag) is pinned in test_anchor_crop_crosscheck.py sections 12-16.
    py -3.12 python_backend/tests/test_anchor_code_left_grow.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import format_anomaly_checker as F
from extraction import template_mapper as TM

CONFIRMED = [{"field_key": "reference_number", "supplier_name": "Larkspur Interiors",
              "document_type": "worksheet",
              "sample_values": ["WS-62301", "WS-62288", "WS-62312", "WS-62290"],
              "value_counts": {"WS-62301": 3, "WS-62288": 2, "WS-62312": 2, "WS-62290": 2}}]
ENTRY = F.build_format_class_index(CONFIRMED).get(("larkspur interiors", "worksheet", "reference_number"))

TARGET = {"x_norm": 0.80, "y_norm": 0.150, "w_norm": 0.08, "h_norm": 0.020}
PAD_BOX = {"x_norm": 0.78, "y_norm": 0.150, "w_norm": 0.10, "h_norm": 0.020, "text": "WS-62315"}
LINES = [{"words": [
    {"x_norm": 0.78, "y_norm": 0.150, "w_norm": 0.10, "h_norm": 0.020, "text": "WS-62315"},
    {"x_norm": 0.10, "y_norm": 0.05, "w_norm": 0.20, "h_norm": 0.02, "text": "WORKSHEET"},
    {"x_norm": 0.10, "y_norm": 0.15, "w_norm": 0.14, "h_norm": 0.02, "text": "Reference"}]}]


class _P:
    size = (1723, 2387)


FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")


def _call(env_var, anchor_text="Reference No.", pad=("WS-62315", 88, dict(PAD_BOX)), lines=LINES):
    TM._full_page_lines = lambda *a, **k: lines
    TM._read_pad_window_code = lambda *a, **k: pad
    return TM._grow_code_left_read(_P(), TARGET, "VS-62315", "reference_number", anchor_text,
                                   {"reference_code": None}, (lambda k: ENTRY), (lambda c: lines), {},
                                   env_var=env_var)


def _env(anchor=None, template=None):
    for k, v in (("ANCHOR_CODE_LEFT_GROW", anchor), ("TEMPLATE_CODE_LEFT_GROW", template)):
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


print("anchor_code_left_grow -- env-var parameterisation")

# 1. Fires under the ANCHOR switch.
_env(anchor="1", template=None)
check("ANCHOR_CODE_LEFT_GROW=1 -> recovery fires (WS-62315)", _call("ANCHOR_CODE_LEFT_GROW") == ("WS-62315", 88))

# 2. OFF (anchor switch unset) -> None, byte-identical.
_env(anchor=None, template=None)
check("ANCHOR switch unset -> None", _call("ANCHOR_CODE_LEFT_GROW") is None)

# 3. NO cross-leak: the template switch ON must NOT enable the anchor call.
_env(anchor=None, template="1")
check("TEMPLATE on but ANCHOR off, env_var=ANCHOR -> None (no cross-leak)", _call("ANCHOR_CODE_LEFT_GROW") is None)

# 4. The template caller (default env_var) is unchanged -- gates on TEMPLATE_CODE_LEFT_GROW.
_env(anchor="1", template="1")
check("default env_var + TEMPLATE on -> fires", _call("TEMPLATE_CODE_LEFT_GROW") == ("WS-62315", 88))
_env(anchor="1", template=None)
check("default env_var + TEMPLATE off (ANCHOR on) -> None (template caller not driven by anchor switch)",
      _call("TEMPLATE_CODE_LEFT_GROW") is None)

# 5. A label-glued recovery is refused through the anchor path too (same guard reused).
_env(anchor="1", template=None)
glued_lines = [{"words": [
    {"x_norm": 0.70, "y_norm": 0.150, "w_norm": 0.18, "h_norm": 0.020, "text": "No.WS-62315"},
    {"x_norm": 0.10, "y_norm": 0.15, "w_norm": 0.14, "h_norm": 0.02, "text": "Reference"}]}]
glued_pad = ("No.WS-62315", 88, {"x_norm": 0.70, "y_norm": 0.150, "w_norm": 0.18, "h_norm": 0.020, "text": "No.WS-62315"})
check("label-glued recovery refused (guard applies through the anchor path)",
      _call("ANCHOR_CODE_LEFT_GROW", anchor_text="No.", pad=glued_pad, lines=glued_lines) is None)

_env(anchor=None, template=None)
print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
