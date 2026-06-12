#!/usr/bin/env python3
"""
tests/test_keyword_custom_fields.py
-----------------------------------
Regression coverage for Commit 1 (Fix A): Stage 1 keyword extraction is now
field-definition-driven, so a CUSTOM field (one with no entry in the static
config/keyword_patterns.json) gets the same first-pass label extraction as a
built-in field, searched by its own configured label.

Before the fix, keyword.extract_fields did `if field_key not in field_patterns:
continue` — every custom field key (job_no, a custom `supplier`, a custom
`date`) was silently skipped at Stage 1, the foundational label-on-page layer.
Built-in fields were extracted from their first document; custom fields got
nothing until anchors/hints/templates were hand-taught. This file proves the
custom path now works, the built-in path is byte-for-byte unchanged, type-based
validation still gates custom values, and the no-definition case is safe.

Usage:
    py -3.12 python_backend/tests/test_keyword_custom_fields.py

Exit code 0 = behaves as expected. Exit code 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import keyword   # noqa: E402

PATTERNS = keyword.load_patterns()


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def section(title):
    print(f"\n{title}")


# Custom doc type ("Job Worksheet") field schema — none of these keys exists in
# the static field_patterns config; supplier_name/invoice_number do.
JOB_DEFS = [
    {"key": "job_no",   "label": "Job No",   "type": "text"},
    {"key": "date",     "label": "Date",     "type": "date"},
    {"key": "supplier", "label": "Supplier", "type": "text"},
]


def run():
    ok = True

    # ── Custom field, inline (direction=right) ────────────────────────────────
    section("Custom field extracted inline by its own label")
    ocr = "Service Worksheet\nJob No: 2605-0805-1\nDate: 22-05-2026\n"
    res = keyword.extract_fields(ocr, ["job_no", "date"], PATTERNS, field_defs=JOB_DEFS)
    ok &= check("job_no found via synthesised label search",
                res.get("job_no", {}).get("value") == "2605-0805-1")
    ok &= check("job_no method is keyword (Stage 1)",
                res.get("job_no", {}).get("method") == "keyword")
    ok &= check("date-typed custom field validated + extracted",
                res.get("date", {}).get("value") == "22-05-2026")

    # ── Custom field, stacked (direction=below) ───────────────────────────────
    section("Custom field extracted from the line below its label")
    ocr2 = "Job No\n2605-0805-1\n"
    res2 = keyword.extract_fields(ocr2, ["job_no"], PATTERNS, field_defs=JOB_DEFS)
    ok &= check("job_no found below its label",
                res2.get("job_no", {}).get("value") == "2605-0805-1")

    # ── Humanised-key fallback (no explicit label) ────────────────────────────
    section("Synthesises label from the key when no label is configured")
    defs_no_label = [{"key": "job_no", "label": "", "type": "text"}]
    ocr3 = "Job No  2605-0805-1\n"
    res3 = keyword.extract_fields(ocr3, ["job_no"], PATTERNS, field_defs=defs_no_label)
    ok &= check("job_no found via 'job no' key fallback",
                res3.get("job_no", {}).get("value") == "2605-0805-1")

    # ── Type validation gates custom values ───────────────────────────────────
    section("Date-typed custom field rejects a non-date value")
    ocr4 = "Date: not a date here\n"
    res4 = keyword.extract_fields(ocr4, ["date"], PATTERNS, field_defs=JOB_DEFS)
    ok &= check("non-date value not extracted for date-typed field",
                "date" not in res4 or not res4["date"].get("value"))

    # ── No definition → safely skipped (old behaviour for unknown keys) ───────
    section("Custom key with no definition is skipped, not crashed")
    res5 = keyword.extract_fields("Mystery: 42\n", ["mystery"], PATTERNS, field_defs=[])
    ok &= check("undefined custom key produces no result", "mystery" not in res5)
    res5b = keyword.extract_fields("Mystery: 42\n", ["mystery"], PATTERNS)  # no field_defs at all
    ok &= check("undefined custom key with no field_defs is safe", "mystery" not in res5b)

    # ── Built-in path unchanged (with and without field_defs) ─────────────────
    section("Built-in field extraction is unchanged")
    inv = "Invoice\nInvoice Number: INV-2024-0456\n"
    bi_defs = [{"key": "invoice_number", "label": "Invoice Number", "type": "text"}]
    r_with = keyword.extract_fields(inv, ["invoice_number"], PATTERNS, field_defs=bi_defs)
    r_without = keyword.extract_fields(inv, ["invoice_number"], PATTERNS)
    ok &= check("invoice_number extracted with field_defs",
                r_with.get("invoice_number", {}).get("value") == "INV-2024-0456")
    ok &= check("invoice_number extracted without field_defs (back-compat)",
                r_without.get("invoice_number", {}).get("value") == "INV-2024-0456")
    ok &= check("built-in result identical with/without field_defs",
                r_with.get("invoice_number") == r_without.get("invoice_number"))

    # A built-in key uses its STATIC config labels, not the field_def label —
    # passing a misleading label must not change built-in matching.
    section("Static config wins over field_def label for built-in keys")
    misleading = [{"key": "invoice_number", "label": "Totally Wrong Label", "type": "text"}]
    r_mis = keyword.extract_fields(inv, ["invoice_number"], PATTERNS, field_defs=misleading)
    ok &= check("built-in still matched via its static labels",
                r_mis.get("invoice_number", {}).get("value") == "INV-2024-0456")

    return ok


if __name__ == "__main__":
    print("=" * 60)
    print("Stage 1 custom-field extraction (Fix A)")
    print("=" * 60)
    success = run()
    print("\n" + ("ALL PASSED" if success else "FAILURES PRESENT"))
    sys.exit(0 if success else 1)
