"""test_verification_doubt_clear.py — PINs for class F of _resolve_corroborated_notes
(CORROB_VERIFICATION_DOUBT_CLEAR; gary audit 2026-08-26; owner exhibit SuperStore invoice_number
31901 held by the taught-box edge-cut note while template_mapping_edgecut AND keyword both read 31901).

ONE general rule for the "please check / please verify" doubt-note family. DEFAULT OFF; every refusal
keeps the note untouched (fail toward Review). For the heal: note popped AND the FIELD lifted to 90
(clearing the note alone is cosmetic — the edge-cut caps the field at 70 and trust.js reads it).

Run:  py -3.12 python_backend/tests/test_verification_doubt_clear.py
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


ENV = 'CORROB_VERIFICATION_DOUBT_CLEAR'
EDGE = template_mapper._EDGE_CUT_NOTE
FT = template_mapper._FT_FALLTHROUGH_NOTE
TRIM = engine._SHAPE_TRIM_NOTE
REREAD = f'{engine._REREAD_NOTE_HEAD}3190l") — please verify'

SUP, SLUG = 'SuperStore', 'invoice'
SCOPE = (SUP.lower(), SLUG, 'invoice_number')


# Build a real format entry through the checker's own classifier so the shape leg is honest
# (classify_format is what build_format_class_index feeds per scope).
def _learned_entry(values):
    try:
        return format_anomaly_checker.classify_format(values)
    except Exception:
        return None


def _indexed_entry(field_key, values):
    """The REAL index path (build_format_class_index over a getFieldFormats-shaped group), so the
    entry carries `shapes` AND `shape_families` (the length leg) exactly as the engine sees them."""
    idx = format_anomaly_checker.build_format_class_index([{
        'supplier_name': SUP, 'document_type': SLUG, 'field_key': field_key,
        'sample_values': list(values), 'value_counts': {v: 1 for v in values}, 'confirmed_count': len(values)}])
    return idx.get((SUP.lower(), SLUG, field_key))


FMT_DIGITS = _indexed_entry('invoice_number', ['31890', '31895', '31899', '31900', '31877', '31866'])
assert FMT_DIGITS is not None, 'fixture: could not build a learned-shape entry through format_anomaly_checker'
assert FMT_DIGITS.get('shape_families'), 'fixture: the index entry must carry shape_families (the length leg)'
assert format_anomaly_checker.check_value('31901', FMT_DIGITS) is None, 'fixture: 31901 must pass its own shape'


def run(results, corrob, cands, fmt_index=None, env=ENV):
    os.environ.pop(ENV, None)
    if env:
        os.environ[env] = '1'
    fake = types.SimpleNamespace(
        prefix_index={}, dominant_index={}, confirmed_counts_index={},
        _field_candidates=cands,
        format_class_index=fmt_index if fmt_index is not None else {SCOPE: FMT_DIGITS},
        _try_prefix_confusable_adopt=lambda *a, **k: False,
        _try_verification_doubt_clear=lambda *a, **k: engine.ExtractionEngine._try_verification_doubt_clear(fake, *a, **k),
        _trace=False, _t=lambda *a, **k: None, log=lambda *a, **k: None)
    try:
        return engine.ExtractionEngine._resolve_corroborated_notes(fake, results, {}, corrob, None, '')
    finally:
        os.environ.pop(ENV, None)


LIC = {'invoice_number': {'independent_agree': True, 'winner_family': 'mapping',
                          'agree': ['keyword'], 'disagree': []}}
KW_WITNESS = [{'stage': '1_keyword', 'method': 'keyword', 'value': '31901', 'confidence': 92}]


def mk(note=EDGE, val='31901', conf=70, method='template_mapping_edgecut', extra=None):
    d = {'value': val, 'method': method, 'confidence': conf, 'validation_note': note}
    if extra:
        d.update(extra)
    return {'_supplier_name': SUP, '_document_slug': SLUG, 'invoice_number': d}


print('F. verification-doubt note clear')

# ── heal: the owner's exhibit ──
r = mk()
fired = run(r, LIC, {'invoice_number': KW_WITNESS})
d = r['invoice_number']
check('heal: edge-cut note popped, field LIFTED 70→90, method +corrob_verified',
      fired and d.get('validation_note') is None and d['confidence'] == 90
      and d['method'].endswith('+corrob_verified') and d['value'] == '31901')
check('heal: provenance recorded on the record (witness family/method), independent_agree untouched',
      LIC['invoice_number'].get('verification_note_cleared', {}).get('witness_family') == 'keyword'
      and LIC['invoice_number']['independent_agree'] is True)
LIC['invoice_number'].pop('verification_note_cleared', None)

# ── every allowlisted mark heals the same way ──
for name, note in (('surrounding-line', FT), ('shape-trim', TRIM), ('re-read', REREAD)):
    r = mk(note=note, extra={'corrected_to': '31901', 'was_corrected': True} if name == 're-read' else None)
    fired = run(r, LIC, {'invoice_number': KW_WITNESS})
    d = r['invoice_number']
    check(f'heal ({name}): note popped + lifted; vacuous corrected_to dropped',
          fired and d.get('validation_note') is None and d['confidence'] == 90 and d.get('corrected_to') is None)
    LIC['invoice_number'].pop('verification_note_cleared', None)

# ── OFF ⇒ untouched ──
r = mk()
check('OFF (no env): untouched', not run(r, LIC, {'invoice_number': KW_WITNESS}, env=None)
      and r['invoice_number']['validation_note'] == EDGE and r['invoice_number']['confidence'] == 70)

# ── deny-by-default: notes outside the allowlist NEVER clear ──
for name, note in (('disagreement', "the raw scan reads this as 'PI/25/8496' — one character differs (1/I); please check which is printed"),
                   ('Gate C not-printed', "this value doesn't appear on this page as written — please check"),
                   ('shape mismatch', 'format differs from the 12 confirmed values for this sender — please check'),
                   ('pad-window disagree', 'A wider reading of this box shows 3190124 — please check which is printed'),
                   ('identity fill', engine._TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY)):
    r = mk(note=note)
    check(f'decline (allowlist, {name}): note kept, confidence kept',
          not run(r, LIC, {'invoice_number': KW_WITNESS})
          and r['invoice_number']['validation_note'] == note and r['invoice_number']['confidence'] == 70)

# ── single family / dissent / memory pair / not licensed ──
r = mk()
check('decline: SINGLE family (mapping alone) keeps the hold',
      not run(r, {'invoice_number': {'independent_agree': False, 'winner_family': 'mapping', 'agree': [], 'disagree': []}},
              {'invoice_number': KW_WITNESS}) and r['invoice_number']['validation_note'] == EDGE)
r = mk()
check('decline: a DISAGREEING family keeps the hold (the genuine clip VXS986 vs VXS98624 class)',
      not run(r, {'invoice_number': {'independent_agree': True, 'winner_family': 'mapping', 'agree': ['keyword'],
                                     'disagree': [{'family': 'crop', 'value': '3190124'}]}},
              {'invoice_number': KW_WITNESS}) and r['invoice_number']['validation_note'] == EDGE)
r = mk()
check('decline: memory + ONE page family is not two PAGE families',
      not run(r, {'invoice_number': {'independent_agree': True, 'winner_family': 'memory', 'agree': ['keyword'], 'disagree': []}},
              {'invoice_number': KW_WITNESS}) and r['invoice_number']['validation_note'] == EDGE)
r = mk()
check('decline: hint + keyword (no mapping/crop pair) is not two PAGE families',
      not run(r, {'invoice_number': {'independent_agree': True, 'winner_family': 'hint', 'agree': ['keyword'], 'disagree': []}},
              {'invoice_number': KW_WITNESS}) and r['invoice_number']['validation_note'] == EDGE)

# ── the witness must be un-noted, confident, a DIFFERENT page family, and agree ──
r = mk()
check('decline: the only agreeing witness is itself NOTED (Oracle-B3)',
      not run(r, LIC, {'invoice_number': [dict(KW_WITNESS[0], noted=True)]}) and r['invoice_number']['validation_note'] == EDGE)
r = mk()
check('decline: witness below 80 confidence',
      not run(r, LIC, {'invoice_number': [dict(KW_WITNESS[0], confidence=79)]}) and r['invoice_number']['validation_note'] == EDGE)
r = mk()
check('decline: SAME-family witness (a second mapping read = same recipe) counts for nothing',
      not run(r, LIC, {'invoice_number': [{'stage': '0.5_mapping', 'method': 'template_mapping', 'value': '31901', 'confidence': 95}]})
      and r['invoice_number']['validation_note'] == EDGE)
r = mk()
check('decline: witness value differs',
      not run(r, LIC, {'invoice_number': [dict(KW_WITNESS[0], value='31907')]}) and r['invoice_number']['validation_note'] == EDGE)
r = mk()
check('decline: empty ledger (record says agree but no witness to show) keeps the hold',
      not run(r, LIC, {}) and r['invoice_number']['validation_note'] == EDGE)
# bare `anchor` folds into the keyword family (record-only) — it corroborates a MAPPING winner
r = mk()
check('heal: bare anchor (full-page line) is a keyword-family witness for a mapping winner',
      run(r, LIC, {'invoice_number': [{'stage': '2_anchor', 'method': 'anchor', 'value': '31901', 'confidence': 90}]})
      and r['invoice_number'].get('validation_note') is None)
LIC['invoice_number'].pop('verification_note_cleared', None)

# ── learned shape: fail-closed on no entry, refuse on a violation ──
r = mk()
check('decline: NO learned shape for the scope → refuse (fail-closed)',
      not run(r, LIC, {'invoice_number': KW_WITNESS}, fmt_index={}) and r['invoice_number']['validation_note'] == EDGE)
r = mk(val='INV-31901', extra=None)
kw2 = [dict(KW_WITNESS[0], value='INV-31901')]
check('decline: value violates the learned digits-only shape → refuse',
      not run(r, LIC, {'invoice_number': kw2}) and r['invoice_number']['validation_note'] == EDGE)

# ── a pending alternative reading keeps the doubt open ──
r = mk(extra={'corrected_to': '3190124'})
check('decline: corrected_to carries a DIFFERENT reading → doubt still open',
      not run(r, LIC, {'invoice_number': KW_WITNESS}) and r['invoice_number']['validation_note'] == EDGE
      and r['invoice_number']['corrected_to'] == '3190124')

# ── never the identity / a name / a human method ──
r = {'_supplier_name': SUP, '_document_slug': SLUG,
     'supplier_name': {'value': 'SuperStore', 'method': 'template_mapping_edgecut', 'confidence': 70, 'validation_note': EDGE}}
check('decline: supplier_name never',
      not run(r, {'supplier_name': {'independent_agree': True, 'winner_family': 'mapping', 'agree': ['keyword'], 'disagree': []}},
              {'supplier_name': [{'stage': '1_keyword', 'method': 'keyword', 'value': 'SuperStore', 'confidence': 90}]})
      and r['supplier_name']['validation_note'] == EDGE)
r = {'_supplier_name': SUP, '_document_slug': SLUG,
     'customer_name': {'value': 'Bramblewood Ltd', 'method': 'template_mapping_edgecut', 'confidence': 70, 'validation_note': EDGE}}
check('decline: a name-like field never (no shape rail)',
      not run(r, {'customer_name': {'independent_agree': True, 'winner_family': 'mapping', 'agree': ['keyword'], 'disagree': []}},
              {'customer_name': [{'stage': '1_keyword', 'method': 'keyword', 'value': 'Bramblewood Ltd', 'confidence': 90}]})
      and r['customer_name']['validation_note'] == EDGE)
r = mk(method='template_fixed_edgecut')
check('decline: a memory/human-set method never',
      not run(r, LIC, {'invoice_number': KW_WITNESS}) and r['invoice_number']['validation_note'] == EDGE)

# ── the lift never LOWERS an already-higher field ──
r = mk(conf=95)
run(r, LIC, {'invoice_number': KW_WITNESS})
check('lift is max(): a 95 field stays 95', r['invoice_number']['confidence'] == 95)
LIC['invoice_number'].pop('verification_note_cleared', None)

# ── Oracle conditions (2026-08-26 SIGN-OFF-W/COND) ──
print('G. Oracle C1 — exact learned SKELETON, non-freetext')
r = mk(val='3190')     # a CLIP of 31901: coarse class digits_only passes, the ##### skeleton does not
check('C1: a clip that passes the coarse class but not the learned skeleton → held',
      not run(r, LIC, {'invoice_number': [dict(KW_WITNESS[0], value='3190')]}) and r['invoice_number']['validation_note'] == EDGE)
FMT_FREE = {'class': format_anomaly_checker.FREETEXT, 'separators': frozenset(), 'shapes': frozenset({'#####'})}
r = mk()
check('C1: a FREETEXT learned class → held (no shape rail)',
      not run(r, LIC, {'invoice_number': KW_WITNESS}, fmt_index={SCOPE: FMT_FREE}) and r['invoice_number']['validation_note'] == EDGE)
FMT_NOSHAPES = dict(FMT_DIGITS); FMT_NOSHAPES['shapes'] = frozenset()
r = mk()
check('C1: a class entry WITHOUT skeletons (young scope) → held (fail-closed)',
      not run(r, LIC, {'invoice_number': KW_WITNESS}, fmt_index={SCOPE: FMT_NOSHAPES}) and r['invoice_number']['validation_note'] == EDGE)

print('H. Oracle C2 — totals / money never')
TSCOPE = (SUP.lower(), SLUG, 'total_amount')
FMT_MONEY = _learned_entry(['1,234.56', '99.00', '2,970.60', '594.12', '3,564.72', '120.00'])
r = {'_supplier_name': SUP, '_document_slug': SLUG,
     'total_amount': {'value': '3,564.72', 'method': 'template_mapping_edgecut', 'confidence': 70, 'validation_note': EDGE}}
check('C2: total_amount with an edge-cut note + keyword agree → held (money stays with the validator/_d2)',
      not run(r, {'total_amount': {'independent_agree': True, 'winner_family': 'mapping', 'agree': ['keyword'], 'disagree': []}},
              {'total_amount': [{'stage': '1_keyword', 'method': 'keyword', 'value': '3,564.72', 'confidence': 92}]},
              fmt_index={TSCOPE: FMT_MONEY}) and r['total_amount']['validation_note'] == EDGE)
r = {'_supplier_name': SUP, '_document_slug': SLUG,
     'deposit': {'value': '250.00', 'method': 'template_mapping_edgecut', 'confidence': 70, 'validation_note': EDGE}}
fake_defs = [{'key': 'deposit', 'type': 'currency'}]
os.environ[ENV] = '1'
try:
    fake = types.SimpleNamespace(prefix_index={}, dominant_index={}, confirmed_counts_index={},
        _field_candidates={'deposit': [{'stage': '1_keyword', 'method': 'keyword', 'value': '250.00', 'confidence': 92}]},
        format_class_index={(SUP.lower(), SLUG, 'deposit'): _learned_entry(['250.00', '100.00', '75.50', '10.00'])},
        _try_prefix_confusable_adopt=lambda *a, **k: False,
        _try_verification_doubt_clear=lambda *a, **k: engine.ExtractionEngine._try_verification_doubt_clear(fake, *a, **k),
        _trace=False, _t=lambda *a, **k: None, log=lambda *a, **k: None)
    fired = engine.ExtractionEngine._resolve_corroborated_notes(fake, r, fake_defs,
        {'deposit': {'independent_agree': True, 'winner_family': 'mapping', 'agree': ['keyword'], 'disagree': []}}, None, '')
finally:
    os.environ.pop(ENV, None)
check('C2: a currency-TYPED custom field → held', not fired and r['deposit']['validation_note'] == EDGE)

print('I. Oracle C3 — the re-read mark needs a KEYWORD-family witness')
r = mk(note=REREAD, method='keyword', conf=70, extra={'corrected_to': '31901', 'was_corrected': True})
LIC_KW = {'invoice_number': {'independent_agree': True, 'winner_family': 'keyword', 'agree': ['crop'], 'disagree': []}}
check('C3: keyword winner re-read from a CROP + a crop witness (same recipe) → held',
      not run(r, LIC_KW, {'invoice_number': [{'stage': '2_anchor', 'method': 'anchor_crop', 'value': '31901', 'confidence': 90}]})
      and r['invoice_number']['validation_note'] == REREAD)
r = mk(note=REREAD, extra={'corrected_to': '31901', 'was_corrected': True})
check('C3: mapping winner + KEYWORD witness on the re-read mark → heals',
      run(r, LIC, {'invoice_number': KW_WITNESS}) and r['invoice_number'].get('validation_note') is None)
LIC['invoice_number'].pop('verification_note_cleared', None)

# ── allowlist ↔ write-site mirror (source contract) ──
marks = [m for m, _ in engine._verification_doubt_note_marks()]
check('allowlist is the write-site constants themselves (edge-cut, surrounding-line, trim, re-read head)',
      EDGE in marks and FT in marks and TRIM in marks and engine._REREAD_NOTE_HEAD in marks and len(marks) == 4)
src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'), encoding='utf-8').read()
check('engine write sites use the constants (no stray literal of the trim / re-read notes)',
      src.count("'trimmed to the expected format — please verify'") == 1      # the constant's own definition
      and "f're-read from the page (was \"" not in src)
mp = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'template_mapper.py'), encoding='utf-8').read()
check('template_mapper writes _EDGE_CUT_NOTE / _FT_FALLTHROUGH_NOTE by constant only',
      mp.count('_EDGE_CUT_NOTE') >= 3 and mp.count('_FT_FALLTHROUGH_NOTE') >= 2
      and mp.count("The taught box's edge cuts through the printed value") == 1)
check('the record bucket is the hoisted module function (class F and the emit share one lens)',
      '_corrob_bucket = _corrob_record_bucket' in src and src.count('def _corrob_record_bucket') == 1)

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
