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

def T(sup, detail):
    return {'dominant_supplier': sup, 'logo_detail_hashes': detail}

def main():
    # Cascade is the coarse pick (its template is closest); its enrolled mark = BASE. The Northgate rival
    # template's enrolled mark = FAR. The scanned mark (query) = FAR → far from Cascade(BASE), == Northgate.
    CAS, NG = T('Cascade', [BASE]), T('Northgate', [FAR])
    cross = [(CAS, 1), (NG, 8)]
    check('mark belongs to a RIVAL (far from pick, matches Northgate) → VETO', _logo_detail_veto(cross, 1, CAS, FAR) is True)
    check('mark AGREES with the pick (query NEAR Cascade) → keep',            _logo_detail_veto(cross, 1, CAS, NEAR) is False)

    # Far from the pick but matches NO rival (both rival + pick marks are BASE, query FAR) → novel/garbled
    # → KEEP (never abstain on a positive-elsewhere absence — that's the recall guard, not ≥2-supplier).
    no_rival = [(T('Cascade', [BASE]), 1), (T('Northgate', [BASE]), 8)]
    check('far from pick but matches no rival mark → keep (novel/garbled)', _logo_detail_veto(no_rival, 1, no_rival[0][0], FAR) is False)

    # Single-supplier cluster (no rival at all) → keep, even when the mark disagrees (byte-identical pin).
    same = [(T('Cascade', [BASE]), 1), (T('Cascade', [BASE]), 8)]
    check('single-supplier cluster → keep (recall pin)', _logo_detail_veto(same, 1, same[0][0], FAR) is False)

    # A DECISIVELY-closest wrong pick whose true supplier's coarse phash drifted OUT of band still vetoes
    # (the detail hash detects it regardless of coarse distance — the doc-193 fix).
    drifted = [(CAS, 1), (NG, 40)]   # Northgate coarse-far, but its MARK matches the scan
    check('true supplier coarse-far but mark matches → VETO (doc-193 case)', _logo_detail_veto(drifted, 1, CAS, FAR) is True)

    # Fail-safe.
    check('missing query hash → keep', _logo_detail_veto(cross, 1, CAS, None) is False)
    empty = [(T('Cascade', []), 1), (NG, 8)]
    check('empty pick detail set → keep (Slice-B not accrued)', _logo_detail_veto(empty, 1, empty[0][0], FAR) is False)

    # Kill switch.
    os.environ['LOGO_DETAIL_VETO'] = '0'
    check('LOGO_DETAIL_VETO=0 → veto disabled (keep)', _logo_detail_veto(cross, 1, CAS, FAR) is False)
    del os.environ['LOGO_DETAIL_VETO']
    check('re-enabled → vetoes again', _logo_detail_veto(cross, 1, CAS, FAR) is True)

    # C2(iii) [Slice-1d DO-NOTHING ledger 2026-07-24]: the underlying primitive veto_by_detail and its
    # pm-is-None ACCEPTED TRADE-OFF. A DETAIL-LESS pick (empty pick set → pm None) is UNJUDGEABLE → KEEP,
    # EVEN WHEN the query positively matches a rival. Locks residual (a)'s deliberate non-close: a future
    # (a)-fix that makes pm-None abstain must consciously update this pin (and keep the positive-rival
    # requirement + re-gate anchor.try_logo_supplier_match — the OTHER consumer of this shared primitive).
    import logo_detail as LD
    check('veto_by_detail: detail-less pick (pm None) → keep EVEN IF a rival matches (residual-(a))',
          LD.veto_by_detail(FAR, [], {'Northgate': [FAR]}) is False)
    check('veto_by_detail: pick AGREES (pm ≤ t) → keep (recall pin)',
          LD.veto_by_detail(NEAR, [BASE], {'Northgate': [NEAR]}) is False)
    check('veto_by_detail: pick disagrees AND a rival positively matches → VETO',
          LD.veto_by_detail(FAR, [BASE], {'Northgate': [FAR]}) is True)
    check('veto_by_detail: pick disagrees but NO rival matches → keep (novel/garbled)',
          LD.veto_by_detail(FAR, [BASE], {'Northgate': [BASE]}) is False)

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
