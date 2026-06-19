#!/usr/bin/env python3
"""
tests/test_logo_phashes_multiref.py
-----------------------------------
Multi-reference logo phash (migration 26) in the Stage-0 matcher: a template
carries a SET of logo hashes (`logo_phashes`); _logo_candidates compares the page
phash to the CLOSEST of them (min Hamming), with a fallback to the legacy single
`logo_phash`. The candidate-net / accept-gate are UNCHANGED — convergence comes
from growing the set at confirm, not from loosening Stage 0.

compute_logo_hash is monkeypatched to read FakePage.phash (no PIL/imagehash).
    py -3.12 python_backend/tests/test_logo_phashes_multiref.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_matcher as tm  # noqa: E402


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


class FakePage:
    def __init__(self, phash):
        self.phash = phash


def with_stub(fn):
    orig = tm.compute_logo_hash
    tm.compute_logo_hash = lambda page: page.phash
    try:
        return fn()
    finally:
        tm.compute_logo_hash = orig


# popcount(diff from P): 'f'=4, '7'=3, '3'=2
P     = '0000000000000000'
NEAR0 = '0000000000000000'   # dist 0
D2    = '0000000000000003'   # dist 2  (conf 88)
D6    = '0000000000000077'   # dist 6  (conf 64 — the accept boundary)
FAR20 = 'fffff00000000000'   # dist 20 (beyond the candidate net 13)
OCR   = 'nothing shared with any fingerprint here'

T_MULTI  = {'id': 1, 'name': 'Multi',  'logo_phashes': [FAR20, NEAR0], 'keyword_fingerprint': ['ZZZ']}
T_LEGACY = {'id': 2, 'name': 'Legacy', 'logo_phash': D2,               'keyword_fingerprint': ['YYY']}  # no logo_phashes
T_GATE   = {'id': 3, 'name': 'Gate',   'logo_phashes': [D6],           'keyword_fingerprint': ['XXX']}
T_FAR    = {'id': 4, 'name': 'Far',    'logo_phashes': [FAR20],        'keyword_fingerprint': ['WWW']}
T_EMPTY  = {'id': 5, 'name': 'Empty',  'logo_phashes': [],             'keyword_fingerprint': ['VVV']}


def main():
    f = 0
    page = FakePage(P)

    # MIN over the set: the far hash is ignored, the exact one wins.
    m = with_stub(lambda: tm.identify_template(page, OCR, [T_MULTI]))
    f += not check('min-over-set: matches the closest hash in the set (conf 100)',
                   m and m['template']['id'] == 1 and m['confidence'] == 100)

    # _logo_candidates: both templates are candidates; the multi-ref one is closest.
    ph, cands = with_stub(lambda: tm._logo_candidates(page, [T_MULTI, T_LEGACY]))
    ids = [t['id'] for (t, d) in cands]
    f += not check('both templates are candidates', set(ids) == {1, 2})
    f += not check('closest-first: multi-ref (dist 0) leads', cands and cands[0][0]['id'] == 1 and cands[0][1] == 0)

    # Legacy single logo_phash still matches identically (fallback path).
    ml = with_stub(lambda: tm.identify_template(page, OCR, [T_LEGACY]))
    f += not check('legacy logo_phash-only template still matches (dist 2, conf 88)',
                   ml and ml['template']['id'] == 2 and ml['confidence'] == 88)

    # Accept gate UNCHANGED: dist 6 -> conf 64 -> accepted (no loosening).
    mg = with_stub(lambda: tm.identify_template(page, OCR, [T_GATE]))
    f += not check('accept gate unchanged: dist 6 -> conf 64 accepted', mg and mg['confidence'] == 64)

    # Beyond the candidate net -> no match.
    mf = with_stub(lambda: tm.identify_template(page, OCR, [T_FAR]))
    f += not check('a far (dist 20) set yields no match', mf is None)

    # Empty/absent hashes -> skipped, no crash.
    ph2, cands2 = with_stub(lambda: tm._logo_candidates(page, [T_EMPTY]))
    f += not check('empty logo_phashes is skipped (no crash, no candidate)', cands2 == [])

    if f:
        print(f"\n{f} check(s) failed - multi-reference logo matching regressed.")
        return 1
    print("\nAll checks passed - matcher matches the closest of several stored logo hashes; gate unchanged.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
