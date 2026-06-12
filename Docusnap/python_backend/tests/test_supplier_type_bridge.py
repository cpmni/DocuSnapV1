#!/usr/bin/env python3
"""
tests/test_supplier_type_bridge.py
----------------------------------
Regression coverage for Commit 2 (Fix B): the logo/supplier -> document-type
bridge in engine.py. When a document's supplier is identified but neither a
template match nor on-page keyword/heading detection produced a document type,
the engine falls back to the type the supplier has most often been CONFIRMED
under (passed in as `supplier_types`). Conservative gating is the whole point,
so every gate is exercised here:

  • fires only when there is NO template match AND NO keyword/heading type
    (document_slug) — page-label evidence always wins first;
  • requires a minimum confirmed history (SUPPLIER_TYPE_MIN_CONFIRMED);
  • never fires without an identified supplier;
  • matches the supplier case-insensitively.

These checks drive engine.extract directly with empty learning corpora and a
benign OCR string, so only the bridge's own decision is under test (no PIL/OCR,
no template geometry). supplier_name is passed in to simulate an
already-identified supplier (logo fingerprint / hint), exactly the situation the
bridge exists for.

Usage:
    py -3.12 python_backend/tests/test_supplier_type_bridge.py

Exit code 0 = behaves as expected. Exit code 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import ExtractionEngine, SUPPLIER_TYPE_MIN_CONFIRMED  # noqa: E402


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def section(title):
    print(f"\n{title}")


SUPPLIER = "Document Solutions Ltd"
OCR = "Service Worksheet\nTicket No 2605-0805-1\nDate 22-05-2026\n"

FIELD_DEFS = [
    {"key": "job_no",   "label": "Job No",   "type": "text"},
    {"key": "date",     "label": "Date",     "type": "date"},
    {"key": "supplier", "label": "Supplier", "type": "text"},
]

HISTORY = [
    {"supplier_name": SUPPLIER, "document_type_slug": "job_worksheet", "confirmed_count": 5},
    {"supplier_name": "Some Other Co", "document_type_slug": "invoice", "confirmed_count": 9},
]


def _extract(**overrides):
    """Run a minimal extract() with empty learning corpora unless overridden."""
    engine = ExtractionEngine(mode="fast")
    kwargs = dict(
        ocr_text=OCR, page_images=[], filename="doc.pdf",
        field_defs=FIELD_DEFS, hints=[], anchors=[], logos=[],
        templates=None, document_type=None, document_slug=None,
        supplier_name=SUPPLIER, supplier_types=HISTORY,
    )
    kwargs.update(overrides)
    return engine.extract(**kwargs)


def run():
    ok = True

    section("Bridge fills the gap when supplier known but no template/heading type")
    r = _extract()
    ok &= check("seeds the supplier's dominant confirmed type",
                r.get("_document_type_slug") == "job_worksheet")

    section("Bridge never overrides a positive keyword/heading detection")
    r2 = _extract(document_slug="invoice")
    ok &= check("keyword-detected type is NOT overridden by supplier history",
                r2.get("_document_type_slug") in (None,))  # no template, bridge skipped

    section("Bridge requires a minimum confirmed history")
    thin = [{"supplier_name": SUPPLIER, "document_type_slug": "job_worksheet",
             "confirmed_count": SUPPLIER_TYPE_MIN_CONFIRMED - 1}]
    r3 = _extract(supplier_types=thin)
    ok &= check(f"history below {SUPPLIER_TYPE_MIN_CONFIRMED} confirmed docs does not seed",
                r3.get("_document_type_slug") is None)

    section("Bridge does nothing without an identified supplier")
    r4 = _extract(supplier_name=None)
    ok &= check("no supplier -> no bridged type", r4.get("_document_type_slug") is None)

    section("Bridge does nothing with no history at all")
    r5 = _extract(supplier_types=[])
    ok &= check("empty history -> no bridged type", r5.get("_document_type_slug") is None)

    section("Supplier matched case-insensitively")
    r6 = _extract(supplier_name=SUPPLIER.upper())
    ok &= check("UPPERCASE supplier still matches its history row",
                r6.get("_document_type_slug") == "job_worksheet")

    section("Only the dominant type is used, not an unrelated supplier's")
    # SUPPLIER's only history is job_worksheet; the invoice row belongs to a
    # different supplier and must never leak across.
    ok &= check("does not pick another supplier's type",
                _extract().get("_document_type_slug") != "invoice")

    return ok


if __name__ == "__main__":
    print("=" * 60)
    print("Supplier -> document-type bridge (Fix B)")
    print("=" * 60)
    success = run()
    print("\n" + ("ALL PASSED" if success else "FAILURES PRESENT"))
    sys.exit(0 if success else 1)
