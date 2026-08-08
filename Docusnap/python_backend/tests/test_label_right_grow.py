#!/usr/bin/env python3
"""tests/test_label_right_grow.py — ANCHOR_VALUE_RIGHT_GROW pins (007/oscar/gary +
Oracle SIGN-OFF-W/COND 2026-08-02; kill switch DEFAULT OFF, dark until gated).

The right-chop class: the rigid/relocated crop is sized from the TAUGHT box width,
so a value LONGER than the taught sample chops on the right ("PO-25909" -> the crop
reads "PO-2590!"). The right grow moves the crop's RIGHT edge to the value's REAL
end — MEASURED on this page from located.inline_box (the cluster-selected value
column, next-column-excluded by cluster_value_words) — rightward only. Twin of
ANCHOR_LABEL_LEFT_CLAMP.

PINNED HERE (Oracle conditions, all ship-blocking):
  C-scope   arms ONLY for a REF-like key OR a DATE field that ALSO carries a
            validation pattern -> the STRICT _pattern_coverage credibility branch.
            SEAM B: a non-ref alphanumeric (part_code) or an untyped ref (no
            pattern) must NOT arm — the label-lock rung has NO cross-check backstop,
            so the strict-coverage credibility gate is the sole guard there.
  C1-frame  the boundary is the MEASURED inline_box edge, never the taught box.
  C-grow    x2 moves RIGHTWARD ONLY (+guard); never shrinks, never past the page.
  no-dbl    the dead max_w_norm widen is SKIPPED when a right limit is present.
  merged    the merged-column read ("PO-25909 Qty") is rejected by strict credibility
            (the guard that protects the cross-checkless label-lock rung); the DATE
            substring caveat (Oracle anomaly #2) is pinned so it's not mistaken clean.
  OFF       unarmed -> helper returns None, geometry byte-identical.
  rungs     right grow wired at rigid/label-lock/drift ONLY (admits content -> not at
            the cross-check/registration rungs, which the left clamp DID reach).

    cd python_backend && PYTHONIOENCODING=utf-8 py -3.12 tests/test_label_right_grow.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['ANCHOR_VALUE_RIGHT_GROW'] = '1'

from PIL import Image
from extraction import anchor as A

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


AUTH = {"last_authoritative_at": "2026-08-02 12:00:00",
        "offset_dx_norm": 0.12, "offset_dy_norm": 0.0,
        "w_norm": 0.10, "h_norm": 0.02}
# located value box (inline_box) = MEASURED value column on this page: 0.42..0.52
LOC = {"inline_box": {"x_norm": 0.42, "y_norm": 0.50, "w_norm": 0.10, "h_norm": 0.02},
       "label_box":  {"x_norm": 0.30, "y_norm": 0.50, "w_norm": 0.08, "h_norm": 0.02}}
# realistic validation patterns: PO-25909 fully matches; a UK date matches
VP = {"alphanumeric": [r"[A-Za-z]{1,4}-?\d{3,8}"],
      "date":         [r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}"]}


def R(field_key, located, anchor, direction, val_type, vpats=VP):
    return A._label_right_limit(field_key, located, anchor, direction, val_type, vpats)


print('§1 helper gate (C-scope + SEAM B + authority bar) — every refusal lane returns None')
ok = R("invoice_number", LOC, AUTH, "right", "alphanumeric")
check('ref-like key + pattern + authoritative + right + inline_box -> a boundary', ok is not None)
check('boundary = inline_box right edge (0.42 + 0.10 = 0.52)', abs(ok - 0.52) < 1e-9)
check('DATE field -> None (slice-1b DEFERRED: substring credibility passes a merged date AND '
      "parse_date doesn't strip trailing junk -> would commit dirty; see helper docstring)",
      R("po_date", LOC, AUTH, "right", "date") is None)
check('SEAM B: non-ref alphanumeric key (part_code) -> None (cross-check does NOT fire there)',
      R("part_code", LOC, AUTH, "right", "alphanumeric") is None)
check('SEAM B: ref-like key but NO validation pattern (untyped) -> None (lenient branch, unguarded)',
      R("invoice_number", LOC, AUTH, "right", "alphanumeric", {}) is None)
check('non-right direction -> None', R("invoice_number", LOC, AUTH, "below", "alphanumeric") is None)
check('passive anchor -> None (Tier-A claimants only)',
      R("invoice_number", LOC, dict(AUTH, last_authoritative_at=None), "right", "alphanumeric") is None)
check('missing offset -> None (same authority bar as the left clamp)',
      R("invoice_number", LOC, dict(AUTH, offset_dx_norm=None, offset_dy_norm=None), "right", "alphanumeric") is None)
check('zero-zero offset -> None',
      R("invoice_number", LOC, dict(AUTH, offset_dx_norm=0.0, offset_dy_norm=0.0), "right", "alphanumeric") is None)
check('no inline_box -> None (this is the geometry the fix needs)',
      R("invoice_number", {"label_box": LOC["label_box"]}, AUTH, "right", "alphanumeric") is None)
check('located None -> None', R("invoice_number", None, AUTH, "right", "alphanumeric") is None)

print('\n§2 C1 frame — boundary is the MEASURED inline_box, NOT the taught box')
# widen the TAUGHT box hugely; the returned edge must not move (it comes from inline_box).
check('taught w_norm change does NOT move the boundary (measured, not taught)',
      abs(R("invoice_number", LOC, dict(AUTH, w_norm=0.40), "right", "alphanumeric") - 0.52) < 1e-9)

print('\n§3 _crop_and_ocr geometry (capture-pinned; OCR result irrelevant)')
_page = Image.new("L", (1000, 1000), 255)


def _crop_box(right_limit=None, left_limit=None, max_w=None):
    got = {}
    A._crop_and_ocr(_page, 0.5, 0.5, 0.2, 0.05, "alphanumeric",
                    capture=lambda c: got.setdefault("size", c.size),
                    left_limit_norm=left_limit, right_limit_norm=right_limit, max_w_norm=max_w)
    return got.get("size")


# Unclamped: cx=500, half_w=0.2*1000/2+20=120 -> x1=380,x2=620 (w=240); h=90.
check('baseline crop is 240x90 (the taught-width pad)', _crop_box(None) == (240, 90))
# right grow to 0.70: 700 + 10px guard = 710 -> x2=max(620,710)=710 -> w=710-380=330
check('right grow extends x2 to inline_box edge (0.70 -> 710px, +10 guard): 240 -> 330',
      _crop_box(right_limit=0.70) == (330, 90))
check('C-grow rightward-only: a right_limit LEFT of the pad is a no-op (0.55 -> unchanged 240)',
      _crop_box(right_limit=0.55) == (240, 90))
check('never past the page edge (0.99 -> clamped to 1000): width 620',
      _crop_box(right_limit=0.99) == (620, 90))
# left clamp (0.42 -> x1 417) + right grow (0.70 -> x2 710) coexist -> w 293
check('left clamp + right grow compose (x1 417, x2 710 -> 293x90)',
      _crop_box(right_limit=0.70, left_limit=0.42) == (293, 90))

print('\n§4 no double-apply — max_w_norm widen SKIPPED when a right limit is present')
os.environ['ANCHOR_MAX_CROP_WIDTH'] = '1'
# max_w=0.5 WOULD widen to a ~920px x2 if applied; with right_limit present it must be
# skipped, so the result is the pure right-grow (330), not the max_w geometry.
check('max_w_norm block skipped when right_limit set (result is right-grow 330, not max_w geometry)',
      _crop_box(right_limit=0.70, max_w=0.5) == (330, 90))
os.environ['ANCHOR_MAX_CROP_WIDTH'] = '0'

print('\n§5 merged-column guard (SEAM A: label-lock rung has NO cross-check)')
# The fix trusts inline_box; on a SUB-THRESHOLD gap cluster_value_words merges value+neighbour,
# so inline_box (and the crop) span "PO-25909 Qty". The commit is blocked NOT by geometry
# (there is no detected gap) but by STRICT credibility on a typed ref field. Pin that guard.
check('merged alphanumeric read fails strict credibility (0.8 coverage) -> not committed',
      A._crop_is_credible("PO-25909 Qty", "alphanumeric", VP) is False)
check('clean alphanumeric read passes credibility', A._crop_is_credible("PO-25909", "alphanumeric", VP) is True)
# Oracle anomaly #2: date credibility is SUBSTRING, so a merged date PASSES it — pin that
# so a future dev knows date is NOT protected by credibility (it relies on structured
# clean-token extraction downstream; the corpus gate + a date variant cover it).
check('merged DATE passes substring credibility (documents why date needs clean-token extraction)',
      A._crop_is_credible("12/05/2026 Qty", "date", VP) is True)

print('\n§6 OFF ⇒ inert + source/rung-discipline pins')
os.environ['ANCHOR_VALUE_RIGHT_GROW'] = '0'
check('OFF: helper returns None', R("invoice_number", LOC, AUTH, "right", "alphanumeric") is None)
check('OFF: geometry byte-identical (no right grow when the helper gave None anyway)',
      _crop_box(right_limit=None) == (240, 90))
os.environ['ANCHOR_VALUE_RIGHT_GROW'] = '1'

_src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         'extraction', 'anchor.py'), encoding='utf-8').read()
check('right grow wired at exactly THREE crop sites (rigid _rlim + label-lock + drift)',
      _src.count('right_limit_norm=') == 3)
check('rigid site passes right_limit_norm=_rlim', 'right_limit_norm=_rlim' in _src)
check('label-lock + drift pass right_limit_norm=_label_right_limit(field_key,',
      _src.count('right_limit_norm=_label_right_limit(field_key,') == 2)
check('cross-check (_gbox) + registration rungs do NOT grow (admit content -> excluded)',
      'right_limit_norm=' not in _src[_src.index('_gbox'):_src.index('_gbox') + 1500]
      and 'right_limit_norm' not in _src[_src.index('mapped["x_norm"]'):_src.index('mapped["x_norm"]') + 1500])
check('C-grow-only: x2 extends via max()+guard, capped at page width (source pin)',
      'x2 = min(w, max(x2, int(right_limit_norm * w) + _RIGHT_GROW_GUARD_PX))' in _src)
check('arming-OR: rigid locate armed for (_want_lclamp or _want_rgrow)',
      '(_want_lclamp or _want_rgrow)' in _src)
check('no-double-apply: max_w_norm gate carries "and right_limit_norm is None"',
      'and right_limit_norm is None' in _src)
check('the shipped credibility gate (_crop_is_credible) is STILL in the anchor path (net stays armed)',
      '_crop_is_credible(' in _src)

print(('\n%d FAILED' % fails) if fails else '\nAll label-right-grow pins passed')
sys.exit(1 if fails else 0)
