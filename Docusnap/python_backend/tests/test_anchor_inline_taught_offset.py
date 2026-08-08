"""test_anchor_inline_taught_offset.py — ANCHOR_INLINE_TAUGHT_OFFSET_VETO pins (2026-08-08).

Run: py -3.12 python_backend/tests/test_anchor_inline_taught_offset.py

WHAT THIS PINS. A ⊕-taught anchor's INLINE harvest must come from the position the teach recorded.
The label-locate strip is FULL PAGE WIDTH on purpose (a key/value value can sit in a far column) and
`cluster_value_words` only splits the post-label words into gap-runs and takes the run nearest the
label's right edge — with a SINGLE run it returns it UNCHANGED (template_mapper.py:2229). So when
the neighbouring block's HEADING is the only thing after the label on that OCR row, it IS the
harvest. No absolute label→value distance test existed on this path.

EVERY NUMBER BELOW IS MEASURED off live document #740 (Pelican Office Interiors delivery note,
field_anchors id 73), not invented:
  taught anchor  value CENTRE (0.16437, 0.25424) w 0.21094 h 0.012648, direction 'below',
                 offset (dx 0.100106, dy 0.018322)   [offset = value_centre - label_top_left]
  located label  'CUSTOMER'  x 0.0677  y 0.2332  w 0.0766  h 0.0063
  BAD harvest    the word 'SHIP' of the right-hand "SHIP TO" block, x 0.5173 y 0.2336 w 0.0209
                 — committed live as 'sui' / 'sup' / 'sup to' at conf 70-82 across 9 documents
  GOOD harvest   'Bramblewood Joinery Ltd'      x 0.0685 y 0.2474 w 0.1563 h 0.0074

TWO LEGS:
  1. DIRECTION — an inline harvest is always same-ROW as the label, so an anchor taught 'below' or
     'above' can never legitimately produce one (owner, 2026-08-08: "it was taught as being below,
     not right"). No tolerance expresses this — one line of separation is ~0.015 against tol_y 0.14.
  2. DISTANCE — 'right' anchors CAN harvest inline, so they are judged on position vs the teach.

THE ANTI-LOOSEN CONTRACT:
  • PRECISION, not distance-phobia: on a 'right' anchor a harvest at the taught offset MUST still be
    accepted, and a legitimate FAR-column value (taught dx 0.55) too — that layout is exactly why the
    locate strip is full-page-width. Do not "simplify" leg 2 into a fixed maximum gap from the label.
  • It may only ever DROP a harvest. The crop read seated at the SAME taught offset then runs, so the
    fall-through target is the taught box — never a new value, never a different rung's value.
  • Unverifiable => ACCEPT. OFF, no usable offset (legacy pre-migration-21 anchors), or no inline_box
    geometry (text-layer line without per-word boxes) are all byte-identical to before.
  • Tolerances are the label veto's own _RELOC_TOL_X/_RELOC_TOL_Y — one source, not a second opinion.
"""
import os, sys
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))

from extraction import anchor  # noqa: E402

FLAG = "ANCHOR_INLINE_TAUGHT_OFFSET_VETO"

# ── the measured live geometry ───────────────────────────────────────────────
VBOX = (0.16437, 0.25424, 0.21094, 0.012648)      # taught value box (CENTRE convention)
OFFSET = (0.100106, 0.018322)
LABEL = {"x_norm": 0.0677, "y_norm": 0.2332, "w_norm": 0.0766, "h_norm": 0.0063}
BAD = {"x_norm": 0.5173, "y_norm": 0.2336, "w_norm": 0.0209, "h_norm": 0.006435}   # 'SHIP'
GOOD = {"x_norm": 0.0685, "y_norm": 0.2474, "w_norm": 0.1563, "h_norm": 0.0074}    # the real name


def located(inline_box, label_box=None):
    return {"label_box": label_box or LABEL, "inline_value": "x", "inline_box": inline_box,
            **(label_box or LABEL)}


def on(): os.environ[FLAG] = "1"
def off(): os.environ.pop(FLAG, None)


CASES = []
def case(fn):
    CASES.append(fn)
    return fn


@case
def test_off_is_byte_identical():
    """OFF: even the far-column caption is accepted — the switch is a true no-op."""
    off()
    assert anchor._inline_at_taught_offset(located(BAD), "below", VBOX, OFFSET) is True


@case
def test_on_vetoes_the_neighbouring_block_heading():
    """ON: the live defect. 'SHIP' is 0.36 of a page from where the teach put the value."""
    on()
    assert anchor._inline_at_taught_offset(located(BAD), "below", VBOX, OFFSET) is False


@case
def test_on_below_anchor_refuses_every_inline_harvest():
    """LEG 1, the owner's point (2026-08-08): 'it was taught as being below, not right'. An inline
    harvest is always same-ROW as the label, so a 'below' teach can never legitimately produce one —
    refused even when the harvested text happens to be the correct value, because the crop seated at
    the taught offset reads that same value anyway (pinned by test_fall_through_target_is_the_taught
    _box). This is the leg that covers a neighbouring block sitting CLOSER than tol_x, where the
    distance leg alone would wave the caption through."""
    on()
    assert anchor._inline_at_taught_offset(located(GOOD), "below", VBOX, OFFSET) is False
    assert anchor._inline_at_taught_offset(located(BAD), "above", VBOX, OFFSET) is False
    near = {"x_norm": 0.2600, "y_norm": 0.2336, "w_norm": 0.0300, "h_norm": 0.0064}   # Δx 0.09 < tol
    assert anchor._inline_at_taught_offset(located(near), "below", VBOX, OFFSET) is False, \
        "a NEAR neighbouring caption is exactly what leg 1 exists for"


@case
def test_on_right_anchor_keeps_precision():
    """LEG 2: a 'right' anchor CAN harvest inline, so it is judged on POSITION only. A harvest at the
    taught offset is kept; one from another column is refused. If the first assertion ever fails the
    veto has become a blunt distance cap and would suppress correct reads."""
    on()
    r_off = (0.1400, 0.0020)
    r_vbox = (0.2100, 0.2340, 0.1200, 0.0070)
    good_r = {"x_norm": 0.1900, "y_norm": 0.2332, "w_norm": 0.0900, "h_norm": 0.0063}
    assert anchor._inline_at_taught_offset(located(good_r), "right", r_vbox, r_off) is True
    assert anchor._inline_at_taught_offset(located(BAD), "right", r_vbox, r_off) is False


@case
def test_on_accepts_a_legitimate_far_column_value():
    """ON: a key/value row whose value genuinely sits far right — TAUGHT that way (dx 0.55) — is
    accepted. This is the case the full-page-width locate strip exists for, and the reason leg 2 is
    a comparison against the TEACH rather than a fixed maximum gap."""
    on()
    far_off = (0.55, 0.0)
    far_box = {"x_norm": 0.5173, "y_norm": 0.2332, "w_norm": 0.1000, "h_norm": 0.0063}
    assert anchor._inline_at_taught_offset(located(far_box), "right", VBOX, far_off) is True


@case
def test_on_no_offset_legacy_anchor_is_never_vetoed():
    """A pre-migration-21 anchor carries no offset, so the value cannot be placed from the label —
    unverifiable, therefore ACCEPT. Vetoing here would silently disarm every legacy taught anchor."""
    on()
    assert anchor._inline_at_taught_offset(located(BAD), "below", VBOX, (None, None)) is True
    assert anchor._inline_at_taught_offset(located(BAD), "below", VBOX, (0.0, 0.0)) is True


@case
def test_on_missing_inline_geometry_is_never_vetoed():
    """A born-digital text line with no per-word boxes yields no inline_box → cannot verify → accept."""
    on()
    assert anchor._inline_at_taught_offset(located(None), "below", VBOX, OFFSET) is True
    assert anchor._inline_at_taught_offset({}, "below", VBOX, OFFSET) is True
    assert anchor._inline_at_taught_offset(located({"x_norm": 0.5}), "below", VBOX, OFFSET) is True


@case
def test_fall_through_target_is_the_taught_box():
    """The veto only DROPS the harvest; what runs next is the crop seated at the taught offset. Pin
    that this fall-through lands on the VALUE (the name), not on the caption — i.e. dropping the
    harvest on #740 yields the correct read rather than a different failure."""
    placed = anchor._place_from_located(located(BAD), "below", VBOX, offset=OFFSET)
    cx, cy, w, h = placed
    left, right = cx - w / 2.0, cx + w / 2.0
    top, bottom = cy - h / 2.0, cy + h / 2.0
    name_l, name_r = GOOD["x_norm"], GOOD["x_norm"] + GOOD["w_norm"]
    assert left <= name_l and right >= name_r, f"crop {left:.4f}-{right:.4f} misses the name"
    assert top <= GOOD["y_norm"] + GOOD["h_norm"] and bottom >= GOOD["y_norm"], "crop misses the name row"
    assert right < BAD["x_norm"], "the taught crop must not reach the neighbouring block"


@case
def test_both_committing_doors_are_guarded():
    """Wiring, not behaviour: BOTH inline consumers that COMMIT a value call the veto. The third
    consumer (the ref/date crosscheck) only FLAGS and is a documented seam — pinned so a future
    edit cannot quietly add a fourth unguarded door."""
    import inspect, re
    src = inspect.getsource(anchor._eval_field_group)   # both committing doors live in this rung
    calls = len(re.findall(r"_inline_at_taught_offset\(", src))
    assert calls >= 2, f"expected both committing doors guarded, found {calls} call sites"
    whole = open(anchor.__file__, encoding="utf-8").read()
    assert whole.count("inline_value") >= 3, "inline consumers moved — re-audit the doors"
    assert "SEAM, deliberate" in whole, "the unguarded flag-only door lost its seam note"


if __name__ == "__main__":
    failed = 0
    for fn in CASES:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL  {fn.__name__}: {e}")
        finally:
            off()
    print(f"\n{len(CASES) - failed}/{len(CASES)} passed")
    sys.exit(1 if failed else 0)
