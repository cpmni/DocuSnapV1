#!/usr/bin/env python3
"""
tests/test_label_overrides.py
-----------------------------
Covers keyword.merge_label_overrides — the admin keyword label overrides
(Settings -> Advanced, migration 19) merged onto the shipped patterns at
Stage 1, scoped to the detected doc-type slug.

Precedence (highest -> lowest): manually drawn anchors > Advanced label override
> auto-detected/default. An override is consulted BEFORE the shipped default
labels and, when it wins, is tagged method "keyword_override" so engine.extract
lets it displace a GENERIC template value while still yielding to curated
Stage 0.5 mappings / Stage 2 anchors.

Usage: py -3.12 python_backend/tests/test_label_overrides.py
Exit 0 = pass, 1 = regression.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import keyword  # noqa: E402
from extraction import engine as engine_mod  # noqa: E402
from extraction.engine import ExtractionEngine  # noqa: E402

CONFIG = str(Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def _texts(labels):
    """Flatten a labels list (mix of plain str and {'text':...} dicts) to text."""
    return [l["text"] if isinstance(l, dict) else l for l in labels]


def _run_engine(kw_results, templates_incumbent=None, anchor_results=None):
    """Run the full extract() with Stage 0 template + Stage 1 keyword + Stage 2
    anchor stubbed, so we can pin the engine's merge precedence without Tesseract.
    `templates_incumbent` seeds the Stage 0 result; `kw_results` is what the
    (stubbed) keyword stage returns; `anchor_results` what Stage 2 returns."""
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    fake_tmpl = {"name": "T", "document_type_slug": "invoice", "field_mappings": []}
    o_id = engine_mod.template_matcher.identify_template
    o_ex = engine_mod.template_matcher.extract_with_template
    o_kw = engine_mod.keyword.extract_fields
    o_an = engine_mod.anchor.extract_with_anchors
    engine_mod.template_matcher.identify_template = lambda *a, **k: {
        "template": fake_tmpl, "confidence": 90, "method": "test"}
    engine_mod.template_matcher.extract_with_template = lambda *a, **k: {
        kk: dict(vv) for kk, vv in (templates_incumbent or {}).items()}
    engine_mod.keyword.extract_fields = lambda *a, **k: {kk: dict(vv) for kk, vv in kw_results.items()}
    engine_mod.anchor.extract_with_anchors = lambda *a, **k: {kk: dict(vv) for kk, vv in (anchor_results or {}).items()}
    try:
        return eng.extract(
            ocr_text="stub", page_images=[], filename="t.pdf",
            field_defs=[{"key": "invoice_number", "type": "text"}],
            hints=[], anchors=[{"field_key": "invoice_number"}],
            logos=[], templates=[fake_tmpl],
            document_type="Invoice", document_slug="invoice")
    finally:
        engine_mod.template_matcher.identify_template = o_id
        engine_mod.template_matcher.extract_with_template = o_ex
        engine_mod.keyword.extract_fields = o_kw
        engine_mod.anchor.extract_with_anchors = o_an


def main():
    fails = 0
    base = {
        "field_patterns": {
            "invoice_number": {"labels": ["Invoice No"], "directions": ["right"],
                               "base_confidence": 88, "validation": "alphanumeric"},
        },
        # alphanumeric is now EXERCISED at Stage 1 for serial_number: merge_label_overrides
        # infers a format gate from the field-key role (*_number -> alphanumeric), so this
        # must be the real-ish pattern — a placeholder like ["x"] would reject a valid code
        # such as SN-99213 and break the end-to-end override extraction below.
        "validation_patterns": {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]},
    }

    # 1. No overrides / no slug -> SAME object back (no copy, no-op).
    print("1. no-op when there is nothing to merge")
    fails += not check("empty overrides -> identical object",
                       keyword.merge_label_overrides(base, [], "invoice") is base)
    fails += not check("no doc_slug -> identical object",
                       keyword.merge_label_overrides(base, [{"doc_type_slug": "invoice",
                           "field_key": "invoice_number", "label": "Bill No"}], None) is base)

    # 2. Override PREPENDED (consulted first) + tagged; shipped labels kept.
    print("2. override label prepended (tagged) to an existing field, shipped labels kept")
    ov = [{"doc_type_slug": "invoice", "field_key": "invoice_number", "label": "Bill No"}]
    merged = keyword.merge_label_overrides(base, ov, "invoice")
    labels = merged["field_patterns"]["invoice_number"]["labels"]
    fails += not check("shipped 'Invoice No' still present", "Invoice No" in _texts(labels))
    fails += not check("override 'Bill No' added", "Bill No" in _texts(labels))
    fails += not check("override is consulted FIRST (prepended)", _texts(labels)[0] == "Bill No")
    fails += not check("override carries the override flag",
                       isinstance(labels[0], dict) and labels[0].get("override") is True)
    fails += not check("validation preserved",
                       merged["field_patterns"]["invoice_number"].get("validation") == "alphanumeric")
    fails += not check("original patterns NOT mutated",
                       base["field_patterns"]["invoice_number"]["labels"] == ["Invoice No"])

    # 3. Doc-type scoping: an override for a DIFFERENT slug does not apply.
    print("3. doc-type scoping")
    ov2 = [{"doc_type_slug": "worksheet", "field_key": "invoice_number", "label": "Ticket No"}]
    fails += not check("non-matching slug -> no-op (same object)",
                       keyword.merge_label_overrides(base, ov2, "invoice") is base)
    fails += not check("slug match is case-insensitive",
                       "Ticket No" in _texts(keyword.merge_label_overrides(
                           base, ov2, "WORKSHEET")["field_patterns"]["invoice_number"]["labels"]))

    # 4. Custom field with NO shipped pattern gets an entry created -> extractable.
    print("4. custom field key (no shipped pattern) becomes extractable")
    ov3 = [{"doc_type_slug": "worksheet", "field_key": "serial_number", "label": "Serial No"}]
    merged3 = keyword.merge_label_overrides(base, ov3, "worksheet")
    sn = merged3["field_patterns"].get("serial_number")
    fails += not check("serial_number entry created", sn is not None)
    fails += not check("created entry carries the override label", sn and "Serial No" in _texts(sn["labels"]))
    fails += not check("created entry has a usable direction default",
                       sn and sn.get("directions"))

    # 5. End-to-end: extract_fields uses the override label AND tags provenance.
    print("5. extract_fields picks up the override label on a custom field")
    ocr = "Job Worksheet\nSerial No: SN-99213\nCustomer: Acme"
    res = keyword.extract_fields(ocr, ["serial_number"], merged3)
    fails += not check("serial_number extracted via the override label",
                       res.get("serial_number", {}).get("value") == "SN-99213")
    fails += not check("override hit tagged method 'keyword_override'",
                       res.get("serial_number", {}).get("method") == "keyword_override")

    # 6. PRECEDENCE within Stage 1 (the reported bug): override beats the shipped
    #    default when BOTH labels are on the page; falls back when it is absent.
    print("6. override label wins over the shipped default when both are present")
    base6 = {"field_patterns": {"invoice_number": {
                 "labels": ["Invoice No"], "directions": ["right"], "base_confidence": 88}},
             "validation_patterns": {}}
    ov6 = [{"doc_type_slug": "invoice", "field_key": "invoice_number", "label": "VAT No"}]
    merged6 = keyword.merge_label_overrides(base6, ov6, "invoice")
    res6 = keyword.extract_fields("TAX INVOICE\nInvoice No: INV-1001\nVAT No: GB123456789\n",
                                  ["invoice_number"], merged6)
    fails += not check("invoice_number reads the VAT value (override beat shipped)",
                       res6.get("invoice_number", {}).get("value") == "GB123456789")
    fails += not check("override win tagged 'keyword_override'",
                       res6.get("invoice_number", {}).get("method") == "keyword_override")
    res6b = keyword.extract_fields("TAX INVOICE\nInvoice No: INV-1001\n",
                                   ["invoice_number"], merged6)
    fails += not check("falls back to shipped label when override absent",
                       res6b.get("invoice_number", {}).get("value") == "INV-1001")
    fails += not check("fallback hit tagged plain 'keyword'",
                       res6b.get("invoice_number", {}).get("method") == "keyword")

    # 7. ENGINE precedence: a keyword_override displaces a GENERIC template value
    #    (the real reprocess blocker), but a plain keyword hit does not.
    print("7. engine: keyword_override displaces a generic template incumbent")
    incumbent = {"invoice_number": {"value": "INV-REAL", "confidence": 95, "method": "template_fixed"}}
    r_over = _run_engine(
        {"invoice_number": {"value": "VAT-9", "confidence": 95, "method": "keyword_override"}},
        incumbent)
    fails += not check("override displaces template_fixed incumbent",
                       (r_over.get("invoice_number") or {}).get("value") == "VAT-9")
    r_plain = _run_engine(
        {"invoice_number": {"value": "VAT-9", "confidence": 95, "method": "keyword"}},
        incumbent)
    fails += not check("plain keyword does NOT displace template_fixed (autodetect stays fallback)",
                       (r_plain.get("invoice_number") or {}).get("value") == "INV-REAL")

    # 8. ENGINE precedence vs Stage 2 anchors: an AUTO-LEARNED anchor must not
    #    clobber a keyword_override (the reported "VAT not populating" bug — a
    #    stale auto-learned anchor was overriding on reprocess), but an explicit
    #    ⊕ re-teach (authoritative) anchor still wins (tier 1 > tier 2).
    print("8. engine: auto-learned anchor yields to override; authoritative anchor wins")
    kw_override = {"invoice_number": {"value": "GB221407490", "confidence": 95, "method": "keyword_override"}}
    r_auto = _run_engine(
        kw_override, None,
        {"invoice_number": {"value": "INV-STALE", "confidence": 97,
                            "method": "anchor_crop", "authoritative": False}})
    fails += not check("auto-learned anchor does NOT override the admin label override",
                       (r_auto.get("invoice_number") or {}).get("value") == "GB221407490")
    r_auth = _run_engine(
        kw_override, None,
        {"invoice_number": {"value": "INV-0501", "confidence": 80,
                            "method": "anchor_crop", "authoritative": True}})
    fails += not check("authoritative (re-taught) anchor still overrides the override (tier 1)",
                       (r_auth.get("invoice_number") or {}).get("value") == "INV-0501")

    # 9. ENGINE precedence: a hand-drawn Stage 0.5 mapping must not be clobbered by
    #    an AUTO-LEARNED anchor (the Template Wizard case), but an AUTHORITATIVE ⊕
    #    anchor (Tier A) outranks the mapping outright — regardless of confidence
    #    and regardless of the resolved anchor method (no longer a confidence
    #    contest; see engine.py Tier A guard).
    print("9. engine: drawn mapping beats auto-learned anchor; authoritative anchor wins outright")
    mapping = {"invoice_number": {"value": "GB859324734", "confidence": 80, "method": "template_mapping"}}
    r_map_auto = _run_engine(
        {}, mapping,
        {"invoice_number": {"value": "HLC-0303", "confidence": 97,
                            "method": "anchor_crop", "authoritative": False}})
    fails += not check("auto-learned anchor does NOT override the hand-drawn mapping",
                       (r_map_auto.get("invoice_number") or {}).get("value") == "GB859324734")
    # Authoritative anchor at LOWER confidence than the mapping (40 < 80): it must
    # still win, proving Tier A is authority-based, not confidence-based.
    r_map_auth = _run_engine(
        {}, mapping,
        {"invoice_number": {"value": "HLC-7777", "confidence": 40,
                            "method": "anchor_crop", "authoritative": True}})
    fails += not check("authoritative anchor wins over a mapping even at lower confidence (Tier A)",
                       (r_map_auth.get("invoice_number") or {}).get("value") == "HLC-7777")

    print()
    print(f"{fails} FAILED" if fails else "All label-override checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
