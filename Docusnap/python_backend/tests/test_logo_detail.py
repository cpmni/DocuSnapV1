"""
test_logo_detail.py — pins the INTERIOR mark-isolation detail hash (logo_detail.py), the logo-
collision discriminator (GATE-0 2026-07-14: mark-isolated 256-bit SEPARATES the Northgate/Cascade
monogram pair by ~94 bits where the coarse region hash collides, and identically on a B&W scan).

Deterministic (synthetic images — no rendering): the pure-NumPy connected-components, the logo-blob
selection (compact mark kept, thin text strip rejected), the fail-safe None, and colour-free/B&W
equivalence. The real-doc margin is gated separately by stress_test/logo_detail_probe.js.

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_logo_detail.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
from PIL import Image
import logo_detail as LD

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1

def gray_from(arr):
    """arr: 2-D uint8 → an RGB PIL page whose top-left region (w//2 × h//5) IS this content.
    detail_hash crops (0,0,w//2,h//5), so build a page 2× wide and 5× tall around it."""
    h, w = arr.shape
    page = np.full((h * 5, w * 2, 3), 255, np.uint8)
    page[0:h, 0:w] = arr[:, :, None]
    return Image.fromarray(page, 'RGB')

def main():
    # 1. Connected components (pure NumPy): two separated blobs → exactly 2 components.
    m = np.zeros((24, 24), bool)
    m[2:8, 2:8] = True; m[14:20, 14:20] = True
    labels, n = LD._label_components(m)
    check('CC: two separated blobs → 2 components', n == 2)
    check('CC: each blob is a single label', len(set(labels[2:8, 2:8].ravel().tolist())) == 1
          and len(set(labels[14:20, 14:20].ravel().tolist())) == 1
          and labels[2, 2] != labels[14, 14])
    # L-shape = ONE 4-connected component.
    m2 = np.zeros((10, 10), bool); m2[1:8, 1:3] = True; m2[6:8, 1:8] = True
    _, n2 = LD._label_components(m2)
    check('CC: an L-shape is ONE component (4-connectivity)', n2 == 1)

    # 2. Blob selection: a COMPACT dark square + a thin dark horizontal text strip → the square wins.
    a = np.full((60, 120), 255, np.uint8)
    a[8:40, 8:40] = 20                      # compact square-ish mark (32×32)
    a[50:54, 5:115] = 20                    # thin wide "text" strip (4×110) — must be rejected
    bbox = LD._mark_bbox(Image.fromarray(a, 'L'))
    check('mark bbox found', bbox is not None)
    if bbox:
        x0, y0, x1, y1 = bbox
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        check('blob selection: picks the COMPACT square, not the thin text strip',
              8 <= cx <= 40 and 8 <= cy <= 40 and (y1 - y0) < 45)

    # 3. detail_hash: a mark → 256-bit (64 hex chars); a blank region → None (fail-safe).
    mark_page = gray_from(a)
    hh = LD.detail_hash(mark_page)
    check('detail_hash on a mark → 64-hex-char (256-bit) string', isinstance(hh, str) and len(hh) == 64)
    blank = Image.new('RGB', (240, 300), (255, 255, 255))
    check('detail_hash on a blank region → None (fail-safe → caller skips the gate)',
          LD.detail_hash(blank) is None)

    # 4. detail_distance: identical → 0; None inputs → None (missing hash = skip, never a false abstain).
    check('detail_distance identical → 0', LD.detail_distance(hh, hh) == 0)
    check('detail_distance with a missing hash → None', LD.detail_distance(hh, None) is None
          and LD.detail_distance(None, hh) is None)

    # 5. COLOUR-FREE / B&W equivalence: the same mark rendered in colour vs bitonal hashes the SAME
    #    (the discriminator survives black-and-white scanning — the owner's constraint).
    colour = a.copy()
    colour_page = np.full((60 * 5, 120 * 2, 3), 255, np.uint8)
    colour_page[0:60, 0:120, 0] = a; colour_page[0:60, 0:120, 1] = a // 3; colour_page[0:60, 0:120, 2] = a // 2
    h_col = LD.detail_hash(Image.fromarray(colour_page, 'RGB'))
    bitonal = np.where(a < 128, 0, 255).astype(np.uint8)
    h_bw = LD.detail_hash(gray_from(bitonal))
    d = LD.detail_distance(h_col, h_bw)
    check('B&W-robust: colour vs bitonal of the same mark hash within a small margin (≤ 20/256)',
          d is not None and d <= 20)

    # 6. Slice C veto helper — min-over-set distance + the abstain decision (fail-safe on missing data).
    base = '0' * 64                       # 256 zero bits
    far  = 'f' * 25 + '0' * 39            # 100 one-bits → distance 100 from base
    near = 'f' * 2 + '3' + '0' * 61       # 10 one-bits  → distance 10  from base
    check('constructed distances are exact (self-check)',
          LD.detail_distance(base, far) == 100 and LD.detail_distance(base, near) == 10)
    check('min_over_set = smallest distance to the set', LD.min_over_set(far, [base, far]) == 0)
    check('min_over_set = None on missing query / empty set',
          LD.min_over_set(None, [base]) is None and LD.min_over_set(far, []) is None)

    T = 72
    check('VETO: mark FAR from the set (100 > 72) → abstain',        LD.should_veto_logo(far,  [base], T) is True)
    check('KEEP: mark CLOSE to the set (10 ≤ 72) → no veto',         LD.should_veto_logo(near, [base], T) is False)
    check('KEEP: FAR from one member but CLOSE to another (min-over-set)',
          LD.should_veto_logo(far, [base, far], T) is False)
    check('FAIL-SAFE: missing query hash → never veto (keep coarse pick)', LD.should_veto_logo(None, [base], T) is False)
    check('FAIL-SAFE: empty stored set → never veto',               LD.should_veto_logo(far, [], T) is False)
    check('FAIL-SAFE: all-null stored set → never veto',            LD.should_veto_logo(far, [None, None], T) is False)
    check('threshold override respected (100 > 90 → veto; 100 ≤ 120 → keep)',
          LD.should_veto_logo(far, [base], 90) is True and LD.should_veto_logo(far, [base], 120) is False)
    check('default threshold ≈ measured 72 (env-overridable)', LD._veto_dist() == 72)

    # 7. Slice D — classify_supplier PRIMARY resolver (pure; fail-safe; the ties/band rules).
    def at(d):
        """A 64-hex (256-bit) string at exactly Hamming `d` from base ('0'*64) — i.e. from the query."""
        full, rem = d // 4, d % 4
        s = 'f' * full + {0: '', 1: '1', 2: '3', 3: '7'}[rem]
        return s + '0' * (64 - len(s))
    q = '0' * 64
    check('classify self-check: at(d) is exactly d from the query', LD.detail_distance(q, at(37)) == 37)
    check('default thresholds (env-overridable): accept 80 / confident 48 / margin 24',
          LD._accept_dist() == 80 and LD._confident_dist() == 48 and LD._accept_margin() == 24)

    # confident band: nearest ≤48 AND ≥2 marks
    check('classify: nearest 30 with 2 marks → confident',
          LD.classify_supplier(q, {'X': [at(30), at(35)]}) == ('X', 30, 'confident'))
    # single ref can NEVER be confident (drift envelope unproven) — cold-start pin
    check('classify: nearest 20 but ONE mark → review (single ref not confident)',
          LD.classify_supplier(q, {'X': [at(20)]}) == ('X', 20, 'review'))
    # review band: confident_thr < dist ≤ accept_thr
    check('classify: nearest 60 → review band',
          LD.classify_supplier(q, {'X': [at(60), at(70)]}) == ('X', 60, 'review'))
    # decisive multi-supplier pick
    check('classify: decisive nearest (20 vs 100) → confident X',
          LD.classify_supplier(q, {'X': [at(20), at(22)], 'Y': [at(100)]}) == ('X', 20, 'confident'))
    # nearest beyond accept → abstain to coarse
    check('classify: nearest 100 (> accept 80) → (None,100,None) → coarse',
          LD.classify_supplier(q, {'X': [at(100)]}) == (None, 100, None))
    # NEAR-TIE: two viable suppliers within margin → abstain (never pick-nearest on a tie)
    check('classify: near-tie 60 vs 70 (both ≤80, diff<24) → abstain',
          LD.classify_supplier(q, {'X': [at(60)], 'Y': [at(70)]}) == (None, 60, None))
    check('classify: near-tie fires even at confident distance (20 vs 30) → abstain',
          LD.classify_supplier(q, {'X': [at(20), at(21)], 'Y': [at(30)]}) == (None, 20, None))
    # Seam-4 boundary: runner-up NOT viable (>accept) → NOT a tie → resolve the nearest
    check('classify: 60 vs 95 (runner-up >accept) → resolve X, not abstain',
          LD.classify_supplier(q, {'X': [at(60)], 'Y': [at(95)]}) == ('X', 60, 'review'))
    # fail-safe
    check('classify FAIL-SAFE: None query → (None,None,None)',
          LD.classify_supplier(None, {'X': [at(10)]}) == (None, None, None))
    check('classify FAIL-SAFE: empty supplier map → (None,None,None)',
          LD.classify_supplier(q, {}) == (None, None, None))
    check('classify FAIL-SAFE: all-null / empty sets → (None,None,None)',
          LD.classify_supplier(q, {'X': [None], 'Y': []}) == (None, None, None))

    # 8. detail_cross_plant_closer — enrolment guard (Oracle C1). True = refuse (would poison the picker).
    # POISON: a Northgate mark presented under Cascade — Cascade has no own detail yet (cold-start) but
    # the mark positively matches Northgate → REFUSE.
    check('cross-plant: cold-start, mark matches a rival (10) → refuse',
          LD.detail_cross_plant_closer(q, [], {'Northgate': [at(10)]}) is True)
    # POISON with own present: mark far from Cascade's own (100) but close to Northgate (10) → refuse.
    check('cross-plant: closer to rival (10) than own (100) → refuse',
          LD.detail_cross_plant_closer(q, [at(100)], {'Northgate': [at(10)]}) is True)
    # LEGIT first mark: Cascade cold-start, its genuine mark is FAR from every rival (inter ~108) → plant.
    check('cross-plant COLD-START SAFE: legit first mark far from all rivals (108) → plant',
          LD.detail_cross_plant_closer(q, [], {'Northgate': [at(108)]}) is False)
    # LEGIT with own: close to own (15), rival far (108) → plant.
    check('cross-plant: closer to own (15) than rival (108) → plant',
          LD.detail_cross_plant_closer(q, [at(15)], {'Northgate': [at(108)]}) is False)
    # ambiguous but NOT decisively closer to rival (own 30, rival 35) → plant (margin not met).
    check('cross-plant: rival barely closer, margin not met → plant',
          LD.detail_cross_plant_closer(q, [at(30)], {'Northgate': [at(35)]}) is False)
    check('cross-plant FAIL-SAFE: no query → plant (nothing to poison)',
          LD.detail_cross_plant_closer(None, [at(30)], {'Y': [at(10)]}) is False)
    check('cross-plant: no rival detail at all → plant',
          LD.detail_cross_plant_closer(q, [at(30)], {}) is False)

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
