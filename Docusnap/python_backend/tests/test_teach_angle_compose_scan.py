"""test_teach_angle_compose_scan.py — TEACH_ANGLE_COMPOSE_SCAN pins (2026-08-09).

Run: py -3.12 python_backend/tests/test_teach_angle_compose_scan.py

WHAT THIS PINS. A taught box carries the teach sample's tilt θ_t; the document being read has its
own tilt θ_s. At 1.6° a 0.16-wide box's centre moves ~0.010 page-height — about three quarters of a
text line — which is exactly enough to shear a 2-row-tall free-text box onto the caption row or the
address row. This composes the box by (θ_t − θ_s) so it lands where the value actually is.

WHY THIS AND NOT STRAIGHTENING THE PAGE (Oracle, 2026-08-09, "fix placement, not pixels"):
rotating the pixels healed 213 of 1127 cells on the synthetic corpus — but that corpus tilts every
page by at most 1.6° (gen_customer_test.py:675), entirely inside the band Tesseract self-tolerates
and inside DESKEW_RAW_CROP_MAX_ANGLE (2.0), and inside the band where this project's own doc-561
probe measured deskew making a REAL scan worse. Re-run at a 2.0° floor the whole heal vanished —
0 of 1127 cells moved — proving the gain came only from the harmful band. Measured placement-only:
customer 52 wrong -> 2, date 21 -> 0, issuer 49 -> 25, no lane regressed, no pixel rotated.

THE ANTI-LOOSEN CONTRACT:
  • THE SIGN IS THE FIX. It is derived, not chosen: teach surfaces persist raw = C + R(+θ)·(level−C)
    and _compose_box_to_level yields C + R(−θ)·(p−C), so composing teach→this page needs
    θ = (θ_t − θ_s). Test 1 re-derives it independently. If it fails, every box moves the WRONG WAY
    and the damage is worse than the defect.
  • w/h MUST be preserved. A corner-AABB would bloat a wide box vertically by w·sinθ — about half a
    text line for a 0.2-wide box at 1.6° — pulling the caption INTO the crop. That is the exact
    'INVOICE TO' crater the deskew sibling documents.
  • Below 0.2° is the detector's own noise floor: composing there is acting on nothing.
  • Stored rows are NEVER mutated — copies only.
"""
import math, os, sys
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))

from extraction.engine import (_compose_box_to_level, _compose_mappings_to_level,   # noqa: E402
                               _COMPOSE_SCAN_MIN_NET, _COMPOSE_SCAN_MAX_NET)

CASES = []
def case(fn):
    CASES.append(fn)
    return fn

W = H = 1000
BOX = (0.06, 0.24, 0.16, 0.015)          # the measured Pelican customer_name shape
centre = lambda b: (b[0] + b[2] / 2.0, b[1] + b[3] / 2.0)


@case
def test_the_sign_is_the_documented_raw_transform():
    """Compose by (θ_t − θ_s) and the centre must land exactly where raw = C + R(+θ_s)·(level − C)
    puts it — the transform the teach surfaces themselves persist with. Derived independently here
    so this pin fails if either side's convention is ever flipped."""
    for tt, ts in ((0.0, 0.5), (0.0, 1.6), (0.0, -1.6), (0.7, 1.6), (-0.4, 0.9)):
        out = _compose_box_to_level(*BOX, tt - ts, W, H)
        cx0, cy0 = centre(BOX)
        cx1, cy1 = centre(out)
        th = math.radians(ts - tt)
        px, py = (cx0 - 0.5) * W, (cy0 - 0.5) * H
        exp_x = 0.5 + (math.cos(th) * px - math.sin(th) * py) / W
        exp_y = 0.5 + (math.sin(th) * px + math.cos(th) * py) / H
        assert abs(cx1 - exp_x) < 1e-9 and abs(cy1 - exp_y) < 1e-9, \
            f'θ_t={tt} θ_s={ts}: got ({cx1:.6f},{cy1:.6f}) want ({exp_x:.6f},{exp_y:.6f})'


@case
def test_it_moves_far_enough_to_matter_and_not_further():
    """The defect is a ~1 text-line shear. At 1.6° the vertical move must be a meaningful fraction
    of a line (else the fix is inert) and must not be wild (else it is a new defect)."""
    out = _compose_box_to_level(*BOX, 0.0 - 1.6, W, H)
    dy = abs(centre(out)[1] - centre(BOX)[1])
    assert 0.004 <= dy <= 0.02, f'vertical move {dy:.4f} page-height is outside the plausible band'


@case
def test_width_and_height_are_never_changed():
    """A corner-AABB compose would bloat height by w·sinθ and pull the caption into the crop."""
    for ts in (0.3, 1.6, 3.0, -2.2):
        out = _compose_box_to_level(*BOX, -ts, W, H)
        assert out[2] == BOX[2] and out[3] == BOX[3], f'size changed at {ts}°: {out[2:]} vs {BOX[2:]}'


@case
def test_zero_net_angle_is_a_no_op():
    """Taught and read at the SAME tilt ⇒ the stored box is already right ⇒ nothing moves."""
    # Tolerance, not equality: the transform round-trips through cos(0)/sin(0) in float, so an
    # exact compare fails on 0.06 -> 0.06000000000000001. A whole page is 1.0, so 1e-9 is ~1 nanometre
    # of A4 — anything this pin would miss is far below a pixel.
    out = _compose_box_to_level(*BOX, 0.0, W, H)
    assert all(abs(a - b) < 1e-9 for a, b in zip(out, BOX)), \
        f'zero-net compose moved the box: {out} vs {BOX}'


@case
def test_the_net_angle_band_is_bounded_at_both_ends():
    """Below the detector's noise floor there is nothing to correct; far beyond it the page is not
    'slightly askew' and belongs in review, not silently re-placed."""
    assert _COMPOSE_SCAN_MIN_NET >= 0.2, 'floor must not drop below the detector noise floor'
    assert 2.0 <= _COMPOSE_SCAN_MAX_NET <= 10.0, 'ceiling should bound a plausible scan skew'


@case
def test_stored_mapping_rows_are_never_mutated():
    """Composition returns COPIES. A mutated row would rewrite the operator's teach on disk."""
    src = [{'field_key': 'customer_name',
            'anchor_x_norm': 0.06, 'anchor_y_norm': 0.23, 'anchor_w_norm': 0.08, 'anchor_h_norm': 0.007,
            'target_x_norm': 0.06, 'target_y_norm': 0.24, 'target_w_norm': 0.16, 'target_h_norm': 0.015}]
    before = [dict(r) for r in src]
    out = _compose_mappings_to_level(src, -1.6, W, H)
    assert src == before, 'source mapping rows were mutated'
    assert out[0]['target_y_norm'] != before[0]['target_y_norm'], 'compose produced no change'
    assert out[0]['field_key'] == 'customer_name', 'non-geometry keys must survive the copy'


@case
def test_the_two_compose_paths_are_mutually_exclusive():
    """Wiring: the deskew sibling requires raw_pages (page WAS rotated); this one requires their
    absence. If a future edit lets both fire, boxes get composed twice and land nowhere."""
    src = open(os.path.join(_HERE, '..', 'extraction', 'engine.py'), encoding='utf-8').read()
    i = src.find('TEACH_ANGLE_COMPOSE and not DESKEW_RAW_CROPS')
    j = src.find('TEACH_ANGLE_COMPOSE_SCAN and not raw_pages')
    assert i > 0 and j > i, 'the two compose branches are not where this pin expects them'
    assert 'elif' in src[i:j], 'the scan branch must be an elif of the deskew branch, not independent'


if __name__ == '__main__':
    failed = 0
    for fn in CASES:
        try:
            fn(); print(f'  PASS  {fn.__name__}')
        except AssertionError as e:
            failed += 1; print(f'  FAIL  {fn.__name__}: {e}')
        except Exception as e:                                    # noqa: BLE001
            failed += 1; print(f'  ERROR {fn.__name__}: {type(e).__name__}: {e}')
    print(f'\n{len(CASES) - failed}/{len(CASES)} passed')
    sys.exit(1 if failed else 0)
