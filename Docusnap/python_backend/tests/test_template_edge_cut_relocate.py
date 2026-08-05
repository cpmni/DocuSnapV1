"""Pins for TEMPLATE_EDGE_CUT_RELOCATE — the Stage-0.5 PLACEMENT pivot (Oracle SIGN-OFF-W/COND
2026-08-06, docs/oracle_log.md). When the abs edge-guard cannot clean-heal a CUT taught box, re-seat
the value off the LOCAL located label + stored offset + word-snap (the reliable placement primitive
the drift path uses) and PREFER it over the abs garble. The horizontal edge-guard grow structurally
cannot recover a VERTICAL seat clip; the re-seat can. Stage-1 commits the re-seated value FLAGGED
(<=70 + note, pre-filled for REVIEW) — never a silent clean auto-file of a no-history teach-once
value; it earns clean ONLY via confirmed/provisional shape consent.

Split: helper-level decision-logic pins (stub _relocate_and_read/_shape_consents) + one dispatch
integration through _extract_one (real edge-guard harness) proving the intercept + OFF byte-identity.

Run: py -3.12 python_backend/tests/test_template_edge_cut_relocate.py
"""
import copy
import importlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


os.environ['TEMPLATE_EDGE_CUT_RELOCATE'] = '1'
os.environ['TEMPLATE_TARGET_WORD_SNAP'] = '1'
os.environ['TEMPLATE_ABS_EDGE_GUARD'] = '1'
import extraction.template_mapper as tm
importlib.reload(tm)
check("switches arm", tm._EDGE_CUT_RELOCATE_ON is True and tm._TARGET_WORD_SNAP_ON is True)


class FakePage:
    size = (1000, 1000)

    def crop(self, box):
        return box


PAGE = FakePage()
ANCHOR = {"x_norm": 0.66, "y_norm": 0.15, "w_norm": 0.14, "h_norm": 0.012}
TARGET = {"x_norm": 0.81, "y_norm": 0.15, "w_norm": 0.08, "h_norm": 0.016}
# A genuine LOCAL locate: top-level x/y/w/h at the taught spot so _label_drifted() reads NOT-drifted
# (the drift branch must NOT pre-empt the edge-guard — doc_06 is near-level, method was _edgecut).
LOCATED = {"matched_text": "Delivery Note No.",
           "x_norm": 0.66, "y_norm": 0.15, "w_norm": 0.12, "h_norm": 0.012,
           "label_box": {"x_norm": 0.66, "y_norm": 0.15, "w_norm": 0.12, "h_norm": 0.012}}
MAP = {"field_key": "delivery_number", "anchor_text": "Delivery Note No.",
       "offset_dx_norm": 0.148, "offset_dy_norm": -0.001}


def call(relo_ret, consent='none', abs_text="VINO0U5D", located=LOCATED, mapping=MAP):
    """Drive _edge_cut_relocate with stubbed _relocate_and_read + _shape_consents."""
    orig_relo, orig_consent = tm._relocate_and_read, tm._shape_consents
    tm._relocate_and_read = lambda *a, **k: (dict(relo_ret) if relo_ret is not None else None)
    tm._shape_consents = lambda *a, **k: consent
    try:
        return tm._edge_cut_relocate(PAGE, mapping, ANCHOR, TARGET, located, "alphanumeric",
                                     "delivery_number", mapping.get("anchor_text"), abs_text,
                                     lambda *a, **k: "", lambda img: [], 0.0,
                                     {}, None, {}, None, 0, None)
    finally:
        tm._relocate_and_read, tm._shape_consents = orig_relo, orig_consent


CLEAN90 = {"value": "DN-58038", "confidence": 90, "method": "template_mapping"}

# 1. Teach-once (no consent): PREFER the re-seated value but FLAGGED, pre-filled — never clean.
r = call(CLEAN90, consent='none')
check("teach-once: re-seated value PREFERRED but FLAGGED <=70 + note (never silent clean)",
      r and r["value"] == "DN-58038" and r["confidence"] <= 70
      and r.get("validation_note") == tm._EDGE_CUT_NOTE and r["method"].endswith("_relocated"))

# 2. Earns CLEAN only via confirmed/provisional shape consent (uncapped, no forced note).
r = call(CLEAN90, consent='provisional')
check("provisional consent: re-seated value commits CLEAN (uncapped, no _relocated cap)",
      r and r["value"] == "DN-58038" and r["confidence"] == 90
      and r["method"] == "template_mapping" and "validation_note" not in r)
r = call(CLEAN90, consent='confirmed')
check("confirmed consent: re-seated value commits CLEAN", r and r["confidence"] == 90)

# 3. _shapewarn relocate = a learned-shape wrong-column bleed → NOT preferred (review floor).
r = call({"value": "XX-99", "confidence": 70, "method": "template_mapping_shapewarn"})
check("shapewarn relocate REJECTED -> fall through (None)", r is None)

# 4. Same-garble guard: re-anchor changed nothing → no gain, no clean-promote of a garble.
r = call({"value": "VIN-O0U5D", "confidence": 90, "method": "template_mapping"}, abs_text="VINO0U5D")
check("same-garble (relo == abs) -> None (no promote)", r is None)

# 5. Relocate read nothing → fall through (no worse than today).
check("relocate returns None -> None", call(None) is None)
check("relocate returns empty value -> None", call({"value": "", "confidence": 0}) is None)

# 6. Rule A — no usable LOCAL label → no relocate (and _relocate_and_read never called).
check("Rule A: located None -> None", call(CLEAN90, located=None) is None)
check("Rule A: located without matched_text -> None",
      call(CLEAN90, located={"matched_text": None}) is None)

# 6b. Rule A locate-scope PIN: the helper uses ONLY the passed local `located` — it must NEVER
# issue its own (page-wide) _locate_anchor (007's wrong-repeated-occurrence Q5 failure). Poison
# _locate_anchor so any internal call would raise; the helper must still succeed off the passed label.
_orig_loc = tm._locate_anchor
def _boom(*a, **k):
    raise AssertionError("edge_cut_relocate must not page-wide locate (Rule A)")
tm._locate_anchor = _boom
try:
    r = call(CLEAN90, consent='none')
    check("Rule A locate-scope: helper never calls _locate_anchor (uses the passed LOCAL label)",
          r and r["value"] == "DN-58038")
except AssertionError as e:
    check("Rule A locate-scope: helper never calls _locate_anchor (uses the passed LOCAL label)", False)
finally:
    tm._locate_anchor = _orig_loc

# 7. CO-REQUIRE _TARGET_WORD_SNAP_ON (the y-cure) — off → inert.
os.environ['TEMPLATE_TARGET_WORD_SNAP'] = '0'
importlib.reload(tm)
check("co-require: TARGET_WORD_SNAP off -> relocate inert (None)", call(CLEAN90) is None)
os.environ['TEMPLATE_TARGET_WORD_SNAP'] = '1'

# 8. Switch OFF → inert.
os.environ['TEMPLATE_EDGE_CUT_RELOCATE'] = '0'
importlib.reload(tm)
check("switch OFF -> relocate inert (None)", call(CLEAN90) is None)
os.environ['TEMPLATE_EDGE_CUT_RELOCATE'] = '1'
importlib.reload(tm)

# ── DISPATCH INTEGRATION — the guard floors on a cut, the re-seat intercepts ───────────────
FP = {"delivery_number": {"validation": "alphanumeric"}}
VAL = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"],
       "date": [r"(?<!\d)\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)"]}
# A value word the taught box's right edge cuts (→ guard fires); the narrow box reads a garble,
# the GROWN box reads None (→ guard floors, defer_cap). label sits at its taught spot (no drift).
VW = {"text": "VINO0U5D", "x_norm": 0.81, "y_norm": 0.155, "w_norm": 0.10, "h_norm": 0.014}
DLINES = [{"text": "Delivery Note No. VINO0U5D", "x_norm": 0.66, "y_norm": 0.155,
           "w_norm": 0.25, "h_norm": 0.014, "words": [VW]}]


def dstub(crop):
    x1, y1, x2, y2 = crop
    if y2 < 100 or y1 > 300:
        return None
    if x2 >= 880:                        # narrow taught box (right edge ~0.87) reads the garble
        return None                      # grown box reads nothing -> guard floors (defer_cap)
    if x2 >= 860:
        return "VINO0U5D"
    return None


def imap():
    return {"field_key": "delivery_number", "anchor_text": "Delivery Note No.", "page_number": 0,
            "enabled": 1, "anchor_x_norm": 0.66, "anchor_y_norm": 0.15, "anchor_w_norm": 0.14,
            "anchor_h_norm": 0.012, "target_x_norm": 0.81, "target_y_norm": 0.15,
            "target_w_norm": 0.06, "target_h_norm": 0.016,
            "offset_dx_norm": 0.148, "offset_dy_norm": -0.001}


def run_dispatch():
    lc = {(id(PAGE), 0.0, 0.0, 1.0, 1.0): DLINES}
    return tm._extract_one(PAGE, imap(), FP, lambda img: DLINES, dstub, located=LOCATED,
                           validation_patterns=VAL, format_lookup=None, line_cache=lc,
                           provisional_lookup=None)


# ARMED: the guard cannot clean-heal → re-seat intercepts and returns the FLAGGED full value.
_orig = tm._relocate_and_read
tm._relocate_and_read = lambda *a, **k: {"value": "DN-58038", "confidence": 90, "method": "template_mapping"}
r = run_dispatch()
tm._relocate_and_read = _orig
check("dispatch ARMED: guard floor is INTERCEPTED -> DN-58038 pre-filled @<=70 (not the garble)",
      r and r["value"] == "DN-58038" and r["confidence"] <= 70 and r.get("validation_note"))

# OFF byte-identical: switch off → the guard's defer_cap floor stands (abs garble @<=70 _edgecut).
os.environ['TEMPLATE_EDGE_CUT_RELOCATE'] = '0'
importlib.reload(tm)
tm._relocate_and_read = lambda *a, **k: {"value": "DN-58038", "confidence": 90, "method": "template_mapping"}
r = run_dispatch()
tm._relocate_and_read = _orig
check("dispatch OFF: byte-identical -> abs garble committed @<=70 _edgecut (no relocate)",
      r and r["value"] != "DN-58038" and r["confidence"] <= 70 and r["method"].endswith("_edgecut"))

os.environ.pop('TEMPLATE_EDGE_CUT_RELOCATE', None)
os.environ.pop('TEMPLATE_TARGET_WORD_SNAP', None)
os.environ.pop('TEMPLATE_ABS_EDGE_GUARD', None)
importlib.reload(tm)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All edge-cut relocate checks passed.")
