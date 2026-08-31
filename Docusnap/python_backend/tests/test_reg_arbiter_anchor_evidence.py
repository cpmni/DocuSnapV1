"""test_reg_arbiter_anchor_evidence.py — pins for TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE.

Run: py -3.12 python_backend/tests/test_reg_arbiter_anchor_evidence.py

THE DEFECT (measured 2026-08-09 NIGHT, Oracle FINAL RULING "the layer MOVED"):
absent evidence was being read as REFUTED evidence. The Stage-0.5 registration arbiter fires on
`not anchor_stable`, which is written to mean "this field's own label WAS looked for and could not
prove the page is stable". For a mapping with NO anchor needle it means "no label was ever looked
for" — `_extract_one`'s drift guard (`if abs_text and anchor_text and located is not _UNSET`) is
skipped outright, `anchor_stable` can never become True, and the arbiter then overrides a credible
absolute read on a GLOBAL transform divergence with zero local evidence that THIS box moved.

`template_field_mappings.anchor_text` is NULL for `supplier_name` on all seven live templates (a
letterhead company name has no printed caption), which is why the issuer is the only field that
suffers: 118 ok / 22 wrong, all 22 won by `template_registration` at conf 78-84, committing document
TITLES, ADDRESS lines and VAT lines. With registration off the same lane reads 140 / 0 / 0.

WHAT THESE PINS PROTECT
  • OFF is byte-identical — every ARMED case has an OFF twin that asserts the defect still reproduces
    (a green ARMED pin means nothing unless the OFF twin is red-by-construction).
  • THE PINNED TRADE-OFF (Oracle G5): a mapping WITH an anchor that simply FAILED TO LOCATE still
    takes the registration branch. "Looked for and not found" is evidence about the page; "never
    looked for" is not. Do not tidy the two into one test.
  • EVERY ARMED PIN ALSO ASSERTS THE PRE-EXISTING BRANCHES DECLINED FIRST (via the
    `declined_no_anchor_evidence` census entry), so a pin cannot go green because the arbiter was
    skipped for some unrelated reason — clean page, no transform, sub-tolerance divergence.
  • The conjunct is scoped to the ARBITER only. It does NOT cover the case where an anchor-less box
    on a genuinely drifted page reads garbage and displaces the curated seed downstream — that is
    Fix 2's (region presence confirm) job. Do not widen this conjunct to reach it.
"""
import os, sys
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))

import importlib                                              # noqa: E402
import numpy as np                                            # noqa: E402
from extraction import template_mapper as tm                  # noqa: E402
from extraction import registration                           # noqa: E402

CASES = []
def case(fn):
    CASES.append(fn)
    return fn


def _arm(**flags):
    """template_mapper reads its switches at IMPORT time (house style: the flag zone above the
    first def), so an arm must re-import the module and use the RETURNED reference."""
    for k, v in flags.items():
        if v:
            os.environ[k] = '1'
        else:
            os.environ.pop(k, None)
    return importlib.reload(tm)


# ── harness (mirrors tests/test_registration_arbiter.py, which pins the legacy behaviour) ────────
class FakePage:
    size = (1000, 1000)
    def crop(self, box):
        return ("crop", box)


FPS = {"invoice_number": {"validation": "alphanumeric"}}
VPS = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}
NO_LINES = lambda _crop: []


def transform(ty=0.0, scale=1.0, residual=0.001):
    return registration.Transform(np.array([[scale, 0.0, 0.0], [0.0, scale, ty]]),
                                  residual=residual, n_inliers=4, n_points=4, kind="similarity")


def mp(anchor_text="Invoice No", **ov):
    """A live-shaped mapping. `anchor_text=None` reproduces the issuer class: the taught VALUE box
    exists, dx/dy are 0.0, and there is no caption to search for."""
    m = {"field_key": "invoice_number", "page_number": 0, "anchor_text": anchor_text,
         "ocr_type": "alphanumeric", "search_expansion": 0.0, "enabled": True,
         "anchor_x_norm": 0.10, "anchor_y_norm": 0.18, "anchor_w_norm": 0.15, "anchor_h_norm": 0.03,
         "target_x_norm": 0.30, "target_y_norm": 0.20, "target_w_norm": 0.15, "target_h_norm": 0.04,
         "offset_dx_norm": 0.20, "offset_dy_norm": 0.02}
    if anchor_text is None:            # the live issuer mapping: NULL caption, dx = dy = 0.0
        m["offset_dx_norm"] = 0.0
        m["offset_dy_norm"] = 0.0
    m.update(ov)
    return m


def band_text(absolute_val, reg_val):
    """Stored target band (~y0.22) reads `absolute_val`; the transform-shifted band (~y0.34) reads
    `reg_val` — i.e. the wrong neighbouring row the arbiter would commit."""
    def stub(crop):
        _, (x1, y1, x2, y2) = crop
        cy = (y1 + y2) / 2.0 / 1000.0
        return absolute_val if cy < 0.27 else reg_val
    return stub


def _run(mod, mapping, page_transform, ocr_text_fn, located):
    del mod._EDGE_GUARD_FIRES[:]          # the census is per-process; isolate each case
    return mod._extract_one(FakePage(), mapping, FPS, NO_LINES, ocr_text_fn,
                            located=located, page_transform=page_transform,
                            validation_patterns=VPS)


def _declines(mod):
    return [e for e in mod._EDGE_GUARD_FIRES if e[1:] == ('reg_arbiter', 'declined_no_anchor_evidence')]


# ── OFF twins: the defect must still reproduce, or the ARMED pins prove nothing ──────────────────
@case
def test_off_anchorless_mapping_still_loses_to_the_arbiter():
    """CONTROL. Flag OFF, no anchor, drifted transform -> the registration read displaces the
    perfectly good absolute read. This is the live issuer bug, reproduced."""
    mod = _arm(TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE=False)
    out = _run(mod, mp(anchor_text=None), transform(ty=0.12),
               band_text("INV-001", "WORKSHEET"), located=None) or {}
    assert out.get("value") == "WORKSHEET", f'OFF must be byte-identical, got {out!r}'
    assert out.get("method", "").startswith("template_registration"), out.get("method")
    assert not _declines(mod), 'OFF must not even count'


@case
def test_off_anchored_mapping_unaffected():
    """OFF twin for the trade-off pin below: an anchored mapping whose locate FAILED already takes
    the registration branch today."""
    mod = _arm(TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE=False)
    out = _run(mod, mp(), transform(ty=0.12), band_text("INV-999", "INV-001"), located=None) or {}
    assert out.get("value") == "INV-001", out
    assert out.get("method", "").startswith("template_registration"), out.get("method")


# ── ARMED: the cure ──────────────────────────────────────────────────────────────────────────────
@case
def test_armed_anchorless_mapping_keeps_its_own_read():
    """THE FIX. No anchor needle -> no local test was ever run -> `not anchor_stable` is not
    evidence of drift -> the arbiter declines and the taught box's own read stands."""
    mod = _arm(TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE=True)
    out = _run(mod, mp(anchor_text=None), transform(ty=0.12),
               band_text("INV-001", "WORKSHEET"), located=None) or {}
    assert out.get("value") == "INV-001", f'the absolute read must stand, got {out!r}'
    assert out.get("method") == "template_mapping", out.get("method")
    assert len(_declines(mod)) == 1, 'the decline must be COUNTED, not silent (root cause stays censusable)'


@case
def test_armed_anchor_present_but_locate_failed_still_registers():
    """THE PINNED TRADE-OFF (Oracle G5). The label WAS looked for and was not found — that is real
    evidence about the page, so the arbiter keeps its jurisdiction. Anyone who "simplifies" the
    availability test into `not anchor_stable` breaks this."""
    mod = _arm(TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE=True)
    out = _run(mod, mp(), transform(ty=0.12), band_text("INV-999", "INV-001"), located=None) or {}
    assert out.get("value") == "INV-001", f'anchored-but-not-found must still register, got {out!r}'
    assert out.get("method", "").startswith("template_registration"), out.get("method")
    assert not _declines(mod), 'this mapping HAD anchor evidence; it must not be counted as absent'


# ── ARMED: the pre-existing declines must still own their cases (no green-for-the-wrong-reason) ──
@case
def test_armed_clean_page_never_reaches_the_conjunct():
    """Identity transform -> divergence ~0 -> the LEGACY tolerance test declines first. Asserting an
    empty census is the point: if this pin ever starts counting, the new conjunct has taken over a
    case that was already handled and the OFF-byte-identical claim is at risk."""
    mod = _arm(TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE=True)
    out = _run(mod, mp(anchor_text=None), transform(0.0), lambda _c: "INV-001", located=None) or {}
    assert out.get("value") == "INV-001" and out.get("method") == "template_mapping", out
    assert not _declines(mod), 'the divergence test declined first — the conjunct must not be reached'


@case
def test_armed_no_transform_never_reaches_the_conjunct():
    """No landmarks fitted -> `page_transform is None` declines first."""
    mod = _arm(TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE=True)
    out = _run(mod, mp(anchor_text=None), None, lambda _c: "INV-001", located=None) or {}
    assert out.get("method") == "template_mapping", out
    assert not _declines(mod), 'no transform — the conjunct must not be reached'


@case
def test_armed_anchor_stable_still_wins_without_the_new_conjunct():
    """An anchored mapping whose label is found AT ITS SPOT sets `anchor_stable` and declines the
    arbiter through the pre-existing route — unchanged by this flag."""
    mod = _arm(TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE=True)
    located = {"x_norm": 0.10, "y_norm": 0.18, "w_norm": 0.15, "h_norm": 0.03,
               "matched_text": "Invoice No",
               "label_box": {"x_norm": 0.10, "y_norm": 0.18, "w_norm": 0.15, "h_norm": 0.03}}
    out = _run(mod, mp(), transform(ty=0.12), band_text("INV-001", "INV-XXX"), located) or {}
    assert out.get("value") == "INV-001" and out.get("method") == "template_mapping", out
    assert not _declines(mod), 'anchor_stable declined first — not the new conjunct'


@case
def test_armed_absolute_empty_path_is_untouched():
    """The conjunct sits on the abs-text arbiter only. When the drawn box reads NOTHING, the
    downstream registration fallback (a different call site) must still run for an anchor-less
    mapping — otherwise the field silently disappears instead of falling back."""
    mod = _arm(TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE=True)
    out = _run(mod, mp(anchor_text=None), transform(ty=0.12),
               band_text(None, "INV-REG"), located=None) or {}
    assert out.get("value") == "INV-REG", f'abs-empty fallback must be unaffected, got {out!r}'
    assert not _declines(mod), 'the abs-text arbiter was never entered (abs_text empty)'


def main():
    fails = 0
    for fn in CASES:
        try:
            fn()
            print(f"  OK  {fn.__name__}")
        except AssertionError as e:
            fails += 1
            print(f"  BAD {fn.__name__}: {e}")
    _arm(TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE=False)     # leave the process clean
    if fails:
        print(f"{fails} check(s) failed - TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE regressed.")
        return 1
    print("All checks passed - the arbiter overrides only where anchor evidence was available and failed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
