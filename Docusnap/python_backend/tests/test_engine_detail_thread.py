#!/usr/bin/env python3
"""
tests/test_engine_detail_thread.py — pins that engine.extract THREADS the isolated-mark detail hash
(query_detail_hash) into the AUTHORITATIVE template_matcher.identify_template call (engine.py:2484).

Load-bearing seam of the 2026-07-24 Slice-1d DO-NOTHING ruling (memory project_slice1d_donothing):
the Stage-0 positive-rival detail veto only works because the engine feeds it the doc's query hash.
If a refactor drops the query_detail_hash= kwarg (mistaking it for a dark Slice-D path), the LIVE
veto silently goes inert. Pins:
  - a computable detail hash IS threaded (query_detail_hash == the computed value);
  - no page image → the hash is None → None is threaded (the value FLOWS from the computed hash;
    it is not hard-coded).

Run: py -3.12 -m tests.test_engine_detail_thread   (from python_backend/)
"""
import os, sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as engine_mod
from extraction.engine import ExtractionEngine
import logo_detail

CONFIG = str(Path(__file__).parent.parent / "config" / "keyword_patterns.json")
F = 0


def check(label, cond):
    global F
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    F += (not cond)


SENTINEL = 'd' * 64   # a stand-in 256-bit detail hash


def _capture_threaded(page_images):
    """Run engine.extract with every heavy stage stubbed EXCEPT the query_detail_hash plumbing, and
    return the query_detail_hash the engine passed into identify_template."""
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    tm, kwmod, anc, val = (engine_mod.template_matcher, engine_mod.keyword,
                           engine_mod.anchor, engine_mod.validator)
    orig = (tm.identify_template, tm.compute_logo_hash, kwmod.extract_fields,
            anc.extract_with_anchors, val.validate_and_adjust, logo_detail.detail_hash)
    captured = {}

    def fake_identify(*a, **k):
        captured['called'] = True
        captured['query_detail_hash'] = k.get('query_detail_hash')
        return None

    tm.compute_logo_hash = lambda *a, **k: None
    tm.identify_template = fake_identify
    logo_detail.detail_hash = lambda *a, **k: SENTINEL          # a computable detail hash
    kwmod.extract_fields = lambda *a, **k: {}
    anc.extract_with_anchors = lambda *a, **k: {}
    val.validate_and_adjust = lambda results, field_defs, **kwargs: results
    try:
        eng.extract(ocr_text="stub", page_images=page_images, filename="t.pdf",
                    field_defs=[{"key": "invoice_number", "type": "text"}], hints=[],
                    anchors=[], logos=[],
                    templates=[{"name": "Acme", "dominant_supplier": "Acme", "logo_phashes": [],
                                "logo_detail_hashes": [], "keyword_fingerprint": [], "fields": []}],
                    document_type="Invoice", document_slug="invoice")
    finally:
        (tm.identify_template, tm.compute_logo_hash, kwmod.extract_fields,
         anc.extract_with_anchors, val.validate_and_adjust, logo_detail.detail_hash) = orig
    return captured


def main():
    page = Image.new('RGB', (400, 500), 'white')
    c = _capture_threaded([page])
    check('identify_template WAS called (templates present)', c.get('called') is True)
    check('a computable detail hash IS threaded as query_detail_hash', c.get('query_detail_hash') == SENTINEL)

    c0 = _capture_threaded([])   # no page image → _id_img None → detail hash not computed
    check('no page image -> query_detail_hash threaded as None (value flows from the computed hash)',
          c0.get('called') is True and c0.get('query_detail_hash') is None)

    if F:
        print(f"\n{F} FAILED")
        return 1
    print("\nAll engine detail-thread checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
