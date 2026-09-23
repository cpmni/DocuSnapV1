"""PIN — GLYPH_CONFUSABLE_RELEASE (mig 211, the RELEASE leg of the PP-OCR second reader;
gary design → Oracle SIGN-OFF-W/COND C0-C11, 2026-09-23 evening).

Inside the DOWNGRADE branch (sole note == the Gate-C confusable soften, PP AGREES on the narrow crop),
the note is POPPED — the only mutation — when EVERY guard passes; any abstain falls through to the
DOWNGRADE reword (still held). Locks:
  - OFF (env unset/'0') with FALLBACK+RESOLVE on → the DOWNGRADE reword, ONE PP read (no wide read).
  - hard deps: RELEASE without RESOLVE / without FALLBACK → untouched.
  - happy path: note popped; conf/value/method untouched; no corrected_to; PP never a candidate;
    the wide read used hpad 1.0 after the narrow 0.15; released dict keys == {value, confidence, method}.
  - POPULATION LOCK (C7): only the CONFUSABLE-soften producer with a map-pair page form; the frozen map.
  - C1 floors: mean ≥ 0.95 AND weakest glyph ≥ 0.80; a 2-tuple reader (no glyph min) never releases.
  - C3 clip guard: the wide read must CONTAIN the value, boundary-guarded (glued digit → held).
  - C4 page edge → held; C6 page unknown → held; veto-fallthrough → held (G1 would re-note).
  - C2 page-family parity: the fixtures below are shared VERBATIM with
    database/modules/test_migration211_glyph_confusable_release.js (trust.js _pageFamilyDisagrees).
  - C5 belt: the ambiguous flag is re-invoked after a release, never after an abstain.
  - C9 traces: every abstain reason is named.
  - R4 (C11): the G1 predicate refuses the released shape; the source ORDER pin.

Run: PYTHONIOENCODING=utf-8 py -3.12 -m tests.test_glyph_confusable_release  (from python_backend/)
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import (ExtractionEngine, _FILING_SANITY_SOFTEN_NOTE, _GLYPH_RESOLVED_SOFTEN_NOTE,
                               _CONFUSE_TO_DIGIT, _CORROB_PAGE_FAMILIES, _fallthrough_critical_corroborated,
                               _GLYPH_RELEASE_PP_FLOOR, _GLYPH_RELEASE_GLYPH_FLOOR)
from extraction import reslice as _rs
from ocr import glyph_reader as _gr

REF, NEAR = "SO-80228", "S0-80228"
SOFT = _FILING_SANITY_SOFTEN_NOTE.format(REF, NEAR)          # exactly what Gate C writes
RESOLVED = _GLYPH_RESOLVED_SOFTEN_NOTE.format(REF)           # the DOWNGRADE reword
_BOX = (0.40, 0.30, 0.20, 0.02)                              # well inside a 1000x1400 page
NARROW_OK = (REF, 0.99, 0.98)
WIDE_OK = ("PO No SO-80228", 0.98, 0.97)
HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_SRC = open(os.path.join(os.path.dirname(HERE), "extraction", "engine.py"), encoding="utf-8").read()

# SHARED with the JS pin (trust.js _pageFamilyDisagrees parity) — keep the two lists identical.
PAGE_FAMILY_FIXTURES = [
    ({"disagree": [{"family": "keyword", "value": "S0-80228"}]}, True),
    ({"disagree": [], "suppressed_taught_role": [{"family": "keyword", "value": "S0-80228"}]}, False),
    ({"disagree": [], "discounted": [{"family": "crop", "value": "SO-8022", "reason": "format"}]}, True),
    ({"disagree": [{"family": "memory", "value": "SO-80229"}]}, False),
    ({"disagree": []}, False),
]


class _Page:
    size = (1000, 1400)


def _engine(*, meta=("confusable", NEAR), pages=1, mapping=True, veto=False, cands=None, anchor=False, box=_BOX):
    e = ExtractionEngine(mode="smart", config_path=None)
    e._s05_pages = [_Page()] * pages
    e._s05_read_geom = {} if anchor else {"reference_number": box}
    e._field_read_geom = {"reference_number": box} if anchor else {}
    e._s05_mappings = [{"field_key": "reference_number", "page_number": 0}] if mapping else []
    e._field_candidates = dict(cands or {})
    e._soften_meta = {} if meta is None else {"reference_number": meta}
    e._veto_fallthrough = veto
    e._trace = False
    e.log = lambda *a, **k: None
    e._t = lambda *a, **k: None
    return e


def _run(committed=REF, narrow=NARROW_OK, wide=WIDE_OK, *, fallback="1", resolve="1", release="1",
         note=SOFT, corrected_to=None, method="template_mapping", provenance=("ocr",), engine=None, trace=None):
    calls = {"reads": 0, "hpads": []}
    reads = [narrow, wide]
    saved = (_gr.available, _gr.read_crop, _gr.prep_crop, _rs._crop_padded)
    _gr.available = lambda: narrow is not None

    def _rc(img):
        calls["reads"] += 1
        return reads.pop(0) if reads else None
    _gr.read_crop = _rc
    _gr.prep_crop = lambda img: img

    def _cp(page, box, v, h):
        calls["hpads"].append(h)
        return ("CROP", (0, 1))
    _rs._crop_padded = _cp
    keys = ("GLYPH_FALLBACK_ENABLED", "GLYPH_CONFUSABLE_RESOLVE", "GLYPH_CONFUSABLE_RELEASE")
    old = {k: os.environ.get(k) for k in keys}
    for k, v in zip(keys, (fallback, resolve, release)):
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        e = engine or _engine()
        if trace is not None:
            e._trace = True
            e._t = lambda ev, **kw: trace.append((ev, kw))
        data = {"value": committed, "confidence": 90, "method": method}
        if note is not None:
            data["validation_note"] = note
        if corrected_to:
            data["corrected_to"] = corrected_to
        res = {"reference_number": data}
        e._glyph_disagreement_hold(res, "reference_number", list(provenance),
                                   field_defs=[{"key": "reference_number", "type": "text"}],
                                   supplier_name="Acme Ltd", document_slug="sales_order")
        return res["reference_number"], e, calls
    finally:
        _gr.available, _gr.read_crop, _gr.prep_crop, _rs._crop_padded = saved
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _held_downgraded(d, calls=None):
    assert d.get("validation_note") == RESOLVED, d.get("validation_note")
    assert d["confidence"] == 90 and d["value"] == REF and "corrected_to" not in d


def _released(d):
    assert "validation_note" not in d, d.get("validation_note")
    assert d["confidence"] == 90 and d["value"] == REF and d["method"] == "template_mapping"
    assert "corrected_to" not in d


def _reason(trace):
    return [kw.get("reason") for ev, kw in trace if ev == "glyph_release" and kw.get("outcome") == "abstain"]


def test_off_is_the_downgrade_with_one_read():
    for rel in ("0", None):
        d, e, calls = _run(release=rel)
        _held_downgraded(d)
        assert calls["reads"] == 1 and calls["hpads"] == [0.15], "OFF must never take the wide read"


def test_hard_deps():
    d, _, _ = _run(resolve="0")
    assert d["validation_note"] == SOFT and d["confidence"] == 90
    d, _, _ = _run(fallback="0")
    assert d["validation_note"] == SOFT and d["confidence"] == 90


def test_happy_path_pops_note_only():
    d, e, calls = _run()
    _released(d)
    assert set(d.keys()) == {"value", "confidence", "method"}, "C9 emit hygiene"
    assert calls["reads"] == 2 and calls["hpads"] == [0.15, 1.0], "narrow read then the WIDE clip-guard read"
    assert e._field_candidates == {}, "C1 of the hold: PP is never a corroboration candidate"


def test_population_lock_producer_and_map():
    for meta in (("corrob", "SO-80225"), ("history", "so-80228"), None, ("confusable", "SO-80225")):
        tr = []
        d, _, _ = _run(engine=_engine(meta=meta), trace=tr)
        _held_downgraded(d)
        assert _reason(tr) and _reason(tr)[0] in ("producer", "meta_missing"), (meta, _reason(tr))
    frozen = {"]": "1", "[": "1", "|": "1", "l": "1", "I": "1", "i": "1",
              "O": "0", "o": "0", "S": "5", "B": "8", "Z": "2"}
    assert dict(_CONFUSE_TO_DIGIT) == frozen, "the census map is the release population — a widening needs its own census"


def test_floors_mean_and_weakest_glyph():
    assert _GLYPH_RELEASE_PP_FLOOR == 0.95 and _GLYPH_RELEASE_GLYPH_FLOOR == 0.80
    tr = []; d, _, _ = _run(narrow=(REF, 0.949, 0.99), trace=tr); _held_downgraded(d); assert _reason(tr) == ["pp_mean"]
    d, _, _ = _run(narrow=(REF, 0.95, 0.80)); _released(d)
    tr = []; d, _, _ = _run(narrow=(REF, 0.99, 0.799), trace=tr); _held_downgraded(d); assert _reason(tr) == ["pp_glyph"]
    tr = []; d, _, _ = _run(narrow=(REF, 0.99), wide=(WIDE_OK[0], 0.98), trace=tr); _held_downgraded(d)
    assert _reason(tr) == ["pp_glyph"], "a reader without a per-glyph minimum never releases"


def test_clip_guard_wide_read_containment():
    for w in (("5O80228", 0.99, 0.98), None, ("", 0.9, 0.9), ("2SO-80228", 0.99, 0.98)):
        tr = []
        d, _, _ = _run(wide=w, trace=tr)
        _held_downgraded(d)
        assert _reason(tr) == ["wide_mismatch"], (w, _reason(tr))
    for w in (("PO No SO-80228", 0.98, 0.97), ("2 SO-80228", 0.98, 0.97), ("SO80228", 0.98, 0.97)):
        d, _, _ = _run(wide=w); _released(d)


def test_page_edge_abstains():
    for box in ((0.01, 0.30, 0.20, 0.02), (0.79, 0.30, 0.20, 0.02)):
        tr = []
        d, _, calls = _run(engine=_engine(box=box), trace=tr)
        _held_downgraded(d)
        assert _reason(tr) == ["page_edge"] and calls["hpads"] == [0.15], "no wide read attempted at the edge"


def test_page_known_rules():
    """C6 after the 007 geometry fix: an ANCHOR winner's crop page is page 0 by construction (the anchor stage
    reads page 0 only) → known even on a multi-page doc; a MAPPING winner without its row on a multi-page doc
    is unknown → abstain; a single-page doc is always known."""
    d, _, _ = _run(engine=_engine(mapping=False, pages=2, anchor=True), method="anchor_crop")
    assert "validation_note" not in d and d["method"] == "anchor_crop", "anchor winner on 2 pages → page 0 known → released"
    tr = []
    d, _, _ = _run(engine=_engine(mapping=False, pages=2), method="template_mapping", trace=tr)
    assert d.get("validation_note") == RESOLVED and _reason(tr) == ["page_unknown"]
    d, _, _ = _run(engine=_engine(mapping=False, pages=1), method="template_mapping")
    assert "validation_note" not in d


def test_veto_fallthrough_abstains():
    tr = []
    d, _, _ = _run(engine=_engine(veto=True), trace=tr)
    _held_downgraded(d)
    assert _reason(tr) == ["veto_fallthrough"]


def test_page_family_disagreement_abstains_with_the_real_record():
    cands = {"reference_number": [{"stage": "1_keyword", "method": "keyword", "value": NEAR, "confidence": 80}]}
    tr = []
    d, _, _ = _run(engine=_engine(cands=cands), trace=tr)
    _held_downgraded(d)
    assert _reason(tr) == ["page_family_disagrees"]


def test_page_family_fixtures_shared_with_js():
    for rec, expect in PAGE_FAMILY_FIXTURES:
        e = _engine()
        e._build_corroboration_emit = lambda results, _r=rec: {"reference_number": dict(_r)}
        got = e._glyph_release_page_family_disagrees({"reference_number": {"value": REF, "method": "template_mapping"}},
                                                     "reference_number", "sales_order")
        assert got is expect, (rec, got)
        tr = []
        d, _, _ = _run(engine=e, trace=tr)
        if expect:
            _held_downgraded(d); assert _reason(tr) == ["page_family_disagrees"]
        else:
            _released(d)


def test_family_set_parity_with_trust_js():
    js = open(os.path.join(os.path.dirname(os.path.dirname(HERE)), "database", "modules", "trust.js"),
              encoding="utf-8").read()
    m = re.search(r"_CORROB_PAGE_FAMILIES\s*=\s*new Set\(\[(.*?)\]\)", js)
    assert m, "trust.js lost its _CORROB_PAGE_FAMILIES literal"
    js_set = set(re.findall(r"'([a-z]+)'", m.group(1)))
    assert js_set == set(_CORROB_PAGE_FAMILIES), (js_set, _CORROB_PAGE_FAMILIES)


def test_disagree_leaves_soften_untouched():
    d, _, calls = _run(narrow=(NEAR, 0.99, 0.98))
    assert d["validation_note"] == SOFT and d["confidence"] == 90 and calls["reads"] == 1


def test_other_notes_and_corrected_to_untouched():
    d, _, _ = _run(note="already noted by another arm")
    assert d["validation_note"] == "already noted by another arm"
    d, _, _ = _run(corrected_to="SO-80229")
    assert d["validation_note"] == SOFT and d["corrected_to"] == "SO-80229"


def test_c5_ambiguous_flag_reinvoked_only_on_release():
    e = _engine(); seen = []
    e._flag_ref_confusable_ambiguous = lambda *a, **k: seen.append(a[4])
    d, _, _ = _run(engine=e); _released(d)
    assert seen == ["reference_number"], "the ambiguous flag must re-judge the now-unnoted field"
    e = _engine(meta=None); seen = []
    e._flag_ref_confusable_ambiguous = lambda *a, **k: seen.append(a[4])
    d, _, _ = _run(engine=e); _held_downgraded(d)
    assert seen == [], "never re-invoked on an abstain (the note still stands)"


def test_trace_reasons_named():
    tr = []
    d, _, _ = _run(trace=tr)
    rel = [kw for ev, kw in tr if ev == "glyph_release" and kw.get("outcome") == "released"]
    assert rel and rel[0].get("conf_at_release") == 90 and rel[0].get("pp_glyph_min") == 0.98


def test_r4_g1_predicate_refuses_the_released_shape():
    assert _fallthrough_critical_corroborated({"value": REF, "method": "template_mapping"},
                                              [{"method": "keyword", "value": NEAR}],
                                              "PO No: S0-80228 dated 12/04/2026 total 120.00", False) is False


def test_source_order_pin():
    ix = [ENGINE_SRC.index(s) for s in (
        "self._flag_ref_confusable_ambiguous(results, field_defs, supplier_name, document_slug,\n",
        "self._glyph_disagreement_hold(results, ref_field_key, page_provenance,",
        "LEARNED-AGREEMENT CONFIDENCE BOOST",
        "fc_delta = validator.format_consistency_delta(",
        "_g1_crit = (",                                   # the G1 veto-fallthrough re-note site
        "if INLINE_HARVEST_ABSENCE_HOLD:")]
    assert ix == sorted(ix), ix


def test_tag_and_reset_source_pin():
    assert "self._soften_meta = {}" in ENGINE_SRC[:ENGINE_SRC.index("results      = {}")]
    for prod in ("corrob", "history", "confusable"):
        i = ENGINE_SRC.index(f"self._t('filing_sanity_ref_{prod}_soften'")
        assert f"_tag('{prod}'" in ENGINE_SRC[i:i + 400], prod
    body = ENGINE_SRC[ENGINE_SRC.index("def _glyph_disagreement_hold"):ENGINE_SRC.index("def _glyph_release_page_family_disagrees")]
    assert body.count("data.pop('validation_note', None)") == 1, "the pop is the ONLY release mutation"
    assert "GLYPH_CONFUSABLE_RELEASE" in body[body.index("_resolve = True"):], "read only inside the DOWNGRADE branch"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn(); print(f"  ok {fn.__name__}")
    print(f"\n{len(fns)}/{len(fns)} passed")
