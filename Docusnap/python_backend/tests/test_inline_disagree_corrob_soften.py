"""test_inline_disagree_corrob_soften.py — PINs for class G of _resolve_corroborated_notes
(INLINE_DISAGREE_CORROB_SOFTEN; gary design -> Oracle SIGN-OFF-W/COND G1-G7, 2026-09-07).

Owner exhibit: Ironbridge sales_order, sales_order_number. The taught box read '30-47559' but the
label-anchored inline read + a keyword read both say 'SO-42552' (the committed value). The
`_pick_fuller_code` inline-disagree note ("…the box may be clipping the first character; please check
which is printed") held the doc as a VALUE-doubt when the value is corroborated and the real defect is a
drifted taught box. Class G REWORDS (never clears) that note when an independent KEYWORD-family read
agrees; stays REVIEW-BOUND; conf never lifted (< 88). DEFAULT OFF; every refusal keeps the note.

Run:  py -3.12 python_backend/tests/test_inline_disagree_corrob_soften.py
"""
import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import engine, template_mapper, format_anomaly_checker  # noqa: E402

passed = failed = 0


def check(name, ok):
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok  {name}')
    else:
        failed += 1
        print(f'  FAIL {name}')


ENV = 'INLINE_DISAGREE_CORROB_SOFTEN'
MARK = template_mapper._INLINE_DISAGREE_MARK
INLINE_NOTE = template_mapper._INLINE_DISAGREE_NOTE.format(rigid='30-47559', inline='SO-42552')

SUP, SLUG = 'Ironbridge Fabrication', 'sales_order'
SCOPE = (SUP.lower(), SLUG, 'sales_order_number')

# A learned entry through the real index path (so check_value is honest). A sales-order number is unique
# per doc, so the SOFT belt fires on a scope WITH an entry (check_value passes) and fails OPEN with none.
FMT = format_anomaly_checker.build_format_class_index([{
    'supplier_name': SUP, 'document_type': SLUG, 'field_key': 'sales_order_number',
    'sample_values': ['SO-42550', 'SO-42549', 'SO-42548'],
    'value_counts': {'SO-42550': 1, 'SO-42549': 1, 'SO-42548': 1}, 'confirmed_count': 3,
}]).get(SCOPE)
assert FMT is not None, 'fixture: could not build a learned-shape entry'
assert format_anomaly_checker.check_value('SO-42552', FMT) is None, 'fixture: SO-42552 must pass its own shape'

LIC = {'sales_order_number': {'independent_agree': True, 'winner_family': 'mapping',
                              'agree': ['keyword'], 'disagree': []}}
KW = [{'stage': '1_keyword', 'method': 'keyword', 'value': 'SO-42552', 'confidence': 88}]
CROP = [{'stage': '2_anchor', 'method': 'anchor_crop', 'value': 'SO-42552', 'confidence': 88}]


def mk(note=INLINE_NOTE, val='SO-42552', conf=70, method='template_mapping_shapewarn', extra=None):
    d = {'value': val, 'method': method, 'confidence': conf, 'validation_note': note}
    if extra:
        d.update(extra)
    return {'sales_order_number': d}


def run(results, corrob=None, cands=None, fmt_index=None, on=True, field_defs=None):
    os.environ.pop(ENV, None)
    if on:
        os.environ[ENV] = '1'
    fake = types.SimpleNamespace(
        _field_candidates=(cands if cands is not None else {'sales_order_number': KW}),
        format_class_index=(fmt_index if fmt_index is not None else {SCOPE: FMT}),
        _try_verification_doubt_clear=lambda *a, **k: False,
        _try_prefix_confusable_adopt=lambda *a, **k: False,
        _trace=False, _t=lambda *a, **k: None, log=lambda *a, **k: None)
    fake._try_inline_disagree_corrob_soften = \
        lambda *a, **k: engine.ExtractionEngine._try_inline_disagree_corrob_soften(fake, *a, **k)
    res = {'_supplier_name': SUP, '_document_slug': SLUG}
    res.update(results)
    try:
        changed = engine.ExtractionEngine._resolve_corroborated_notes(
            fake, res, (field_defs or []), (corrob if corrob is not None else LIC), None, '')
        return changed, res['sales_order_number']
    finally:
        os.environ.pop(ENV, None)


# ── 1. Exhibit heals: note REWORDED (not cleared), conf not lifted, stays review-bound ──
ch, d = run(mk())
check('1 exhibit: changed True', ch is True)
check('1 note reworded — names the drifted box / re-teach', 're-teach' in (d.get('validation_note') or '').lower())
check('1 note NO LONGER a value-doubt ("please check which is printed" gone)',
      'please check which is printed' not in (d.get('validation_note') or ''))
check('1 a validation_note is RETAINED (review-bound; not cleared)', bool(d.get('validation_note')))
check('1 the mark is gone from the reworded note', MARK not in (d.get('validation_note') or ''))
check('1 conf NOT lifted and < 88 (Oracle G1)', d.get('confidence') == 70 and d.get('confidence') < 88)
check('1 value untouched', d.get('value') == 'SO-42552')
check('1 method carries the census marker', str(d.get('method') or '').endswith('+inline_disagree_corrob_soften'))

# ── 2. Anti-regression: the raw-witness note (two-reads-say-WRONG) STAYS flagged ──
RAWW = "the raw scan reads this as 'S0-42552' — one character differs (O/0); please check which is printed"
check('2a raw-witness note does NOT contain the mark (dispatch never selects it)', MARK not in RAWW)
ch2, d2 = run(mk(note=RAWW, method='template_mapping_shapewarn+_rawwitness'))
check('2b raw-witness field UNCHANGED (note kept, no soften)', ch2 is False and d2.get('validation_note') == RAWW)
# even were the mark present, a _rawwitness method must refuse
ch2c, d2c = run(mk(note=INLINE_NOTE, method='template_mapping_shapewarn+_rawwitness'))
check('2c a _rawwitness method refuses even with the mark', d2c.get('method') == 'template_mapping_shapewarn+_rawwitness')

# ── 3. No KEYWORD witness (only a CROP witness = common-mode) -> refuse (Oracle G3) ──
ch3, d3 = run(mk(), cands={'sales_order_number': CROP})
check('3 crop-only witness refuses (keyword-family only)', ch3 is False and d3.get('validation_note') == INLINE_NOTE)

# ── 4. Not licensed -> refuse ──
UNLIC = {'sales_order_number': {'independent_agree': False, 'winner_family': 'mapping', 'agree': [], 'disagree': []}}
ch4, d4 = run(mk(), corrob=UNLIC)
check('4 unlicensed record refuses', ch4 is False and d4.get('validation_note') == INLINE_NOTE)

# ── 5. Money + identity excluded (mirror F Oracle C2) ──
def run_field(fk, note=INLINE_NOTE, field_defs=None):
    os.environ[ENV] = '1'
    fake = types.SimpleNamespace(
        _field_candidates={fk: [{'stage': '1_keyword', 'method': 'keyword', 'value': 'SO-42552', 'confidence': 88}]},
        format_class_index={}, _try_verification_doubt_clear=lambda *a, **k: False,
        _try_prefix_confusable_adopt=lambda *a, **k: False, _trace=False, _t=lambda *a, **k: None, log=lambda *a, **k: None)
    fake._try_inline_disagree_corrob_soften = lambda *a, **k: engine.ExtractionEngine._try_inline_disagree_corrob_soften(fake, *a, **k)
    res = {'_supplier_name': SUP, '_document_slug': SLUG,
           fk: {'value': 'SO-42552', 'method': 'template_mapping_shapewarn', 'confidence': 70, 'validation_note': note}}
    try:
        engine.ExtractionEngine._resolve_corroborated_notes(fake, res, (field_defs or []), {fk: LIC['sales_order_number']}, None, '')
        return res[fk]
    finally:
        os.environ.pop(ENV, None)

check('5a supplier_name excluded', run_field('supplier_name').get('validation_note') == INLINE_NOTE)
check('5b total_amount excluded', run_field('total_amount').get('validation_note') == INLINE_NOTE)
check('5c a currency-typed field excluded',
      run_field('grand_total', field_defs=[{'key': 'grand_total', 'type': 'currency'}]).get('validation_note') == INLINE_NOTE)

# ── 6. OFF == ON (byte-identical off) ──
ch6, d6 = run(mk(), on=False)
check('6 OFF: field untouched', ch6 is False and d6.get('validation_note') == INLINE_NOTE and d6.get('confidence') == 70)

# ── 7. SOFT shape belt: fail-OPEN on a scope with no learned entry (unique-per-doc ref) ──
ch7, d7 = run(mk(), fmt_index={})
check('7 no learned entry -> fail-open, softens', ch7 is True and 're-teach' in (d7.get('validation_note') or '').lower())
# a value that FAILS an existing entry's check_value -> refuse
BADFMT = format_anomaly_checker.build_format_class_index([{
    'supplier_name': SUP, 'document_type': SLUG, 'field_key': 'sales_order_number',
    'sample_values': ['12345', '12346', '12347'], 'value_counts': {'12345': 1, '12346': 1, '12347': 1}, 'confirmed_count': 3,
}]).get(SCOPE)
if BADFMT and format_anomaly_checker.check_value('SO-42552', BADFMT) is not None:
    ch7b, d7b = run(mk(), fmt_index={SCOPE: BADFMT})
    check('7b value failing an existing entry refuses', ch7b is False and d7b.get('validation_note') == INLINE_NOTE)
else:
    check('7b (fixture) digits-only entry rejects SO-42552', False)

# ── 8. Class-separation PIN: the mark is its OWN discriminator, never in F's allowlist ──
check('8a mark present in the inline-disagree note', MARK in INLINE_NOTE)
check('8b mark ABSENT from _SHAPE_WARN_NOTE (shares the method)', MARK not in template_mapper._SHAPE_WARN_NOTE)
try:
    fmarks = engine._verification_doubt_note_marks()
    # marks may be strings or tuples of alternates — flatten to strings and assert the mark is not one.
    flat = []
    for m in fmarks:
        flat.extend(m if isinstance(m, (list, tuple)) else [m])
    check('8c mark NOT in F allowlist (_verification_doubt_note_marks)',
          all(MARK not in str(m) and str(m) not in MARK for m in flat))
except Exception as e:
    check(f'8c (could not read F allowlist: {e})', False)

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
