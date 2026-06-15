#!/usr/bin/env python3
"""
tests/test_stage2_winner_consistency.py
---------------------------------------
Stage 2 credibility gate + winner/final consistency.

Two properties are pinned here:
  1. A Stage 2 candidate must not OVERRIDE an existing incumbent unless it is
     credible for the field's class:
        - ref-like fields (..._number / ..._no / reference): reject wildly
          inconsistent / low-information candidates (e.g. a lone "a");
        - date-like fields: the candidate must actually parse as a date.
  2. The dev trace's logged Stage 2 winner is consistent with the value the
     engine returns and reports as `final` (what Review/persistence shows).

OCR-dependent stages are stubbed (keyword + anchor return controlled dicts) so the
test is deterministic and needs no Tesseract. (The Debug/ folder holds only image
PDFs — no structured trace payloads — so synthetic engine-level inputs are used.)

    py -3.12 python_backend/tests/test_stage2_winner_consistency.py
Exit 0 = all good. Exit 1 = a gate or consistency property regressed.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as engine_mod
from extraction import validator
from extraction.engine import ExtractionEngine

CONFIG = str(Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


def _run(field_defs, kw_results, anchor_results):
    """Run extract() with keyword/anchor stubbed; return (results, trace events)."""
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    orig_kw, orig_an = engine_mod.keyword.extract_fields, engine_mod.anchor.extract_with_anchors
    engine_mod.keyword.extract_fields = lambda *a, **k: {kk: dict(vv) for kk, vv in kw_results.items()}
    engine_mod.anchor.extract_with_anchors = lambda *a, **k: {kk: dict(vv) for kk, vv in anchor_results.items()}
    events = []
    try:
        results = eng.extract(
            ocr_text="stub", page_images=[], filename="t.pdf", field_defs=field_defs,
            hints=[], anchors=[{"field_key": f["key"]} for f in field_defs],
            logos=[], templates=[], document_type="Invoice", document_slug="invoice",
            trace=lambda ev: events.append(ev))
    finally:
        engine_mod.keyword.extract_fields = orig_kw
        engine_mod.anchor.extract_with_anchors = orig_an
    return results, events


def _merge(events, field):
    return [e for e in events if e.get("event") == "merge" and e.get("stage") == "2_anchor" and e.get("field") == field]


def _final(events, field):
    return next((e for e in events if e.get("event") == "final" and e.get("field") == field), None)


def _val(results, field):
    return (results.get(field) or {}).get("value")


REF_FIELDS = [{"key": "job_no", "type": "text"}]
DATE_FIELDS = [{"key": "invoice_date", "type": "date"}]


def test_one_char_ref_loses():
    """A lone 'a' anchor_crop (even at high confidence) must NOT override a
    plausible reference incumbent."""
    print("ref gate: one-character anchor candidate must lose to a plausible incumbent")
    failures = 0
    results, events = _run(
        REF_FIELDS,
        {"job_no": {"value": "JOB-123", "confidence": 70, "method": "keyword"}},
        {"job_no": {"value": "a",       "confidence": 95, "method": "anchor_crop"}})
    if not check("incumbent 'JOB-123' survives the 'a' override", _val(results, "job_no") == "JOB-123"):
        failures += 1
    lose = next((m for m in _merge(events, "job_no") if m.get("decision") == "lose"), None)
    if not check("Stage 2 logs the 'a' candidate as a LOSS", lose is not None and lose.get("value") == "a"):
        failures += 1
    fin = _final(events, "job_no")
    if not check("final == returned == 'JOB-123' (trace/return/persist agree)",
                 fin is not None and fin.get("value") == _val(results, "job_no") == "JOB-123"):
        failures += 1
    print()
    return failures


def test_non_date_candidate_for_date_field_loses():
    """A non-date anchor_crop ('March') must not override a date incumbent."""
    print("date gate: non-date anchor candidate must lose to a real date incumbent")
    failures = 0
    results, events = _run(
        DATE_FIELDS,
        {"invoice_date": {"value": "16/03/2026", "confidence": 70, "method": "keyword"}},
        {"invoice_date": {"value": "March",      "confidence": 95, "method": "anchor_crop"}})
    rv = _val(results, "invoice_date")
    if not check(f"date incumbent survives (got {rv!r}, parses as date, not 'March')",
                 rv != "March" and validator.parse_date(rv) is not None):
        failures += 1
    lose = next((m for m in _merge(events, "invoice_date") if m.get("decision") == "lose"), None)
    if not check("Stage 2 logs 'March' as a LOSS", lose is not None and lose.get("value") == "March"):
        failures += 1
    fin = _final(events, "invoice_date")
    if not check("final == returned (trace/return/persist agree)",
                 fin is not None and fin.get("value") == rv):
        failures += 1
    print()
    return failures


def test_digit_free_candidate_cannot_override_digit_ref():
    """A digit-free word read from a drifted crop ('Booking') must NOT displace a
    digit-bearing reference incumbent ('7602-1354-4'), even at higher confidence."""
    print("ref gate: digit-free 'Booking' cannot override a digit-bearing job_no")
    failures = 0
    results, events = _run(
        REF_FIELDS,
        {"job_no": {"value": "7602-1354-4", "confidence": 70, "method": "keyword"}},
        {"job_no": {"value": "Booking",     "confidence": 97, "method": "anchor_crop"}})
    if not check("digit-bearing incumbent '7602-1354-4' survives", _val(results, "job_no") == "7602-1354-4"):
        failures += 1
    lose = next((m for m in _merge(events, "job_no") if m.get("decision") == "lose"), None)
    if not check("Stage 2 logs 'Booking' as a LOSS", lose is not None and lose.get("value") == "Booking"):
        failures += 1
    print()
    return failures


def test_valid_ref_still_overrides_and_is_consistent():
    """A credible ref anchor_crop SHOULD still win via is_taught_override, and the
    logged winner must equal the returned/final value."""
    print("ref gate: a credible reference candidate still wins and stays consistent")
    failures = 0
    results, events = _run(
        REF_FIELDS,
        {"job_no": {"value": "JOB-1",     "confidence": 70, "method": "keyword"}},
        {"job_no": {"value": "REF-99887", "confidence": 80, "method": "anchor_crop"}})
    rv = _val(results, "job_no")
    win = next((m for m in _merge(events, "job_no") if m.get("decision") == "win"), None)
    fin = _final(events, "job_no")
    if not check("credible anchor 'REF-99887' wins", rv == "REF-99887"):
        failures += 1
    if not check("logged Stage 2 winner == returned == final == 'REF-99887'",
                 win is not None and win.get("value") == "REF-99887"
                 and fin is not None and fin.get("value") == "REF-99887"):
        failures += 1
    print()
    return failures


def test_valid_date_still_overrides_and_is_consistent():
    """A real date anchor_crop should win; final == returned (normalised)."""
    print("date gate: a real date candidate still wins and stays consistent")
    failures = 0
    results, events = _run(
        DATE_FIELDS,
        {"invoice_date": {"value": "01/01/2020", "confidence": 70, "method": "keyword"}},
        {"invoice_date": {"value": "16/03/2026", "confidence": 80, "method": "anchor_crop"}})
    rv = _val(results, "invoice_date")
    fin = _final(events, "invoice_date")
    win = next((m for m in _merge(events, "invoice_date") if m.get("decision") == "win"), None)
    if not check(f"real date anchor wins and normalises to 16-03-2026 (got {rv!r})", rv == "16-03-2026"):
        failures += 1
    if not check("Stage 2 logged the date candidate as the winner",
                 win is not None and validator.parse_date(win.get("value")) is not None):
        failures += 1
    if not check("final == returned (post-validation value agrees)",
                 fin is not None and fin.get("value") == rv):
        failures += 1
    print()
    return failures


def test_gate_only_guards_overrides_not_first_reads():
    """Boundary: the gate must NOT suppress a FIRST read of an empty field — a
    low-info value still fills it (the validator then flags it for review)."""
    print("boundary: gate guards overrides only; an empty field is still filled")
    failures = 0
    results, _ = _run(
        REF_FIELDS,
        {},  # keyword found nothing → no incumbent
        {"job_no": {"value": "a", "confidence": 80, "method": "anchor_crop"}})
    if not check("empty job_no is filled by the anchor (no incumbent to protect)",
                 _val(results, "job_no") == "a"):
        failures += 1
    print()
    return failures


def main():
    failures = 0
    failures += test_one_char_ref_loses()
    failures += test_non_date_candidate_for_date_field_loses()
    failures += test_digit_free_candidate_cannot_override_digit_ref()
    failures += test_valid_ref_still_overrides_and_is_consistent()
    failures += test_valid_date_still_overrides_and_is_consistent()
    failures += test_gate_only_guards_overrides_not_first_reads()
    if failures:
        print(f"{failures} check(s) failed — Stage 2 credibility gate / consistency regressed.")
        return 1
    print("All checks passed — Stage 2 credibility gate behaves and stays consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
