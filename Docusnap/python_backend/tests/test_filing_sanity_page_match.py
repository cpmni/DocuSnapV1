"""test_filing_sanity_page_match.py — PINs for Gate-C page-membership v2
(FILING_SANITY_PAGE_MATCH_V2; Chris round-7 card 1 → gary → Oracle SIGN-OFF-W/COND 2026-08-16,
blocking condition A1 applied: the confusable compare runs on a projection that KEEPS class
symbols — a strip-all projection deletes the very '$' the tolerance needs to see).

The evidence class (all verified in the round-7 sandbox DB): the full-page pass ITSELF misreads a
confusable glyph or splits a token — page "P1/26/9910" under a corrected value PI/26/9910; page
"VX$22033" under VXS22033; page "SB-ORD7 4238" under SB-ORD74238 — and Gate C's exact-token test
then flags the CORRECTED, history-backed crop value as "not on this page".

Run:  py -3.12 python_backend/tests/test_filing_sanity_page_match.py
"""
import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import engine  # noqa: E402

passed = failed = 0


def check(name, ok):
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok  {name}')
    else:
        failed += 1
        print(f'  FAIL {name}')


PAD = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt '
       'ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ' * 2)

PELICAN_IDX = {('pelican office interiors', 'invoice', 'invoice_number'):
               {'dominant': 'PI', 'counts': {'PI': 18}, 'total': 21, 'known': {'PI'}}}
VELTRIX_IDX = {('veltrix automotive parts', 'sales_order', 'sales_order_number'):
               {'dominant': 'VXS', 'counts': {'VXS': 12}, 'total': 12, 'known': {'VXS'}}}
THIN_IDX = {('veltrix automotive parts', 'sales_order', 'sales_order_number'):
            {'dominant': 'VXS', 'counts': {'VXS': 4}, 'total': 4, 'known': {'VXS'}}}


def run_gate(value, page_line, *, key='invoice_number', sup='Pelican Office Interiors',
             slug='invoice', idx=None, v2=True, extra_lines=(), scope='mirror'):
    """scope: how the gate learns its (supplier, slug) —
         'mirror'  = results['_supplier_name'/'_document_slug'] (the ORIGINAL pin shape — which the production
                     call order never provides: extract() writes those AFTER this gate runs);
         'caller'  = passed by the caller as supplier_name/document_slug (the production shape since 2026-08-27);
         'field'   = neither — only the supplier FIELD's value is on results (the fallback);
         'none'    = nothing at all (the pre-fix production shape — leg 2 must miss)."""
    os.environ['FILING_VALUE_SANITY_FLAGS'] = '1'
    if v2:
        os.environ['FILING_SANITY_PAGE_MATCH_V2'] = '1'
    else:
        os.environ.pop('FILING_SANITY_PAGE_MATCH_V2', None)
    fake = types.SimpleNamespace(prefix_index=idx or {}, _trace=False,
                                 _t=lambda *a, **k: None, log=lambda *a, **k: None)
    fake._page_match_v2 = lambda *a, **k: engine.ExtractionEngine._page_match_v2(fake, *a, **k)
    results = {key: {'value': value, 'method': 'template_mapping', 'confidence': 95}}
    kw = {}
    if scope == 'mirror':
        results['_supplier_name'] = sup; results['_document_slug'] = slug
    elif scope == 'caller':
        kw = {'supplier_name': sup, 'document_slug': slug}
    elif scope == 'field':
        results['supplier_name'] = {'value': sup, 'method': 'template_fixed', 'confidence': 95}
        results['_document_slug'] = slug
    page = '\n'.join([PAD, page_line, *extra_lines, PAD])
    try:
        engine.ExtractionEngine._flag_filing_value_sanity(fake, results, key, [], page, **kw)
    finally:
        os.environ.pop('FILING_VALUE_SANITY_FLAGS', None)
        os.environ.pop('FILING_SANITY_PAGE_MATCH_V2', None)
    return results[key].get('validation_note')


print('1. OFF control — v1 byte-identical (the three exhibits all still flag)')
check('doc-337 shape flags with v2 OFF',
      run_gate('PI/26/9910', 'Invoice Number P1/26/9910', idx=PELICAN_IDX, v2=False) is not None)
check('doc-204 shape flags with v2 OFF (LITERAL page string "VX$22033" — Oracle A1 pin)',
      run_gate('VXS22033', 'Order No VX$22033', key='sales_order_number',
               sup='Veltrix Automotive Parts', slug='sales_order', idx=VELTRIX_IDX, v2=False) is not None)
check('doc-191 split shape flags with v2 OFF',
      run_gate('SB-ORD74238', 'SALES ORDER SB-ORD7 4238', key='sales_order_number',
               sup='Silverbeck', slug='sales_order', v2=False) is not None)

print('2. Heals (v2 ON)')
check('doc-337: backed 1/I page form → flag withheld',
      run_gate('PI/26/9910', 'Invoice Number P1/26/9910', idx=PELICAN_IDX) is None)

print("2b. THE PRODUCTION SCOPE SHAPE (2026-08-27, the owner's Pelican 'PI/26/9687' exhibit): extract() writes")
print("    results['_supplier_name'] AFTER this gate runs, so the mirror shape above is not what production sees.")
check("pre-fix production shape (no scope at all) → leg 2 MISSES and the flag stays (the defect, pinned as the control)",
      run_gate('PI/26/9910', 'Invoice Number P1/26/9910', idx=PELICAN_IDX, scope='none') is not None)
check("caller-passed scope (the production shape now) → flag withheld",
      run_gate('PI/26/9910', 'Invoice Number P1/26/9910', idx=PELICAN_IDX, scope='caller') is None)
check("supplier FIELD value fallback (no mirror, no caller scope) → flag withheld",
      run_gate('PI/26/9910', 'Invoice Number P1/26/9910', idx=PELICAN_IDX, scope='field') is None)
_esrc = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'), encoding='utf-8').read()
check("extract() passes its resolved scope into the gate (source pin)",
      'self._flag_filing_value_sanity(results, ref_field_key, date_field_keys, ocr_text,\n'
      '                                       supplier_name=supplier_name, document_slug=document_slug)' in _esrc)
check("the note names the page form when one exists",
      "the page reads it as 'P1/26/9910'" in (run_gate('PI/26/9910', 'Invoice Number P1/26/9910', scope='none') or ''))
check('doc-204: backed $/S page form "VX$22033" → flag withheld (the A1 projection keeps the $)',
      run_gate('VXS22033', 'Order No VX$22033', key='sales_order_number',
               sup='Veltrix Automotive Parts', slug='sales_order', idx=VELTRIX_IDX) is None)
check('doc-191: same-line split join → flag withheld, NO backing needed',
      run_gate('SB-ORD74238', 'SALES ORDER SB-ORD7 4238', key='sales_order_number',
               sup='Silverbeck', slug='sales_order') is None)
check('slash retokenisation ("PI/26/ 9910") → flag withheld (join, no backing)',
      run_gate('PI/26/9910', 'Ref PI/26/ 9910') is None)
check('exact-token page (sanity) → no flag either way',
      run_gate('PI/26/9910', 'Invoice Number PI/26/9910') is None)

print('3. Fail-closed controls (v2 ON — each keeps the flag)')
check('the CLIP still flags: value VXS986 vs printed VXS98624 (exact sepless equality only)',
      run_gate('VXS986', 'Order No VXS98624', key='sales_order_number',
               sup='Veltrix Automotive Parts', slug='sales_order', idx=VELTRIX_IDX) is not None)
check('UNBACKED confusable still flags: PL value vs page PI (PL != dominant — the true positive)',
      run_gate('PL/26/3883', 'Invoice Number PI/26/3883', idx=PELICAN_IDX) is not None)
check('SUFFIX-region 1-diff still flags (pinned trade-off: dominance licenses only the HEAD — '
      'a crop suffix misread against a clean page must never file)',
      run_gate('PI/26/9918', 'Invoice Number PI/26/9910', idx=PELICAN_IDX) is not None)
check('under-bar scope (counts 4) still flags',
      run_gate('VXS22033', 'Order No VX$22033', key='sales_order_number',
               sup='Veltrix Automotive Parts', slug='sales_order', idx=THIN_IDX) is not None)
check('TWO diffs still flag',
      run_gate('PI/26/9910', 'Invoice Number P1/26/991O', idx=PELICAN_IDX) is not None)
check('cross-LINE join refused (manufactured adjacency)',
      run_gate('SB-ORD74238', 'SALES ORDER SB-ORD7', key='sales_order_number',
               sup='Silverbeck', slug='sales_order', extra_lines=('4238 more words',)) is not None)
check('no prefix record at all → unbacked → flags',
      run_gate('PI/26/9910', 'Invoice Number P1/26/9910', idx={}) is not None)

print('4. The shared dominance-bars helper == the B-lane arithmetic (boundary pins)')
b = engine._prefix_dominant_backed
check('5/5/1.0 passes', b({'dominant': 'PI', 'counts': {'PI': 5}}) is True)
check('4-count fails', b({'dominant': 'PI', 'counts': {'PI': 4}}) is False)
check('0.89 share fails', b({'dominant': 'PI', 'counts': {'PI': 89, 'PX': 11}}) is False)
check('0.90 share passes', b({'dominant': 'PI', 'counts': {'PI': 90, 'PX': 10}}) is True)
check('class symbols retained by the keep-projection are exactly the class non-alnum members',
      engine._PREFIX_CLASS_SYMBOLS == frozenset('$|][€£'))

print(f'\n{"ALL PASS" if failed == 0 else str(failed) + " FAILED"}  ({passed} ok)')
sys.exit(0 if failed == 0 else 1)
