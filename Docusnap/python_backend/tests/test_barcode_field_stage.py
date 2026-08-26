"""test_barcode_field_stage.py — PINs for the BARCODE field type's engine stage (Stage 1.5;
kill switch BARCODE_FIELD, DEFAULT OFF; barry → gary design 2026-08-26).

The decode is the ONE writer of a barcode-typed field: exactly one code-like decode fills it @100
with a confirm-once note; several leave it EMPTY with a note (never first-wins); no OCR rung
(keyword / hint / late rescue / format repair / Stage 4.5) may touch it; OFF is byte-identical.

Run:  py -3.12 python_backend/tests/test_barcode_field_stage.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction.engine import ExtractionEngine, _BARCODE_CONFIRM_NOTE, _BARCODE_SEVERAL_NOTE  # noqa: E402
from extraction import engine as _engine_mod  # noqa: E402

passed = failed = 0


def check(name, ok, extra=''):
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok  {name}')
    else:
        failed += 1
        print(f'  FAIL {name}{("  [" + str(extra) + "]") if extra else ""}')


FIELDS = [
    {'key': 'supplier_name', 'label': 'Document Issuer', 'type': 'text', 'required': 1},
    {'key': 'invoice_number', 'label': 'Invoice Number', 'type': 'alphanumeric', 'required': 1},
    {'key': 'invoice_date', 'label': 'Invoice Date', 'type': 'date', 'required': 1},
    {'key': 'asset_tag', 'label': 'Asset Tag', 'type': 'barcode', 'required': 0},
]
PAGE = """ACME SUPPLIES LTD
Invoice Number: INV-1001
Invoice Date: 12/05/2026
Asset Tag: OLD-OCR-READ
Total: 100.00
"""
BC_ONE = [{'page': 0, 'symbology': 'Code128', 'value': 'AT-778899', 'x_norm': .1, 'y_norm': .2, 'w_norm': .3, 'h_norm': .05, 'orientation': 0, 'content_type': 'Text'}]
BC_TWO = BC_ONE + [{'page': 0, 'symbology': 'QRCode', 'value': 'AT-778900', 'x_norm': .6, 'y_norm': .2, 'w_norm': .1, 'h_norm': .1, 'orientation': 0, 'content_type': 'Text'}]
BC_URL = [{'page': 0, 'symbology': 'QRCode', 'value': 'https://example.com/x', 'x_norm': .6, 'y_norm': .2, 'w_norm': .1, 'h_norm': .1, 'orientation': 0, 'content_type': 'Text'}]


def run(barcodes, armed=True, hints=None, fields=FIELDS):
    old = os.environ.get('BARCODE_FIELD')
    if armed:
        os.environ['BARCODE_FIELD'] = '1'
    else:
        os.environ.pop('BARCODE_FIELD', None)
    try:
        eng = ExtractionEngine(mode='smart', emit_fn=lambda *_a: None)
        res = eng.extract(ocr_text=PAGE, page_images=[], filename='doc.pdf', field_defs=fields,
                          hints=hints or [], anchors=[], logos=[], templates=None,
                          document_type='Invoice', document_slug='invoice', barcodes=barcodes)
        return res, eng
    finally:
        if old is None:
            os.environ.pop('BARCODE_FIELD', None)
        else:
            os.environ['BARCODE_FIELD'] = old


print('1. exactly one decode → filled @100, method barcode, confirm-once note, doc held')
r, eng = run(BC_ONE)
d = r.get('asset_tag') or {}
check('value is the decode (not the OCR "Asset Tag:" line)', d.get('value') == 'AT-778899', d)
check('confidence 100, method barcode', d.get('confidence') == 100 and d.get('method') == 'barcode', d)
check('confirm-once note present', d.get('validation_note') == _BARCODE_CONFIRM_NOTE, d.get('validation_note'))
check('document needs review (fail-toward-review)', r.get('_needs_review') is True)
check('other fields still read by OCR', (r.get('invoice_number') or {}).get('value') == 'INV-1001')
_rec = (r.get('_corroboration_emit') or {}).get('asset_tag')
check('corroboration record can never LICENSE the barcode field (no page family agrees; independent_agree False)',
      _rec is None or (_rec.get('independent_agree') is False and not _rec.get('agree')), _rec)

print('2. several decodes → EMPTY + a note listing them (never first-wins)')
r, _ = run(BC_TWO)
d = r.get('asset_tag') or {}
check('value empty', not d.get('value'), d)
check('note lists both candidates', 'AT-778899' in str(d.get('validation_note')) and 'AT-778900' in str(d.get('validation_note')), d.get('validation_note'))
check('note text is the SEVERAL constant', str(d.get('validation_note')).startswith(_BARCODE_SEVERAL_NOTE.split('{}')[0]))

print('3. only a URL decode → empty + unsupported note')
r, _ = run(BC_URL)
d = r.get('asset_tag') or {}
check('value empty, unsupported note', not d.get('value') and 'web link' in str(d.get('validation_note')), d)

print('4. no decode at all (barcodes=[]) → field absent/empty, no note')
r, _ = run([])
d = r.get('asset_tag') or {}
check('no value, no note', not d.get('value') and not d.get('validation_note'), d)

print('5. OWNERSHIP — a hint never fills a barcode field; the OCR line never becomes its value')
r, _ = run([], hints=[{'supplier_name': 'ACME SUPPLIES LTD', 'document_type': 'invoice', 'field_key': 'asset_tag',
                       'hint_value': 'AT-000001', 'usage_count': 9}])
d = r.get('asset_tag') or {}
check('hint did not fill the empty barcode field', d.get('value') != 'AT-000001', d)
r, _ = run(BC_ONE, hints=[{'supplier_name': 'ACME SUPPLIES LTD', 'document_type': 'invoice', 'field_key': 'asset_tag',
                           'hint_value': 'AT-000001', 'usage_count': 9}])
check('hint did not displace the decode', (r.get('asset_tag') or {}).get('value') == 'AT-778899')
check('the OCR "Asset Tag: OLD-OCR-READ" line never wrote the field (keyword scan excludes barcode keys)',
      all((res.get('asset_tag') or {}).get('value') != 'OLD-OCR-READ' for res in (run(BC_ONE)[0], run([])[0])))

print('6. OFF — byte-identical: `barcodes` is ignored and the field behaves exactly as an unknown-typed field does today')
r_off, _ = run(BC_ONE, armed=False)
r_off_none, _ = run(None, armed=False)
check('OFF: the decode is NOT adopted', (r_off.get('asset_tag') or {}).get('value') != 'AT-778899', r_off.get('asset_tag'))
check('OFF: identical with and without the kwarg', r_off.get('asset_tag') == r_off_none.get('asset_tag'))
r_none, _ = run(None, armed=True)
check('ON but no decode ran (barcodes=None, e.g. --reextract): identical to OFF', r_none.get('asset_tag') == r_off.get('asset_tag'))

print('7. the barcode notes are NOT in the class-F verification-doubt allowlist')
check('confirm note not clearable by F', not _engine_mod._is_verification_doubt_note(_BARCODE_CONFIRM_NOTE))
check('several note not clearable by F', not _engine_mod._is_verification_doubt_note(_BARCODE_SEVERAL_NOTE.format('A · B')))

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
