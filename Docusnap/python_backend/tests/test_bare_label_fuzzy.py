#!/usr/bin/env python3
"""
tests/test_bare_label_fuzzy.py — ANCHOR_BARE_LABEL_FUZZY (log review Item 2 slice A, 2026-09-05;
gary + 007 → Oracle SIGN-OFF-W/COND C1; DARK, mig 122 `anchor_bare_label_fuzzy`).

Oakhaven delivery notes: the taught `customer_name` (label CUSTOMER, direction below) — the
registration rung shifted the box onto the caption row minus its first glyph and read "USTOMER"
@81, which WON Tier-A over the keyword "Deliver To" @78. anchor._is_bare_label is token-EXACT, so a
caption missing one glyph is not a bare label; the registration rung has no other caption defence.

Pins:
  1 OFF (default): "USTOMER" vs "CUSTOMER" is NOT rejected — documents the bug, and OFF == today.
  2 ON: USTOMER / CUSTOME / CUSTOMFR / Customers vs CUSTOMER are bare labels (per-token, one slip).
  3 ON negatives stay values: Deliveroo vs "Deliver To" · Customs vs Customer · IBM vs "Company Name" ·
    Denver Trading vs "Deliver To" · 139.36 vs Total · short label "To" · a real "1234" vs "Order 12345"
    (digit tokens skipped) · "Custom" vs Customer (2 short) · "Custer" vs Customer (2 edits).
  4 ON: the split / two-token roads ("UST OMER", "USTOMER NAME" vs "CUSTOMER NAME").
  5 the registration RUNG: a stubbed page_transform maps the taught box onto the caption band and the
    crop reads "USTOMER" → ON: on_reject('anchor_registration', 'USTOMER', 'not_credible') and the
    field is OMITTED (the keyword incumbent stands in the engine); OFF: registration commits it.
  6 no label (the Stage-0.5 mapper road, Oracle C2) → never rejected, ON or OFF.
  7 _edit_distance_le1 truth table.

Usage:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_bare_label_fuzzy.py
"""
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor, registration  # noqa: E402
from extraction.anchor import _is_bare_label, _crop_is_credible, _edit_distance_le1  # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def arm(on):
    if on:
        os.environ["ANCHOR_BARE_LABEL_FUZZY"] = "1"
    else:
        os.environ.pop("ANCHOR_BARE_LABEL_FUZZY", None)


TEXT_PATS = {"date": [r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}"], "currency": [r"[\d,]+\.\d{2}"]}

print("-- 1 OFF (default) == today: the exhibit passes --")
arm(False)
check("OFF: 'USTOMER' vs 'CUSTOMER' is NOT a bare label (the bug, documented)", not _is_bare_label("USTOMER", "CUSTOMER"))
check("OFF: exact rule still rejects 'CUSTOMER' vs 'CUSTOMER'", _is_bare_label("CUSTOMER", "CUSTOMER"))
check("OFF: exact rule still rejects 'Work Address' vs 'Work Address'", _is_bare_label("Work Address", "Work Address"))
check("OFF: the free-text credibility gate accepts 'USTOMER' (what the rung committed)", _crop_is_credible("USTOMER", "text", TEXT_PATS, "CUSTOMER"))

print("-- 2 ON: one slip from the caption token is a bare label --")
arm(True)
for v in ("USTOMER", "CUSTOME", "CUSTOMFR", "Customers", "ustomer", "CUSTOMER:"):
    check(f"ON: {v!r} vs 'CUSTOMER' rejected", _is_bare_label(v, "CUSTOMER"))
check("ON: the credibility gate now refuses 'USTOMER' for label 'CUSTOMER'", not _crop_is_credible("USTOMER", "text", TEXT_PATS, "CUSTOMER"))
check("ON: 'USTOMER' vs 'CUSTOMER NAME' (per TOKEN, not the joined phrase — Oracle C1)", _is_bare_label("USTOMER", "CUSTOMER NAME"))
check("ON: 'otal' vs 'Total' (a clipped first glyph, len 4 vs 5)", _is_bare_label("otal", "Total"))

print("-- 3 ON: negatives stay values --")
NEG = [
    ("Deliveroo", "Deliver To"), ("Customs", "Customer"), ("IBM", "Company Name"),
    ("Denver Trading", "Deliver To"), ("139.36", "Total"), ("Total", "To"), ("Custom", "Customer"),
    ("Custer", "Customer"), ("1234", "Order 12345"), ("Acme Customer Care Ltd", "Customer Name"),
    ("Smith", "Customer"), ("Ordered", "Order Date"), ("12345", "Invoice Number"),
]
for v, lbl in NEG:
    check(f"ON: {v!r} vs {lbl!r} stays a value", not _is_bare_label(v, lbl))
check("ON: a real value is still credible ('Denver Trading' for 'Deliver To')", _crop_is_credible("Denver Trading", "text", TEXT_PATS, "Deliver To"))

print("-- 4 ON: the split / two-token roads --")
check("ON: 'UST OMER' (space-split) vs 'CUSTOMER' rejected via the joined value", _is_bare_label("UST OMER", "CUSTOMER"))
check("ON: 'USTOMER NAME' vs 'CUSTOMER NAME' rejected (every token exact-or-slip)", _is_bare_label("USTOMER NAME", "CUSTOMER NAME"))
check("ON: 'USTOMER Smith' vs 'CUSTOMER NAME' stays (one token is a real word)", not _is_bare_label("USTOMER Smith", "CUSTOMER NAME"))

print("-- 6 no label (the Stage-0.5 mapper road) never rejects --")
check("ON: no label → not a bare label", not _is_bare_label("USTOMER", None))
check("ON: empty label → not a bare label", not _is_bare_label("USTOMER", ""))

print("-- 7 _edit_distance_le1 --")
for a, b, want in [("ustomer", "customer", True), ("customfr", "customer", True), ("customers", "customer", True),
                   ("customer", "customer", True), ("custome", "customer", True), ("customs", "customer", False),
                   ("custom", "customer", False), ("custer", "customer", False), ("deliveroo", "deliver", False),
                   ("abc", "abd", True), ("abc", "xbz", False), ("", "a", True), ("ab", "ba", False)]:
    check(f"le1({a!r},{b!r}) == {want}", _edit_distance_le1(a, b) == want)


# ── 5 the registration RUNG ─────────────────────────────────────────────────────────────────────
class FakePage:
    size = (1000, 1000)


def _shift_transform(dx, dy):
    return registration.Transform(np.array([[1.0, 0.0, dx], [0.0, 1.0, dy]]),
                                  residual=0.0, n_inliers=3, n_points=5, kind="similarity")


def _anchor():
    return {"field_key": "customer_name", "anchor_label": "CUSTOMER", "direction": "below",
            "usage_count": 3, "confidence": 0.8, "last_authoritative_at": "2026-09-01T00:00:00Z",
            "x_norm": 0.30, "y_norm": 0.25, "w_norm": 0.20, "h_norm": 0.03}


def _run_rung(on):
    """Rigid crop at the stored coords reads nothing; relocate finds no label; the fitted transform
    maps the taught box up onto the caption band, where the crop reads the caption minus its first
    glyph. Hermetic (no Tesseract / image)."""
    arm(on)
    rejects = []
    saved = (anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors)

    def crop(page, x, y, w, h, vt, capture=None, verify_fn=None, meta=None, continuation=None, **_kw):
        # the mapped position (0.30+0.02, 0.25-0.01) = the caption row; the stored position reads nothing
        return "USTOMER" if (abs(x - 0.32) < 0.005 and abs(y - 0.24) < 0.005) else None

    anchor._crop_and_ocr = crop
    anchor._locate_for_relocation = lambda *a, **k: None
    anchor._filter_anchors = lambda anchors, s, d: list(anchors)
    try:
        res = anchor.extract_with_anchors(
            "dummy ocr text", [_anchor()], supplier_name="Oakhaven", document_type="delivery_note",
            page_images=[FakePage()], field_patterns={"customer_name": {"validation": "text"}},
            validation_patterns=TEXT_PATS, page_transform=_shift_transform(0.02, -0.01),
            on_reject=lambda *a: rejects.append(a), text_field_keys={"customer_name"})
    finally:
        anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors = saved
        arm(False)
    return res, rejects


print("-- 5 the registration rung --")
res_off, rej_off = _run_rung(False)
got = res_off.get("customer_name", {})
check(f"OFF: registration COMMITS 'USTOMER' (method {got.get('method')!r}) — the exhibit",
      got.get("value") == "USTOMER" and got.get("method") == "anchor_registration")
res_on, rej_on = _run_rung(True)
check("ON: the field is OMITTED (the keyword incumbent stands in the engine)", "customer_name" not in res_on)
check("ON: on_reject('customer_name', 'anchor_registration', 'USTOMER', 'not_credible') fired",
      any(r[:4] == ("customer_name", "anchor_registration", "USTOMER", "not_credible") for r in rej_on))
check("ON: nothing else was committed for the field (no recovered token)", not any(k == "customer_name" for k in res_on))

print(f"\n{'FAILED: ' + str(fails) if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
