#!/usr/bin/env python3
"""tests/test_registration_min_inliers.py — S-D VACUOUS-FIT GATE at BOTH call sites.

THE BUG THIS PINS (2026-08-06, Castellan Security credit_note / template 32):
`_fit_page_transform` has TWO callers — engine.py's Stage-2 anchor transform and
template_mapper's Stage-0.5 mapping transform. The `n_inliers < 3` refusal was written INLINE at
the Stage-2 site on 2026-08-01 and nowhere else, so Stage 0.5 kept consuming exactly the fits
Stage 2 refuses.

Live consequence: the template has 2 landmarks, one of them the 3-char table header 'Qty'. On the
sibling documents 'Qty' is not found in its taught box, so the page-wide fallback locate matched it
onto the line 'Castellan Security Systems' — `_label_score('qty', 'castellan security systems')`
= 0.667 >= the 0.6 threshold, because the longest common run is 'ty' (from "securi-TY") and the run
fraction is measured against the 3-char NEEDLE. The resulting 2-point fit is EXACTLY DETERMINED:
residual 0.000000, conf 78, scale 1.1445, rotation -166.71 deg. It displaced the taught supplier box
by 0.277 of the page, and `template_registration` overwrote a CORRECT operator-drawn read with the
customer block ('Bramblewood Joinery Ltd'), 'DELIVER TO', line totals, ... on 15 of 22 documents.

Run: py -3.12 python_backend/tests/test_registration_min_inliers.py
"""
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import registration as reg
from extraction import template_mapper as tm

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


class _T:
    def __init__(self, n):
        self.n_inliers = n


# ── the shared predicate ────────────────────────────────────────────────────────────────────────
os.environ.pop("REG_MIN_INLIERS_GATE", None)
check("default ON: a 2-inlier fit is unfalsifiable and must be refused",
      reg.is_unfalsifiable(_T(2)) is True)
check("a 3-inlier fit is verifiable (one point MORE than the minimal sample) -> kept",
      reg.is_unfalsifiable(_T(3)) is False)
check("a 5-inlier fit is kept", reg.is_unfalsifiable(_T(5)) is False)
check("None transform is not 'unfalsifiable' (nothing to refuse)",
      reg.is_unfalsifiable(None) is False)
check("MIN_VERIFIABLE_INLIERS is 3", reg.MIN_VERIFIABLE_INLIERS == 3)

os.environ["REG_MIN_INLIERS_GATE"] = "0"
check("kill switch restores the pre-gate behaviour byte-for-byte",
      reg.is_unfalsifiable(_T(2)) is False)
os.environ.pop("REG_MIN_INLIERS_GATE", None)

# ── THE EXHIBIT: the REAL measured Castellan correspondences ────────────────────────────────────
# src = taught landmark centres; dst = where they LOCATED on doc #705. 'Qty' (index 1) landed on the
# supplier-name line, 0.21 of page height above where it was taught.
SRC = [[0.5489, 0.2401], [0.6250, 0.3304]]
DST = [[0.5510, 0.2390], [0.4900, 0.1184]]
SUPPLIER_BOX = {"x_norm": 0.2743, "y_norm": 0.1076, "w_norm": 0.4505, "h_norm": 0.0239}

t = reg.fit_transform(SRC, DST, kind="similarity")
check("EXHIBIT: the bad pair still FITS (the fit itself cannot detect the false correspondence)",
      t is not None and t.n_inliers == 2)
check("EXHIBIT: its residual is 0 BY CONSTRUCTION — the self-consistency check is vacuous",
      t is not None and t.residual < 1e-12)
check("EXHIBIT: registration_confidence still scores it 78 (no penalty for being unverifiable)",
      reg.registration_confidence(t) == 78)
check("EXHIBIT: it displaces the taught supplier box by >0.2 of the page",
      reg.box_divergence(t, SUPPLIER_BOX) > 0.2)
check("EXHIBIT: the shared predicate REFUSES it", reg.is_unfalsifiable(t) is True)

# ── RANSAC collapse: the degeneracy is on INLIERS, not on the landmark count ────────────────────
# A 5-landmark template whose consensus collapses to 2 inliers refits on those 2 and is the SAME
# degenerate object. Gating on len(landmarks) would miss this entirely.
src5 = [[0.1, 0.1], [0.9, 0.1], [0.5, 0.5], [0.1, 0.9], [0.9, 0.9]]
dst5 = [[0.4, 0.7], [0.2, 0.35], [0.5, 0.5], [0.77, 0.2], [0.9, 0.9]]
t5 = reg.fit_transform(src5, dst5, kind="similarity")
check("COLLAPSE: a 5-landmark fit can still land on 2 inliers with residual ~0 and conf 78",
      t5 is not None and t5.n_inliers == 2 and t5.residual < 1e-12
      and reg.registration_confidence(t5) == 78)
check("COLLAPSE: the predicate refuses it too (predicate is on INLIERS, not on n_points)",
      reg.is_unfalsifiable(t5) is True)

# ── THE SHARED-MATCHER PIN (Oracle G5): the gate must NOT have touched _label_score ─────────────
# A future dev must not "fix" this class by loosening the fuzzy matcher instead. The false match
# that started it all is still a match at the line level — that is deliberate; the GATE is the fix.
check("G5: _label_score('qty','castellan security systems') is UNCHANGED and still >= threshold "
      "(the shared matcher was deliberately NOT retuned)",
      tm._label_score("qty", "castellan security systems") >= tm._FUZZY_MATCH_THRESHOLD)
check("G5: the 0.667 value itself is unchanged",
      abs(tm._label_score("qty", "castellan security systems") - 2.0 / 3.0) < 1e-9)

# ── G6: BOTH call sites must consume the SHARED helper, never an inlined copy ───────────────────
# This is the pin that would have caught the original bug: one site fixed, the other missed.
_ENG = (Path(__file__).parent.parent / "extraction" / "engine.py").read_text(encoding="utf-8")
_TM = (Path(__file__).parent.parent / "extraction" / "template_mapper.py").read_text(encoding="utf-8")
check("G6: engine.py (Stage-2 call site) consumes registration.is_unfalsifiable",
      "registration.is_unfalsifiable(" in _ENG)
check("G6: template_mapper.py (Stage-0.5 call site) consumes registration.is_unfalsifiable",
      "registration.is_unfalsifiable(" in _TM)
check("G6: engine.py imports registration (a call-time NameError is invisible to a module smoke)",
      re.search(r"^from extraction import .*\bregistration\b", _ENG, re.M) is not None)
check("G6: neither call site re-inlines the n_inliers condition "
      "(an inlined COPY is how one site got fixed and the other did not)",
      "n_inliers', 0) or 0) < 3" not in _ENG and "n_inliers\", 0) or 0) < 3" not in _TM)

# ── behavioural: _fit_page_transform itself refuses, so no caller can miss it ───────────────────
_real_locate = tm._locate_anchor
try:
    LM = [{"label_text": "DELIVER", "x_norm": 0.54, "y_norm": 0.236, "w_norm": 0.02, "h_norm": 0.008},
          {"label_text": "Qty", "x_norm": 0.62, "y_norm": 0.327, "w_norm": 0.02, "h_norm": 0.008}]
    _found = {"DELIVER": {"x_norm": 0.541, "y_norm": 0.235, "w_norm": 0.02, "h_norm": 0.008,
                          "matched_text": "DELIVER TO"},
              "Qty": {"x_norm": 0.48, "y_norm": 0.115, "w_norm": 0.02, "h_norm": 0.008,
                      "matched_text": "Castellan Security Systems"}}

    def _fake_locate(page, box, text, expansion, fn, **kw):
        return _found.get(text)

    tm._locate_anchor = _fake_locate
    out = tm._fit_page_transform(object(), LM, lambda img: [])
    check("BEHAVIOURAL: _fit_page_transform REFUSES the 2-inlier fit -> None (every caller "
          "inherits the guard; the rung falls through to the absolute read)",
          out is None)

    os.environ["REG_MIN_INLIERS_GATE"] = "0"
    out_off = tm._fit_page_transform(object(), LM, lambda img: [])
    check("BEHAVIOURAL: with the kill switch OFF the same call returns a Transform "
          "(proves this pin goes RED against the pre-fix code)",
          out_off is not None and out_off.n_inliers == 2)
    os.environ.pop("REG_MIN_INLIERS_GATE", None)
finally:
    tm._locate_anchor = _real_locate

print()
print(f"{fails} FAILED" if fails else "All REG_MIN_INLIERS gate pins passed")
sys.exit(1 if fails else 0)
