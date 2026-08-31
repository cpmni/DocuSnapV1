#!/usr/bin/env python3
"""tests/test_label_left_clamp.py — ANCHOR_LABEL_LEFT_CLAMP pins (007+Oracle
SIGN-OFF-W/COND 2026-08-01; kill switch DEFAULT OFF, dark until gated).

The label-bleed class: rigid taught crops are built label-blind (+20px fixed pad)
while scans jitter, so 13/16 Saltmarsh crops swallowed the located label's TAIL
("Vo. WS-73541") and the read trifurcated on what the tail OCR'd as. The clamp moves
the crop's LEFT edge to the expected value left — derived in the LOCATED frame
(located label top-left + stored offset − half taught width) — rightward only.

PINNED HERE:
  C1  the FRAME TRAP — the boundary derives from the LOCATED label + stored offset,
      never the taught box. The fixture drifts the page: a taught-frame
      implementation computes a boundary that differs, and the pin FAILS it.
  C2  gate — authoritative + real stored offset + direction right + located label.
  C3  structured val_types only (free-text/currency return None; the type set is
      the caption-strip set, ONE source).
  C4  all four crop sites pass left_limit_norm (source pin) + the label-lock rung's
      type-disjointness is pinned (its types can't clamp today).
  C5  in-crop degenerate reverts to UNCLAMPED — never refuse, never None.
  G3  the edge moves RIGHTWARD only (a left_limit left of the pad is a no-op).
  OFF the switch unarmed ⇒ helper returns None and the rigid site pays NO locate
      (env check is the FIRST condition — source pin).

    cd python_backend && PYTHONIOENCODING=utf-8 py -3.12 tests/test_label_left_clamp.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['ANCHOR_LABEL_LEFT_CLAMP'] = '1'

from PIL import Image

from extraction import anchor as A

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


AUTH = {"last_authoritative_at": "2026-08-01 12:00:00",
        "offset_dx_norm": 0.12, "offset_dy_norm": 0.0,
        "w_norm": 0.10, "h_norm": 0.02}
LOC = {"label_box": {"x_norm": 0.30, "y_norm": 0.50, "w_norm": 0.08, "h_norm": 0.02}}


print('§1 helper gate (C2/C3) — every refusal lane returns None')
ok = A._label_left_limit(LOC, AUTH, "right", "alphanumeric")
check('armed + authoritative + right + structured -> a boundary', ok is not None)
check('non-right direction -> None', A._label_left_limit(LOC, AUTH, "below", "alphanumeric") is None)
check('free-text val_type -> None (C3: ladder/preview regime untouched)',
      A._label_left_limit(LOC, AUTH, "right", "text") is None)
check('currency val_type -> None (C3: _skip_rigid already owns it)',
      A._label_left_limit(LOC, AUTH, "right", "currency") is None)
check('None val_type -> None', A._label_left_limit(LOC, AUTH, "right", None) is None)
_passive = dict(AUTH, last_authoritative_at=None)
check('passive anchor -> None (Tier-A claimants only)',
      A._label_left_limit(LOC, _passive, "right", "alphanumeric") is None)
_no_off = dict(AUTH, offset_dx_norm=None, offset_dy_norm=None)
check('missing offset -> None (value cannot be placed from the label)',
      A._label_left_limit(LOC, _no_off, "right", "alphanumeric") is None)
_zz_off = dict(AUTH, offset_dx_norm=0.0, offset_dy_norm=0.0)
check('zero-zero offset -> None (same bar as _located_at_taught_position)',
      A._label_left_limit(LOC, _zz_off, "right", "alphanumeric") is None)
_no_w = dict(AUTH, w_norm=0.0)
check('no taught width -> None', A._label_left_limit(LOC, _no_w, "right", "alphanumeric") is None)
check('no located label_box -> None', A._label_left_limit({}, AUTH, "right", "alphanumeric") is None)
check('located None -> None', A._label_left_limit(None, AUTH, "right", "alphanumeric") is None)
check('type set is the caption-strip set, ONE source (C3 pin)',
      A._LEFT_CLAMP_TYPES is A._CAPTION_STRIP_TYPES)

print('\n§2 C1 frame math + the FRAME TRAP fixture')
# offset = value_centre − label_top_left. Located label at 0.30 + offset 0.12 puts the
# value CENTRE at 0.42; taught width 0.10 puts its LEFT edge at 0.37.
check('boundary = located_lx + offset_dx − w/2 (0.30+0.12−0.05 = 0.37)',
      abs(A._label_left_limit(LOC, AUTH, "right", "alphanumeric") - 0.37) < 1e-9)
# FRAME TRAP: the page DRIFTED +0.02 — the label was taught at 0.28 (taught value
# centre 0.40 − offset 0.12) but LOCATES at 0.30 on this page. A taught-frame
# implementation derives 0.40−0.05 = 0.35 (the taught box's left edge) and silently
# no-ops on the worst-drift docs. The located frame follows the drift: 0.37.
_taught_frame_boundary = 0.40 - AUTH["w_norm"] / 2.0
_located_frame_boundary = A._label_left_limit(LOC, AUTH, "right", "alphanumeric")
check('C1 FRAME TRAP: a taught-frame boundary (0.35) is NOT what the helper returns',
      abs(_located_frame_boundary - _taught_frame_boundary) > 0.01)
check('C1 FRAME TRAP: the helper follows the LOCATED label (0.37)',
      abs(_located_frame_boundary - 0.37) < 1e-9)

print('\n§3 _crop_and_ocr geometry (capture-pinned; OCR result irrelevant)')
_page = Image.new("L", (1000, 1000), 255)


def _crop_box(left_limit, top_limit=None):
    got = {}
    A._crop_and_ocr(_page, 0.5, 0.5, 0.2, 0.05, "alphanumeric",
                    capture=lambda c: got.setdefault("size", c.size),
                    top_limit_norm=top_limit, left_limit_norm=left_limit)
    return got.get("size")


# Unclamped geometry: cx=500, half_w = 0.2*1000/2 + 20 = 120 -> x1=380, x2=620 (w=240);
# half_h = 0.05*1000/2 + 20 = 45 -> y1=455, y2=545 (h=90).
_base = _crop_box(None)
check('baseline crop is 240x90 (the label-blind pad)', _base == (240, 90))
_clamped = _crop_box(0.42)
check('clamp moves the LEFT edge to 0.42*1000 − 3px guard: width 240 -> 203',
      _clamped == (203, 90))
check('G3 rightward-only: a left_limit LEFT of the pad is a no-op (0.30 -> unclamped)',
      _crop_box(0.30) == (240, 90))
check('C5 degenerate reverts to UNCLAMPED, never refuses (0.95 -> full 240 crop, not None)',
      _crop_box(0.95) == (240, 90))
_twin = _crop_box(0.42, top_limit=0.47)
check('(P)-twin: top clamp (0.47 -> y1 470) and left clamp coexist -> 203x75',
      _twin == (203, 75))

print('\n§4 OFF ⇒ inert (kill switch)')
os.environ['ANCHOR_LABEL_LEFT_CLAMP'] = '0'
check('helper returns None when unarmed', A._label_left_limit(LOC, AUTH, "right", "alphanumeric") is None)
os.environ['ANCHOR_LABEL_LEFT_CLAMP'] = '1'

print('\n§5 source pins (C4 four sites + OFF pays no locate + C3 retry bypass)')
_src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         'extraction', 'anchor.py'), encoding='utf-8').read()
check('C4: all FOUR crop sites pass left_limit_norm (rigid + label-lock + cross-check + drift relo)',
      _src.count('left_limit_norm=_lclamp') == 1
      and _src.count('left_limit_norm=_label_left_limit(_dloc') == 1
      and _src.count('left_limit_norm=_label_left_limit(_xloc') == 1
      and _src.count('left_limit_norm=_label_left_limit(located') == 1)
check('OFF pays no locate: the rigid-site locate is gated on (_want_lclamp or _want_rgrow), '
      'each read from env first — both OFF => no locate (arming-OR, 2026-08-02 right-grow twin)',
      '_want_lclamp = os.environ.get("ANCHOR_LABEL_LEFT_CLAMP", "0") != "0"' in _src
      and 'if ((_want_lclamp or _want_rgrow)\n'
          '                    and direction == "right"' in _src)
check('label-lock rung types stay DISJOINT from the clamp set (the pinned C4 asymmetry: '
      'text/currency rung, structured clamp)',
      not (set(A._LEFT_CLAMP_TYPES) & {None, "text", "multiline_text", "currency"}))
check('C3: the free-text noise retry has NO left_limit param (structured never reaches it)',
      'left_limit' not in _src[_src.index('def _noise_smooth_retry'):
                               _src.index('def _row_band')])
check('rigid clamp needs the frame coincidence check (_located_at_taught_position) '
      'before clamping a TAUGHT-frame crop',
      '_located_at_taught_position(\n                        _cloc' in _src)

print(('\n%d FAILED' % fails) if fails else '\nAll label-left-clamp pins passed')
sys.exit(1 if fails else 0)
