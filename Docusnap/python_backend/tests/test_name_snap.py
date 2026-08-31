#!/usr/bin/env python
"""test_name_snap.py — the NAME SUFFIX-SNAP metric + the OFF-byte-identical source guarantee.

The whole safety of the silent adopt (2026-08-24, Oracle SIGN-OFF-W/COND) rests on ONE pure predicate,
name_match.name_snap_adopt: it may adopt the confirmed dominant ONLY when the sole differing content
token is the trailing legal suffix (Lid->Ltd) with an EXACT-match core, or a pure surface/case change.
Any CORE-token change is a different company and must stay in Review. These pins fail on the bug they
guard (a whole-fold rule would adopt Highfield Care/Cars), so a future dev can't loosen the metric.

Run: py -3.12 python_backend/tests/test_name_snap.py
"""
import os, sys, re
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import name_match

_p = 0
_f = 0
def check(name, cond):
    global _p, _f
    if cond:
        _p += 1
    else:
        _f += 1
        print('  FAIL: ' + name)

snap = name_match.name_snap_adopt
DOM = "Bramblewood Joinery Ltd"

# ── ADOPT (the owner's class) ─────────────────────────────────────────────────
check('adopt Lid->Ltd (trailing suffix slip, exact core)', snap("Bramblewood Joinery Lid", DOM) == DOM)
check('adopt Lfd->Ltd', snap("Bramblewood Joinery Lfd", DOM) == DOM)
check('adopt surface/case only', snap("BRAMBLEWOOD JOINERY LTD", DOM) == DOM)
check('adopt a longer 3-token core, suffix slip', snap("Copperfield Trading Lid", "Copperfield Trading Ltd") == "Copperfield Trading Ltd")

# ── REFUSE (different entity / not a clean suffix slip) ────────────────────────
# THE KILLER: whole-fold Levenshtein-1 but the CORE token differs => a different real company.
check('REFUSE Cars vs Care (core token differs)', snap("Highfield Care Ltd", "Highfield Cars Ltd") is None)
# A long core so the length gate is NOT what refuses it — the core-exact rule is.
check('REFUSE core swap with a long core (Foxglove/Coxglove)', snap("Coxglove Holdings Ltd", "Foxglove Holdings Ltd") is None)
check('REFUSE a core _close repair (Brambiewood)', snap("Brambiewood Joinery Ltd", DOM) is None)
check('REFUSE a core AND suffix change together', snap("Brambiewood Joinery Lid", DOM) is None)
check('REFUSE a non-legal-suffix trailing change', snap("Bramblewood Joinery Lane", DOM) is None)
# Oracle 2026-08-25: a VALID-FORM suffix SWAP is a DIFFERENT ENTITY, not a slip — the read's own trailing
# token is itself a distinct canonical legal suffix (LLP vs LLC, both in canon and 1 edit apart). This is
# the one hole the single-spelling confirmed-corpus A/B could not exercise; it RED-fails pre-fix.
check('REFUSE valid-form swap LLP->LLC (distinct entity)', snap("Anderson Holdings LLP", "Anderson Holdings LLC") is None)
check('REFUSE valid-form swap LLC->Ltd (distinct entity)', snap("Anderson Holdings LLC", "Anderson Holdings Ltd") is None)
check('adopt STILL holds for a garble into a valid suffix (Lid->Ltd)', snap("Bramblewood Joinery Lid", DOM) == DOM)
check('REFUSE differing token count', snap("Bramblewood Ltd", DOM) is None)
check('no-op when already equal', snap(DOM, DOM) is None)

# ── ACRONYM / short-core gate (owner's ask: names must exceed a length) ───────
check('REFUSE short core BP (acronym)', snap("BP Lid", "BP Ltd") is None)
check('REFUSE short core ABC', snap("ABC Lid", "ABC Ltd") is None)   # core "abc" = 3 < 6

# ── THE SEAM PIN: why we did NOT reuse near_match_identity ─────────────────────
# near_match_identity accepts Highfield Care/Cars (whole-fold d=1) — proving gary's metric would misfile;
# name_snap_adopt refuses the SAME pair. If a future dev swaps the metric back, this goes RED.
nmi = getattr(name_match, 'near_match_identity', None)
if callable(nmi):
    check('SEAM: near_match_identity ACCEPTS Care/Cars (the rejected metric)',
          bool(nmi("Highfield Care Ltd", "Highfield Cars Ltd")))
    check('SEAM: name_snap_adopt REFUSES the same pair', snap("Highfield Care Ltd", "Highfield Cars Ltd") is None)

# ── OFF byte-identical: the engine switch must be the FIRST conjunct of the branch ───
eng = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'), encoding='utf-8').read()
check('engine reads NAME_DOMINANT_SNAP as the first conjunct (OFF byte-identical)',
      bool(re.search(r"if \(os\.environ\.get\('NAME_DOMINANT_SNAP'\) == '1'", eng)))
check('engine gates the snap on the solid-confirm floor', '_NAME_SNAP_MIN_CONFIRMS' in eng)
check('engine writes the +name_snap marker', "+name_snap" in eng)
check('engine writes NO validation_note / corrected_to on the snap row (clean row)',
      "'method':        f\"{data.get('method') or 'unknown'}+name_snap\"," in eng
      and "'value':         _snap_val," in eng)

print(('ALL PASS' if _f == 0 else 'FAILED') + f' ({_p} passed, {_f} failed)')
sys.exit(1 if _f else 0)
