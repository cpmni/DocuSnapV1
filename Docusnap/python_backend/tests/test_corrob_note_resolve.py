"""test_corrob_note_resolve.py — PINs for the corroboration-driven note resolver
(_resolve_corroborated_notes; the 2026-08-15 held-queue arc; gary → Oracle SIGN-OFF-W/COND).

Five classes, each DEFAULT OFF, each failing TOWARD Review. Fixtures mirror the owner's live
review-queue documents. For EACH class: one HEAL + at least one fail-closed DECLINE control.

Run:  py -3.12 python_backend/tests/test_corrob_note_resolve.py
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


ENVS = ['TEMPLATE_IDENTITY_CORROB_NOTE_SHED', 'REF_DOMINANT_FORMAT_NOTE_DEMOTE',
        'RECON_SHADOW_ATTRIB_NOTE_DEMOTE', 'SNAP_CONFUSABLE_CLEAN_AUTOFILE',
        'NAME_CORROB_SUGGESTION_ADOPT']
MAJ = engine._TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY
cn = engine._cmp_norm


def run(results, corrob, matched_tmpl, env, selfattrs):
    for e in ENVS:
        os.environ.pop(e, None)
    if env:
        os.environ[env] = '1'
    os.environ['GRADUATION_WINDOW'] = '5'
    fake = types.SimpleNamespace(
        prefix_index=selfattrs.get('prefix_index', {}),
        dominant_index=selfattrs.get('dominant_index', {}),
        confirmed_counts_index=selfattrs.get('confirmed_counts_index', {}),
        _field_candidates=selfattrs.get('_field_candidates', {}),
        _trace=False, _t=lambda *a, **k: None, log=lambda *a, **k: None)
    try:
        fired = engine.ExtractionEngine._resolve_corroborated_notes(
            fake, results, {}, corrob, matched_tmpl)
    finally:
        for e in ENVS:
            os.environ.pop(e, None)
        os.environ.pop('GRADUATION_WINDOW', None)
    return fired


# ── A: inferred-company FILL note ───────────────────────────────────────────────
print('A. inferred-company note (corroboration-fed shed)')
LIC_A = {'supplier_name': {'independent_agree': True, 'winner_family': 'memory',
                           'agree': ['crop', 'hint', 'mapping'], 'disagree': []}}
def mk_a(count=107, note=MAJ, val='Silverbeck Cleaning Supplies', corrob=LIC_A):
    return ({'_supplier_name': 'Silverbeck Cleaning Supplies', '_document_slug': 'sales_order',
             'supplier_name': {'value': val, 'method': 'template_identity', 'confidence': 70,
                               'validation_note': note}},
            corrob, {'dominant_supplier_count': count, 'dominant_supplier_total': count})

r, c, t = mk_a()
fired = run(r, c, t, 'TEMPLATE_IDENTITY_CORROB_NOTE_SHED', {})
check('A heal: note shed, method→corroborated @85, value fixed',
      fired and r['supplier_name'].get('validation_note') is None
      and r['supplier_name']['method'] == 'template_identity_corroborated'
      and r['supplier_name']['confidence'] == 85
      and r['supplier_name']['value'] == 'Silverbeck Cleaning Supplies')

r, c, t = mk_a()
check('A OFF (no env): untouched', not run(r, c, t, None, {}) and r['supplier_name'].get('validation_note') == MAJ)

r, c, t = mk_a(count=3)   # not graduated
check('A decline: thin layout (count<window) keeps the note',
      not run(r, c, t, 'TEMPLATE_IDENTITY_CORROB_NOTE_SHED', {}) and r['supplier_name'].get('validation_note') == MAJ)

r, c, t = mk_a(corrob={'supplier_name': {'independent_agree': False, 'winner_family': 'memory', 'agree': ['hint'], 'disagree': []}})
check('A decline: not-licensed (memory+hint only, not independent) keeps the note',
      not run(r, c, t, 'TEMPLATE_IDENTITY_CORROB_NOTE_SHED', {}) and r['supplier_name'].get('validation_note') == MAJ)


# ── B: 1/I rawwitness ref note ──────────────────────────────────────────────────
print('B. rawwitness 1/I ref note (dominant-prefix demote)')
B_NOTE = "the raw scan reads this as 'PI/25/8496' — one character differs (1/I); please check which is printed"
PIDX = {('pelican office interiors -', 'invoice', 'invoice_number'):
        # REAL pipeline shape: 18 'PI' + 3 'P1/…' (the I→1 misread has NO extractable code_prefix, so it
        # sits in `total` (21) but NOT in `counts` — it is the SAME prefix OCR-lost, not a competitor).
        # Share is over EXTRACTABLE prefixes: 18/18 = 1.0 → demote. (`learning_exclude_machine_confirms`
        # shrinks the human sample, so the old `dn/total` bar (18/21=0.857) wrongly declined — the bug
        # Chris's mature reprocess surfaced.)
        {'dominant': 'PI', 'counts': {'PI': 18}, 'total': 21, 'known': {'PI'}}}
def mk_b(val='PI/25/8496', cto='PI/25/8496', idx=PIDX):
    return ({'_supplier_name': 'Pelican Office Interiors -', '_document_slug': 'invoice',
             'invoice_number': {'value': val, 'method': 'template_mapping_rawwitness+corrected',
                                'confidence': 95, 'validation_note': B_NOTE, 'corrected_to': cto}},
            idx)

r, idx = mk_b()
fired = run(r, {}, None, 'REF_DOMINANT_FORMAT_NOTE_DEMOTE', {'prefix_index': idx})
d = r['invoice_number']
check('B heal: note + vacuous corrected_to cleared, _rawwitness stripped, value fixed',
      fired and d.get('validation_note') is None and d.get('corrected_to') is None
      and d['method'] == 'template_mapping+corrected' and d['value'] == 'PI/25/8496')

r, idx = mk_b()
check('B OFF: untouched', not run(r, {}, None, None, {'prefix_index': idx}) and r['invoice_number'].get('validation_note') == B_NOTE)

# a scope with a GENUINE competing EXTRACTABLE prefix 'PX' as dominant → a 'PI' commit ≠ dominant → keep
POISON = {('pelican office interiors -', 'invoice', 'invoice_number'):
          {'dominant': 'PX', 'counts': {'PX': 6, 'PI': 4}, 'total': 10, 'known': {'PX', 'PI'}}}
r, _ = mk_b(val='PI/25/8496')
check('B decline: committed prefix != dominant → keep the note',
      not run(r, {}, None, 'REF_DOMINANT_FORMAT_NOTE_DEMOTE', {'prefix_index': POISON})
      and r['invoice_number'].get('validation_note') == B_NOTE)

# a GENUINE second extractable prefix 'PX' dilutes the dominant BELOW 0.90 among extractable prefixes → keep
THIN = {('pelican office interiors -', 'invoice', 'invoice_number'):
        {'dominant': 'PI', 'counts': {'PI': 5, 'PX': 4}, 'total': 9, 'known': {'PI', 'PX'}}}  # 5/9=0.56 < 0.90
r, _ = mk_b()
check('B decline: a real competing extractable prefix drops share < 0.90 → keep the note',
      not run(r, {}, None, 'REF_DOMINANT_FORMAT_NOTE_DEMOTE', {'prefix_index': THIN})
      and r['invoice_number'].get('validation_note') == B_NOTE)


# ── C: doubly-corroborated total ────────────────────────────────────────────────
print('C. corroborated-total shadow-attribution note (VAT re-verify)')
C_NOTE = "the total 2,419.56 was read the same way by two independent methods; the page's net/subtotal reading £2,016.30 disagrees with it — please check"
LIC_C = {'total': {'independent_agree': True, 'winner_family': 'mapping', 'agree': ['keyword'], 'disagree': []}}
def mk_c(total='2,419.56', sub='£2,016.30', vat='£403.26', corrob=LIC_C):
    return ({'_supplier_name': 'Pelican Office Interiors -', '_document_slug': 'invoice',
             'total': {'value': total, 'method': 'template_mapping', 'confidence': 90, 'validation_note': C_NOTE},
             'subtotal': {'value': sub, 'method': 'shadow_reconcile'},
             'vat_tax': {'value': vat, 'method': 'shadow_reconcile'}}, corrob)

r, c = mk_c()   # 2016.30 * 1.2 == 2419.56
fired = run(r, c, None, 'RECON_SHADOW_ATTRIB_NOTE_DEMOTE', {})
check('C heal: note cleared, +corrob_clear, total value UNCHANGED',
      fired and r['total'].get('validation_note') is None
      and r['total']['method'] == 'template_mapping+corrob_clear' and r['total']['value'] == '2,419.56')

r, c = mk_c()
check('C OFF: untouched', not run(r, c, None, None, {}) and r['total'].get('validation_note') == C_NOTE)

r, c = mk_c(sub='£1,900.00', vat='£99.99')   # neither operand ties to implied net/vat at 20% or 5%
check('C decline: no penny-exact VAT tie → keep the note',
      not run(r, c, None, 'RECON_SHADOW_ATTRIB_NOTE_DEMOTE', {}) and r['total'].get('validation_note') == C_NOTE)

r, c = mk_c(corrob={'total': {'independent_agree': False, 'winner_family': 'mapping', 'agree': [], 'disagree': []}})
check('C decline: total not licensed (single family) → keep the note',
      not run(r, c, None, 'RECON_SHADOW_ATTRIB_NOTE_DEMOTE', {}) and r['total'].get('validation_note') == C_NOTE)


# ── D: charset note on a single-confusable of a single-canonical constant ────────
print('D. account_no ] → 1 (snap to single-canonical constant)')
D_NOTE = 'unexpected characters (]) - please verify'
DIDX = {('pelican office interiors -', 'invoice', 'account_no'): {'dominant': 'ACC-2291', 'known': {'ACC-2291'}}}
DIS_D = {'account_no': {'independent_agree': False, 'winner_family': 'mapping', 'agree': [],
                        'disagree': [{'family': 'hint', 'value': 'ACC-2291'}, {'family': 'memory', 'value': 'ACC-2291'}]}}
def mk_d(val='ACC-229]', idx=DIDX, corrob=DIS_D):
    return ({'_supplier_name': 'Pelican Office Interiors -', '_document_slug': 'invoice',
             'account_no': {'value': val, 'method': 'template_mapping', 'confidence': 70,
                            'validation_note': D_NOTE, 'corrected_to': None}}, idx, corrob)

r, idx, c = mk_d()
fired = run(r, c, None, 'SNAP_CONFUSABLE_CLEAN_AUTOFILE', {'dominant_index': idx})
check('D heal: value→ACC-2291, note cleared, +snap_corrob',
      fired and r['account_no']['value'] == 'ACC-2291' and r['account_no'].get('validation_note') is None
      and r['account_no']['method'] == 'template_mapping+snap_corrob')

r, idx, c = mk_d()
check('D OFF: untouched', not run(r, c, None, None, {'dominant_index': idx}) and r['account_no']['value'] == 'ACC-229]')

# two confirmed values → NOT single-canonical → keep the note
NOTSINGLE = {('pelican office interiors -', 'invoice', 'account_no'): {'dominant': 'ACC-2291', 'known': {'ACC-2291', 'ACC-2292'}}}
r, _, c = mk_d()
check('D decline: >1 confirmed value (not single-canonical) → keep the note',
      not run(r, c, None, 'SNAP_CONFUSABLE_CLEAN_AUTOFILE', {'dominant_index': NOTSINGLE})
      and r['account_no']['value'] == 'ACC-229]')

# hint family absent from the disagree list → keep the note
NOHINT = {'account_no': {'independent_agree': False, 'winner_family': 'mapping', 'agree': [],
                         'disagree': [{'family': 'memory', 'value': 'ACC-2291'}]}}
r, idx, _ = mk_d()
check('D decline: no independent hint family carrying the constant → keep the note',
      not run(r, NOHINT, None, 'SNAP_CONFUSABLE_CLEAN_AUTOFILE', {'dominant_index': idx})
      and r['account_no']['value'] == 'ACC-229]')


# ── E: name suggestion adopt ────────────────────────────────────────────────────
print('E. name suggestion adopt (dominant confirmed literal + keyword witness)')
E_NOTE = 'Suggested name correction: Bramblewood Joinery Ltd'
CCI = {('castellan security systems', 'service_worksheet', 'customer_name'): {cn('Bramblewood Joinery Ltd'): 96}}
def mk_e(field='customer_name', repaired='Bramblewood Joinery Ltd', kw='Bramblewood Joinery Ltd', cci=CCI):
    return ({'_supplier_name': 'Castellan Security Systems', '_document_slug': 'service_worksheet',
             field: {'value': 'Branblewood Joinery Utd', 'method': 'template_mapping+corrected',
                     'confidence': 70, 'validation_note': E_NOTE, 'corrected_to': repaired}},
            cci, {field: [{'method': 'keyword', 'value': kw}]})

r, cci, cands = mk_e()
fired = run(r, {}, None, 'NAME_CORROB_SUGGESTION_ADOPT',
            {'confirmed_counts_index': cci, '_field_candidates': cands})
check('E heal: value ADOPTED to the repaired literal, note cleared, +name_corrob_adopt',
      fired and r['customer_name']['value'] == 'Bramblewood Joinery Ltd'
      and r['customer_name'].get('validation_note') is None
      and r['customer_name']['method'] == 'template_mapping+corrected+name_corrob_adopt')

r, cci, cands = mk_e()
check('E OFF: untouched (still a suggestion)',
      not run(r, {}, None, None, {'confirmed_counts_index': cci, '_field_candidates': cands})
      and r['customer_name']['value'] == 'Branblewood Joinery Utd')

# Southgate → Northgate: the page's own keyword read is 'Southgate', NOT the suggested 'Northgate' → NO adopt
SG_CCI = {('castellan security systems', 'service_worksheet', 'customer_name'): {cn('Northgate Ltd'): 96}}
r, cci, cands = mk_e(repaired='Northgate Ltd', kw='Southgate Ltd', cci=SG_CCI)
check('E decline (Southgate control): keyword read ≠ suggestion → never adopt a DIFFERENT company',
      not run(r, {}, None, 'NAME_CORROB_SUGGESTION_ADOPT',
              {'confirmed_counts_index': cci, '_field_candidates': cands})
      and r['customer_name']['value'] == 'Branblewood Joinery Utd')

# supplier_name is NEVER adopted (identity channel excluded)
SN_CCI = {('castellan security systems', 'service_worksheet', 'supplier_name'): {cn('Bramblewood Joinery Ltd'): 96}}
r, cci, cands = mk_e(field='supplier_name', cci=SN_CCI)
check('E decline: supplier_name (identity) is excluded — never adopted here',
      not run(r, {}, None, 'NAME_CORROB_SUGGESTION_ADOPT',
              {'confirmed_counts_index': cci, '_field_candidates': cands})
      and r['supplier_name']['value'] == 'Branblewood Joinery Utd')


print(f'\n{"ALL PASS" if failed == 0 else str(failed) + " FAILED"}  ({passed} ok)')
sys.exit(0 if failed == 0 else 1)
