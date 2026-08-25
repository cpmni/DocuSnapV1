#!/usr/bin/env python
"""test_branding_reg_boilerplate.py — the UK-registration-boilerplate strip (iris/gary → Oracle, 2026-08-24).

The Oakhaven->Castellan misfile: a logo-collision picks the wrong supplier, and generic {vat, reg} in its
branding fingerprint score free own_ratio hits on the page's "VAT Reg …" line, pushing own_ratio over the
0.25 present-bar so decide_logo_text_gate ACCEPTS a supplier the page never names. Stripping the boilerplate
from _distinctive_tokens drops the wrong supplier below the bar (-> the gate abstains).

These pins exercise the REAL functions and assert the exact quantity the gate branches on
(own_ratio > _BRANDING_PRESENT_RATIO, engine.py:1526). They fail on the bug they guard: with the switch OFF
the wrong supplier clears the bar; with it ON it does not. OFF is byte-identical.

Run: py -3.12 python_backend/tests/test_branding_reg_boilerplate.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import template_matcher as tm
from extraction import engine

_p = _f = 0
def check(name, cond):
    global _p, _f
    if cond: _p += 1
    else: _f += 1; print('  FAIL: ' + name)

norm = lambda s: str(s or '').strip().lower()

def _dtoks(words):
    return tm._distinctive_tokens(words)

def _bank(words):
    return {'words': _dtoks(words)}

def with_strip(on):
    if on: os.environ['BRANDING_STRIP_REG_BOILERPLATE'] = '1'
    else:  os.environ.pop('BRANDING_STRIP_REG_BOILERPLATE', None)

PRESENT = tm._BRANDING_PRESENT_RATIO   # 0.25

# A doc-732-shaped page: names Oakhaven + a "VAT Reg" line; "Castellan" absent.
PAGE = ('oakhaven electrical wholesale conduit row ampfield vat reg gb 660 1173 45 '
        'goods delivery note bramblewood joinery ltd received in good condition')
CAS_FP = ['Castellan', 'Security', 'Systems', 'VAT', 'Reg']       # a wrong-supplier bank with 2 boilerplate tokens
OAK_FP = ['Oakhaven', 'Electrical', 'Wholesale', 'Conduit']       # the genuine supplier, no boilerplate

# ── 1. _distinctive_tokens: OFF keeps vat/reg (byte-identical), ON drops them; the name survives both ──
with_strip(False)
off = _dtoks(CAS_FP)
check('OFF: vat kept (byte-identical legacy)', 'vat' in off)
check('OFF: reg kept', 'reg' in off)
with_strip(True)
on = _dtoks(CAS_FP)
check('ON: vat dropped', 'vat' not in on)
check('ON: reg dropped', 'reg' not in on)
check('ON: the distinctive NAME survives', 'castellan' in on and 'systems' in on)
# Oracle C3 — the NARROW default keeps legal suffixes + england/wales (real names exist); only the
# pure-registration tokens are stripped. A future widening must go through the env override, measured.
check('ON default: ltd KEPT (narrow set excludes legal suffixes)', 'ltd' in _dtoks(['Ltd', 'Ridgeway']))
check('ON default: england/wales KEPT (real names exist)', 'england' in _dtoks(['England', 'Foods']) and 'wales' in _dtoks(['Wales', 'Timber']))
check('ON: a real name beside a suffix survives', 'ridgeway' in _dtoks(['Ltd', 'Ridgeway']))
os.environ['BRANDING_REG_BOILERPLATE_TOKENS'] = 'vat,reg,ltd'
check('env override widens the strip set (ltd now dropped, name survives)',
      'ltd' not in _dtoks(['Ltd', 'Ridgeway']) and 'ridgeway' in _dtoks(['Ltd', 'Ridgeway']))
os.environ.pop('BRANDING_REG_BOILERPLATE_TOKENS', None)

# ── 2. THE DECISION INPUT: the wrong supplier crosses 0.25 OFF, not ON (what the gate branches on) ──
with_strip(False)
banks_off = {norm('Castellan Security Systems'): _bank(CAS_FP)}
r_off = engine._branding_own_ratio('Castellan Security Systems', banks_off, PAGE, norm)
with_strip(True)
banks_on = {norm('Castellan Security Systems'): _bank(CAS_FP)}
r_on = engine._branding_own_ratio('Castellan Security Systems', banks_on, PAGE, norm)
check('OFF: wrong supplier own_ratio > 0.25 (the DEFEAT -> gate accepts)', r_off is not None and r_off > PRESENT)
check('ON: wrong supplier own_ratio <= 0.25 (fixed -> gate abstains)', r_on is not None and r_on <= PRESENT)
check('ON strictly reduces the wrong supplier presence', r_on < r_off)

# ── 3. POSITIVE CONTROL: the GENUINE supplier is unaffected (no boilerplate to strip), still present ──
with_strip(False)
g_off = engine._branding_own_ratio('Oakhaven Electrical Wholesale', {norm('Oakhaven Electrical Wholesale'): _bank(OAK_FP)}, PAGE, norm)
with_strip(True)
g_on = engine._branding_own_ratio('Oakhaven Electrical Wholesale', {norm('Oakhaven Electrical Wholesale'): _bank(OAK_FP)}, PAGE, norm)
check('positive control: genuine supplier present both OFF and ON', g_off is not None and g_on is not None and g_off > PRESENT and g_on > PRESENT)
check('positive control: strip does not change a boilerplate-free bank', abs(g_off - g_on) < 1e-9)

# ── 4. UNDER-POPULATION FAIL-SAFE: an all-boilerplate bank -> < K words ON -> None (never 'abstain') ──
with_strip(True)
thin = {norm('Nowhere Ltd'): _bank(['Nowhere', 'Ltd', 'Company', 'VAT'])}   # only 'nowhere' survives the strip
r_thin = engine._branding_own_ratio('Nowhere Ltd', thin, PAGE, norm)
check('under-population: stripped bank < K words -> None (suggest/witness, never abstain)', r_thin is None)

with_strip(False)   # leave env clean
print(('ALL PASS' if _f == 0 else 'FAILED') + f' ({_p} passed, {_f} failed)')
sys.exit(1 if _f else 0)
