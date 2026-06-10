#!/usr/bin/env python3
"""
tests/test_date_precedence.py
-----------------------------
Regression for the date merge guard in engine.py: a date-typed candidate that
does NOT parse as a real date (e.g. a mis-cropped taught anchor returning a bare
"March") must never displace a valid date already extracted — not even via the
is_taught_override "ground truth" path. A genuinely valid taught date still wins
on its merits.

Usage: py -3.12 python_backend/tests/test_date_precedence.py
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import ExtractionEngine                    # noqa: E402
from extraction import anchor as anchor_module                    # noqa: E402


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return cond


FIELD_DEFS = [
    {"key": "supplier_name", "type": "text", "is_variable": False},
    {"key": "invoice_date",  "type": "date", "is_variable": True},
]
# Keyword Stage 1 reads a real, valid date from this line.
OCR_TEXT = "Cloud VPS\nInvoice Date: 06-03-2026\nTotal Due: 12.00"
PLACEHOLDER_ANCHORS = [{'field_key': 'invoice_date', 'anchor_label': 'x', 'direction': 'right',
                       'supplier_name': '', 'document_type': '', 'usage_count': 1, 'confidence': 0.5}]


def run(anchor_result):
    orig = anchor_module.extract_with_anchors
    anchor_module.extract_with_anchors = lambda *a, **k: dict(anchor_result)
    try:
        eng = ExtractionEngine(mode='smart', emit_fn=lambda *_a: None)
        return eng.extract(
            ocr_text=OCR_TEXT, page_images=[], filename='cvps.pdf',
            field_defs=FIELD_DEFS, hints=[], anchors=PLACEHOLDER_ANCHORS, logos=[],
            templates=[], document_type='Invoice', document_slug='invoice', supplier_name=None)
    finally:
        anchor_module.extract_with_anchors = orig


def main():
    failures = 0

    print('\na mis-cropped taught anchor ("March") must NOT override a valid extracted date')
    r1 = run({'invoice_date': {'value': 'March', 'confidence': 95, 'method': 'anchor_crop'}})
    # 06-03-2026 normalises to DD-MM-YYYY; the key assertion is it is NOT "March".
    val1 = (r1.get('invoice_date') or {}).get('value')
    failures += not check(f'invoice_date kept the valid date (got {val1!r}), not "March"',
                          val1 and val1 != 'March' and 'March' not in val1)

    print('\na genuinely valid taught date still wins on its merits (guard only blocks invalid)')
    r2 = run({'invoice_date': {'value': '15-07-2026', 'confidence': 95, 'method': 'anchor_crop'}})
    val2 = (r2.get('invoice_date') or {}).get('value')
    failures += not check(f'invoice_date took the valid taught date (got {val2!r})', val2 == '15-07-2026')

    print()
    if failures:
        print(f"{failures} check(s) FAILED.")
        return 1
    print("All checks passed.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
