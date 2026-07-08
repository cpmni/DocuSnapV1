#!/usr/bin/env python3
"""
tests/test_name_wordness_engine.py
----------------------------------
End-to-end (engine.extract) proof of the two reggie follow-ups for free-text NAME
fields, both gated under the name_wordness opt-in (default OFF => byte-identical):

  A. word_like self-calibration — a name-LABELLED but CODE-valued field self-disables
     the wordness language flag (its own regex owns it); a genuine name field keeps it.
  B. truncation/fragment flag — a value SHORTER than the confirmed-history length
     ("Joinery" where history is always "Stonebridge Joinery") is flagged for review.

Run: py -3.12 -m tests.test_name_wordness_engine   (from python_backend/)
"""
import os, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as engine_mod
from extraction.engine import ExtractionEngine

CONFIG = str(Path(__file__).parent.parent / "config" / "keyword_patterns.json")
F = 0


def check(label, cond):
    global F
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    F += (not cond)


def _run(field_key, value, *, history=None, wordness_on=True, ftype="text", accepted=None):
    """extract() with a single field whose value comes from the (stubbed) keyword stage."""
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    eng.set_name_wordness(wordness_on)
    if accepted:
        eng.set_accepted_names(accepted)
    if history:
        eng.set_formats([{
            "supplier_name": "", "document_type": "invoice", "field_key": field_key,
            "sample_values": list(history.keys()), "value_counts": history,
            "confirmed_count": sum(history.values()),
        }])
    tm, kwmod, anc, val = (engine_mod.template_matcher, engine_mod.keyword,
                           engine_mod.anchor, engine_mod.validator)
    orig = (tm.identify_template, tm.compute_logo_hash, kwmod.extract_fields,
            anc.extract_with_anchors, val.validate_and_adjust)
    tm.compute_logo_hash = lambda *a, **k: None
    tm.identify_template = lambda *a, **k: None
    kwmod.extract_fields = lambda *a, **k: {field_key: {"value": value, "confidence": 88, "method": "keyword"}}
    anc.extract_with_anchors = lambda *a, **k: {}
    val.validate_and_adjust = lambda results, field_defs, **kwargs: results   # isolate Stage 4.5
    try:
        res = eng.extract(ocr_text="stub", page_images=[], filename="t.pdf",
                          field_defs=[{"key": field_key, "type": ftype}], hints=[],
                          anchors=[], logos=[], templates=[],
                          document_type="Invoice", document_slug="invoice")
    finally:
        (tm.identify_template, tm.compute_logo_hash, kwmod.extract_fields,
         anc.extract_with_anchors, val.validate_and_adjust) = orig
    return res.get(field_key) or {}


# A single recurring identity with a varying TAIL (>=3 distinct values, shared prefix) —
# the shape build_format_class_index needs to learn a stable-prefix lexicon (expected_len 5).
BEAU = {"Beaumont Care Homes Ltd - Bangor": 3, "Beaumont Care Homes Ltd - Holywood": 3,
        "Beaumont Care Homes Ltd - Belmont": 3, "Beaumont Care Homes Ltd - Parkview": 3}


def main():
    print("B. truncation/fragment flag (history = 'Beaumont Care Homes Ltd - <site>', expected_len 5)")
    r = _run("supplier_name", "Beaumont Care Homes Ltd", history=BEAU, wordness_on=True)
    check("truncated value preserved (flag-only, never rewritten)", r.get("value") == "Beaumont Care Homes Ltd")
    check("truncated (no site) flagged as shorter-than-usual", "shorter than the usual" in (r.get("validation_note") or ""))
    check("confidence capped <= 70", (r.get("confidence") or 100) <= 70)

    r = _run("supplier_name", "Beaumont Care Homes Ltd - Newtownards", history=BEAU, wordness_on=True)
    check("full name with a NEW site NOT flagged", "shorter than the usual" not in (r.get("validation_note") or ""))

    r = _run("supplier_name", "Beaumont Care Homes Ltd", history=BEAU, wordness_on=False)
    check("DEFAULT OFF: truncation not flagged when name_wordness disabled",
          "shorter than the usual" not in (r.get("validation_note") or ""))

    print("\nA. word_like self-calibration (name-labelled CODE field self-disables the language flag)")
    CODES = {"AB-1041": 4, "CD-2205": 4, "EF-3309": 4, "GH-4417": 4}
    # 'INVOI' is document-chrome the wordness gate flags on a genuine name field...
    r = _run("supplier_name", "INVOI", history=None, wordness_on=True)
    check("name field WITHOUT code-history: 'INVOI' wordness-flagged", bool(r.get("validation_note")))
    # ...but on a field whose confirmed history is all CODES (word_like False), the language
    # flag self-disables (the field is really a code field despite a name-ish key).
    r = _run("vendor_name", "INVOI", history=CODES, wordness_on=True)
    check("code-history field (word_like False): language flag self-disabled",
          "read like a name" not in (r.get("validation_note") or ""))

    print("\nA2. accepted-names allowlist (operator 'This name is correct' button)")
    # An acronym-bearing company ("Cloud VPS": 'VPS' scores low on the char model) IS flagged
    # by default — the exact complaint the accept button fixes.
    r = _run("supplier_name", "Cloud VPS", history=None, wordness_on=True)
    check("acronym company 'Cloud VPS' wordness-flagged by default",
          "read like a name" in (r.get("validation_note") or ""))
    # Once the operator accepts it, the flag never fires again (any casing/whitespace).
    r = _run("supplier_name", "Cloud VPS", history=None, wordness_on=True, accepted=["cloud vps"])
    check("accepted name 'Cloud VPS' NOT flagged", not (r.get("validation_note") or ""))
    check("accepted name value preserved", r.get("value") == "Cloud VPS")

    print("\nC. identity R2 fix - repair + truncation restored, cross-supplier NOT vetoed")
    # C1 — canonical name-repair FIRES for the identity field (the untested 0cbafb8 gap that
    #      let R2 ship green): a misread stable token auto-corrects to the learned canonical.
    r = _run("supplier_name", "Beaumont Care Homes Lid - Bangor", history=BEAU, wordness_on=True)
    check("identity misread auto-repaired (Lid->Ltd)",
          r.get("value") == "Beaumont Care Homes Ltd - Bangor")
    check("identity repair marked was_corrected", bool(r.get("was_corrected")))

    # C2 — a DIFFERENT, legitimately shorter supplier against a single-identity history is
    #      NOT truncation-flagged (Hunk C: not anchored to the stable prefix) and NOT shape-
    #      flagged (Hunk B: identity bypasses the cross-supplier veto). It's a new company.
    r = _run("supplier_name", "McMahon Associates Ltd", history=BEAU, wordness_on=True)
    check("different supplier NOT flagged shorter-than-usual",
          "shorter than the usual" not in (r.get("validation_note") or ""))
    check("different supplier NOT flagged format-differs",
          "format differs" not in (r.get("validation_note") or ""))
    check("different supplier value preserved", r.get("value") == "McMahon Associates Ltd")

    # C3 — customer_name is an identity field too (symmetry): the same repair/truncation net
    #      applies (both keys are in _IDENTITY_FIELD_KEYS).
    r = _run("customer_name", "Beaumont Care Homes Ltd", history=BEAU, wordness_on=True)
    check("customer_name truncation flagged (identity symmetry)",
          "shorter than the usual" in (r.get("validation_note") or ""))

    if F:
        print(f"\n{F} FAILED")
        return 1
    print("\nAll name-wordness engine checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
