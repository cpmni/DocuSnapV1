"""test_corroboration_emit.py — the corroboration RECORD: independence is method family.

Run: py -3.12 python_backend/tests/test_corroboration_emit.py

OWNER PRINCIPLE (2026-08-11, verbatim): "it is more about corroboration than merely getting it
right. all the mechanisms should work in the best way possible to enable us to confirm the values
obtained." The trace that prompted it: the mapping matched 'JOB SHEET NO' at 90 and the keyword
matched a bare 'Ref' at 85 — two rungs answering DIFFERENT questions, settled by a 5-point margin.
A margin is not evidence. This emit records, per committed field, which INDEPENDENT method
families read the same value — so agreement stops being invisible.

WHAT THESE PINS DEFEND:
  * Independence is METHOD FAMILY, never a witness count. Same-pixel agreement is worthless —
    Oracle 2026-08-03 measured same-crop-different-prep witnesses at 5:1 false:true, re-proved
    2026-08-11 (two preps agreed on the wrong P1 on 2 of 5 documents). A future dev who counts
    witnesses instead of families reintroduces exactly that.
  * The bucketing comes from _crosscheck_witness_bucket, which EXCLUDES the independence frauds
    (anchor_registration = located-by-fiat; bare 'anchor' = the same full-page line the keyword
    pass reads). An excluded winner may never claim independent_agree.
  * RECORD-ONLY: the emit must not touch results. The ordered plan is record -> surface -> only
    then let it move a decision; wiring it into selection/auto-file belongs to a later,
    separately-gated slice.
"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.engine import ExtractionEngine  # noqa: E402

passed = 0


def ok(name):
    global passed
    passed += 1
    print(f"  ok  {name}")


class _Fake:
    """Just enough self for the unbound method — the emit reads only _field_candidates."""
    def __init__(self, candidates):
        self._field_candidates = candidates


def emit(results, candidates):
    return ExtractionEngine._build_corroboration_emit(_Ake := _Fake(candidates), results)


def cand(stage, method, value):
    return {"stage": stage, "method": method, "value": value, "confidence": 80}


# ── 1. The headline case: caption-located and geometry-located AGREE ─────────
res = {"worksheet_number": {"value": "CJB-2592", "method": "template_mapping", "confidence": 90}}
cands = {"worksheet_number": [cand("0.5_mapping", "template_mapping", "CJB-2592"),
                             cand("1_keyword", "keyword", "CJB-2592")]}
e = emit(res, cands)["worksheet_number"]
assert e["independent_agree"] is True and e["agree"] == ["keyword"], e
assert e["winner_family"] == "mapping", e
ok("keyword + mapping reading the same value = INDEPENDENT agreement, recorded")

# ── 2. Independent DISAGREEMENT is recorded (the Oakhaven VAT row) ───────────
res = {"vat_no": {"value": "GB 512 8846 27", "method": "template_fixed", "confidence": 95}}
cands = {"vat_no": [cand("1_keyword", "keyword", "GB 660 1173 45")]}
e = emit(res, cands)["vat_no"]
assert e["independent_agree"] is False, e
assert e["disagree"] == [{"family": "keyword", "value": "GB 660 1173 45"}], e
ok("a stamped value contradicted by the page's own caption read is RECORDED (not acted on)")

# ── 3. Same-family agreement counts for NOTHING ──────────────────────────────
res = {"ref": {"value": "PO-1", "method": "keyword", "confidence": 85}}
cands = {"ref": [cand("1_keyword", "keyword", "PO-1"),
                 cand("1_keyword", "keyword_override", "PO-1")]}
e = emit(res, cands)["ref"]
assert e["independent_agree"] is False and e["agree"] == [], e
ok("two keyword-family reads agreeing = same pixels/recipe = no independence claimed")

# ── 4. Excluded methods can neither vouch nor claim ──────────────────────────
res = {"ref": {"value": "PO-1", "method": "keyword", "confidence": 85}}
cands = {"ref": [cand("2_anchor", "anchor_registration", "PO-1"),
                 cand("2_anchor", "anchor", "PO-1")]}
e = emit(res, cands)["ref"]
assert e["independent_agree"] is False, e
ok("anchor_registration / bare anchor (the independence frauds) may not vouch")

res = {"ref": {"value": "PO-1", "method": "anchor", "confidence": 85}}
cands = {"ref": [cand("1_keyword", "keyword", "PO-1")]}
e = emit(res, cands)["ref"]
assert e["independent_agree"] is False, e
ok("a bare-anchor WINNER cannot claim keyword agreement — they read the same full-page line")

# ── 5. Crop family is independent of keyword ─────────────────────────────────
res = {"total": {"value": "1,962.00", "method": "keyword", "confidence": 85}}
cands = {"total": [cand("2_anchor", "anchor_inline", "1,962.00")]}
e = emit(res, cands)["total"]
assert e["independent_agree"] is True and e["agree"] == ["crop"], e
ok("a drawn-box crop read corroborates a caption read (different pixels, different recipe)")

# ── 6. Comparison is normalised, not byte equality ───────────────────────────
res = {"ref": {"value": "PO-1", "method": "template_mapping", "confidence": 90}}
cands = {"ref": [cand("1_keyword", "keyword", "  po-1 ")]}
e = emit(res, cands)["ref"]
assert e["independent_agree"] is True, e
ok("agreement is judged on the normalised value (case/whitespace noise ignored)")

# ── 7. A family that both agrees and disagrees counts as agreement ───────────
res = {"ref": {"value": "PO-1", "method": "template_mapping", "confidence": 90}}
cands = {"ref": [cand("1_keyword", "keyword", "PO-1"),
                 cand("1_keyword", "keyword", "XX-9")]}
e = emit(res, cands)["ref"]
assert e["agree"] == ["keyword"] and e["disagree"] == [], e
ok("agree wins within a family — the record never contradicts itself")

# ── 8. '+corrected' overlays keep their family ───────────────────────────────
res = {"ref": {"value": "PO-1", "method": "keyword+corrected", "confidence": 85}}
cands = {"ref": [cand("0.5_mapping", "template_mapping", "PO-1")]}
e = emit(res, cands)["ref"]
assert e["winner_family"] == "keyword" and e["independent_agree"] is True, e
ok("a corrected overlay does not change the winner's family")

# ── 9. RECORD-ONLY: results untouched, kill switch works ─────────────────────
res = {"ref": {"value": "PO-1", "method": "keyword", "confidence": 85}}
before = {k: dict(v) for k, v in res.items()}
emit(res, {"ref": [cand("0.5_mapping", "template_mapping", "PO-1")]})
assert res == before, "the emit mutated results"
ok("the emit never mutates results — record-only by construction")

os.environ["FIELD_CORROBORATION_EMIT"] = "0"
try:
    assert emit(res, {"ref": [cand("0.5_mapping", "template_mapping", "PO-1")]}) == {}
    ok("FIELD_CORROBORATION_EMIT=0 kills the emit entirely")
finally:
    os.environ.pop("FIELD_CORROBORATION_EMIT", None)

# ── 10. Empty/missing values are skipped, metadata keys ignored ──────────────
res = {"_supplier_name": "X", "empty": {"value": "", "method": "keyword"},
       "ref": {"value": "PO-1", "method": "keyword", "confidence": 85}}
e = emit(res, {})
assert set(e.keys()) == {"ref"}, e
assert e["ref"]["winner_family"] == "keyword" and e["ref"]["agree"] == [], e
ok("metadata and empty fields are skipped; a sole witness records as such")

print(f"\n{passed} checks passed")
