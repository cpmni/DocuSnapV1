"""Pins for the ref-arbiter reinstatement (mig 160 filing_sanity_ref_reinstate, DARK; Ridgeway exhibit).

The pure predicate `_ref_reinstate_candidate` is tested against real primitives (build_format_class_index /
build_prefix_index / shape_match_score / code_prefix), and the engine method wrapper for env-gating + the
note/cap application. Each guard is proven to FAIL with it removed (a No-reinstate case that would flip). The
reinstate case (#1) is the regression PIN; the same-shape-neighbour (#9) is the Oracle B2 adversarial fixture.
Run: py -3.12 tests/test_ref_reinstate_page_absent.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from extraction import format_anomaly_checker as F
from extraction import ocr_corrector as OC
from extraction.engine import (_ref_reinstate_candidate, ExtractionEngine, _cmp_norm,
                                _FILING_SANITY_ABSENT_MARK, _FILING_SANITY_SOFTEN_MARK)

CONFIRMED = [{"field_key": "reference_number", "supplier_name": "Ridgeway Plant Hire",
              "document_type": "worksheet",
              "sample_values": ["WS-73601", "WS-73588", "WS-73512", "WS-73490"],
              "value_counts": {"WS-73601": 3, "WS-73588": 2, "WS-73512": 2, "WS-73490": 2}}]
FCI = F.build_format_class_index(CONFIRMED)
FMT = FCI.get(("ridgeway plant hire", "worksheet", "reference_number"))
PIDX = OC.build_prefix_index(CONFIRMED)
DOM = (OC.lookup_prefix(PIDX, "reference_number", "Ridgeway Plant Hire", "worksheet") or {}).get("dominant")

PAGE = ("Ridgeway Plant Hire   Unit 5, Quarry Road Estate   Reference No. WS-73673   Date 13/04/2026\n"
        "WORKSHEET   Site / Customer   Aldermoor Engineering   Delivery Consumables Materials Labour "
        "Service call-out   Net Total GBP 13,698.91   VAT 20% Order Total GBP 16,438.69") + (" pad" * 30)
def _toks(page):
    return {t.strip('.,;:()[]{}"\'').casefold() for t in re.split(r"\s+", page)}
TOKS = _toks(PAGE)

def cand(v, method="keyword_override", conf=85, noted=False):
    return {"value": v, "method": method, "confidence": conf, "noted": noted}

# ── pure predicate ─────────────────────────────────────────────────────────
def P(winner="VS-72672", wmethod="template_mapping", cands=None, toks=TOKS, fmt=FMT, dom=DOM, others=None, page=PAGE):
    return _ref_reinstate_candidate(winner, wmethod, cands or [], toks, fmt, dom, others or set(), page)

def test_1_reinstate_regression_pin():
    assert P(cands=[cand("WS-73673")]) == "WS-73673"

def test_2_cand_not_on_page():
    toks = _toks(PAGE.replace("WS-73673", "WS-99999"))   # the true value not printed
    assert P(cands=[cand("WS-73673")], toks=toks) is None

def test_3_cand_shape_wrong():
    # 'WS-7' on page but wrong shape (not WS-#####)
    assert P(cands=[cand("WS-7")], toks=TOKS | {"ws-7"}) is None

def test_4_cand_wrong_prefix():
    assert P(cands=[cand("XS-73673")], toks=TOKS | {"xs-73673"}) is None

def test_5_ambiguous_two_qualifying():
    toks = TOKS | {"ws-98241"}
    assert P(cands=[cand("WS-73673"), cand("WS-98241")], toks=toks) is None

def test_6_user_literal_winner():
    assert P(wmethod="template_fixed", cands=[cand("WS-73673")]) is None

def test_7_winner_not_stage05():
    assert P(wmethod="keyword", cands=[cand("WS-73673")]) is None

def test_8_cold_start_no_shape_or_prefix():
    assert P(cands=[cand("WS-73673")], fmt=None) is None
    assert P(cands=[cand("WS-73673")], dom=None) is None

def test_9_adversarial_neighbour_another_fields_value():
    # WS-73673 is on-page + shape + prefix, BUT it's another committed field's value -> must NOT reinstate.
    assert P(cands=[cand("WS-73673")], others={_cmp_norm("WS-73673")}) is None

def test_10_clip_fragment_of_longer_token():
    # 'WS-736' is a sepless-substring of the longer same-line 'WS-73673' -> clip guard rejects.
    assert P(cands=[cand("WS-736")], toks=TOKS | {"ws-736"}) is None

def test_11_noted_or_lowconf_candidate_skipped():
    assert P(cands=[cand("WS-73673", noted=True)]) is None
    assert P(cands=[cand("WS-73673", conf=40)]) is None

# ── engine method wrapper (env gating + apply) ───────────────────────────────
class _Stub:
    def __init__(self, cands):
        self.prefix_index = PIDX
        self._field_candidates = {"reference_number": cands}
        self._trace = False
    def _make_format_lookup(self, sup, slug):
        return lambda k: (FMT if k == "reference_number" else None)
    def log(self, *a, **k):
        pass
    def _t(self, *a, **k):
        pass

def _absent_result(value="VS-72672", conf=90, method="template_mapping"):
    return {"reference_number": {"value": value, "confidence": conf, "method": method,
                                 "validation_note": f"'{value}' {_FILING_SANITY_ABSENT_MARK} — please check the reference before filing."},
            "_supplier_name": "Ridgeway Plant Hire", "_document_slug": "worksheet"}

def _run_method(env_on, results, cands):
    if env_on:
        os.environ["FILING_SANITY_REF_REINSTATE"] = "1"
    else:
        os.environ.pop("FILING_SANITY_REF_REINSTATE", None)
    ExtractionEngine._reinstate_page_absent_ref(
        _Stub(cands), results, "reference_number", PAGE, "Ridgeway Plant Hire", "worksheet")
    return results["reference_number"]

def test_20_method_reinstates_review_bound():
    d = _run_method(True, _absent_result(), [cand("WS-73673")])
    assert d["value"] == "WS-73673" and d["confidence"] <= 69
    assert d.get("method") == "keyword_override" and d.get("was_corrected") is False and "corrected_to" not in d
    assert _FILING_SANITY_SOFTEN_MARK in d["validation_note"] and _FILING_SANITY_ABSENT_MARK not in d["validation_note"]
    assert "WS-73673" in d["validation_note"] and "VS-72672" in d["validation_note"]

def test_21_off_byte_identical():
    before = _absent_result()
    snap = dict(before["reference_number"])
    d = _run_method(False, before, [cand("WS-73673")])
    assert d == snap   # env OFF -> untouched

def test_22_no_absent_mark_noop():
    r = {"reference_number": {"value": "VS-72672", "confidence": 90, "method": "template_mapping"},
         "_supplier_name": "Ridgeway Plant Hire", "_document_slug": "worksheet"}
    snap = dict(r["reference_number"])
    d = _run_method(True, r, [cand("WS-73673")])
    assert d == snap   # Gate C never marked absent -> byte-identical

def test_23_method_no_qualifying_cand_keeps_absent_note():
    d = _run_method(True, _absent_result(), [cand("WS-7")])   # shape-wrong -> no reinstate
    assert d["value"] == "VS-72672" and _FILING_SANITY_ABSENT_MARK in d["validation_note"]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    fails = 0
    for fn in fns:
        try:
            fn()
            print(f"  PASS {fn.__name__}")
        except AssertionError as e:
            fails += 1
            print(f"  FAIL {fn.__name__}: {e}")
        except Exception as e:
            fails += 1
            print(f"  ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - fails}/{len(fns)} passed")
    sys.exit(1 if fails else 0)
