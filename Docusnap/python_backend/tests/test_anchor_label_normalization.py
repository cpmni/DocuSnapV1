#!/usr/bin/env python3
"""
tests/test_anchor_label_normalization.py
----------------------------------------
Regression coverage for fix (2): poisoned taught-anchor labels. The ⊕ capture
can fold a variable per-document token into the saved label
("2605-0805-1 Work Address"), so it stops matching any OTHER document in the
family. Stage 2 now tries the ORIGINAL label first and, only when it is absent
from the page, falls back to the recurring CORE label ("Work Address").

Proves:
  • digit-bearing leading tokens are stripped to the recurring core;
  • legitimate labels are preserved unchanged (core = None);
  • weak/over-stripping cases are rejected;
  • extract_with_anchors uses the original label first, then the core fallback;
  • customer_name-style recovery works end-to-end (text path, no Tesseract).

Usage:
    py -3.12 python_backend/tests/test_anchor_label_normalization.py

Exit code 0 = behaves as expected. Exit code 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor   # noqa: E402


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def section(title):
    print(f"\n{title}")


def _anchor(label, **kw):
    base = {"field_key": "customer_name", "anchor_label": label,
            "direction": "right", "supplier_name": "__unknown__",
            "document_type": "job_worksheet", "x_norm": 0.0, "y_norm": 0.0,
            "usage_count": 1, "confidence": 1.0}
    base.update(kw)
    return base


def run():
    ok = True

    # ── _is_variable_token ──────────────────────────────────────────────────
    section("_is_variable_token flags variable (digit/punct) tokens only")
    ok &= check("digit-bearing ticket number is variable",
                anchor._is_variable_token("2605-0805-1") is True)
    ok &= check("punctuation-only token is variable",
                anchor._is_variable_token("(") is True and anchor._is_variable_token("-") is True)
    ok &= check("a plain word is NOT variable",
                anchor._is_variable_token("Work") is False)
    ok &= check("a word with trailing colon is NOT variable",
                anchor._is_variable_token("Address:") is False)

    # ── _core_label strips leading variable tokens ──────────────────────────
    section("_core_label strips a leading variable token to the recurring core")
    ok &= check("'2605-0805-1 Work Address' -> 'Work Address'",
                anchor._core_label("2605-0805-1 Work Address") == "Work Address")
    ok &= check("'(2605-0065-1 Work Address' -> 'Work Address'",
                anchor._core_label("(2605-0065-1 Work Address") == "Work Address")
    ok &= check("'INV-2024 Invoice Total' -> 'Invoice Total'",
                anchor._core_label("INV-2024 Invoice Total") == "Invoice Total")

    # ── Legitimate labels are preserved (no fallback produced) ──────────────
    section("Legitimate labels are preserved (core = None)")
    for lbl in ["Ticket No.", "Ticket Logged", "Work Address",
                "Invoice Date", "PO Number"]:
        ok &= check(f"{lbl!r} unchanged", anchor._core_label(lbl) is None)

    # ── Over-stripping guards ───────────────────────────────────────────────
    section("Weak / single-token cases are NOT reduced")
    ok &= check("single token 'No' -> None", anchor._core_label("No") is None)
    ok &= check("'2605 No' would leave only weak 'No' -> None",
                anchor._core_label("2605 No") is None)
    ok &= check("'2024 To' would leave weak 'To' -> None",
                anchor._core_label("2024 To") is None)
    ok &= check("all-variable label -> None",
                anchor._core_label("2605-0805-1 (123)") is None)

    # ── End-to-end: original first, then core fallback (text path) ──────────
    section("extract_with_anchors recovers via the core when the original is absent")
    poisoned = _anchor("2605-0805-1 Work Address")
    # A different document in the family: different ticket number, so the saved
    # label's number is absent; only the recurring "Work Address" appears.
    ocr_other = "Ticket No. 2603-1351-1\nWork Address Beaumont Care Homes Ltd\n"
    res = anchor.extract_with_anchors(ocr_other, [poisoned], "Document Solutions",
                                      "job_worksheet", page_images=None, field_patterns={})
    val = (res.get("customer_name") or {}).get("value", "")
    ok &= check("core 'Work Address' recovers the customer value",
                val.startswith("Beaumont Care Homes Ltd"))

    section("Original label is used as-is when it IS present (original first)")
    ocr_same = "Work Address 2605-0805-1 Work Address Acme Holdings Ltd\n"
    # original "2605-0805-1 Work Address" present -> used directly
    res2 = anchor.extract_with_anchors(ocr_same, [poisoned], "Document Solutions",
                                       "job_worksheet", page_images=None, field_patterns={})
    ok &= check("original-label match still extracts",
                (res2.get("customer_name") or {}).get("value", "").startswith("Acme Holdings"))

    section("No recurring core present -> field stays empty (no false match)")
    res3 = anchor.extract_with_anchors("Totally unrelated text here\n", [poisoned],
                                       "Document Solutions", "job_worksheet",
                                       page_images=None, field_patterns={})
    ok &= check("absent label and absent core -> no value",
                "customer_name" not in res3 or not res3["customer_name"].get("value"))

    section("A clean anchor is unaffected by the fallback machinery")
    clean = _anchor("Ticket Logged", field_key="date")
    res4 = anchor.extract_with_anchors("Ticket Logged 31/03/2026\n", [clean],
                                       "Document Solutions", "job_worksheet",
                                       page_images=None, field_patterns={})
    ok &= check("clean label extracts normally",
                (res4.get("date") or {}).get("value", "").startswith("31/03/2026"))

    return ok


if __name__ == "__main__":
    print("=" * 60)
    print("Poisoned anchor-label normalisation (fix 2)")
    print("=" * 60)
    success = run()
    print("\n" + ("ALL PASSED" if success else "FAILURES PRESENT"))
    sys.exit(0 if success else 1)
