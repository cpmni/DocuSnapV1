#!/usr/bin/env python3
"""stress_test/heading_band_probe.py — real-pixel gate for RUNG 2 (HEADING_BAND_REREAD).

Reproduces herald's doc-180 axis-1 failure through the PIPELINE'S OWN read at the live
ocr_dpi=200, then proves the rung-2 recovery on the same pixels:
  1. extract_text_and_images on the working copy → the manufactured supp-merge garble
     ("PURCHASE PU RC HASE Oo RDER" class) → detect_document_type yields NO trusted PO
     heading (the fire condition).
  2. find_prominent_heading_band on the SAME run's page-0 geometry → band located.
  3. recover_type_detection_general → Purchase Order, heading=True, conf>=70 (adopted).
  4. CONTROL (doc 173-class clean sibling): main pass already trusted → rung 2's fire
     condition is False (no needless second OCR on healthy docs).

Read-only: reads working copies from %APPDATA%\\ScanFinder\\inbox; writes nothing.
Run (repo root):  PYTHONIOENCODING=utf-8 py -3.12 stress_test/heading_band_probe.py
Docs overridable: HB_PROBE_GARBLED / HB_PROBE_CLEAN (doc ids; default 180 / 173).
"""
import os
import sys

os.environ.setdefault("OCR_RENDER_DPI", "200")   # the live setting the failure was measured at
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'python_backend'))

import pytesseract
_TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'   # NOT the TESSERACT env var (a DIR on this machine)
if os.path.exists(_TESS):
    pytesseract.pytesseract.tesseract_cmd = _TESS

import json
from pathlib import Path
from ocr.tesseract import extract_text_and_images
from ocr.heading_reread import (find_prominent_heading_band, recover_type_detection_general)
from extraction import keyword

with open(os.path.join(REPO, 'config', 'keyword_patterns.json'), 'r', encoding='utf-8') as _f:
    PATTERNS = json.load(_f)
KNOWN = ['Invoice', 'Sales Order', 'Purchase Order', 'Delivery Note', 'Service Worksheet']
INBOX = os.path.join(os.environ.get('APPDATA', ''), 'ScanFinder', 'inbox')
GARBLED = os.environ.get('HB_PROBE_GARBLED', '180')
CLEAN = os.environ.get('HB_PROBE_CLEAN', '173')

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def read(doc_id):
    fp = Path(os.path.join(INBOX, f'{doc_id}.pdf'))
    if not fp.exists():
        print(f'SKIP: {fp} missing')
        return None
    geom = {}
    prov = []
    text, pages = extract_text_and_images(fp, None, born_digital=True, provenance_out=prov,
                                          page0_words_out=geom)
    det = keyword.detect_document_type(text, PATTERNS, KNOWN, None)
    trusted = bool(det and det.get('heading') and det.get('confidence', 0) >= 70)
    return {'text': text, 'pages': pages, 'geom': geom, 'det': det, 'trusted': trusted}


def main():
    print(f'— GARBLED doc {GARBLED} (the doc-180 class) —')
    g = read(GARBLED)
    if g is None:
        sys.exit(2)
    line4 = (g['text'].splitlines() + [''] * 4)[3]
    print(f'  main-pass heading line: {line4!r}')
    print(f"  main-pass detection: {g['det']} trusted={g['trusted']}")
    check('fire condition: main pass has NO trusted PO heading (axis-1 reproduced)',
          not (g['trusted'] and g['det'] and g['det'].get('type') == 'Purchase Order'))
    bounds = find_prominent_heading_band(g['geom'])
    check('geometry pre-gate finds the banner band', bounds is not None)
    aug = recover_type_detection_general(g['pages'][0] if g['pages'] else None, g['geom'],
                                         g['text'], KNOWN, None,
                                         lambda t, k, a: keyword.detect_document_type(t, PATTERNS, k, a))
    print(f'  rung-2 recovery: {aug}')
    check('rung 2 recovers Purchase Order with a TRUSTED heading',
          bool(aug) and aug.get('type') == 'Purchase Order'
          and aug.get('heading') is True and aug.get('confidence', 0) >= 70)

    print(f'\n— CLEAN control doc {CLEAN} —')
    c = read(CLEAN)
    if c is not None:
        print(f"  main-pass detection: {c['det']} trusted={c['trusted']}")
        check('control: main pass already trusted → rung 2 fire condition FALSE (no extra OCR)',
              c['trusted'] and c['det'].get('type') == 'Purchase Order')

    print()
    if fails:
        print(f'{fails} CHECK(S) FAILED')
        sys.exit(1)
    print('ALL PINS PASS')


main()
