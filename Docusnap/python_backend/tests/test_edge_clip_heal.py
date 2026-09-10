#!/usr/bin/env python3
"""tests/test_edge_clip_heal.py — EDGE-CLIP HEAL (mig 151, 2026-09-10; 007 root cause + Oracle SIGN-OFF-W/COND
C1-C7). docs/designs/EDGE_CLIP_HEAL_2026-09-10.md.

The class: a skewed sibling's composed axis-aligned target box severs ONE edge glyph, committing a HIGH
OCR-confidence, same-length, shape-valid garble (YN-38626 for DN-38626). Read-widen (shape stays valid),
the edge-cut guard (overhang < ~8px), AND _maybe_pad_code (the +15 conf margin returns it before consent,
and its two-sided consent would FLAG not swap) all miss it. The heal arbitrates by PLACEMENT, not OCR
confidence: the recovered token must occupy the taught slot (_snap_union_witness un-cut-edge anchor +
>=0.6 slot-fill) AND differ from the tight read ONLY at the cut-side glyph (clip-containment). ADOPT capped
87 (<88 floor); note-first / already-healed → never lift; OFF → byte-identical.

Exhibit coords are 007's rendered doc140 delivery_number (200 DPI, live DB): value DN-38626 [0.8096,0.8816]
inside the composed box [0.8148,0.8961] — a LEFT clip (box left edge bisects the 'D'; the value's RIGHT
edge is intact).

Run: py -3.12 python_backend/tests/test_edge_clip_heal.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper as tm

fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1

# ── the exhibit geometry (page-normalised) ────────────────────────────────────────────────────────
TARGET = {"x_norm": 0.8148, "y_norm": 0.142, "w_norm": 0.0813, "h_norm": 0.015}   # composed box (clips 'D')
VALUE  = {"x_norm": 0.8096, "y_norm": 0.142, "w_norm": 0.0720, "h_norm": 0.015, "text": "DN-38626"}  # left-cut
VP = {"reference_code": "x"}   # inert — the reader is stubbed

# ── 1. pure helpers ───────────────────────────────────────────────────────────────────────────────
check("_clip_edges: value overhanging the box LEFT edge (right intact) -> 'L'", tm._clip_edges(VALUE, TARGET) == 'L')
check("_clip_edges: value overhanging the RIGHT edge -> 'R'",
      tm._clip_edges({"x_norm": 0.82, "w_norm": 0.09}, TARGET) == 'R')
check("_clip_edges: value overhanging BOTH -> 'LR' (no single un-cut edge)",
      tm._clip_edges({"x_norm": 0.80, "w_norm": 0.11}, TARGET) == 'LR')
check("_clip_edges: value inside the box -> None (no clip)",
      tm._clip_edges({"x_norm": 0.82, "w_norm": 0.05}, TARGET) is None)

check("_clip_contained L: dn38626 vs yn38626 (leading substitution, suffix intact) -> True",
      tm._clip_contained('dn38626', 'yn38626', 'L') is True)
check("_clip_contained L: a MIDDLE/right diff (i < MIN_INTACT on the intact suffix) -> False",
      tm._clip_contained('dn38526', 'dn38626', 'L') is False)
check("_clip_contained R: dn3862 vs dn38626 (trailing completion, prefix intact) -> True",
      tm._clip_contained('dn3862', 'dn38626', 'R') is True)
check("_clip_contained: identical -> False (nothing to heal)", tm._clip_contained('dn38626', 'dn38626', 'L') is False)
check("_clip_contained: wholesale-different -> False",
      tm._clip_contained('ab12345', 'yn38626', 'L') is False)

# ── 2. the placement certification rejects a NEIGHBOUR (Oracle: the un-cut-edge anchor IS the guard) ──
# A value in a slot to the RIGHT of the taught box (a right-neighbour), clip-contained on 'R', must FAIL
# the R anchor (ux1 - tx1 far exceeds k*tw) -> not certified.
NEIGHBOUR = {"x_norm": 0.90, "y_norm": 0.142, "w_norm": 0.07, "h_norm": 0.015, "text": "DN-38626"}
check("_snap_union_witness: a right-NEIGHBOUR (ux1 >> tx1) fails the un-cut-edge anchor -> False",
      tm._snap_union_witness([{"words": [NEIGHBOUR]}], NEIGHBOUR, 0.90, 0.97, "DN-38626", TARGET, 'R') is False)
check("_snap_union_witness: the exhibit value at the taught slot (L-cut, right edge intact) -> True",
      tm._snap_union_witness([{"words": [VALUE]}], VALUE, 0.8096, 0.8816, "DN-38626", TARGET, 'L') is True)

# ── 3. the DECISION through _maybe_pad_code (reuses its single pad read; C1/C2/C4) ───────────────────
check("_row_aligned: same-row token -> True; a different-row token -> False",
      tm._row_aligned(VALUE, TARGET) is True and tm._row_aligned({**VALUE, "y_norm": 0.30}, TARGET) is False)

_orig_pad = tm._read_pad_window_code
def heal(tight, pad_val, cand_box, *, tight_conf=95, pad_conf=90, anchor_text=None, full_conf=True,
         result_note=None, result_method='template_mapping', on=True, pad_on=True):
    """Drive _maybe_pad_code with a stubbed reader. tight_conf high + pad_conf below the +15 margin, so if
    the edge-clip branch does NOT certify, the margin gate returns the result UNCHANGED — isolating the heal.
    full_conf=True mirrors the labelled auto-file tier (90) the <88 cap must pull down."""
    tm._EDGE_CLIP_HEAL_ON = on
    tm._PAD_WINDOW_CODE_ON = pad_on
    if pad_val is None:
        tm._read_pad_window_code = lambda *a, **k: None
    else:
        tm._read_pad_window_code = (lambda page, box, vp, return_geom=False:
                                    (pad_val, pad_conf, cand_box) if return_geom else (pad_val, pad_conf))
    result = {"value": tight, "confidence": tight_conf, "method": result_method}
    if result_note:
        result["validation_note"] = result_note
    fl = lambda fk: None            # cold field — but the branch certifies/returns before consent
    try:
        return tm._maybe_pad_code(None, TARGET, 'reference_code', result, tight_conf,
                                  full_conf, "delivery_number", False, "delivery_number", VP, fl, fl,
                                  anchor_text=anchor_text)
    finally:
        tm._read_pad_window_code = _orig_pad

# ADOPT: the certified clip
out = heal("YN-38626", "DN-38626", VALUE)
check("ADOPT: certified L-cut substitution -> value swapped to DN-38626",
      out.get("value") == "DN-38626")
check("ADOPT: capped at 87 (below the 88 critical auto-file floor)", out.get("confidence") == 87)
check("ADOPT: method carries _edgeclipheal + _heal breadcrumb",
      str(out.get("method") or "").endswith("_edgeclipheal") and out.get("_heal") == "edge_clip"
      and out.get("edge_clip_from") == "YN-38626")

# NOT CERTIFIED -> byte-identical (margin gate keeps the commit)
check("NOT CERTIFIED (wrong row): a token off the box row is rejected by _row_aligned -> unchanged",
      heal("YN-38626", "DN-38626", {**VALUE, "y_norm": 0.30}).get("value") == "YN-38626")
check("NOT CERTIFIED (mid-glyph diff, not a clip): -> unchanged",
      heal("DN-38626", "DN-38526", VALUE).get("value") == "DN-38626")
check("NOT CERTIFIED (both edges cut, LR): -> unchanged",
      heal("YN-38626", "DN-38626", {**VALUE, "x_norm": 0.80, "w_norm": 0.11}).get("value") == "YN-38626")
check("NOT CERTIFIED (abstain / no pad code): -> unchanged",
      heal("YN-38626", None, None).get("value") == "YN-38626")

# C1 note-first: a result already flagged is NEVER lifted
check("C1 note-first: a result carrying a validation_note is never lifted",
      heal("YN-38626", "DN-38626", VALUE, result_note="please check").get("value") == "YN-38626")
# C1 already-healed method: a read-widen/edge-grow/raw-adopt result is never lifted
for m in ("template_mapping_readwiden", "template_mapping_edgegrow", "template_mapping_rawadopt"):
    check(f"C1 already-healed ({m}) is never lifted",
          heal("YN-38626", "DN-38626", VALUE, result_method=m).get("value") == "YN-38626")

# C4 label-glue: a candidate that swallowed the label tail is refused (falls through to the margin/flag)
check("C4 label-glue: a candidate beginning with the label tail is not adopted",
      heal("YN-38626", "NoDN-38626", {**VALUE, "text": "NoDN-38626"},
           anchor_text="Delivery No.").get("value") == "YN-38626")

# OFF == byte-identical (DARK)
check("OFF: the heal never fires when _EDGE_CLIP_HEAL_ON is False",
      heal("YN-38626", "DN-38626", VALUE, on=False).get("value") == "YN-38626")
# HARD dep: without the pad-code parent the whole _maybe_pad_code is inert
check("HARD dep: _PAD_WINDOW_CODE_ON off -> _maybe_pad_code inert (unchanged)",
      heal("YN-38626", "DN-38626", VALUE, pad_on=False).get("value") == "YN-38626")

# ── 4. source-shape pins (the C1-C5 seams live in the source, not just the stub) ─────────────────────
src = (Path(__file__).parent.parent / "extraction" / "template_mapper.py").read_text(encoding="utf-8")
check("C2: the heal lives INSIDE _maybe_pad_code (reuses its single pad read), before the consent/swap logic",
      "_EDGE_CLIP_HEAL_ON and pad_box is not None" in src
      and src.index("_EDGE_CLIP_HEAL_ON and pad_box is not None") < src.index("is_suffix = p.endswith(t)"))
check("C4: certification is sourced from the pad token's OWN geom, not full-page _ocr_lines",
      '_snap_union_witness([{"words": [pad_box]}]' in src)
check("ADOPT caps at the <88 provisional floor", '_PAD_CODE_PROVISIONAL_CAP' in src
      and tm._PAD_CODE_PROVISIONAL_CAP < 88)
check("HARD dep is enforced at the flag (strict subset of _PAD_WINDOW_CODE_ON)",
      "_EDGE_CLIP_HEAL_ON = _PAD_WINDOW_CODE_ON and os.environ.get('TEMPLATE_EDGE_CLIP_HEAL'" in src)

# C5 (trust.js): the 88-floor relax requires a page-text keyword witness for the _edgeclipheal family
tj = (Path(__file__).parent.parent.parent / "database" / "modules" / "trust.js").read_text(encoding="utf-8")
check("C5: trust.js requires _corrobLicensedKeyword for the _edgeclipheal method family",
      "_edgeclipheal" in tj and "_corrobLicensedKeyword(e.corroboration)" in tj)

tm._EDGE_CLIP_HEAL_ON = False   # leave the module clean
print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
