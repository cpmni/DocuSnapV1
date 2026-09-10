#!/usr/bin/env python3
"""tests/test_anchor_axis_lock.py — pins the ANCHOR_AXIS_LOCK arc (mig 155, DARK; 007+reggie+gary →
Oracle SIGN-OFF-W/COND). An ADDITIVE width-invariant label-column read for a below/above/right free-text
anchor whose taught box (value CENTRE) drifts the read-box off a narrower value.

Two levels:
  A) the RECONCILER (engine._reconcile_axislock_winners) — the safety-critical decision logic, pure:
     precedence via the REAL _override_eligible (authoritative / Stage-0.5 / admin discarded, the
     motivating exhibit INERT), the <=87/<=69 caps, the always-note + C1 method sentinel, pop-always,
     never-a-corroboration-witness (structural: the helper takes no field_candidates), byte-identical
     when no field carries the stash.
  B) the EMITTER (anchor._axislock_read) — gate scoping (free-text/name only, offset present, direction),
     and the C4 emit-gate (only a LONGER read than the incumbent, else the empty fill).

    py -3.12 tests/test_anchor_axis_lock.py    (from python_backend/)
"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")   # the labels carry →/<= etc.; Windows console is cp1252
except Exception:
    pass
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import anchor, engine
from extraction import template_mapper

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


OE = engine.ExtractionEngine._override_eligible          # the REAL precedence gate (staticmethod)
NOTE = anchor.AXISLOCK_VERIFY_NOTE


def _cand(value, conf=85):
    return {"value": value, "conf": conf, "min_conf": conf, "box": (0.44, 0.55, 0.18, 0.03),
            "method": "anchor_axis_locked"}


def _incumbent(value, method="anchor_crop", authoritative=False):
    return {"value": value, "confidence": 92, "method": method, "authoritative": authoritative,
            "_axislock_candidate": None}


# ── A. reconciler ────────────────────────────────────────────────────────────
print("A — reconciler precedence + caps (real _override_eligible):")

# below_heal: a generic anchor incumbent, a LONGER superset candidate → replace, <=87, note, C1 method.
r = {"customer_name": {**_incumbent("Halcyon Leisure"), "_axislock_candidate": _cand("Halcyon Leisure Group")}}
changed = engine._reconcile_axislock_winners(r, OE)
d = r["customer_name"]
check("below_heal: value replaced with the un-clipped read",
      changed is True and d["value"] == "Halcyon Leisure Group")
check("below_heal: method is the anchor_axis_locked C1 sentinel", d["method"] == "anchor_axis_locked")
check("below_heal: confidence capped <=87 (superset agrees)", d["confidence"] <= 87)
check("below_heal: the always-note is set (never a silent auto-file)", d.get("validation_note") == NOTE)
check("below_heal: stash popped (never persisted)", "_axislock_candidate" not in d)

# exhibit-inert: an AUTHORITATIVE incumbent (the Vellum&Crane anchor_crop) → candidate discarded.
r = {"customer_name": {**_incumbent("Halcyon Leisure", authoritative=True),
                       "_axislock_candidate": _cand("Halcyon Leisure Group")}}
engine._reconcile_axislock_winners(r, OE)
d = r["customer_name"]
check("exhibit-inert: authoritative incumbent UNCHANGED (value)", d["value"] == "Halcyon Leisure")
check("exhibit-inert: method unchanged (still anchor_crop)", d["method"] == "anchor_crop")
check("exhibit-inert: no note added", not d.get("validation_note"))
check("exhibit-inert: stash still popped (housekeep)", "_axislock_candidate" not in d)

# keyword_override (admin) incumbent → discarded.
r = {"customer_name": {**_incumbent("Halcyon Leisure", method="keyword_override"),
                       "_axislock_candidate": _cand("Halcyon Leisure Group")}}
engine._reconcile_axislock_winners(r, OE)
check("keyword_override incumbent → candidate discarded", r["customer_name"]["value"] == "Halcyon Leisure"
      and r["customer_name"]["method"] == "keyword_override")

# Stage-0.5 located mapping incumbent → discarded.
r = {"customer_name": {**_incumbent("Halcyon Leisure", method="template_mapping"),
                       "_axislock_candidate": _cand("Halcyon Leisure Group")}}
engine._reconcile_axislock_winners(r, OE)
check("Stage-0.5 mapping incumbent → candidate discarded",
      r["customer_name"]["method"] == "template_mapping")

# disagreement: a LONGER but DIFFERENT read (not a superset) → cap <=69 + note (stronger review).
r = {"customer_name": {**_incumbent("Halcyon Ltd"),
                       "_axislock_candidate": _cand("Riverside Trading Group")}}
engine._reconcile_axislock_winners(r, OE)
d = r["customer_name"]
check("disagreement: replaced but capped <=69 (fail-toward-review)",
      d["value"] == "Riverside Trading Group" and d["confidence"] <= 69)
check("disagreement: note set", d.get("validation_note") == NOTE)

# empty-fill: an empty incumbent → fill, <=87, note.
r = {"customer_name": {**_incumbent(""), "_axislock_candidate": _cand("Halcyon Leisure Group")}}
engine._reconcile_axislock_winners(r, OE)
d = r["customer_name"]
check("empty-fill: filled + capped <=87 + noted",
      d["value"] == "Halcyon Leisure Group" and d["confidence"] <= 87 and d.get("validation_note") == NOTE)

# conf never exceeds the cap even if the candidate conf is high.
r = {"customer_name": {**_incumbent("Halcyon Leisure"),
                       "_axislock_candidate": _cand("Halcyon Leisure Group", conf=99)}}
engine._reconcile_axislock_winners(r, OE)
check("high candidate conf is still capped <=87", r["customer_name"]["confidence"] <= 87)

# byte-identical when no stash present.
r = {"customer_name": _incumbent("Halcyon Leisure")}
del r["customer_name"]["_axislock_candidate"]
before = dict(r["customer_name"])
changed = engine._reconcile_axislock_winners(r, OE)
check("no stash → returns False, result unchanged (byte-identical)",
      changed is False and r["customer_name"] == before)

# not-a-corroboration-witness: structural — the helper takes no field_candidates argument.
import inspect
check("not-in-ledger: reconciler signature has no field_candidates (can't feed the witness ledger)",
      "field_candidates" not in inspect.signature(engine._reconcile_axislock_winners).parameters)

# metadata / _ keys are skipped.
r = {"_meta": {"x": 1}, "customer_name": {**_incumbent("A"), "_axislock_candidate": _cand("A Bigger Co")}}
engine._reconcile_axislock_winners(r, OE)
check("underscore keys skipped, real field healed", r["_meta"] == {"x": 1}
      and r["customer_name"]["value"] == "A Bigger Co")

# ── B. emitter gate scoping + C4 emit-gate ───────────────────────────────────
print("B — emitter gate scoping + C4 emit-gate (stubbed page/OCR):")


class _FakeImg:
    size = (1000, 1000)

    def crop(self, box):
        return self


def _run_emit(direction="below", val_type="text", field_key="customer_name",
              incumbent="Halcyon Leisure", read="Halcyon Leisure Group",
              odx=0.10, ody=0.05, words=None):
    """Drive _axislock_read with stubbed crop/ocr so only the arc's own logic is under test."""
    if words is None:
        words = [{"text": "Halcyon", "x_norm": 0.44, "y_norm": 0.40, "w_norm": 0.07, "h_norm": 0.03},
                 {"text": "Leisure", "x_norm": 0.52, "y_norm": 0.40, "w_norm": 0.07, "h_norm": 0.03},
                 {"text": "Group", "x_norm": 0.60, "y_norm": 0.40, "w_norm": 0.05, "h_norm": 0.03}]
    anchor_dict = {"anchor_label": "Deliver To", "offset_dx_norm": odx, "offset_dy_norm": ody,
                   "w_norm": 0.14, "h_norm": 0.03, "last_authoritative_at": None}
    located = {"label_box": {"x_norm": 0.44, "y_norm": 0.34, "w_norm": 0.10, "h_norm": 0.02},
               "inline_box": {"x_norm": 0.55, "y_norm": 0.34, "w_norm": 0.16, "h_norm": 0.03}}

    def _co(page, x, y, w, h, vt, **kw):
        m = kw.get("meta")
        if m is not None:
            m["conf"], m["min_conf"] = 85, 82
        return read

    saved = {"_crop_and_ocr": anchor._crop_and_ocr, "_ocr_lines": template_mapper._ocr_lines,
             "_ccr": anchor._is_caption_band_read}
    anchor._crop_and_ocr = _co
    template_mapper._ocr_lines = lambda img: [{"y_norm": 0.40, "h_norm": 0.03, "words": words}]
    anchor._is_caption_band_read = lambda *a, **k: False   # its own reject is pinned elsewhere
    try:
        return anchor._axislock_read(_FakeImg(), anchor_dict, direction, val_type, field_key,
                                     incumbent, located, {}, {}, [], "Deliver To", None, None)
    finally:
        anchor._crop_and_ocr = saved["_crop_and_ocr"]
        template_mapper._ocr_lines = saved["_ocr_lines"]
        anchor._is_caption_band_read = saved["_ccr"]


c = _run_emit()
check("below_heal emit: returns a candidate with the un-clipped value + C1 method",
      c is not None and c["value"] == "Halcyon Leisure Group" and c["method"] == "anchor_axis_locked")

check("C4 emit-gate: a read NOT longer than the incumbent → no candidate (no truncation offered)",
      _run_emit(incumbent="Halcyon Leisure Group Holdings", read="Halcyon Leisure Group") is None)

check("empty incumbent → emits (fill path)",
      _run_emit(incumbent="") is not None)

check("scope: currency val_type → no candidate", _run_emit(val_type="currency") is None)
check("scope: unknown direction → no candidate", _run_emit(direction="left") is None)
check("scope: a non-name field_key → no candidate (names only)",
      _run_emit(field_key="invoice_number") is None)


def _run_null_offset():
    return _run_emit(odx=None, ody=None)


check("scope: null offset → no candidate", _run_null_offset() is None)

print("\n" + ("ALL PASS" if fails == 0 else f"{fails} FAILED"))
sys.exit(1 if fails else 0)
