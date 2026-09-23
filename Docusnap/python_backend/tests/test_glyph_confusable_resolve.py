"""PIN — GLYPH_CONFUSABLE_RESOLVE (mig 210, the DOWNGRADE leg of the PP-OCR second reader;
Oracle SIGN-OFF D1-D5, 2026-09-23, after the dual-reader census).

Inside _glyph_disagreement_hold: when the ONLY note on a scanned ref is the Gate-C confusable
SOFTEN note (exact text, no corrected_to) and the second reader AGREES with the committed read,
the note is RE-WORDED to confident copy. It is STILL a non-empty validation_note ending in the
same ref-advisory MARK, so the doc stays HELD and auto-file is byte-identical.

Locks (a future dev must not break):
  - OFF (env unset / '0')        → the soften note is untouched, even with the fallback ON.
  - ON without GLYPH_FALLBACK_ENABLED → untouched (D4 hard dep).
  - ON + agree + sole soften note → note re-worded: names the value, keeps the SOFTEN MARK
                                    (composeNote.js REF_ADVISORY), carries NO absent mark,
                                    non-empty; conf/value/method untouched; no corrected_to;
                                    PP still writes no _field_candidates entry (C1).
  - ON + DISAGREE + soften note   → untouched (never stack a second note, never re-cap).
  - ON + agree + a DIFFERENT note (absent / reinstate / free text) → untouched (D3 unique key).
  - ON + agree + soften note + corrected_to → untouched.
  - ON + agree + soften note whose value no longer matches the committed value → untouched
    (a later resolver changed the value → exact-text match fails → fail-closed).
  - Mark-sync: the resolved note contains the JS composeNote.js advisory mark literal.

Run: PYTHONIOENCODING=utf-8 py -3.12 -m tests.test_glyph_confusable_resolve  (from python_backend/)
"""
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import (ExtractionEngine, _FILING_SANITY_SOFTEN_NOTE, _FILING_SANITY_SOFTEN_MARK,
                               _FILING_SANITY_ABSENT_MARK, _FILING_SANITY_REINSTATE_NOTE,
                               _GLYPH_RESOLVED_SOFTEN_NOTE, _GLYPH_SOFTEN_KEY)
from extraction import reslice as _rs
from ocr import glyph_reader as _gr

_BOX = (0.5, 0.5, 0.1, 0.02)
REF = "SO-80228"
SOFT = _FILING_SANITY_SOFTEN_NOTE.format(REF, "S0-80228")   # exactly what Gate C writes


def _fake_engine():
    return SimpleNamespace(
        _s05_pages=[object()], _s05_read_geom={}, _field_read_geom={"reference_number": _BOX},
        _s05_mappings=[], _field_candidates={}, _trace=False,
        log=lambda *a, **k: None, _t=lambda *a, **k: None)


def _run(committed, pp_return, *, fallback="1", resolve="1", note=SOFT, corrected_to=None,
         method="anchor_crop", provenance=("ocr",)):
    saved = (_gr.available, _gr.read_crop, _gr.prep_crop, _rs._crop_padded)
    _gr.available = lambda: pp_return is not None
    _gr.read_crop = lambda img: pp_return
    _gr.prep_crop = lambda img: img
    _rs._crop_padded = lambda page, box, v, h: ("CROP", (0, 1))
    old = {k: os.environ.get(k) for k in ("GLYPH_FALLBACK_ENABLED", "GLYPH_CONFUSABLE_RESOLVE")}
    for k, v in (("GLYPH_FALLBACK_ENABLED", fallback), ("GLYPH_CONFUSABLE_RESOLVE", resolve)):
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        f = _fake_engine()
        data = {"value": committed, "confidence": 90, "method": method}
        if note is not None:
            data["validation_note"] = note
        if corrected_to:
            data["corrected_to"] = corrected_to
        res = {"reference_number": data}
        ExtractionEngine._glyph_disagreement_hold.__get__(f, ExtractionEngine)(
            res, "reference_number", list(provenance))
        return res["reference_number"], f
    finally:
        _gr.available, _gr.read_crop, _gr.prep_crop, _rs._crop_padded = saved
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _untouched(d):
    assert d["validation_note"] == SOFT, d.get("validation_note")
    assert d["confidence"] == 90 and d["value"] == REF and "corrected_to" not in d


def test_off_is_byte_identical():
    d, _ = _run(REF, (REF, 0.99), resolve="0"); _untouched(d)
    d, _ = _run(REF, (REF, 0.99), resolve=None); _untouched(d)


def test_hard_dep_on_fallback():
    d, _ = _run(REF, (REF, 0.99), fallback="0"); _untouched(d)
    d, _ = _run(REF, (REF, 0.99), fallback=None); _untouched(d)


def test_agree_rewords_soften_note_keeps_hold():
    d, f = _run(REF, (REF, 0.99))
    n = d.get("validation_note") or ""
    assert n and n != SOFT, "the note must be re-worded, never emptied"
    assert n == _GLYPH_RESOLVED_SOFTEN_NOTE.format(REF)
    assert REF in n, "names the value"
    assert n.endswith(_FILING_SANITY_SOFTEN_MARK + "."), "D2: keeps the ref-advisory MARK (composeNote rank 1)"
    assert _FILING_SANITY_ABSENT_MARK not in n, "D2: never the absent mark"
    assert d["confidence"] == 90 and d["value"] == REF and d["method"] == "anchor_crop"
    assert "corrected_to" not in d
    assert f._field_candidates == {}, "C1: PP is never a corroboration candidate"


def test_agree_matches_on_alnum_only():
    # the second reader drops the separator — still an AGREE on content
    d, _ = _run(REF, ("SO80228", 0.97))
    assert d["validation_note"] == _GLYPH_RESOLVED_SOFTEN_NOTE.format(REF)


def test_disagree_leaves_soften_untouched():
    d, _ = _run(REF, ("S0-80228", 0.99)); _untouched(d)           # single-glyph disagreement
    d, _ = _run(REF, ("SO-8022", 0.99)); _untouched(d)            # length difference (abstain class)


def test_abstain_paths_leave_soften_untouched():
    d, _ = _run(REF, None); _untouched(d)                          # reader unavailable
    d, _ = _run(REF, ("", 0.0)); _untouched(d)                     # empty read
    d, _ = _run(REF, (REF, 0.99), provenance=("ocr", "digital")); _untouched(d)   # born-digital


def test_other_notes_never_touched():
    absent = f"'{REF}' {_FILING_SANITY_ABSENT_MARK} — the page reads it as 'S0-80228' — please check the reference before filing."
    reinstate = _FILING_SANITY_REINSTATE_NOTE.format(REF, "VS-72672")
    for other in (absent, reinstate, "already noted by another arm",
                  SOFT + " Also: a second note appended."):        # composite → not the SOLE note
        d, _ = _run(REF, (REF, 0.99), note=other)
        assert d["validation_note"] == other and d["confidence"] == 90, other


def test_corrected_to_blocks_resolve():
    d, _ = _run(REF, (REF, 0.99), corrected_to="SO-80229")
    assert d["validation_note"] == SOFT and d["corrected_to"] == "SO-80229"


def test_value_drift_after_soften_fails_closed():
    # the soften named 'SO-80228' but a later resolver committed a different value → exact match fails
    d, _ = _run("SO-80229", (("SO-80229"), 0.99), note=SOFT)
    assert d["validation_note"] == SOFT and d["confidence"] == 90


def test_manual_method_skipped():
    for meth in ("template_fixed", "manual_override", "override"):
        d, _ = _run(REF, (REF, 0.99), method=meth); _untouched(d)


def test_no_note_path_unchanged_by_resolve_switch():
    """With no prior note the method behaves exactly as before: agree → no-op, disagree → hold."""
    d, _ = _run(REF, (REF, 0.99), note=None)
    assert d["confidence"] == 90 and "validation_note" not in d
    d, _ = _run(REF, ("S0-80228", 0.99), note=None)
    assert d["confidence"] <= 69 and "Two text readers disagree" in d["validation_note"]


def test_mark_sync_with_js_composeNote():
    """composeNote.js REF_ADVISORY_MARKS hard-codes the soften MARK; the resolved note must still carry it,
    and the unique phrase the resolve keys on must still live in the Gate-C soften note."""
    here = os.path.dirname(os.path.abspath(__file__))
    js = os.path.join(os.path.dirname(os.path.dirname(here)), "src", "modules", "processing", "composeNote.js")
    src = open(js, encoding="utf-8").read()
    assert _FILING_SANITY_SOFTEN_MARK in src, "composeNote.js lost the soften mark literal"
    assert _FILING_SANITY_SOFTEN_MARK in _GLYPH_RESOLVED_SOFTEN_NOTE
    assert _GLYPH_SOFTEN_KEY in _FILING_SANITY_SOFTEN_NOTE, "the resolve keys on a phrase Gate C no longer writes"
    assert _GLYPH_SOFTEN_KEY not in _FILING_SANITY_REINSTATE_NOTE, "the key must be UNIQUE to the soften note"
    assert _FILING_SANITY_ABSENT_MARK not in _GLYPH_RESOLVED_SOFTEN_NOTE


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn(); print(f"  ok {fn.__name__}")
    print(f"\n{len(fns)}/{len(fns)} passed")
