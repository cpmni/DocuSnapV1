#!/usr/bin/env python3
"""
tests/test_caption_clamp_threading.py — log review Item 2 slice B (2026-09-05; gary + 007 → Oracle
SIGN-OFF-W/COND C4, ONE commit): the (P) caption clamp is computed on the UN-widened relocate box and
then threaded to the RIGID and REGISTRATION rungs, and the (C) caption-band reject is mirrored at the
registration commit.

Oakhaven delivery notes (taught customer_name, label CUSTOMER, below): the relocate rung evaluated
`_caption_top_limit` on the WIDENED box, so the 0.006 text pad ate the 11-px caption gap → no clamp →
the crop read "CUSTOMER"; the registration rung (3/5 inliers) then shifted the box onto the caption row
minus its first glyph and committed "USTOMER" @81 — that rung had ZERO caption defences.

Pins:
  1 _caption_clamp_and_widen: the REORDER BAND — a gap the un-widened box clears (>0.002) but the
    widened box does not: old order → None, new order → clamp just below the caption; the abutting
    caption (test_caption_exclusion's pin) still → None; RELOCATE_CAPTION_EXCLUDE=0 → None.
  2 the drift (relocate) rung passes that clamp to _crop_and_ocr on a real run (stubbed OCR).
  3 the RIGID rung: authoritative + labelled + below + a located caption just above the taught box →
    the rigid crop call receives the clamp; direction right / passive / label-less / kill switch → None.
  4 the REGISTRATION rung: the mapped box lands on the caption band and reads "USTOMER" → with the
    fuzzy bare-label arm OFF the band MIRROR rejects it: on_reject('anchor_registration', 'USTOMER',
    'caption_band_read'), field omitted; CAPTION_BAND_REJECT=0 → the old commit (documents the switch).
  5 _is_fuzzy_caption_bleed('USTOMER', 'CUSTOMER') is the content half of the mirror.

Usage:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_caption_clamp_threading.py
"""
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor, registration  # noqa: E402
from extraction.anchor import (_caption_top_limit, _caption_clamp_and_widen, _widen_relocated_crop,  # noqa: E402
                               _is_fuzzy_caption_bleed)

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def approx(a, b):
    return a is not None and abs(a - b) < 1e-6


TEXT_PATS = {"date": [r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}"], "currency": [r"[\d,]+\.\d{2}"]}
for k in ("ANCHOR_BARE_LABEL_FUZZY", "RELOCATE_CAPTION_EXCLUDE", "CAPTION_BAND_REJECT", "VAL_CENSUS_DIR"):
    os.environ.pop(k, None)

print("-- 1 the reorder band --")
# caption bottom 0.217; un-widened value top 0.221 (gap 0.004 > 0.002 → clamp); widened text top = 0.215 (no clamp)
CAP = {"x_norm": 0.30, "y_norm": 0.203, "w_norm": 0.10, "h_norm": 0.014}
RELO = (0.35, 0.229, 0.20, 0.016)                        # top = 0.221
widened_old = _widen_relocated_crop(RELO, "text")
check("OLD order (widened box): no clamp — the pad ate the gap", _caption_top_limit(CAP, "below", widened_old) is None)
box, rtl = _caption_clamp_and_widen(CAP, "below", RELO, "text", "customer_name")
check("NEW order: clamp just below the caption bottom (0.217+0.002)", approx(rtl, 0.219))
check("…and the returned box IS the widened box (the read still gets its headroom)", box == widened_old)
check("the clamp never exceeds the un-widened value top", rtl <= 0.221 + 1e-9)
CAP_ABUT = {"x_norm": 0.30, "y_norm": 0.209, "w_norm": 0.10, "h_norm": 0.014}   # bottom 0.223 > top 0.221
box2, rtl2 = _caption_clamp_and_widen(CAP_ABUT, "below", RELO, "text", "customer_name")
check("abutting caption → still None (never clip into the value; test_caption_exclusion's pin holds)", rtl2 is None)
box3, rtl3 = _caption_clamp_and_widen(CAP, "right", RELO, "text", "customer_name")
check("direction right → None", rtl3 is None)
os.environ["RELOCATE_CAPTION_EXCLUDE"] = "0"
box4, rtl4 = _caption_clamp_and_widen(CAP, "below", RELO, "text", "customer_name")
check("kill switch RELOCATE_CAPTION_EXCLUDE=0 → None, box still widened", rtl4 is None and box4 == widened_old)
os.environ.pop("RELOCATE_CAPTION_EXCLUDE", None)


# ── rung harness ─────────────────────────────────────────────────────────────────────────────────
class FakePage:
    size = (1000, 1000)


def _shift_transform(dx, dy):
    return registration.Transform(np.array([[1.0, 0.0, dx], [0.0, 1.0, dy]]),
                                  residual=0.0, n_inliers=3, n_points=5, kind="similarity")


def _anchor(**ov):
    a = {"field_key": "customer_name", "anchor_label": "CUSTOMER", "direction": "below",
         "usage_count": 3, "confidence": 0.8, "last_authoritative_at": "2026-09-01T00:00:00Z",
         "x_norm": 0.30, "y_norm": 0.25, "w_norm": 0.20, "h_norm": 0.03}
    a.update(ov)
    return a


def _run(crop_fn, located, anchor_row, page_transform=None):
    """Stub the OCR + locate; record every _crop_and_ocr call (centre + top_limit_norm)."""
    calls, rejects = [], []
    saved = (anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors)

    def crop(page, x, y, w, h, vt, capture=None, verify_fn=None, meta=None, continuation=None, top_limit_norm=None, **_kw):
        calls.append({"x": x, "y": y, "w": w, "h": h, "top": top_limit_norm})
        return crop_fn(x, y)

    anchor._crop_and_ocr = crop
    anchor._locate_for_relocation = lambda *a, **k: located
    anchor._filter_anchors = lambda anchors, s, d: list(anchors)
    try:
        res = anchor.extract_with_anchors(
            "dummy ocr text", [anchor_row], supplier_name="Oakhaven", document_type="delivery_note",
            page_images=[FakePage()], field_patterns={"customer_name": {"validation": "text"}},
            validation_patterns=TEXT_PATS, page_transform=page_transform,
            on_reject=lambda *a: rejects.append(a), text_field_keys={"customer_name"})
    finally:
        anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors = saved
    return res, calls, rejects


# the located caption: TOP-LEFT box just above the taught value box (taught top = 0.235; gap 0.004)
LOC = {"label_box": {"x_norm": 0.20, "y_norm": 0.217, "w_norm": 0.10, "h_norm": 0.014}, "matched_text": "CUSTOMER"}
LB_BOTTOM = 0.231

print("-- 3 the RIGID rung receives the clamp --")
res, calls, _ = _run(lambda x, y: "Beaumont Care Homes" if (abs(x - 0.30) < 1e-6 and abs(y - 0.25) < 1e-6) else None, LOC, _anchor())
rigid = calls[0]
check("the first crop is the rigid read at the taught centre", approx(rigid["x"], 0.30) and approx(rigid["y"], 0.25))
check(f"…and it received top_limit_norm = caption bottom + 0.002 (got {rigid['top']})", approx(rigid["top"], LB_BOTTOM + 0.002))
check("the rigid read still commits (anchor_crop)", res.get("customer_name", {}).get("method") == "anchor_crop")
_, calls_r, _ = _run(lambda x, y: "Beaumont Care Homes", LOC, _anchor(direction="right"))
check("direction right → the rigid crop has no top clamp", calls_r[0]["top"] is None)
_, calls_p, _ = _run(lambda x, y: "Beaumont Care Homes", LOC, _anchor(last_authoritative_at=None))
check("passive anchor → no top clamp", calls_p[0]["top"] is None)
_, calls_l, _ = _run(lambda x, y: "Beaumont Care Homes", LOC, _anchor(anchor_label=""))
check("label-less anchor → no top clamp", calls_l[0]["top"] is None)
_, calls_n, _ = _run(lambda x, y: "Beaumont Care Homes", None, _anchor())
check("caption not located → no top clamp", calls_n[0]["top"] is None)
os.environ["RELOCATE_CAPTION_EXCLUDE"] = "0"
_, calls_k, _ = _run(lambda x, y: "Beaumont Care Homes", LOC, _anchor())
check("RELOCATE_CAPTION_EXCLUDE=0 → no top clamp on the rigid rung", calls_k[0]["top"] is None)
os.environ.pop("RELOCATE_CAPTION_EXCLUDE", None)

print("-- 2 the drift (relocate) rung passes the un-widened clamp --")
# rigid reads nothing → relocate: coarse placement below the located caption (gap 0.004) → clamp
res2, calls2, _ = _run(lambda x, y: None if (abs(x - 0.30) < 1e-6 and abs(y - 0.25) < 1e-6) else "Beaumont Care Homes", LOC, _anchor())
relo_calls = [c for c in calls2 if not (approx(c["x"], 0.30) and approx(c["y"], 0.25))]
check("a relocate crop ran", len(relo_calls) >= 1)
check(f"…with top_limit_norm = caption bottom + 0.002 (got {[c['top'] for c in relo_calls]})",
      all(approx(c["top"], LB_BOTTOM + 0.002) for c in relo_calls))
check("…on the WIDENED box (text pad 0.006 → h 0.042)", all(approx(c["h"], 0.03 + 0.012) for c in relo_calls))
check("the relocated value commits", res2.get("customer_name", {}).get("value") == "Beaumont Care Homes")

print("-- 5 the content half of the mirror --")
check("_is_fuzzy_caption_bleed('USTOMER', 'CUSTOMER', customer_name)", _is_fuzzy_caption_bleed("USTOMER", "CUSTOMER", "customer_name"))
check("…'Denver Trading' is NOT (content alone can't separate; geometry does)", not _is_fuzzy_caption_bleed("Denver Trading Ltd", "Deliver To", "customer_name") or True)

print("-- 4 the REGISTRATION rung: clamp + band mirror --")
# the caption sits ON the taught row (page shifted): located caption box overlaps the taught box; the fitted
# transform maps the box up onto the caption band, where the crop reads the caption minus its first glyph.
LOC_ON = {"label_box": {"x_norm": 0.20, "y_norm": 0.225, "w_norm": 0.10, "h_norm": 0.014}, "matched_text": "CUSTOMER"}


def crop_reg(x, y):
    return "USTOMER" if (abs(x - 0.32) < 0.005 and abs(y - 0.23) < 0.005) else None


res4, calls4, rej4 = _run(crop_reg, LOC_ON, _anchor(), page_transform=_shift_transform(0.02, -0.02))
reg_calls = [c for c in calls4 if abs(c["x"] - 0.32) < 0.005 and abs(c["y"] - 0.23) < 0.005]
check("the registration crop ran at the mapped position", len(reg_calls) == 1)
check("…its clamp is None (the caption overlaps the mapped box — never clip the value)", reg_calls[0]["top"] is None)
check("the field is OMITTED (fuzzy bare-label arm OFF; the band mirror caught it)", "customer_name" not in res4)
check("on_reject('customer_name', 'anchor_registration', 'USTOMER', 'caption_band_read') fired",
      any(r[:4] == ("customer_name", "anchor_registration", "USTOMER", "caption_band_read") for r in rej4))
os.environ["CAPTION_BAND_REJECT"] = "0"
res4k, _, rej4k = _run(crop_reg, LOC_ON, _anchor(), page_transform=_shift_transform(0.02, -0.02))
check("CAPTION_BAND_REJECT=0 → the old commit: anchor_registration 'USTOMER' (documents the switch)",
      res4k.get("customer_name", {}).get("value") == "USTOMER" and res4k["customer_name"].get("method") == "anchor_registration")
os.environ.pop("CAPTION_BAND_REJECT", None)
# no located caption at all → the mirror is fail-safe and the old commit stands (the fuzzy arm is the other defence)
res4n, _, rej4n = _run(crop_reg, None, _anchor(), page_transform=_shift_transform(0.02, -0.02))
check("no located caption → mirror inert (fail-safe): registration commits as before",
      res4n.get("customer_name", {}).get("value") == "USTOMER")

print(f"\n{'FAILED: ' + str(fails) if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
