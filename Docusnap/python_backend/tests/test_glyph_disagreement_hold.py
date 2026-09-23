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
        _field_read_geom={},                         # anchor-stage fallback store
        _s05_mappings=[{"field_key": "reference_number", "page_number": 0}],
        _field_candidates={},                        # C1 witness
        _trace=False, log=lambda *a, **k: None, _t=lambda *a, **k: None)
    return f


def _run(committed, pp_return, *, env="1", provenance=("ocr",), method="template_mapping",
         geom=True, prior_note=None, anchor_geom=False, record=None):
    """Call the bound method with the recognizer + crop mocked. Returns the ref data dict
    and the fake engine (to inspect _field_candidates)."""
    saved = (_gr.available, _gr.read_crop, _gr.prep_crop, _rs._crop_padded)
    _gr.available = lambda: pp_return is not None
    _gr.read_crop = lambda img: pp_return
    _gr.prep_crop = lambda img: img

    def _cp(page, box, v, h):
        if record is not None:
            record.append((page, box))
        return ("CROP", (0, 1))
    _rs._crop_padded = _cp
    old_env = os.environ.get("GLYPH_FALLBACK_ENABLED")
    if env is None:
        os.environ.pop("GLYPH_FALLBACK_ENABLED", None)
    else:
        os.environ["GLYPH_FALLBACK_ENABLED"] = env
    try:
        f = _fake_engine()
        if anchor_geom:
            # the ref read via ANCHOR: no mapping geom, only the captured winner box
            f._s05_read_geom = {}
            f._field_read_geom = {"reference_number": _BOX}
        if not geom:
            f._s05_read_geom = {}
            f._field_read_geom = {}
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


def test_winning_read_geom_prefers_box():
    g = ExtractionEngine._winning_read_geom(
        {"method": "anchor_crop_relocated",
         "box": {"x_norm": .6, "y_norm": .4, "w_norm": .1, "h_norm": .02},
         "taught_box": (.5, .5, .1, .02)})
    assert g == (.6, .4, .1, .02), "prefer the actual located box over the pre-drift taught box"


def test_winning_read_geom_rigid_converts_taught_box_centre_to_top_left():
    """field_anchors stores the taught box CENTRE (renderer + anchor._crop_and_ocr); reslice._crop_padded
    does top-left math. The old pass-through shipped a crop shifted (+w/2, +h/2) — 007, 2026-09-23."""
    g = ExtractionEngine._winning_read_geom({"method": "anchor_crop", "box": None, "taught_box": (.5, .5, .1, .02)})
    assert g == (.45, .49, .1, .02), g
    # clamped at the page origin, never negative
    g = ExtractionEngine._winning_read_geom({"method": "anchor_crop", "box": None, "taught_box": (.02, .005, .1, .02)})
    assert g == (0.0, 0.0, .1, .02), g


def test_winning_read_geom_inline():
    g = ExtractionEngine._winning_read_geom(
        {"method": "anchor_inline", "box": {"x_norm": .1, "y_norm": .2, "w_norm": .3, "h_norm": .04}})
    assert g == (.1, .2, .3, .04)


def test_winning_read_geom_keyword_none():
    # a keyword full-page read carries no box → no capture → the method abstains (C4)
    assert ExtractionEngine._winning_read_geom({"method": "keyword", "value": "X"}) is None
    assert ExtractionEngine._winning_read_geom(None) is None
    assert ExtractionEngine._winning_read_geom({"box": "notadict"}) is None


def test_fallback_anchor_disagree_holds():
    """The load-bearing new path: an ANCHOR-read ref (no mapping geom, only the captured winner box)
    still fires on a single-glyph disagreement. This is the real Print Tracker case."""
    d, f = _run("1625802868", ("1G25802868", 1.0), anchor_geom=True, method="anchor_inline")
    assert d["confidence"] <= 69 and (d.get("validation_note") or "")
    assert "1625802868" in d["validation_note"] and "1G25802868" in d["validation_note"]
    assert d["value"] == "1625802868", "never overwrites"
    assert f._field_candidates == {}, "C1: still never a corroboration candidate"


def test_fallback_anchor_agree_is_noop():
    d, _ = _run("1G25802868", ("1G25802868", 1.0), anchor_geom=True, method="anchor_crop")
    assert d["confidence"] == 90 and "validation_note" not in d


def test_geometry_follows_the_winner():
    """007 2026-09-23: the crop PP re-reads must be the rect that PRODUCED the value. A keyword winner has no
    box read → abstain even when a mapping rect exists; an anchor winner on a multi-page doc is read on its
    OWN box on page 0 (the anchor stage reads page 0 only) even when a page-2 ref mapping row exists."""
    # keyword winner + a mapping rect present → no box to compare → untouched
    d, _ = _run("1625802868", ("1G25802868", 1.0), method="keyword")
    assert d["confidence"] == 90 and "validation_note" not in d
    # anchor winner with BOTH geometries: the anchor box wins, on page 0
    rec = []
    saved = (_gr.available, _gr.read_crop, _gr.prep_crop, _rs._crop_padded)
    os.environ["GLYPH_FALLBACK_ENABLED"] = "1"
    try:
        _gr.available = lambda: True
        _gr.read_crop = lambda img: ("1G25802868", 1.0)
        _gr.prep_crop = lambda img: img
        _rs._crop_padded = lambda page, box, v, h: (rec.append((page, box)) or ("CROP", (0, 1)))
        f = _fake_engine()
        P0, P1 = object(), object()
        f._s05_pages = [P0, P1]
        f._s05_read_geom = {"reference_number": (.1, .1, .1, .02)}          # a mapping rect on page 2
        f._s05_mappings = [{"field_key": "reference_number", "page_number": 1}]
        f._field_read_geom = {"reference_number": (.6, .4, .1, .02)}        # the anchor's own box
        res = {"reference_number": {"value": "1625802868", "confidence": 90, "method": "anchor_crop_relocated"}}
        ExtractionEngine._glyph_disagreement_hold.__get__(f, ExtractionEngine)(res, "reference_number", ["ocr"])
        assert rec and rec[0][0] is P0, "anchor winner → page 0"
        assert rec[0][1]["x_norm"] == .6 and rec[0][1]["y_norm"] == .4, "anchor winner → its own box, not the mapping rect"
        assert res["reference_number"]["confidence"] <= 69, "and the disagreement still holds"
    finally:
        _gr.available, _gr.read_crop, _gr.prep_crop, _rs._crop_padded = saved
        os.environ.pop("GLYPH_FALLBACK_ENABLED", None)


def test_pad_parity_for_crop_family_winners():
    """Oracle C1 (2026-09-23): a crop-family anchor winner was READ through anchor._crop_and_ocr = value box +20 px
    every side; the second reader must get that rect (no extra quiet zone). An inline winner (word geometry, no
    crop OCR) keeps the 0.3/0.15 quiet-zone pad."""
    rec = []
    saved = (_gr.available, _gr.read_crop, _gr.prep_crop, _rs._crop_padded)
    os.environ["GLYPH_FALLBACK_ENABLED"] = "1"
    try:
        _gr.available = lambda: True
        _gr.read_crop = lambda img: ("1G25802868", 1.0)
        _gr.prep_crop = lambda img: img
        _rs._crop_padded = lambda page, box, v, h: (rec.append((box, v, h)) or ("CROP", (0, 1)))

        class _Page:
            size = (1000, 2000)
        f = _fake_engine()
        f._s05_pages = [_Page()]
        f._s05_read_geom = {}
        f._field_read_geom = {"reference_number": (.5, .5, .1, .02)}
        f._field_read_pad_px = {"reference_number": 20}
        res = {"reference_number": {"value": "1625802868", "confidence": 90, "method": "anchor_crop+corrected"}}
        ExtractionEngine._glyph_disagreement_hold.__get__(f, ExtractionEngine)(res, "reference_number", ["ocr"])
        box, v, h = rec[0]
        assert (v, h) == (0.0, 0.0), "no quiet zone on top of Tesseract's own +20 px"
        assert abs(box["x_norm"] - (.5 - 20 / 1000)) < 1e-9 and abs(box["y_norm"] - (.5 - 20 / 2000)) < 1e-9
        assert abs(box["w_norm"] - (.1 + 40 / 1000)) < 1e-9 and abs(box["h_norm"] - (.02 + 40 / 2000)) < 1e-9
        assert res["reference_number"]["confidence"] <= 69, "the disagreement still holds on the parity rect"
        # inline winner: pad 0 → the quiet-zone pad stands
        rec.clear()
        f._field_read_pad_px = {"reference_number": 0}
        res = {"reference_number": {"value": "1625802868", "confidence": 90, "method": "anchor_inline"}}
        ExtractionEngine._glyph_disagreement_hold.__get__(f, ExtractionEngine)(res, "reference_number", ["ocr"])
        assert rec[0][1:] == (0.3, 0.15) and rec[0][0]["x_norm"] == .5
    finally:
        _gr.available, _gr.read_crop, _gr.prep_crop, _rs._crop_padded = saved
        os.environ.pop("GLYPH_FALLBACK_ENABLED", None)


def test_pp_confidence_floor_for_a_disagreement():
    """Oracle C10: a single-glyph disagreement below PP mean 0.90 abstains (bleed/fragment reads); at/above it holds."""
    d, _ = _run("1625802868", ("1G25802868", 0.899))
    assert d["confidence"] == 90 and "validation_note" not in d
    d, _ = _run("1625802868", ("1G25802868", 0.90))
    assert d["confidence"] <= 69 and "validation_note" in d


def test_c1_pp_not_a_corroboration_family():
    """Oracle C1 (ship-blocker), belt: PP must NEVER be a corroboration page family — else a same-pixel
    {crop-Tesseract, ppocr} pair would satisfy _corrob_licensed and license a wrong auto-file. The engine
    method already writes no _field_candidates entry (test_disagree_holds_with_neutral_note); this locks
    the constant so a future dev can't add a glyph/pp key to the family set."""
    from extraction.engine import _CORROB_PAGE_FAMILIES, _corrob_licensed
    bad = [f for f in _CORROB_PAGE_FAMILIES if any(t in f.lower() for t in ("glyph", "ppocr", "pp_", "onnx"))]
    assert not bad, f"a PP recognizer read must not be a corroboration family: {bad}"
    # Oracle 2026-09-23 (the Paddle corroboration vet, Seam 1): a PP read recorded under ANY family name — even one
    # outside _CORROB_PAGE_FAMILIES — would still license the corroborated auto-file when the WINNER is a page
    # family ({crop} ∪ {pp_line} = 2 families, crop ∈ page families). So PP reads must never enter the record at all.
    # This pins the mechanism the design must respect (the predicate itself is untouched).
    assert _corrob_licensed({"winner_family": "crop", "agree": ["pp_line"], "independent_agree": True,
                             "disagree": []}) is True, "the licence predicate counts ANY agreeing family — PP must stay out of the record"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn(); print(f"  ok {fn.__name__}")
    print(f"\n{len(fns)}/{len(fns)} passed")
