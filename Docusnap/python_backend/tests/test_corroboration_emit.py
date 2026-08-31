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
import re

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

# ── 2b. ORACLE C1: a MEMORY stamp is its own family, not the mapping family ──
# template_fixed carries no pixels. Folding it into 'mapping' (as the shared crosscheck bucket
# does) would suppress both the page-corroborates-memory agreement AND the stamp-contradicted-by-
# the-page disagreement as "same family" — hiding the Oakhaven class entirely.
res = {"vat_no": {"value": "GB 512 8846 27", "method": "template_fixed", "confidence": 95}}
e = emit(res, {"vat_no": [cand("0.5_mapping", "template_mapping", "GB 512 8846 27")]})["vat_no"]
assert e["winner_family"] == "memory" and e["independent_agree"] is True and e["agree"] == ["mapping"], e
ok("ORACLE C1: the page's own taught-box read CORROBORATES a memory stamp (memory != mapping)")

res = {"vat_no": {"value": "GB 512 8846 27", "method": "template_fixed", "confidence": 95}}
e = emit(res, {"vat_no": [cand("0.5_mapping", "template_mapping", "GB 660 1173 45")]})["vat_no"]
assert e["independent_agree"] is False, e
assert e["disagree"] == [{"family": "mapping", "value": "GB 660 1173 45"}], e
ok("ORACLE C1: a frozen stamp CONTRADICTED by the page's own read is recorded, not suppressed")

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

# ── 11. VOCABULARY FREEZE (2026-08-11, the record became DECISION-BEARING) ────
# trust.js's corroborated auto-file route licenses filing off these family names
# (_CORROB_PAGE_FAMILIES = {mapping, crop, keyword}; memory+hint refused as near-circular).
# The JS side FAILS CLOSED on an unknown name — safe but SILENT: a rename here would quietly
# inert the route with every gate still green. So the emitted vocabulary is frozen: every
# family string this emit can produce must be one of exactly these five. A new family is a
# deliberate cross-language change (update trust.js + its battery + this pin together).
_FROZEN = {"mapping", "crop", "keyword", "hint", "memory"}
res = {"f": {"value": "V", "method": "template_mapping", "confidence": 90}}
sweep = {"f": [
    cand("0.5_mapping", "template_mapping", "V"),
    cand("0.5_mapping", "template_fixed", "V"),
    cand("0.5_mapping", "template_anchor", "V"),
    cand("1_keyword", "keyword", "V"),
    cand("1_keyword", "keyword_override", "V"),
    cand("2_anchor", "anchor_crop", "V"),
    cand("2_anchor", "anchor_crop_relocated", "V"),
    cand("2_anchor", "anchor_inline", "V"),
    cand("2_anchor", "hint", "V"),
    cand("2_anchor", "hint_fill", "V"),
]}
e = emit(res, sweep)["f"]
seen = {e["winner_family"], *e["agree"], *(d["family"] for d in e["disagree"])}
assert seen <= _FROZEN, f"emit produced a family OUTSIDE the frozen vocabulary: {seen - _FROZEN}"
ok(f"family vocabulary frozen to {sorted(_FROZEN)} (saw {sorted(seen)})")

# ── 12. independent_agree TRUTH now gates filing: same-family echo must not set it ──
res = {"f": {"value": "V", "method": "template_mapping", "confidence": 90}}
e = emit(res, {"f": [cand("0.5_mapping", "template_mapping", "V"),
                     cand("0.5_mapping", "template_mapping", "V")]})["f"]
assert e["independent_agree"] is False and e["agree"] == [], e
ok("a same-family echo can never set independent_agree (now load-bearing for auto-file)")

# ── 13. CROSS-LANGUAGE: engine._corrob_licensed mirrors trust.js _corrobLicensed (2026-08-15) ──
# The held-queue arc's note resolver reads the SAME licensed-record bet the JS auto-file gate uses.
# A rename/relaxation on either side silently inerts one — pin the page-family SET (read from the JS
# source) and the decision on the canonical cases against the Python mirror.
from extraction import engine as _eng  # noqa: E402
_trust_src = ""
for _p in (os.path.join(os.path.dirname(__file__), "..", "..", "database", "modules", "trust.js"),
           os.path.join(os.path.dirname(__file__), "..", "..", "Docusnap", "database", "modules", "trust.js")):
    if os.path.exists(_p):
        with open(_p, encoding="utf-8") as _f:
            _trust_src = _f.read()
        break
_m = re.search(r"_CORROB_PAGE_FAMILIES\s*=\s*new Set\(\[([^\]]*)\]\)", _trust_src)
_js_fams = set(re.findall(r"'([^']+)'", _m.group(1))) if _m else set()
assert _js_fams == set(_eng._CORROB_PAGE_FAMILIES), \
    f"page-family set drift: JS {_js_fams} != Python {set(_eng._CORROB_PAGE_FAMILIES)}"
ok(f"page-family set matches trust.js: {sorted(_js_fams)}")
_cl = _eng._corrob_licensed
assert _cl({"independent_agree": True, "winner_family": "crop", "agree": ["mapping"], "disagree": []}) is True
assert _cl({"independent_agree": True, "winner_family": "memory", "agree": ["hint"], "disagree": []}) is False
assert _cl({"independent_agree": False, "winner_family": "crop", "agree": ["mapping"], "disagree": []}) is False
assert _cl({"independent_agree": True, "winner_family": "crop", "agree": [], "disagree": [{"family": "keyword", "value": "x"}]}) is False
assert _cl({"independent_agree": True, "winner_family": "crop", "agree": []}) is False
assert _cl(None) is False
ok("engine._corrob_licensed decision mirrors trust.js on the canonical cases")

# ── 14. BARE-ANCHOR → KEYWORD FAMILY (2026-08-23; gary → Oracle SIGN-OFF-W/COND) ──────────────
# Bare `anchor` is the full-page TEXT-LINE reader (anchor.py:1309), the keyword family's pixels — not a
# crop. The shared bucket EXCLUDES it; the RECORD folds it into keyword so a genuine crop/mapping winner's
# corroboration by a different-recipe read is no longer discarded (the Pelican 565 hold). Kill:
# CORROB_ANCHOR_AS_KEYWORD=0.
# HEAL — an ANCHOR winner corroborated by an independent MAPPING crop (the doc-565 shape):
res = {"invoice_number": {"value": "PI/25/5450", "method": "anchor", "confidence": 84}}
cands = {"invoice_number": [cand("0.5_mapping", "template_mapping", "PI/25/5450"),
                            cand("2_anchor", "anchor", "PI/25/5450")]}
e = emit(res, cands)["invoice_number"]
assert e["winner_family"] == "keyword" and e["agree"] == ["mapping"] \
    and e["independent_agree"] is True and e["disagree"] == [], e
ok("bare-anchor winner + independent mapping crop → licensed (the Pelican 565 heal)")

# BEFORE/AFTER — with the reclassification OFF the same record is agree:[] (proves the pin needs the fix):
os.environ["CORROB_ANCHOR_AS_KEYWORD"] = "0"
try:
    e0 = emit(res, cands)["invoice_number"]
    assert e0["agree"] == [] and e0["independent_agree"] is False, e0
    ok("…and OFF (CORROB_ANCHOR_AS_KEYWORD=0) it is agree:[] — the fix is what heals it")
finally:
    os.environ.pop("CORROB_ANCHOR_AS_KEYWORD", None)

# REVERSE — a MAPPING winner corroborated by the bare-anchor line (anchor folds to keyword = real 2nd family):
res = {"ref": {"value": "X-1", "method": "template_mapping", "confidence": 90}}
e = emit(res, {"ref": [cand("2_anchor", "anchor", "X-1")]})["ref"]
assert e["winner_family"] == "mapping" and e["agree"] == ["keyword"] and e["independent_agree"] is True, e
ok("mapping winner + bare-anchor line → keyword-family corroboration (reverse heal)")

# FRAUD STAYS CLOSED — bare-anchor winner + keyword-regex agreeing = SAME family now → no independence:
res = {"ref": {"value": "PO-1", "method": "anchor", "confidence": 85}}
e = emit(res, {"ref": [cand("1_keyword", "keyword", "PO-1")]})["ref"]
assert e["independent_agree"] is False and e["agree"] == [], e
ok("bare-anchor winner + keyword-regex agree = same family (fold) → still no independence (fraud closed)")

# THE r19-UNMASK SEAM (Oracle 2026-08-23) — a mapping winner where the bare-anchor LINE agrees but a
# keyword-REGEX read DISAGREES must ROUTE TO REVIEW: the regex is the genuinely independent dissent, and a
# bare-anchor same-line agreement must NOT suppress it (else X auto-files with no shape gate):
res = {"ref": {"value": "X-1", "method": "template_mapping", "confidence": 90}}
e = emit(res, {"ref": [cand("2_anchor", "anchor", "X-1"),
                       cand("1_keyword", "keyword", "Y-9")]})["ref"]
assert any(d["family"] == "keyword" for d in e["disagree"]), e
assert _eng._corrob_licensed(e) is False, e
ok("mapping winner + bare-anchor(X) agree + keyword-regex(Y) disagree → dissent kept, NOT licensed (r19 holds)")

# CONTRAST — a NON-anchor within-family agree STILL suppresses that family's disagreement (existing rule
# unchanged; the seam guard is bare-anchor-specific):
res = {"ref": {"value": "X-1", "method": "template_mapping", "confidence": 90}}
e = emit(res, {"ref": [cand("1_keyword", "keyword", "X-1"),
                       cand("1_keyword", "keyword", "Y-9")]})["ref"]
assert e["disagree"] == [] and e["agree"] == ["keyword"], e
ok("a genuine keyword-regex agreement still collapses its family's disagreement (non-anchor unchanged)")

# NARROWNESS — ONLY bare `anchor` is reclassified; anchor_registration stays an excluded winner, and the
# SHARED bucket still returns None for bare anchor (nobody may hoist the fold into the shared function):
res = {"ref": {"value": "PO-1", "method": "anchor_registration", "confidence": 85}}
e = emit(res, {"ref": [cand("0.5_mapping", "template_mapping", "PO-1")]})["ref"]
assert e["independent_agree"] is False, e
ok("anchor_registration is NOT reclassified (only bare anchor) — stays an excluded winner")
assert _eng._crosscheck_witness_bucket(None, "anchor") is None, "shared bucket must still EXCLUDE bare anchor"
ok("the SHARED _crosscheck_witness_bucket still excludes bare anchor (live reconcile untouched)")

print(f"\n{passed} checks passed")
