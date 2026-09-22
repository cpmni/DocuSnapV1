"""PIN — the PP-OCR disagreement hold (S1 of the confusable slice fallback; Oracle
SIGN-OFF-W/COND 2026-09-22 re-rule). Mocks the recognizer so the ENGINE LOGIC is tested
deterministically (no model/scan needed): the hold fires only on a genuine disagreement,
under a located crop, on a scanned OCR read, and PP never becomes a corroboration candidate.

Locks the load-bearing invariants a future change must not break:
  - OFF (env unset)  → byte-identical: no note, no cap.
  - DISAGREE         → hold: conf≤69 + a NEUTRAL note naming BOTH readings (never overwrites
                       the value, never a corrected_to).
  - AGREE            → no-op (preserves the current read/auto-file).
  - reader None      → no-op (fail-toward-Tesseract).
  - no located box   → abstain (C4: a keyword full-page read isn't second-guessed).
  - manual/template_fixed method, a prior note, or a born-digital page → skip.
  - C1: PP writes NO _field_candidates entry — it can never license _corrob_licensed.

Run: PYTHONIOENCODING=utf-8 py -3.12 -m tests.test_glyph_disagreement_hold  (from python_backend/)
"""
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import ExtractionEngine
from extraction import reslice as _rs
from ocr import glyph_reader as _gr

_BOX = (0.5, 0.5, 0.1, 0.02)   # a plausible norm box


def _fake_engine():
    f = SimpleNamespace(
        _s05_pages=[object()],                       # a stand-in page (crop is mocked)
        _s05_read_geom={"reference_number": _BOX},
        _s05_mappings=[{"field_key": "reference_number", "page_number": 0}],
        _field_candidates={},                        # C1 witness
        _trace=False, log=lambda *a, **k: None, _t=lambda *a, **k: None)
    return f


def _run(committed, pp_return, *, env="1", provenance=("ocr",), method="keyword",
         geom=True, prior_note=None):
    """Call the bound method with the recognizer + crop mocked. Returns the ref data dict
    and the fake engine (to inspect _field_candidates)."""
    saved = (_gr.available, _gr.read_crop, _gr.prep_crop, _rs._crop_padded)
    _gr.available = lambda: pp_return is not None
    _gr.read_crop = lambda img: pp_return
    _gr.prep_crop = lambda img: img
    _rs._crop_padded = lambda page, box, v, h: ("CROP", (0, 1))
    old_env = os.environ.get("GLYPH_FALLBACK_ENABLED")
    if env is None:
        os.environ.pop("GLYPH_FALLBACK_ENABLED", None)
    else:
        os.environ["GLYPH_FALLBACK_ENABLED"] = env
    try:
        f = _fake_engine()
        if not geom:
            f._s05_read_geom = {}
        data = {"value": committed, "confidence": 90, "method": method}
        if prior_note:
            data["validation_note"] = prior_note
        res = {"reference_number": data}
        ExtractionEngine._glyph_disagreement_hold.__get__(f, ExtractionEngine)(
            res, "reference_number", list(provenance))
        return res["reference_number"], f
    finally:
        _gr.available, _gr.read_crop, _gr.prep_crop, _rs._crop_padded = saved
        if old_env is None:
            os.environ.pop("GLYPH_FALLBACK_ENABLED", None)
        else:
            os.environ["GLYPH_FALLBACK_ENABLED"] = old_env


def test_off_is_byte_identical():
    d, _ = _run("1625802868", ("1G25802868", 1.0), env="0")
    assert d["confidence"] == 90 and "validation_note" not in d
    d2, _ = _run("1625802868", ("1G25802868", 1.0), env=None)
    assert d2["confidence"] == 90 and "validation_note" not in d2


def test_disagree_holds_with_neutral_note():
    d, f = _run("1625802868", ("1G25802868", 1.0))
    assert d["confidence"] <= 69, "must cap conf to block auto-file"
    note = d.get("validation_note") or ""
    assert "1625802868" in note and "1G25802868" in note, "note names BOTH readings"
    assert "corrected_to" not in d, "never writes corrected_to"
    assert d["value"] == "1625802868", "never overwrites the displayed value"
    # C1: PP is not a corroboration candidate
    assert f._field_candidates == {}, "PP must never enter _field_candidates"


def test_agree_is_noop():
    d, _ = _run("1G25802868", ("1G25802868", 1.0))
    assert d["confidence"] == 90 and "validation_note" not in d


def test_reader_unavailable_is_noop():
    d, _ = _run("1625802868", None)          # available()->False
    assert d["confidence"] == 90 and "validation_note" not in d


def test_no_box_abstains():
    d, _ = _run("1625802868", ("1G25802868", 1.0), geom=False)
    assert d["confidence"] == 90 and "validation_note" not in d


def test_manual_method_skipped():
    for meth in ("template_fixed", "manual_override", "override"):
        d, _ = _run("1625802868", ("1G25802868", 1.0), method=meth)
        assert d["confidence"] == 90 and "validation_note" not in d, meth


def test_prior_note_skipped():
    d, _ = _run("1625802868", ("1G25802868", 1.0), prior_note="already noted")
    assert d["validation_note"] == "already noted" and d["confidence"] == 90


def test_born_digital_skipped():
    d, _ = _run("1625802868", ("1G25802868", 1.0), provenance=("ocr", "digital"))
    assert d["confidence"] == 90 and "validation_note" not in d


def test_empty_pp_read_is_noop():
    d, _ = _run("1625802868", ("", 0.0))
    assert d["confidence"] == 90 and "validation_note" not in d


def test_c1_pp_not_a_corroboration_family():
    """Oracle C1 (ship-blocker), belt: PP must NEVER be a corroboration page family — else a same-pixel
    {crop-Tesseract, ppocr} pair would satisfy _corrob_licensed and license a wrong auto-file. The engine
    method already writes no _field_candidates entry (test_disagree_holds_with_neutral_note); this locks
    the constant so a future dev can't add a glyph/pp key to the family set."""
    from extraction.engine import _CORROB_PAGE_FAMILIES
    bad = [f for f in _CORROB_PAGE_FAMILIES if any(t in f.lower() for t in ("glyph", "ppocr", "pp_", "onnx"))]
    assert not bad, f"a PP recognizer read must not be a corroboration family: {bad}"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn(); print(f"  ok {fn.__name__}")
    print(f"\n{len(fns)}/{len(fns)} passed")
