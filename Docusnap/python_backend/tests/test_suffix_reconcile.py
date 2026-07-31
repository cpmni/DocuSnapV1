#!/usr/bin/env python3
"""tests/test_suffix_reconcile.py — CLIPPED-SUFFIX RECONCILIATION pins
(Oracle amended verdict 2026-07-31; kill CANDIDATE_SUFFIX_RECONCILE, ships dark).

Pins the PURE classifier (extraction/suffix_reconcile.py) + prefix_confirmed
(ocr_corrector). The real-pixel proof (docs #121/123/124/131 'V-xxxxx' heal) lives in
the traced single-doc probe; the corpus go/no-go is realdoc ON-vs-OFF.

PINNED TRADE-OFFS (do not "fix" these back into the bug):
  - a digit-bearing completion ('1V-69523' needing '1' dropped, or 'INV' vs '1NV')
    NEVER adopts — widening to digit completions would let a hallucinated leading
    digit rewrite a real code;
  - an interior digit substitution ('PO-34729' vs 'PO-24729') is NOT this class;
  - an UNCONFIRMED completed prefix never silently adopts (flag lane only).

    cd python_backend && PYTHONIOENCODING=utf-8 py -3.12 tests/test_suffix_reconcile.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import suffix_reconcile as sr
from extraction import ocr_corrector as oc

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


REC = {'dominant': 'INV', 'known': {'INV'}, 'counts': {'INV': 12}, 'total': 12}
REC_STRAY = {'dominant': 'DN', 'known': {'DN', 'IN'}, 'counts': {'DN': 14, 'IN': 1}, 'total': 15}


def classify(winner, cand, clean=None, rec=REC):
    return sr.classify(winner, cand, clean if clean is not None else cand, rec,
                       oc.prefix_confirmed, oc.code_prefix)


print('§1 clip_completion — the string geometry:')
check("the #121 pair completes 'in'", sr.clip_completion('V-69523', 'INV-69523') == 'in')
check("debris-prefixed keyword value still completes ('. INV-69523')",
      sr.clip_completion('V-69523', '. INV-69523') == 'in')
check('equal values -> None', sr.clip_completion('INV-69523', 'INV-69523') is None)
check('normalisation-only difference -> None', sr.clip_completion('INV 69523', 'INV-69523') is None)
check('interior digit substitution -> None (PO-34729 vs PO-24729)',
      sr.clip_completion('PO-34729', 'PO-24729') is None)
check("PIN: digit-bearing completion never qualifies ('1V-69523' fuller of 'V-69523')",
      sr.clip_completion('V-69523', '1V-69523') is None)
check("PIN: the '1V-69523' winner is NOT healed by 'INV-69523' (not a suffix)",
      sr.clip_completion('1V-69523', 'INV-69523') is None)
check('completion longer than 3 -> None',
      sr.clip_completion('69523', 'ABCD-69523') is None)
check('digit growth is not a clip (suffix with extra digits)',
      sr.clip_completion('INV-359', 'INV-35900') is None)
check('candidate shorter than winner -> None', sr.clip_completion('INV-69523', 'V-69523') is None)
check('empty inputs -> None', sr.clip_completion('', 'INV-1') is None and sr.clip_completion('V-1', '') is None)

print('§1b edge_strip — debris removal:')
check("leading dot-space stripped", sr.edge_strip('. INV-69523') == 'INV-69523')
check('interior separators untouched', sr.edge_strip('INV-69523') == 'INV-69523')
check('trailing junk stripped', sr.edge_strip('PO-1234 :') == 'PO-1234')
check('empty safe', sr.edge_strip('') == '' and sr.edge_strip(None) == '')

print('§2 classify — lanes:')
check("adopt: confirmed prefix ('INV' dominant, 12 confirms)",
      classify('V-69523', '. INV-69523', 'INV-69523') == ('adopt', 'INV-69523'))
check('flag: NO prefix record for the scope',
      classify('V-69523', 'INV-69523', rec=None) == ('flag',))
check("flag: completed prefix is a low-count STRAY ('IN' 1-of-15 — poison, not confirmed)",
      classify('N-97393', 'IN-97393', rec=REC_STRAY) == ('flag',))
check("adopt via non-dominant but WELL-SUPPORTED prefix",
      classify('O-1234', 'PO-1234', rec={'dominant': 'INV', 'known': {'INV', 'PO'},
                                         'counts': {'INV': 20, 'PO': 10}, 'total': 30})
      == ('adopt', 'PO-1234'))
check('None: not the clip pattern at all',
      classify('PO-34729', 'PO-24729') is None)
check('None: clean form broke the suffix identity (shape-extract trimmed digits)',
      classify('V-69523', 'INV-69523', clean='INV-695') is None)

print('§3 prefix_confirmed — membership with support (mirrors is_prefix_outlier):')
check('dominant always confirmed', oc.prefix_confirmed('INV', REC))
check('absent prefix not confirmed', not oc.prefix_confirmed('PO', REC))
check('1-of-15 stray not confirmed', not oc.prefix_confirmed('IN', REC_STRAY))
check('empty/None safe', not oc.prefix_confirmed('', REC) and not oc.prefix_confirmed('INV', None))

print()
if fails:
    print(f'{fails} CHECK(S) FAILED')
    sys.exit(1)
print('ALL PINS PASS')
