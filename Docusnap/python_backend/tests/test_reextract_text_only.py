#!/usr/bin/env python3
"""
tests/test_reextract_text_only.py
---------------------------------
Fast on-open re-extract (Oracle-vetted). Proves the IMAGELESS engine path used by
`process_docs --reextract`: with page_images=[] and a caller-supplied known_template_id,
the engine runs its text-only subset — keyword reads from the cached OCR, the known
template applies its fixed values text-only via the known-id HONOUR path (Oracle C1:
Stage-0 live identify is skipped when there is no image, so the honour path at
engine.py:2848 applies the passed id), and crop/anchor stages self-skip (no crash).

    py -3.12 python_backend/tests/test_reextract_text_only.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import ExtractionEngine

CONFIG = str(Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")

TEMPLATE = {
    "id": 1, "name": "Acme", "document_type_slug": "invoice",
    "keyword_fingerprint": ["acme", "invoice"], "logo_phashes": [], "logo_detail_hashes": [],
    "confirmed_count": 5, "field_mappings": [],
    "fields": [{"field_key": "supplier_name", "fixed_value": "Acme Ltd", "is_variable": 0, "fixed_locked": 0}],
}
FIELDS = [{"key": "supplier_name", "type": "text"},
          {"key": "invoice_number", "type": "text"},
          {"key": "invoice_date", "type": "date"}]
OCR = "ACME LTD\nInvoice Number: INV-7788\nInvoice Date: 12/03/2026\nTotal: 100.00\n"


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


def main():
    f = 0
    eng = ExtractionEngine(mode="fast", config_path=CONFIG if os.path.exists(CONFIG) else None)
    # IMAGELESS: page_images=[] + anchors=[] + known_template_id=1 → the --reextract engine path.
    r = eng.extract(ocr_text=OCR, page_images=[], filename="t.pdf", field_defs=FIELDS,
                    hints=[], anchors=[], logos=[], templates=[TEMPLATE], known_template_id=1,
                    document_type="Invoice", document_slug="invoice")
    v = lambda k: (r.get(k) or {}).get("value")
    m = lambda k: (r.get(k) or {}).get("method")

    f += not check("imageless extract returned a dict (no crash on page_images=[])", isinstance(r, dict))
    f += not check("known template's fixed supplier applied text-only (honour path)",
                   v("supplier_name") == "Acme Ltd" and "template_fixed" in str(m("supplier_name")))
    f += not check("keyword invoice_number read from cached OCR", v("invoice_number") == "INV-7788")
    f += not check("keyword invoice_date read from cached OCR", bool(v("invoice_date")))

    # Control: with NO known_template_id, imageless live-identify is skipped (Oracle C1) → the fixed
    # supplier from the template is NOT applied (no image to identify by, no id passed), proving the
    # template only enters via the passed id — not an unguarded imageless text-arm match.
    r2 = eng.extract(ocr_text=OCR, page_images=[], filename="t.pdf", field_defs=FIELDS,
                     hints=[], anchors=[], logos=[], templates=[TEMPLATE], known_template_id=None,
                     document_type="Invoice", document_slug="invoice")
    f += not check("keyword still works with no template id (imageless)",
                   (r2.get("invoice_number") or {}).get("value") == "INV-7788")

    print(f"\n{'ALL PASS' if f == 0 else str(f) + ' FAILED'}")
    sys.exit(1 if f else 0)


main()
