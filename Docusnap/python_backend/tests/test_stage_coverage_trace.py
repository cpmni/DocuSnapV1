#!/usr/bin/env python3
"""
tests/test_stage_coverage_trace.py
----------------------------------
SFDEV every-step trace — the `step` event ladder (slice 1, four core stages).

Pins the Oracle-signed conditions for the dev-only per-field ladder:
  - the ladder is COMPLETE: exactly one `step` per (stage, configured field),
    INCLUDING when a stage's gate is FALSE (no template / no anchors) — the
    exhibit-A "green dots, no anchor rows" class (SEAM 3a);
  - the discriminator is value-TRUTHINESS FIRST, so a {value:None} seed is
    `no_candidate`, never a false `won` (SEAM 3b, the Stage-0 reference-copy trap
    — exercised here via a keyword {value:None}, the identical code path);
  - the ladder can NEVER disagree with the `merge` event (shared `_merge_outcome`):
    a `won` step's value+method equal the merge win event's (value-parity pin);
  - `lost` steps RETAIN their value+method (the fine-tuning arc's substrate);
  - `already_resolved` states STATE, never a DECISION this vantage can't see
    (no "credible"/"validated"/"skipped because" — no-overclaim pin);
  - trace-OFF is byte-identical (guard-shape pin + a two-run results-equal pin).

OCR-dependent stages are stubbed (keyword + anchor return controlled dicts); the
Stage-0/0.5 RAN call SITES (which need a real/stubbed template) are covered by the
realdoc corpus trace-on pass, not this harness — see the note in main().

    py -3.12 python_backend/tests/test_stage_coverage_trace.py
Exit 0 = all good. Exit 1 = a ladder property regressed.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as engine_mod
from extraction.engine import ExtractionEngine

CONFIG = str(Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")

CORE_STAGES = ("0_template", "0.5_mapping", "1_keyword", "2_anchor")


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def _run(field_defs, kw_results, anchor_results, anchors="auto", trace=True):
    """Run extract() with keyword/anchor stubbed. `anchors="auto"` builds one
    anchor per field (Stage 2 gate TRUE); pass [] to force the gate FALSE.
    Returns (results, events)."""
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    orig_kw, orig_an = engine_mod.keyword.extract_fields, engine_mod.anchor.extract_with_anchors
    engine_mod.keyword.extract_fields = lambda *a, **k: {kk: dict(vv) for kk, vv in kw_results.items()}
    engine_mod.anchor.extract_with_anchors = lambda *a, **k: {kk: dict(vv) for kk, vv in anchor_results.items()}
    anchor_arg = ([{"field_key": f["key"]} for f in field_defs] if anchors == "auto" else anchors)
    events = []
    try:
        results = eng.extract(
            ocr_text="stub", page_images=[], filename="t.pdf", field_defs=field_defs,
            hints=[], anchors=anchor_arg,
            logos=[], templates=[], document_type="Invoice", document_slug="invoice",
            trace=(events.append if trace else None))
    finally:
        engine_mod.keyword.extract_fields = orig_kw
        engine_mod.anchor.extract_with_anchors = orig_an
    return results, events


def _steps(events, stage, field):
    return [e for e in events if e.get("event") == "step"
            and e.get("stage") == stage and e.get("field") == field]


def _step(events, stage, field):
    s = _steps(events, stage, field)
    return s[0] if s else None


def _merge_win(events, stage, field):
    return next((e for e in events if e.get("event") == "merge" and e.get("decision") == "win"
                 and e.get("stage") == stage and e.get("field") == field), None)


REF = [{"key": "job_no", "type": "text"}]
TWO = [{"key": "invoice_number", "type": "text"}, {"key": "po_number", "type": "text"}]


def test_completeness_gate_false():
    """The load-bearing pin: exactly ONE step per (core stage, CONFIGURED field),
    even when Stage-0 (no template) AND Stage-2 (no anchors) gates are FALSE."""
    print("completeness: one step per (stage, field), gates 0 and 2 both FALSE")
    failures = 0
    results, events = _run(
        TWO,
        {"invoice_number": {"value": "INV-1", "confidence": 80, "method": "keyword"}},
        {},                       # anchor stub irrelevant — no anchors in scope
        anchors=[])               # Stage 2 gate FALSE; templates=[] → Stage 0 gate FALSE
    for stage in CORE_STAGES:
        for f in ("invoice_number", "po_number"):
            n = len(_steps(events, stage, f))
            if not check(f"exactly one step for ({stage}, {f}) — got {n}", n == 1):
                failures += 1
    # gate-false stages must be 'skipped' with a reason (exhibit-A class)
    if not check("Stage 0 skipped (no template)",
                 _step(events, "0_template", "po_number").get("outcome") == "skipped"):
        failures += 1
    s2 = _step(events, "2_anchor", "invoice_number")
    if not check("Stage 2 skipped w/ no-anchors reason (exhibit-A)",
                 s2.get("outcome") == "skipped" and "anchor" in (s2.get("reason") or "")):
        failures += 1
    print()
    return failures


def test_exhibit_a_already_resolved():
    """Exhibit A: a field greened by keyword shows Stage-1 won AND Stage-2 as a
    real row (already_resolved), not silent absence — despite Stage 2 running."""
    print("exhibit A: keyword-filled field shows Stage-2 already_resolved, not absent")
    failures = 0
    results, events = _run(
        REF,
        {"job_no": {"value": "JOB-9", "confidence": 80, "method": "keyword"}},
        {})                       # anchor produces nothing; anchors in scope (gate TRUE)
    s1 = _step(events, "1_keyword", "job_no")
    if not check("Stage 1 won for job_no", s1 and s1.get("outcome") == "won" and s1.get("value") == "JOB-9"):
        failures += 1
    s2 = _step(events, "2_anchor", "job_no")
    if not check("Stage 2 already_resolved, by=keyword",
                 s2 and s2.get("outcome") == "already_resolved" and s2.get("by") == "keyword"):
        failures += 1
    print()
    return failures


def test_exhibit_b_anchor_win_no_kw_no_mapping():
    """Exhibit B: po_number won by an anchor with NO keyword candidate — Stage-1
    reads no_candidate (keyword TRIED, nothing), Stage-0.5 skipped, Stage-2 won."""
    print("exhibit B: anchor win, keyword no_candidate, mapping skipped")
    failures = 0
    results, events = _run(
        [{"key": "po_number", "type": "text"}],
        {},                       # keyword found nothing
        {"po_number": {"value": "PO-9", "confidence": 80, "method": "anchor_inline"}})
    s1 = _step(events, "1_keyword", "po_number")
    if not check("Stage 1 no_candidate for po_number", s1 and s1.get("outcome") == "no_candidate"):
        failures += 1
    s05 = _step(events, "0.5_mapping", "po_number")
    if not check("Stage 0.5 skipped", s05 and s05.get("outcome") == "skipped"):
        failures += 1
    s2 = _step(events, "2_anchor", "po_number")
    if not check("Stage 2 won == PO-9 via anchor_inline",
                 s2 and s2.get("outcome") == "won" and s2.get("value") == "PO-9"
                 and s2.get("method") == "anchor_inline"):
        failures += 1
    print()
    return failures


def test_value_none_is_no_candidate_not_won():
    """SEAM 3b: a stage producing {value:None} for a configured field is
    no_candidate, NEVER a false 'won' (results[key] IS the seed object)."""
    print("SEAM 3b: {value:None} keyword read is no_candidate, not a false won")
    failures = 0
    results, events = _run(
        REF,
        {"job_no": {"value": None, "confidence": 50, "method": "keyword"}},
        {})
    s1 = _step(events, "1_keyword", "job_no")
    if not check("Stage 1 no_candidate (not won) for the {value:None} read",
                 s1 and s1.get("outcome") == "no_candidate"):
        failures += 1
    print()
    return failures


def test_won_parity_with_merge():
    """A won step's value+method equal the merge win event's — the shared
    _merge_outcome guarantee, pinned so a refactor can't re-source the value."""
    print("parity: won step value+method == merge win event")
    failures = 0
    results, events = _run(
        REF,
        {},                                                   # empty → anchor first-fills
        {"job_no": {"value": "REF-42", "confidence": 80, "method": "anchor_crop"}})
    s2 = _step(events, "2_anchor", "job_no")
    mw = _merge_win(events, "2_anchor", "job_no")
    if not check("Stage 2 step won", s2 and s2.get("outcome") == "won"):
        failures += 1
    if not check("step value+method == merge win value+method",
                 s2 and mw and s2.get("value") == mw.get("value") == "REF-42"
                 and s2.get("method") == mw.get("method")):
        failures += 1
    print()
    return failures


def test_lost_retains_value():
    """Trade-off pin: a `lost` step keeps its value+method (the arc's substrate).
    A lone 'a' anchor_crop loses the credibility gate to a plausible incumbent."""
    print("trade-off: lost step retains value+method")
    failures = 0
    results, events = _run(
        REF,
        {"job_no": {"value": "JOB-123", "confidence": 70, "method": "keyword"}},
        {"job_no": {"value": "a",       "confidence": 95, "method": "anchor_crop"}})
    s2 = _step(events, "2_anchor", "job_no")
    if not check("Stage 2 lost, value 'a' retained, method kept",
                 s2 and s2.get("outcome") == "lost" and s2.get("value") == "a"
                 and s2.get("method") == "anchor_crop"):
        failures += 1
    print()
    return failures


def test_already_resolved_wording_no_overclaim():
    """already_resolved reason states STATE, never a DECISION this vantage can't
    see (Oracle C3): no 'credible' / 'validated' / 'skipped because'."""
    print("no-overclaim: already_resolved reason states state, not a decision")
    failures = 0
    _results, events = _run(
        REF,
        {"job_no": {"value": "JOB-9", "confidence": 80, "method": "keyword"}},
        {})
    s2 = _step(events, "2_anchor", "job_no")
    reason = (s2.get("reason") or "").lower() if s2 else ""
    banned = ("credible", "validated", "skipped because")
    if not check("reason contains 'already held'", "already held" in reason):
        failures += 1
    if not check(f"reason free of overclaim words {banned!r}",
                 all(b not in reason for b in banned)):
        failures += 1
    print()
    return failures


def test_trace_off_is_inert():
    """Guard-shape pin: _trace_steps emits nothing when trace is off; and a full
    extract() run yields byte-identical results trace-off vs trace-on."""
    print("inertness: trace-off emits no steps and does not perturb results")
    failures = 0
    # (a) direct guard-shape: _trace None → no emission
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    eng._trace = None
    emitted = []
    eng._t = lambda *a, **k: emitted.append((a, k))
    eng._trace_steps("1_keyword", True, None,
                     {"x": {"value": "v", "method": "keyword"}}, {}, {"x": {"value": "v"}}, ["x"])
    if not check("no events emitted with trace off", len(emitted) == 0):
        failures += 1
    # (b) results identical trace-off vs trace-on (catches a stray results write)
    kw = {"job_no": {"value": "JOB-1", "confidence": 70, "method": "keyword"}}
    an = {"job_no": {"value": "REF-9", "confidence": 80, "method": "anchor_crop"}}
    r_off, _ = _run(REF, kw, an, trace=False)
    r_on, _ = _run(REF, kw, an, trace=True)
    same = (r_off.get("job_no", {}).get("value") == r_on.get("job_no", {}).get("value")
            and r_off.get("job_no", {}).get("confidence") == r_on.get("job_no", {}).get("confidence")
            and r_off.get("job_no", {}).get("method") == r_on.get("job_no", {}).get("method")
            and r_off.get("job_no", {}).get("validation_note") == r_on.get("job_no", {}).get("validation_note"))
    if not check("results identical trace-off vs trace-on (value/conf/method/note)", same):
        failures += 1
    print()
    return failures


def main():
    failures = 0
    failures += test_completeness_gate_false()
    failures += test_exhibit_a_already_resolved()
    failures += test_exhibit_b_anchor_win_no_kw_no_mapping()
    failures += test_value_none_is_no_candidate_not_won()
    failures += test_won_parity_with_merge()
    failures += test_lost_retains_value()
    failures += test_already_resolved_wording_no_overclaim()
    failures += test_trace_off_is_inert()
    print("NOTE: Stage-0/0.5 RAN call sites need a real template — covered by the")
    print("      realdoc corpus trace-on pass (completeness on template docs), not")
    print("      this keyword/anchor harness. Slice-1 boundary: four core stages;")
    print("      late 2.5/2.6 stages deferred to slice 2.")
    if failures:
        print(f"\n{failures} check(s) failed — step-ladder trace regressed.")
        return 1
    print("\nAll checks passed — step ladder is complete, inert, and merge-consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
