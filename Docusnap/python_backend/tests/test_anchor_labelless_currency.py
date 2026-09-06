#!/usr/bin/env python3
"""
tests/test_anchor_labelless_currency.py — ANCHOR_LABELLESS_CURRENCY_REFUSE (log review Item 1 read-side,
2026-09-05; gary + 007 → Oracle SIGN-OFF-W/COND C1; DARK, mig 122 `anchor_labelless_currency_refuse`).

Meadowvale credit notes: a ⊕ teach persisted `total_amount` with anchor_label=''. A label-less
AUTHORITATIVE currency anchor is a pure absolute crop — no label, no relocation road — and the totals
block floats with the line count, so the box read the VAT row / a neighbour / garbage @50 on 17/20
docs (13 in review, 4 hand-fixes = corrections rows). Registration cannot fix a row that moves
relative to the PAGE, so BOTH absolute reads are refused when armed; the field goes to the keyword
incumbent or, when it would end EMPTY, to a re-teach note (engine — anchor.py has no note road).

Pins (the design's 1-7):
  1 label-less authoritative currency on a shifted row: OFF → anchor_crop commits the (wrong-row) read;
    ON → the field is OMITTED + on_reject('anchor_crop', None, 'labelless_currency_refuse').
  2 ON + a fitted page_transform → NO anchor_registration commit either.
  3 a LABELLED currency anchor is byte-identical ON vs OFF.
  4 a PASSIVE label-less currency anchor is unchanged.
  5 a label-less authoritative TEXT anchor is unchanged.
  6 the trade-off: a fixed-layout label-less currency anchor that reads RIGHT today becomes empty under ON.
  7 the engine note road: note ONLY when the field would end EMPTY; an incumbent → no note; no reject → no note.

Usage:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_anchor_labelless_currency.py
"""
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor, registration  # noqa: E402
from extraction.anchor import _labelless_absolute_currency  # noqa: E402
from extraction.engine import _apply_labelless_withheld_notes, _LABELLESS_WITHHELD_NOTE  # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def arm(on):
    if on:
        os.environ["ANCHOR_LABELLESS_CURRENCY_REFUSE"] = "1"
    else:
        os.environ.pop("ANCHOR_LABELLESS_CURRENCY_REFUSE", None)


for k in ("ANCHOR_LABELLESS_CURRENCY_REFUSE", "ANCHOR_BARE_LABEL_FUZZY"):
    os.environ.pop(k, None)

PATS = {"currency": [r"[\d,]+\.\d{2}"], "date": [r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}"]}


class FakePage:
    size = (1000, 1000)


def _shift(dx, dy):
    return registration.Transform(np.array([[1.0, 0.0, dx], [0.0, 1.0, dy]]),
                                  residual=0.0, n_inliers=4, n_points=4, kind="similarity")


def _anchor(**ov):
    a = {"field_key": "total_amount", "anchor_label": "", "direction": "right",
         "usage_count": 1, "confidence": 1.0, "last_authoritative_at": "2026-09-05T13:45:28Z",
         "x_norm": 0.89174, "y_norm": 0.38814, "w_norm": 0.10156, "h_norm": 0.01739}
    a.update(ov)
    return a


def _run(crop_fn, anchor_row, val_type="currency", page_transform=None, on=False):
    arm(on)
    calls, rejects = [], []
    saved = (anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors)

    def crop(page, x, y, w, h, vt, capture=None, verify_fn=None, meta=None, continuation=None, **_kw):
        calls.append((x, y))
        return crop_fn(x, y)

    anchor._crop_and_ocr = crop
    anchor._locate_for_relocation = lambda *a, **k: None
    anchor._filter_anchors = lambda anchors, s, d: list(anchors)
    try:
        res = anchor.extract_with_anchors(
            "dummy ocr text", [anchor_row], supplier_name="Meadowvale Dairy Wholesale", document_type="credit_note",
            page_images=[FakePage()], field_patterns={anchor_row["field_key"]: {"validation": val_type}},
            validation_patterns=PATS, page_transform=page_transform,
            on_reject=lambda *a: rejects.append(a), text_field_keys={"customer_name"})
    finally:
        anchor._crop_and_ocr, anchor._locate_for_relocation, anchor._filter_anchors = saved
        arm(False)
    return res, calls, rejects


print("-- 0 the predicate --")
check("label-less + authoritative + currency → True", _labelless_absolute_currency(_anchor(), "currency"))
check("labelled → False", not _labelless_absolute_currency(_anchor(anchor_label="Total"), "currency"))
check("whitespace label → True", _labelless_absolute_currency(_anchor(anchor_label="  "), "currency"))
check("passive → False", not _labelless_absolute_currency(_anchor(last_authoritative_at=None), "currency"))
check("text → False", not _labelless_absolute_currency(_anchor(), "text"))

print("-- 1 the shifted-row exhibit --")
AT_TAUGHT = lambda x, y: "139.36" if (abs(x - 0.89174) < 1e-6 and abs(y - 0.38814) < 1e-6) else None
r_off, c_off, j_off = _run(AT_TAUGHT, _anchor(), on=False)
got = r_off.get("total_amount", {})
check(f"OFF: anchor_crop commits the wrong-row read '139.36' (method {got.get('method')!r})",
      got.get("value") == "139.36" and got.get("method") == "anchor_crop")
r_on, c_on, j_on = _run(AT_TAUGHT, _anchor(), on=True)
check("ON: the field is OMITTED", "total_amount" not in r_on)
check("ON: the rigid crop was never attempted (no OCR call)", len(c_on) == 0)
check("ON: on_reject('total_amount', 'anchor_crop', None, 'labelless_currency_refuse') fired",
      any(r[:4] == ("total_amount", "anchor_crop", None, "labelless_currency_refuse") for r in j_on))

print("-- 2 ON + a fitted page_transform: no registration commit --")
AT_MAPPED = lambda x, y: "139.36" if (abs(x - 0.90174) < 1e-3 and abs(y - 0.39814) < 1e-3) else None
r_reg_off, _, _ = _run(AT_MAPPED, _anchor(), page_transform=_shift(0.01, 0.01), on=False)
check("OFF: registration commits the mapped read (anchor_registration)",
      r_reg_off.get("total_amount", {}).get("method") == "anchor_registration")
r_reg_on, c_reg_on, _ = _run(AT_MAPPED, _anchor(), page_transform=_shift(0.01, 0.01), on=True)
check("ON: no anchor_registration commit — field omitted", "total_amount" not in r_reg_on)
check("ON: no crop was attempted at the mapped position either", len(c_reg_on) == 0)

print("-- 3 a LABELLED currency anchor is byte-identical --")
LAB = _anchor(anchor_label="Total")      # no offset → the rigid crop still runs
r3_off, _, _ = _run(AT_TAUGHT, LAB, on=False)
r3_on, _, _ = _run(AT_TAUGHT, LAB, on=True)
check("labelled: ON == OFF", r3_off == r3_on and r3_on.get("total_amount", {}).get("value") == "139.36")

print("-- 4 a PASSIVE label-less currency anchor is unchanged --")
PAS = _anchor(last_authoritative_at=None)
r4_off, _, _ = _run(AT_TAUGHT, PAS, on=False)
r4_on, _, _ = _run(AT_TAUGHT, PAS, on=True)
check("passive: ON == OFF", r4_off == r4_on)

print("-- 5 a label-less authoritative TEXT anchor is unchanged --")
TXT = _anchor(field_key="customer_name")
AT_TAUGHT_T = lambda x, y: "Beaumont Care Homes" if (abs(x - 0.89174) < 1e-6 and abs(y - 0.38814) < 1e-6) else None
r5_off, _, _ = _run(AT_TAUGHT_T, TXT, val_type="text", on=False)
r5_on, _, _ = _run(AT_TAUGHT_T, TXT, val_type="text", on=True)
check("text: ON == OFF (a name read stays)", r5_off == r5_on and r5_on.get("customer_name", {}).get("value") == "Beaumont Care Homes")

print("-- 6 the pinned trade-off --")
r6_off, _, _ = _run(lambda x, y: "1,178.89", _anchor(), on=False)
r6_on, _, _ = _run(lambda x, y: "1,178.89", _anchor(), on=True)
check("a fixed-layout label-less box that reads RIGHT today: OFF commits it, ON leaves it empty (deliberate)",
      r6_off.get("total_amount", {}).get("value") == "1,178.89" and "total_amount" not in r6_on)

print("-- 7 the engine note road --")
rej = {"total_amount": [{"method": "anchor_crop", "value": None, "reason": "labelless_currency_refuse"}]}
res = {"supplier_name": {"value": "Meadowvale", "confidence": 90, "method": "keyword"}}
changed = _apply_labelless_withheld_notes(res, rej)
check("EMPTY field + reject → the note lands (value None, conf 0, method anchor_labelless_withheld)",
      changed and res["total_amount"]["value"] is None and res["total_amount"]["confidence"] == 0
      and res["total_amount"]["method"] == "anchor_labelless_withheld"
      and res["total_amount"]["validation_note"] == _LABELLESS_WITHHELD_NOTE)
check("the note never uses a renderer trigger phrase", "please verify" not in _LABELLESS_WITHHELD_NOTE
      and "doesn't appear on this page" not in _LABELLESS_WITHHELD_NOTE)
res2 = {"total_amount": {"value": "-139.36", "confidence": 85, "method": "keyword"}}
check("an INCUMBENT (keyword) → untouched, no note", not _apply_labelless_withheld_notes(res2, rej)
      and res2["total_amount"]["value"] == "-139.36" and "validation_note" not in res2["total_amount"])
res3 = {"total_amount": {"value": "", "confidence": 0, "method": "keyword"}}
check("an EMPTY-string incumbent counts as empty → note", _apply_labelless_withheld_notes(res3, rej)
      and res3["total_amount"]["method"] == "anchor_labelless_withheld")
res4 = {}
check("no reject → nothing (OFF is inert by construction)", not _apply_labelless_withheld_notes(res4, {}) and res4 == {})
rej_other = {"total_amount": [{"method": "anchor_crop", "value": "Oo", "reason": "not_credible"}]}
check("a different reject reason → nothing", not _apply_labelless_withheld_notes({}, rej_other))

print(f"\n{'FAILED: ' + str(fails) if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
