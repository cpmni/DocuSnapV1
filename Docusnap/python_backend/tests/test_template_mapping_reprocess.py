#!/usr/bin/env python3
"""
tests/test_template_mapping_reprocess.py
----------------------------------------
Covers the reprocess "honour the linked template" fallback (engine.extract
known_template_id) and that a matched template's Stage 0.5 mapping overrides a
bad learned-anchor value.

Scenario mirrors the real bug: a document whose live template re-identification
FAILS (logo/keyword below threshold) was previously linked to a template that
carries an admin-drawn invoice_date mapping. Without the fallback, Stage 0/0.5
never run, so the mapping can't fix the date. With known_template_id, Stage 0 is
honoured and the mapping wins over the mis-aimed learned anchor.

Usage: py -3.12 python_backend/tests/test_template_mapping_reprocess.py
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import ExtractionEngine                    # noqa: E402
from extraction import template_mapper, anchor as anchor_module   # noqa: E402


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


FIELD_DEFS = [
    {"key": "supplier_name", "type": "text", "is_variable": False},
    {"key": "invoice_date",  "type": "text", "is_variable": True},
]

# Fingerprint words deliberately absent from OCR_TEXT → live match fails.
TEMPLATE = {
    'id': 42, 'name': 'Acme Invoice', 'document_type_slug': 'invoice',
    'logo_phash': None,
    'keyword_fingerprint': ['ZZZNOPE', 'QQQABSENT', 'WONTMATCH'],
    'fields': [
        {'field_key': 'supplier_name', 'fixed_value': 'Acme Ltd', 'is_variable': 0,
         'anchor_label': None, 'direction': 'right'},
    ],
    'field_mappings': [
        {'field_key': 'invoice_date', 'enabled': True, 'page_number': 0,
         'anchor_text': 'Date', 'target_x_norm': 0.1, 'target_y_norm': 0.1,
         'target_w_norm': 0.3, 'target_h_norm': 0.05},
    ],
}
OCR_TEXT = "Acme Header\nInvoice\nDate: 03-06-2026\nTotal Due 100.00"
PLACEHOLDER_ANCHORS = [{'field_key': 'invoice_date', 'anchor_label': 'x', 'direction': 'right',
                       'supplier_name': '', 'document_type': '', 'usage_count': 1, 'confidence': 0.5}]
# Mis-aimed learned date anchor (the real symptom: read the invoice-number region)
BAD_ANCHOR = {'invoice_date': {'value': '20581', 'confidence': 30, 'method': 'anchor_crop'}}
# The admin mapping resolves the real date, higher confidence
MAPPING_HIT = {'invoice_date': {'value': '03-06-2026', 'confidence': 90, 'method': 'template_mapping'}}


def run(known_id):
    om, oa = template_mapper.extract_with_mappings, anchor_module.extract_with_anchors
    template_mapper.extract_with_mappings = lambda *a, **k: dict(MAPPING_HIT)
    anchor_module.extract_with_anchors    = lambda *a, **k: dict(BAD_ANCHOR)
    try:
        eng = ExtractionEngine(mode='smart', emit_fn=lambda *_a: None)
        return eng.extract(
            ocr_text=OCR_TEXT, page_images=['fake'], filename='x.pdf',
            field_defs=FIELD_DEFS, hints=[], anchors=PLACEHOLDER_ANCHORS, logos=[],
            templates=[TEMPLATE], document_type='Invoice', document_slug='invoice',
            supplier_name=None, known_template_id=known_id)
    finally:
        template_mapper.extract_with_mappings = om
        anchor_module.extract_with_anchors    = oa


def main():
    failures = 0

    print("\nlive match fails AND no known_template_id -> Stage 0/0.5 never run")
    r0 = run(None)
    failures += not check('no template match (_template_id is None)', r0.get('_template_id') is None)
    failures += not check('Stage 0 did not run (supplier_fixed not applied)',
                          (r0.get('supplier_name') or {}).get('value') != 'Acme Ltd')
    failures += not check('mapping did not run; bad learned-anchor date "20581" remains',
                          (r0.get('invoice_date') or {}).get('value') == '20581')

    print("\nlive match fails BUT known_template_id honours the linked template")
    r1 = run(42)
    failures += not check('linked template honoured (_template_id == 42)', r1.get('_template_id') == 42)
    failures += not check('Stage 0 ran (supplier_fixed applied)',
                          (r1.get('supplier_name') or {}).get('value') == 'Acme Ltd')
    failures += not check('Stage 0.5 ran: mapped date (conf 90) overrides bad anchor (conf 30)',
                          (r1.get('invoice_date') or {}).get('value') == '03-06-2026')
    # The matched template exposes its document type so process_docs can assign
    # it (the only mechanism that types CUSTOM doc types on recurring docs).
    failures += not check("matched template emits _document_type_slug for doc-type assignment",
                          r1.get('_document_type_slug') == 'invoice')

    print()
    if failures:
        print(f"{failures} check(s) FAILED.")
        return 1
    print("All checks passed.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
