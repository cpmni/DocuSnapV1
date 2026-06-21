#!/usr/bin/env python3
"""
tests/test_precedence.py
------------------------
Pins the cross-stage extraction PRECEDENCE order in engine.extract():

    authoritative ⊕ anchor (valid)        ← Tier A, wins regardless of method/conf
  > Stage 0.5 template mapping (valid)     ← Tier B
  > admin label override keyword_override  ← Tier C, beats all learned/generic/passive
  > other candidates (keyword, passive anchor, …) by existing rules
  > generic template seed (template_fixed/template_anchor)

"Valid" reuses the EXISTING field-aware gates (no new one-off checks):
  - a keyword_override is only returned by keyword.extract_fields when it already
    passed the field's validation gate (present ⇒ valid);
  - an authoritative anchor must clear the Stage 2 credibility gate
    (validator.parse_date for dates, _ref_override_plausible for refs) before it
    can win — an invalid higher-priority source therefore yields to the next valid
    lower-priority one.

All OCR-dependent stages are stubbed (template match / mapping / keyword / anchor
return controlled dicts), so the test is deterministic and needs no Tesseract.

    py -3.12 python_backend/tests/test_precedence.py
Exit 0 = all good. Exit 1 = a precedence property regressed.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as engine_mod
from extraction.engine import ExtractionEngine

CONFIG = str(Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


def _tmpl(with_mappings):
    """Minimal template dict accepted by select_mapping_source / Stage 0."""
    return {
        "id": 1, "name": "Test Template", "document_type_slug": "invoice",
        "group_id": None, "landmarks": [],
        # Stage 0.5 only runs when the matched template has enabled mappings.
        "field_mappings": ([{"id": 1, "field_key": "x", "enabled": True}]
                           if with_mappings else []),
    }


def _run(field_defs, *, seed=None, mapping=None, kw=None, anchor=None,
         doc_slug="invoice", collect_trace=False):
    """Run extract() with every OCR-dependent stage stubbed.

    seed    → Stage 0   template_matcher.extract_with_template result (template_fixed-style)
    mapping → Stage 0.5 template_mapper.extract_with_mappings result (template_mapping-style)
    kw      → Stage 1   keyword.extract_fields result (keyword / keyword_override)
    anchor  → Stage 2   anchor.extract_with_anchors result (incl. authoritative flag)
    """
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)

    use_template = seed is not None or mapping is not None
    tmpl = _tmpl(with_mappings=mapping is not None)
    templates = [tmpl] if use_template else []

    tm, tmap, kwmod, anc, val = (engine_mod.template_matcher, engine_mod.template_mapper,
                                 engine_mod.keyword, engine_mod.anchor, engine_mod.validator)
    orig = (tm.identify_template, tm.extract_with_template, tm.compute_logo_hash,
            tmap.extract_with_mappings, kwmod.extract_fields, anc.extract_with_anchors,
            val.validate_and_adjust)

    tm.compute_logo_hash = lambda *a, **k: None
    tm.identify_template = lambda *a, **k: ({"template": tmpl, "confidence": 90, "method": "logo"}
                                            if use_template else None)
    tm.extract_with_template = lambda *a, **k: {kk: dict(vv) for kk, vv in (seed or {}).items()}
    tmap.extract_with_mappings = lambda *a, **k: {kk: dict(vv) for kk, vv in (mapping or {}).items()}
    kwmod.extract_fields = lambda *a, **k: {kk: dict(vv) for kk, vv in (kw or {}).items()}
    anc.extract_with_anchors = lambda *a, **k: {kk: dict(vv) for kk, vv in (anchor or {}).items()}
    # Isolate the MERGE precedence: skip Stage 4 normalisation so asserted values
    # are exactly what the stage competition produced.
    val.validate_and_adjust = lambda results, field_defs: results

    events = []
    try:
        results = eng.extract(
            ocr_text="stub", page_images=(["img"] if use_template else []),
            filename="t.pdf", field_defs=field_defs, hints=[],
            anchors=[{"field_key": f["key"]} for f in field_defs],
            logos=[], templates=templates, document_type="Invoice",
            document_slug=doc_slug,
            trace=(lambda ev: events.append(ev)) if collect_trace else None)
    finally:
        (tm.identify_template, tm.extract_with_template, tm.compute_logo_hash,
         tmap.extract_with_mappings, kwmod.extract_fields, anc.extract_with_anchors,
         val.validate_and_adjust) = orig
    return results, events


def _val(results, field):
    return (results.get(field) or {}).get("value")


def _method(results, field):
    return (results.get(field) or {}).get("method")


REF = [{"key": "invoice_number", "type": "text"}]
DATE = [{"key": "invoice_date", "type": "date"}]


def test_label_beats_generic_seed():
    print("Tier C > generic: a valid admin label beats a template_fixed seed (on authority, not confidence)")
    f = 0
    results, _ = _run(REF,
        seed={"invoice_number": {"value": "OLD-SEED", "confidence": 95, "method": "template_fixed"}},
        kw={"invoice_number": {"value": "INV-123", "confidence": 80, "method": "keyword_override"}})
    if not check("admin label 'INV-123' wins over template_fixed 'OLD-SEED' at lower confidence",
                 _val(results, "invoice_number") == "INV-123"):
        f += 1
    if not check("winning method is keyword_override", _method(results, "invoice_number") == "keyword_override"):
        f += 1
    print()
    return f


def test_authoritative_anchor_beats_label_method_independent():
    print("Tier A > C: an authoritative anchor wins over the admin label even via anchor_inline at lower confidence")
    f = 0
    results, _ = _run(REF,
        kw={"invoice_number": {"value": "INV-123", "confidence": 90, "method": "keyword_override"}},
        anchor={"invoice_number": {"value": "INV-999", "confidence": 50,
                                   "method": "anchor_inline", "authoritative": True}})
    if not check("authoritative 'INV-999' (anchor_inline, conf 50) beats the label (conf 90)",
                 _val(results, "invoice_number") == "INV-999"):
        f += 1
    if not check("winning method is anchor_inline", _method(results, "invoice_number") == "anchor_inline"):
        f += 1
    print()
    return f


def test_invalid_authoritative_date_yields_to_label():
    print("validity: an INVALID authoritative date anchor ('March') yields to the valid admin label")
    f = 0
    results, _ = _run(DATE,
        kw={"invoice_date": {"value": "01-02-2025", "confidence": 80, "method": "keyword_override"}},
        anchor={"invoice_date": {"value": "March", "confidence": 99,
                                 "method": "anchor_crop", "authoritative": True}})
    if not check("label date survives the unparseable authoritative anchor",
                 _val(results, "invoice_date") == "01-02-2025"):
        f += 1
    print()
    return f


def test_invalid_authoritative_ref_yields_to_label():
    print("validity: an implausible authoritative ref anchor ('a') yields to the valid admin label")
    f = 0
    results, _ = _run(REF,
        kw={"invoice_number": {"value": "INV-7", "confidence": 80, "method": "keyword_override"}},
        anchor={"invoice_number": {"value": "a", "confidence": 99,
                                   "method": "anchor_crop", "authoritative": True}})
    if not check("label 'INV-7' survives the low-info authoritative anchor 'a'",
                 _val(results, "invoice_number") == "INV-7"):
        f += 1
    print()
    return f


def test_mapping_beats_label():
    print("Tier B > C (chosen order): a Stage 0.5 template mapping beats the admin label")
    f = 0
    results, _ = _run(REF,
        mapping={"invoice_number": {"value": "MAP-1", "confidence": 60, "method": "template_mapping"}},
        kw={"invoice_number": {"value": "KW-1", "confidence": 95, "method": "keyword_override"}})
    if not check("template_mapping 'MAP-1' wins over the admin label 'KW-1' (label yields to the mapping)",
                 _val(results, "invoice_number") == "MAP-1"):
        f += 1
    print()
    return f


def test_authoritative_anchor_beats_mapping():
    print("Tier A > B: a valid authoritative anchor beats a Stage 0.5 mapping (via anchor_crop_relocated)")
    f = 0
    results, _ = _run(REF,
        mapping={"invoice_number": {"value": "MAP-1", "confidence": 99, "method": "template_mapping"}},
        anchor={"invoice_number": {"value": "ANC-1", "confidence": 40,
                                   "method": "anchor_crop_relocated", "authoritative": True}})
    if not check("authoritative 'ANC-1' beats the mapping 'MAP-1' at lower confidence",
                 _val(results, "invoice_number") == "ANC-1"):
        f += 1
    print()
    return f


def test_blind_authoritative_anchor_yields_to_mapping():
    print("LOCATED gate: a BLIND authoritative anchor (located=False) yields to a located Stage 0.5 mapping")
    f = 0
    # The City Office NI failure: the mapping reads the right value; a stale
    # authoritative ⊕ anchor whose label isn't on the page blind-reads the wrong
    # row at a capped confidence. The same value/method as the test above, ONLY
    # `located` differs — proving the located gate (not value/conf) is what flips it.
    results, _ = _run(REF,
        mapping={"invoice_number": {"value": "MAP-1", "confidence": 99, "method": "template_mapping"}},
        anchor={"invoice_number": {"value": "ANC-1", "confidence": 40, "method": "anchor_crop",
                                   "authoritative": True, "located": False}})
    if not check("blind (located=False) authoritative anchor does NOT win — mapping 'MAP-1' survives",
                 _val(results, "invoice_number") == "MAP-1"):
        f += 1
    if not check("winning method is the mapping", _method(results, "invoice_number") == "template_mapping"):
        f += 1
    print()
    return f


def test_blind_authoritative_anchor_cannot_taught_override():
    print("LOCATED gate: a BLIND authoritative anchor_crop can't taught-override a logo/keyword incumbent")
    f = 0
    # The City Office NI failure on a template-less doc: the logo resolved the right
    # supplier; a stale label-less authoritative ⊕ anchor blind-reads the address
    # (capped conf 50). With is_taught_override gated on `located`, the anchor must
    # NOT override the logo despite anchor_crop's old taught-override power.
    results, _ = _run([{"key": "supplier_name", "type": "text"}],
        kw={"supplier_name": {"value": "City Office NI", "confidence": 88, "method": "logo"}},
        anchor={"supplier_name": {"value": "57 Boucher Crescent", "confidence": 50,
                                  "method": "anchor_crop", "authoritative": True, "located": False}})
    if not check("blind authoritative anchor_crop does NOT override the logo — 'City Office NI' survives",
                 _val(results, "supplier_name") == "City Office NI"):
        f += 1
    print()
    return f


def test_passive_anchor_cannot_beat_label():
    print("passive guard: a PASSIVE anchor (authoritative=False) cannot displace the admin label")
    f = 0
    results, _ = _run(REF,
        kw={"invoice_number": {"value": "KW-1", "confidence": 50, "method": "keyword_override"}},
        anchor={"invoice_number": {"value": "P-1", "confidence": 99,
                                   "method": "anchor_crop", "authoritative": False}})
    if not check("label 'KW-1' survives a higher-confidence passive anchor 'P-1'",
                 _val(results, "invoice_number") == "KW-1"):
        f += 1
    print()
    return f


def test_trace_payload_for_console():
    print("trace: the merge 'win' + 'final' events the review console consumes carry the real winner")
    f = 0
    results, events = _run(REF,
        kw={"invoice_number": {"value": "INV-123", "confidence": 90, "method": "keyword_override"}},
        anchor={"invoice_number": {"value": "INV-999", "confidence": 50,
                                   "method": "anchor_inline", "authoritative": True}},
        collect_trace=True)
    win = next((e for e in events if e.get("event") == "merge" and e.get("stage") == "2_anchor"
                and e.get("field") == "invoice_number" and e.get("decision") == "win"), None)
    fin = next((e for e in events if e.get("event") == "final" and e.get("field") == "invoice_number"), None)
    cands = [e for e in events if e.get("event") == "candidate" and e.get("field") == "invoice_number"]
    if not check("a Stage 2 'win' merge event is logged for the authoritative anchor",
                 win is not None and win.get("value") == "INV-999"):
        f += 1
    if not check("a 'final' event carries the winning value (console's per-field source)",
                 fin is not None and fin.get("value") == "INV-999" == _val(results, "invoice_number")):
        f += 1
    if not check("both stage candidates were traced (label + anchor) for the console's candidate list",
                 len(cands) >= 2):
        f += 1
    print()
    return f


# ── Admin-LOCKED fixed value (migration 31, method 'template_fixed_locked') ──────
def test_locked_fixed_survives_ordinary_keyword():
    print("LOCKED > ordinary: an admin-locked fixed value survives a HIGHER-confidence ordinary keyword")
    f = 0
    results, _ = _run(REF,
        seed={"invoice_number": {"value": "LOCKED-1", "confidence": 95, "method": "template_fixed_locked"}},
        kw={"invoice_number": {"value": "KW-OCR", "confidence": 99, "method": "keyword"}})
    if not check("locked 'LOCKED-1' survives ordinary keyword 'KW-OCR' at higher confidence",
                 _val(results, "invoice_number") == "LOCKED-1"):
        f += 1
    if not check("winning method stays template_fixed_locked",
                 _method(results, "invoice_number") == "template_fixed_locked"):
        f += 1
    print()
    return f


def test_ordinary_fixed_still_overridable():
    print("narrow: an ORDINARY template_fixed seed is STILL overridden by a higher-confidence keyword (unchanged)")
    f = 0
    results, _ = _run(REF,
        seed={"invoice_number": {"value": "SEED-1", "confidence": 95, "method": "template_fixed"}},
        kw={"invoice_number": {"value": "KW-OCR", "confidence": 99, "method": "keyword"}})
    if not check("ordinary template_fixed 'SEED-1' is overridden by keyword 'KW-OCR' (no behaviour change)",
                 _val(results, "invoice_number") == "KW-OCR"):
        f += 1
    print()
    return f


def test_locked_fixed_survives_passive_anchor():
    print("LOCKED > passive anchor: a non-authoritative anchor cannot displace a locked fixed value")
    f = 0
    results, _ = _run(REF,
        seed={"invoice_number": {"value": "LOCKED-1", "confidence": 95, "method": "template_fixed_locked"}},
        anchor={"invoice_number": {"value": "ANC-OCR", "confidence": 99,
                                   "method": "anchor_crop", "authoritative": False}})
    if not check("locked 'LOCKED-1' survives a higher-confidence passive anchor 'ANC-OCR'",
                 _val(results, "invoice_number") == "LOCKED-1"):
        f += 1
    print()
    return f


def test_stage05_mapping_beats_locked():
    print("Stage 0.5 > LOCKED: a curated admin mapping still outranks a locked fixed value (intended precedence)")
    f = 0
    results, _ = _run(REF,
        seed={"invoice_number": {"value": "LOCKED-1", "confidence": 95, "method": "template_fixed_locked"}},
        mapping={"invoice_number": {"value": "MAP-1", "confidence": 60, "method": "template_mapping"}})
    if not check("template_mapping 'MAP-1' beats locked 'LOCKED-1' at lower confidence (curated > locked)",
                 _val(results, "invoice_number") == "MAP-1"):
        f += 1
    print()
    return f


def test_keyword_override_beats_locked():
    print("admin label > LOCKED: an explicit keyword_override outranks a locked fixed value")
    f = 0
    results, _ = _run(REF,
        seed={"invoice_number": {"value": "LOCKED-1", "confidence": 95, "method": "template_fixed_locked"}},
        kw={"invoice_number": {"value": "LBL-1", "confidence": 50, "method": "keyword_override"}})
    if not check("keyword_override 'LBL-1' beats locked 'LOCKED-1' at lower confidence (admin label > locked)",
                 _val(results, "invoice_number") == "LBL-1"):
        f += 1
    print()
    return f


def test_matcher_emits_locked_method():
    print("Stage 0 emit: a locked row -> 'template_fixed_locked'; unlocked/legacy -> 'template_fixed'")
    f = 0
    ewt = engine_mod.template_matcher.extract_with_template
    locked = ewt("", {"fields": [{"field_key": "supplier_name", "fixed_value": "Document Solutions",
                                   "is_variable": 0, "fixed_locked": 1}]})
    if not check("locked row emits template_fixed_locked",
                 (locked.get("supplier_name") or {}).get("method") == "template_fixed_locked"):
        f += 1
    unlocked = ewt("", {"fields": [{"field_key": "supplier_name", "fixed_value": "X",
                                    "is_variable": 0, "fixed_locked": 0}]})
    if not check("unlocked non-variable row still emits template_fixed",
                 (unlocked.get("supplier_name") or {}).get("method") == "template_fixed"):
        f += 1
    legacy = ewt("", {"fields": [{"field_key": "supplier_name", "fixed_value": "X", "is_variable": 0}]})
    if not check("legacy row (no fixed_locked key) emits template_fixed",
                 (legacy.get("supplier_name") or {}).get("method") == "template_fixed"):
        f += 1
    print()
    return f


def test_locked_supplier_name_survives_garbled_read():
    print("LOCKED company: a locked supplier_name survives the keyword read AND the identity rescue (real case)")
    f = 0
    results, _ = _run([{"key": "supplier_name", "type": "text"}],
        seed={"supplier_name": {"value": "Document Solutions", "confidence": 95, "method": "template_fixed_locked"}},
        kw={"supplier_name": {"value": "17 Castes rare Homes Ltd", "confidence": 99, "method": "keyword"}})
    if not check("locked 'Document Solutions' survives the garbled page read on the company field",
                 _val(results, "supplier_name") == "Document Solutions"):
        f += 1
    print()
    return f


def test_garbled_authoritative_anchor_yields_to_clean_keyword():
    print("OCR gate: an authoritative anchor with a GARBLED word (low ocr_min_conf) yields to a clean keyword")
    f = 0
    # The "Aaiumant Care Homes Ltd - Galaorm" case: the authoritative ⊕ anchor read
    # is type-valid and well-SHAPED (so credibility + name_quality pass), but two
    # words are garbled — its min substantial-word OCR confidence is low (~55). It
    # must NOT win Tier-A outright; it falls through to the confidence contest where
    # the clean keyword (the correct "Beaumont…") wins on confidence.
    results, _ = _run([{"key": "customer", "type": "text"}],
        kw={"customer": {"value": "Beaumont Care Homes Ltd - Galgorm", "confidence": 85,
                         "method": "keyword_override"}},
        anchor={"customer": {"value": "Aaiumant Care Homes Ltd - Galaorm", "confidence": 60,
                             "method": "anchor_crop", "authoritative": True, "ocr_min_conf": 55}})
    if not check("clean keyword 'Beaumont…' beats the garbled authoritative read (ocr_min_conf 55)",
                 _val(results, "customer") == "Beaumont Care Homes Ltd - Galgorm"):
        f += 1
    print()
    return f


def test_clean_authoritative_anchor_still_wins_tier_a():
    print("OCR gate: a CLEAN authoritative anchor (high ocr_min_conf) still wins Tier-A over a keyword")
    f = 0
    # Same shape as above but the read is CLEAN (min word conf 90) — Tier-A is intact:
    # a genuinely confident re-teach still wins outright even below the keyword's conf.
    results, _ = _run([{"key": "customer", "type": "text"}],
        kw={"customer": {"value": "Wrong Co", "confidence": 95, "method": "keyword_override"}},
        anchor={"customer": {"value": "Beaumont Care Homes Ltd", "confidence": 60,
                             "method": "anchor_crop", "authoritative": True, "ocr_min_conf": 90}})
    if not check("clean authoritative 'Beaumont…' wins Tier-A despite lower confidence",
                 _val(results, "customer") == "Beaumont Care Homes Ltd"):
        f += 1
    print()
    return f


def test_keyword_name_value_edge_cleaned_at_capture():
    print("input hygiene: leading OCR junk is stripped from a name-like keyword value AT CAPTURE")
    f = 0
    # The "--« Beaumont Care Homes Ltd -" case: a keyword_override name read carries
    # leading OCR junk. It still WINS (highest authority), but the junk is stripped
    # at capture so the winner is clean (trailing ' -' separator kept; interior intact).
    results, _ = _run([{"key": "customer", "type": "text"}],
        kw={"customer": {"value": "--« Beaumont Care Homes Ltd -", "confidence": 85,
                         "method": "keyword_override"}})
    if not check("keyword winner is edge-cleaned to 'Beaumont Care Homes Ltd -'",
                 _val(results, "customer") == "Beaumont Care Homes Ltd -"):
        f += 1
    if not check("winning method stays keyword_override (precedence untouched)",
                 _method(results, "customer") == "keyword_override"):
        f += 1
    print()
    return f


def test_passive_anchor_cannot_displace_keyword_override_name():
    print("fence (Gary): a passive anchor_crop must NOT displace a keyword_override name incumbent")
    f = 0
    # Locks in the deliberate decision NOT to weaken admin-label authority: even a
    # higher-confidence passive anchor cannot win over a keyword_override. This is the
    # tripwire against a future "make the clean anchor win" change landing silently.
    results, _ = _run([{"key": "customer", "type": "text"}],
        kw={"customer": {"value": "Beaumont Care Homes Ltd", "confidence": 80, "method": "keyword_override"}},
        anchor={"customer": {"value": "Wrong Name Ltd", "confidence": 99,
                             "method": "anchor_crop", "authoritative": False}})
    if not check("keyword_override 'Beaumont Care Homes Ltd' survives a 99% passive anchor",
                 _val(results, "customer") == "Beaumont Care Homes Ltd"):
        f += 1
    print()
    return f


def main():
    failures = 0
    failures += test_keyword_name_value_edge_cleaned_at_capture()
    failures += test_passive_anchor_cannot_displace_keyword_override_name()
    failures += test_label_beats_generic_seed()
    failures += test_authoritative_anchor_beats_label_method_independent()
    failures += test_invalid_authoritative_date_yields_to_label()
    failures += test_invalid_authoritative_ref_yields_to_label()
    failures += test_garbled_authoritative_anchor_yields_to_clean_keyword()
    failures += test_clean_authoritative_anchor_still_wins_tier_a()
    failures += test_mapping_beats_label()
    failures += test_authoritative_anchor_beats_mapping()
    failures += test_blind_authoritative_anchor_yields_to_mapping()
    failures += test_blind_authoritative_anchor_cannot_taught_override()
    failures += test_passive_anchor_cannot_beat_label()
    failures += test_trace_payload_for_console()
    # Admin-locked fixed values (migration 31)
    failures += test_matcher_emits_locked_method()
    failures += test_locked_fixed_survives_ordinary_keyword()
    failures += test_ordinary_fixed_still_overridable()
    failures += test_locked_fixed_survives_passive_anchor()
    failures += test_stage05_mapping_beats_locked()
    failures += test_keyword_override_beats_locked()
    failures += test_locked_supplier_name_survives_garbled_read()
    if failures:
        print(f"{failures} check(s) failed — extraction precedence regressed.")
        return 1
    print("All checks passed — extraction precedence order holds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
