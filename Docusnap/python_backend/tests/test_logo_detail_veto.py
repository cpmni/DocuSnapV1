"""
test_logo_detail_veto.py — SLICE C: the isolated-mark VETO predicate `template_matcher._logo_detail_veto`.
It ABSTAINS the coarse logo pick when the cluster spans ≥2 suppliers AND the scanned mark's detail hash
disagrees with the picked template's enrolled set (a look-alike monogram collision). Pins:
  - ≥2-supplier cluster + mark disagrees → veto (abstain);
  - ≥2-supplier cluster + mark agrees → keep;
  - SINGLE-supplier cluster → NEVER veto (byte-identical — the load-bearing recall pin);
  - a 2nd supplier OUTSIDE band-13 doesn't count → single-supplier → keep;
  - fail-safe: missing query hash / empty stored set → keep;
  - kill switch LOGO_DETAIL_VETO=0 → keep.

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_logo_detail_veto.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.template_matcher import _logo_detail_veto, _AMBIG_LOGO_BAND

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1

BASE = '0' * 64
FAR  = 'f' * 25 + '0' * 39     # distance 100 from BASE (> 72 → disagrees)
NEAR = 'f' * 2 + '3' + '0' * 61  # distance 10  from BASE (≤ 72 → agrees)

def T(sup, detail=None):
    return {'dominant_supplier': sup, 'logo_detail_hashes': detail if detail is not None else [BASE]}

def main():
    # best_t = Cascade (mark set [BASE]); a Northgate sibling sits within band-13 → ≥2 suppliers.
    cross = [(T('Cascade'), 1), (T('Northgate'), 8)]
    check('≥2-supplier + mark DISAGREES (100 > 72) → VETO', _logo_detail_veto(cross, 1, cross[0][0], FAR) is True)
    check('≥2-supplier + mark AGREES (10 ≤ 72) → keep',    _logo_detail_veto(cross, 1, cross[0][0], NEAR) is False)

    # SINGLE-supplier cluster → never veto, even when the mark disagrees (recall: byte-identical).
    same = [(T('Cascade'), 1), (T('Cascade'), 8)]
    check('single-supplier cluster → NEVER veto (recall pin)', _logo_detail_veto(same, 1, same[0][0], FAR) is False)

    # A rival supplier OUTSIDE band-13 doesn't make it a collision cluster.
    far_rival = [(T('Cascade'), 1), (T('Northgate'), 1 + _AMBIG_LOGO_BAND + 5)]
    check('2nd supplier beyond band-13 → single-supplier → keep', _logo_detail_veto(far_rival, 1, far_rival[0][0], FAR) is False)

    # Fail-safe: a missing query hash / empty stored set → keep (never drop on missing data).
    check('missing query hash → keep', _logo_detail_veto(cross, 1, cross[0][0], None) is False)
    empty = [(T('Cascade', []), 1), (T('Northgate'), 8)]
    check('empty stored detail set → keep (Slice-B not accrued)', _logo_detail_veto(empty, 1, empty[0][0], FAR) is False)

    # Kill switch.
    os.environ['LOGO_DETAIL_VETO'] = '0'
    check('LOGO_DETAIL_VETO=0 → veto disabled (keep)', _logo_detail_veto(cross, 1, cross[0][0], FAR) is False)
    del os.environ['LOGO_DETAIL_VETO']
    check('re-enabled → vetoes again', _logo_detail_veto(cross, 1, cross[0][0], FAR) is True)

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
