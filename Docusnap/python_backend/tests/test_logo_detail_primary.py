"""
test_logo_detail_primary.py — SLICE D: the PRIMARY detail-hash supplier resolver wired into
anchor.try_logo_supplier_match (kill switch LOGO_DETAIL_PRIMARY, default OFF). Pins:
  - PRIMARY off → veto-only behaviour, byte-identical (the coarse winner is returned as today);
  - AGREE (detail names the coarse winner) → coarse winner untouched (coarse confidence, NO note);
  - DISAGREE → OVERRIDE to the detail supplier, REVIEW-BOUND (conf 69 + validation_note, method 'logo');
  - coarse ambiguous/None + detail resolves → OVERRIDE (the doc-193 out-of-band case);
  - PRIMARY on + classify ABSTAINS → falls through so the Slice-C VETO still guards (Oracle Seam 3);
  - PINNED TRADE-OFF: even a 'confident'-band override is capped at 69 + note on first ship;
  - method invariant stays 'logo' (Oracle C3 — keeps the _genuine_template_supplier override unreachable).

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_logo_detail_primary.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
from PIL import Image, ImageOps, ImageFilter
import imagehash
from extraction import anchor

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1

def make_page():
    """A page with a compact top-left mark (so a coarse phash + detail hash are both computable)."""
    a = np.full((60, 120), 255, np.uint8)
    a[8:40, 8:40] = 20
    page = np.full((300, 240, 3), 255, np.uint8)
    page[0:60, 0:120] = a[:, :, None]
    return Image.fromarray(page, 'RGB')

def coarse_phash(page):
    """Replicate try_logo_supplier_match's internal coarse phash so fixtures can control the winner."""
    w, h = page.size
    crop = page.crop((0, 0, w // 2, h // 5)).convert('L')
    crop = ImageOps.autocontrast(crop, cutoff=5)
    crop = crop.resize((256, 256), Image.LANCZOS)
    crop = crop.filter(ImageFilter.GaussianBlur(radius=1))
    return str(imagehash.phash(crop, hash_size=8))

def complement(hexstr):
    """A 64-bit phash at Hamming 64 (full complement) → a decisive coarse LOSER."""
    return ''.join(format(15 - int(ch, 16), 'x') for ch in hexstr)

def at(d):
    """256-bit (64-hex) detail hash at exactly Hamming d from the query BASE ('0'*64)."""
    full, rem = d // 4, d % 4
    s = 'f' * full + {0: '', 1: '1', 2: '3', 3: '7'}[rem]
    return s + '0' * (64 - len(s))

def L(name, phash, detail):
    return {"supplier_name": name, "phash": phash, "detail_hash": detail}

def main():
    page = make_page()
    P    = coarse_phash(page)
    FARP = complement(P)             # decisive coarse loser
    QUERY = '0' * 64                 # the scanned mark; X's detail sits near it, Y's far
    XNEAR, YFAR = at(20), at(100)

    os.environ.pop('LOGO_DETAIL_VETO', None)     # default ON
    agree    = [L('X', P, XNEAR), L('Y', FARP, YFAR)]     # coarse winner = X; detail names X
    disagree = [L('Y', P, YFAR), L('X', FARP, XNEAR)]     # coarse winner = Y; detail names X

    # ── PRIMARY OFF (default): byte-identical veto-only path ──────────────────
    os.environ.pop('LOGO_DETAIL_PRIMARY', None)
    r = anchor.try_logo_supplier_match(page, agree, query_detail_hash=QUERY)
    check('PRIMARY off → coarse winner X returned unchanged (byte-identical)',
          r and r['supplier_name'] == 'X' and r['confidence'] != 69 and 'validation_note' not in r)
    # The disagree fixture: PRIMARY off can only ABSTAIN via the existing veto (None) — it can never
    # RESOLVE the collision. This is exactly the limitation the promotion fixes (contrast with below).
    r = anchor.try_logo_supplier_match(page, disagree, query_detail_hash=QUERY)
    check('PRIMARY off → disagree ABSTAINS via veto (None), cannot resolve (pre-promotion behaviour)',
          r is None)

    # ── PRIMARY ON ───────────────────────────────────────────────────────────
    os.environ['LOGO_DETAIL_PRIMARY'] = '1'

    # AGREE: coarse winner X, detail names X → coarse winner untouched (coarse conf, no note).
    r = anchor.try_logo_supplier_match(page, agree, query_detail_hash=QUERY)
    check('AGREE → coarse winner X untouched (conf != 69, no note)',
          r and r['supplier_name'] == 'X' and r['confidence'] != 69 and 'validation_note' not in r)

    # DISAGREE: coarse winner Y, detail names X → OVERRIDE to X, review-bound.
    r = anchor.try_logo_supplier_match(page, disagree, query_detail_hash=QUERY)
    check('DISAGREE → OVERRIDE to X (the detail supplier), not the coarse Y',
          r and r['supplier_name'] == 'X')
    check('override is REVIEW-BOUND: confidence 69',            r and r['confidence'] == 69)
    check('override carries a validation_note (the auto-file block)',
          r and bool(r.get('validation_note')))
    check('override method stays "logo" (Oracle C3 — precedence override unreachable)',
          r and r.get('method') == 'logo')
    check('override is flagged detail_override',                 r and r.get('detail_override') is True)

    # Coarse AMBIGUOUS (X & Y tie in coarse) + detail resolves X → OVERRIDE (doc-193 out-of-band).
    ambiguous = [L('X', P, XNEAR), L('Y', P, YFAR)]      # both coarse dist 0 → winner None
    r = anchor.try_logo_supplier_match(page, ambiguous, query_detail_hash=QUERY)
    check('coarse ambiguous (winner None) + detail resolves → OVERRIDE X@69+note',
          r and r['supplier_name'] == 'X' and r['confidence'] == 69 and bool(r.get('validation_note')))

    # PINNED TRADE-OFF (Seam F): a CONFIDENT-band override is STILL capped at 69 + note on first ship.
    conf_fixture = [L('Y', P, YFAR), L('X', FARP, at(20)), L('X', FARP, at(22))]  # X: 2 marks, dist 20 → confident
    r = anchor.try_logo_supplier_match(page, conf_fixture, query_detail_hash=QUERY)
    check('PINNED: confident-band override is STILL review-bound (band=confident, conf=69, note)',
          r and r.get('detail_band') == 'confident' and r['confidence'] == 69 and bool(r.get('validation_note')))

    # Seam 3: PRIMARY on but classify ABSTAINS (near-tie) → falls through so the VETO still fires → None.
    # Coarse winner X; detail near-tie Y@70 vs X@75 (both ≤80, diff<24) → classify abstains; then the veto
    # sees the pick (X@75 > 72) matching a rival (Y@70 ≤ 72) → abstain → None.
    veto_fix = [L('X', P, at(75)), L('Y', FARP, at(70))]
    r = anchor.try_logo_supplier_match(page, veto_fix, query_detail_hash=QUERY)
    check('Seam 3: PRIMARY on + classify abstains + veto conditions met → None (veto still guards)',
          r is None)

    # PRIMARY on but classify abstains (all detail far > accept 80) → fall through → coarse winner kept.
    far_all = [L('X', P, at(100)), L('Y', FARP, at(110))]
    r = anchor.try_logo_supplier_match(page, far_all, query_detail_hash=QUERY)
    check('PRIMARY on + classify abstains (all detail far) → coarse winner X kept (no override)',
          r and r['supplier_name'] == 'X' and r['confidence'] != 69 and 'validation_note' not in r)

    # No query detail hash → PRIMARY block skipped entirely → coarse winner (byte-identical).
    r = anchor.try_logo_supplier_match(page, disagree, query_detail_hash=None)
    check('no query detail hash → coarse winner Y (PRIMARY block skipped)',
          r and r['supplier_name'] == 'Y' and 'validation_note' not in r)

    os.environ.pop('LOGO_DETAIL_PRIMARY', None)
    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
