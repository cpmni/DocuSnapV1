#!/usr/bin/env python3
"""tests/test_heading_band_reread.py — RUNG 2 general title-band re-read
(2026-07-31; herald→Oracle SIGN-OFF-W/COND; kill HEADING_BAND_REREAD, dark until gated).

Pins the PURE pieces: the geometry prominence PRE-GATE (find_prominent_heading_band — Oracle
A2: top-fraction constrained so the falsely-trusted MID-BODY column class can't arm it) and
the adoption contract of recover_type_detection_general (Oracle A1: detect_fn only, trusted
heading only). The real-pixel doc-180 proof lives in stress_test/heading_band_probe.py.

    cd python_backend && PYTHONIOENCODING=utf-8 py -3.12 tests/test_heading_band_reread.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ocr import heading_reread as hr

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def W(l, t, w, h, text='X', conf=80.0):
    return (l, t, w, h, text, conf)


# A plausible page: H=3000, body med_h 30. Banner words are ~90px tall near the top.
def geom(words, med_h=30, H=3000):
    return {'words': words, 'med_h': med_h, 'size': (2000, H), 'lines': [], 'rows': []}


print('§1 prominence pre-gate (pure):')
BANNER = [W(500, 200, 400, 90), W(950, 205, 380, 88)]          # banner-height, top of page
BODY   = [W(100, 800, 200, 30), W(400, 1500, 250, 28)]
b = hr.find_prominent_heading_band(geom(BANNER + BODY))
check('banner-height top words → band bounds returned', b is not None)
check('bounds cover the banner rows with pad', b[0] < 200 and b[1] > 295)
check('body-only page (no banner-height type) → None',
      hr.find_prominent_heading_band(geom(BODY)) is None)
# Oracle A2: a banner-HEIGHT word too far DOWN the page (mid-body leftmost column class)
# must NOT arm the re-read — the top-fraction constraint is load-bearing.
MID = [W(100, 1400, 300, 90)]
check('PIN (Oracle A2): banner-height word at 47% page height → None (top-fraction constraint)',
      hr.find_prominent_heading_band(geom(MID + BODY)) is None)
check('no geometry (cached reprocess / born-digital) → None (honestly inert)',
      hr.find_prominent_heading_band({}) is None
      and hr.find_prominent_heading_band(None) is None)
check('zero med_h → None (degenerate)',
      hr.find_prominent_heading_band(geom(BANNER, med_h=0)) is None)

print('\n§2 adoption contract (Oracle A1 — detect_fn only, trusted heading only):')
_calls = []


def _fake_detect_trusted(text, known, aliases):
    _calls.append(text)
    return {'type': 'Purchase Order', 'confidence': 95, 'heading': True}


def _fake_detect_untrusted(text, known, aliases):
    return {'type': 'Sales Order', 'confidence': 65, 'heading': False}


class _FakeImg:
    size = (2000, 3000)


# Stub the OCR read so the contract is testable without pixels.
_orig = hr.recover_heading_band_general
hr.recover_heading_band_general = lambda img, bounds, **kw: 'PURCHASE ORDER'
try:
    aug = hr.recover_type_detection_general(_FakeImg(), geom(BANNER + BODY), 'body text',
                                            ['Purchase Order'], None, _fake_detect_trusted)
    check('recovered band + trusted detection → adopted', aug and aug['type'] == 'Purchase Order')
    check('band PREPENDED to a copy of ocr_text (detect_fn saw both)',
          _calls and _calls[0].startswith('PURCHASE ORDER\n') and 'body text' in _calls[0])
    check('untrusted re-detection (heading False / conf<70) → None (fail toward review)',
          hr.recover_type_detection_general(_FakeImg(), geom(BANNER + BODY), 'body',
                                            ['Sales Order'], None, _fake_detect_untrusted) is None)
    check('no prominent band → None, detect_fn never consulted',
          hr.recover_type_detection_general(_FakeImg(), geom(BODY), 'body',
                                            ['Purchase Order'], None,
                                            lambda *a: (_ for _ in ()).throw(AssertionError())) is None)
finally:
    hr.recover_heading_band_general = _orig

print('\n§3 band read fail-safes (real function, degenerate inputs):')
check('None image → None', hr.recover_heading_band_general(None, (0, 100)) is None)
check('empty bounds → None', hr.recover_heading_band_general(_FakeImg(), None) is None)

print()
if fails:
    print(f"{fails} CHECK(S) FAILED")
    sys.exit(1)
print("ALL PASS")
