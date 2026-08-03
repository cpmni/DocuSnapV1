#!/usr/bin/env python3
"""tests/test_ref_length_outlier.py — S-B ref digit-run LENGTH profile pins (Oracle
SIGN-OFF-W/COND 2026-08-01; kill REF_LENGTH_OUTLIER_GUARD, built OFF).

The length-FOLDED learned shape is blind to digit accretion/duplication BY DESIGN (the fold
cured the INV999->INV1000 rollover withhold — do NOT revert; pinned here by construction:
these cases pass the shape and only THIS guard sees them). Flag-only, value never touched.

PINNED TRADE-OFF: a genuine rollover ('INV-1000' vs a uniform 3-digit history) FLAGS its
first ~_PREFIX_ACCEPT_MIN docs then self-heals — exempting +1-length would reopen the
accretion hole.

    cd python_backend && PYTHONIOENCODING=utf-8 py -3.12 tests/test_ref_length_outlier.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['REF_LENGTH_OUTLIER_GUARD'] = '1'

from extraction import ocr_corrector as oc
from extraction.engine import ExtractionEngine

CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                      'config', 'keyword_patterns.json')

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def formats(counts, sup='Ridgeway Plant Hire', dt='delivery_note', key='delivery_number'):
    return [{'supplier_name': sup, 'document_type': dt, 'field_key': key,
             'sample_values': list(counts)[:12], 'value_counts': counts}]


print('§1 profile extraction (pure)')
check("'DN-24408' -> (5,)", oc.digit_run_profile('DN-24408') == (5,))
check("'7602-1354-4' -> (4,4,1)", oc.digit_run_profile('7602-1354-4') == (4, 4, 1))
check("'INV-121' -> (3,)", oc.digit_run_profile('INV-121') == (3,))
check('no digits -> None', oc.digit_run_profile('nope') is None)

print('§2 index dominance + support bars')
UNI = {f'DN-{20000 + i}': 1 for i in range(12)}                     # 12× (5,)
idx = oc.build_length_index(formats(UNI))
rec = oc.lookup_length(idx, 'delivery_number', 'Ridgeway Plant Hire', 'delivery_note')
check('uniform scope indexes with dominant (5,)', rec and rec['dominant'] == (5,))
check('4 confirms -> below DOMINANT_MIN_COUNT -> no index',
      oc.build_length_index(formats({f'DN-{20000 + i}': 1 for i in range(4)})) == {})
MIXED = {**{f'DN-{20000 + i}': 1 for i in range(6)}, **{f'DN-{200000 + i}': 1 for i in range(4)}}
check('60/40 mixed scope DISARMED (no ≥80% share)', oc.build_length_index(formats(MIXED)) == {})
check('exact-scope lookup only (no fallback)',
      oc.lookup_length(idx, 'delivery_number', 'Other Supplier', 'delivery_note') is None)

print('§3 outlier decision + self-heal')
check('#33 class: (5,) read vs (3,) dominant is an outlier',
      oc.is_length_outlier((5,), {'dominant': (3,), 'counts': {(3,): 12}, 'total': 12}))
check('dup class: (6,) vs (5,) dominant is an outlier', oc.is_length_outlier((6,), rec))
check('matching profile is not', not oc.is_length_outlier((5,), rec))
check('self-heal: a new length with 8 confirms clears the ABS bar',
      not oc.is_length_outlier((6,), {'dominant': (5,), 'counts': {(5,): 40, (6,): 8}, 'total': 48}))
check('a 2-confirm stray still flags',
      oc.is_length_outlier((6,), {'dominant': (5,), 'counts': {(5,): 40, (6,): 2}, 'total': 42}))
check('multi-run: run COUNT change is an outlier ((4,4,1) vs (4,4))',
      oc.is_length_outlier((4, 4), {'dominant': (4, 4, 1), 'counts': {(4, 4, 1): 10}, 'total': 10}))

print('§4 engine pass')


def run(value, method='anchor_crop', note=None, env_on=True, fmts=None,
        cands=None, authoritative=False, witness_on=True, pg_on=False):
    os.environ['REF_LENGTH_OUTLIER_GUARD'] = '1' if env_on else '0'
    os.environ['REF_LENGTH_WITNESS_RECONCILE'] = '1' if witness_on else '0'
    os.environ['PREFIX_GARBLE_ADOPT'] = '1' if pg_on else '0'
    eng = ExtractionEngine(config_path=CONFIG)
    eng.set_formats(fmts if fmts is not None else formats(UNI))
    if cands:
        eng._field_candidates = {'delivery_number': cands}
    row = {'value': value, 'confidence': 92, 'method': method}
    if authoritative:
        row['authoritative'] = True
    if note:
        row['validation_note'] = note
    results = {'delivery_number': row}
    eng._flag_ref_length_outlier(results, [{'key': 'delivery_number', 'type': 'text'}],
                                 'Ridgeway Plant Hire', 'delivery_note')
    return results['delivery_number']


r = run('DN-244088')
check('accretion read FLAGS (cap 69 + note)', r['confidence'] == 69 and 'digits' in r['validation_note'])
check('value untouched', r['value'] == 'DN-244088')
check('conforming read untouched', 'validation_note' not in run('DN-24408'))
check("PIN rollover trade-off: 'DN-1000' (4,) vs (5,) dominant FLAGS until confirmed",
      run('DN-1000')['confidence'] == 69)
check('taught anchor NOT exempt (doctrine: the teach fixed the position, not the value)',
      run('DN-244088', method='anchor_registration')['confidence'] == 69)
check('keyword_override exempt (prefix-outlier parity)',
      'validation_note' not in run('DN-244088', method='keyword_override'))
check('note precedence: pre-existing note preserved',
      run('DN-244088', note='S-A spoke')['validation_note'] == 'S-A spoke')
check('kill OFF untouched', 'validation_note' not in run('DN-244088', env_on=False))

print('§5 doubled-digit fingerprint (pure — the doc-297 artifact signature)')
from extraction import suffix_reconcile as sr
check("'WS-1904' + witness 'WS-11904' -> fingerprint (adjacent-identical insert)",
      sr.doubled_digit_fingerprint('WS-1904', 'WS-11904'))
check("insert not adjacent-identical -> NO ('DN-1904'/'DN-19204')",
      not sr.doubled_digit_fingerprint('DN-1904', 'DN-19204'))
check("PIN multi-edit dup pair routes to flag, never adopt ('PO-643224' winner / 'PO-64334' witness)",
      not sr.doubled_digit_fingerprint('PO-643224', 'PO-64334'))
check('winner longer than witness -> NO',
      not sr.doubled_digit_fingerprint('WS-11904', 'WS-1904'))
check("substitution -> NO ('PO-24729'/'PO-34729')",
      not sr.doubled_digit_fingerprint('PO-34729', 'PO-24729'))
check("PIN rollover-drift structural reject ('INV-1000' winner / 'INV-999' witness)",
      not sr.doubled_digit_fingerprint('INV-1000', 'INV-999'))
check('alpha insertion is not the artifact',
      not sr.doubled_digit_fingerprint('WS-1904', 'WSS-1904'))

print('§6 length-witness reconciliation lanes (Oracle W/COND 2026-08-01)')
KW_WIT = {'stage': '1_keyword', 'value': 'DN-24408', 'method': 'keyword', 'confidence': 85}
r5 = run('DN-2408', cands=[KW_WIT])            # (4,) outlier; witness (5,) passes; fingerprint 2408->24408 ('4' doubled? 24408 vs 2408: insert '4' adjacent to '4' YES)
check('ADOPT lane: passive winner + fingerprint witness -> value healed at witness conf',
      r5['value'] == 'DN-24408' and r5['confidence'] == 85 and r5.get('length_reconciled') is True
      and 'validation_note' not in r5)
r6 = run('DN-2408', cands=[KW_WIT], authoritative=True)
check('AUTHORITATIVE winner -> FLAG-WITH-SUGGESTION (value kept, corrected_to = witness)',
      r6['value'] == 'DN-2408' and r6['confidence'] == 69
      and r6.get('corrected_to') == 'DN-24408' and 'another check read' in r6['validation_note'])
NOVEL = {**{f'INV-{100 + i}': 1 for i in range(12)}}                    # dominant (3,)
r7 = run('INV-1000', cands=[{'stage': '1_keyword', 'value': 'INV-999', 'method': 'keyword', 'confidence': 90}],
         fmts=formats(NOVEL))
check('PIN rollover-drift: profile-passing stale witness NEVER adopts (flag + suggestion only)',
      r7['value'] == 'INV-1000' and r7['confidence'] == 69 and r7.get('corrected_to') == 'INV-999')
r8 = run('DN-2408', cands=[KW_WIT], witness_on=False)
check('witness kill OFF -> plain S-B flag, no suggestion',
      r8['value'] == 'DN-2408' and r8['confidence'] == 69 and not r8.get('corrected_to'))
r9 = run('DN-2408', cands=[{'stage': '2.6_late_anchor', 'value': 'DN-24408', 'method': 'anchor', 'confidence': 90}])
check('same-eye stages are no witness (plain flag)',
      r9['confidence'] == 69 and not r9.get('corrected_to'))

print('§7 prefix-garble adopt lane (Oracle SIGN-OFF-W/COND 2026-08-03; the Northgate PO-17039 class)')
# Winner = the confirmed prefix mis-read into a short non-alpha garble ('DN-24408' -> tight-crop
# '0-24408'); the distinct-stage keyword peer carries the confirmed prefix + exact tail @93.
PG_WIT = {'stage': '1_keyword', 'value': 'DN-24408', 'method': 'keyword', 'confidence': 93}
r10 = run('0-24408', method='template_mapping', cands=[PG_WIT], fmts=formats(UNI), pg_on=True)
check('ADOPT: prefix-garble winner + confirmed-prefix witness (all_prefixed scope) -> healed @ witness conf',
      r10['value'] == 'DN-24408' and r10['confidence'] == 93
      and r10.get('length_reconciled') is True and 'validation_note' not in r10)
# LOAD-BEARING negative: ONE numeric-leading confirmed value flips all_prefixed False -> DECLINE.
MIXED_LEAD = {**UNI, '0-55555': 1}
r11 = run('0-24408', method='template_mapping', cands=[PG_WIT], fmts=formats(MIXED_LEAD), pg_on=True)
check('DECLINE (all_prefixed False — a numeric-leading ref was confirmed) -> FLAG-WITH-SUGGESTION',
      r11['value'] == '0-24408' and r11['confidence'] == 69 and r11.get('corrected_to') == 'DN-24408')
# kill OFF -> byte-identical (plain S-B flag + suggestion, no adopt).
r12 = run('0-24408', method='template_mapping', cands=[PG_WIT], fmts=formats(UNI), pg_on=False)
check('PREFIX_GARBLE_ADOPT OFF -> no adopt (flag + suggestion only)',
      r12['value'] == '0-24408' and r12['confidence'] == 69 and r12.get('corrected_to') == 'DN-24408')
# AUTHORITATIVE winner (⊕ re-teach) declines the adopt -> FLAG (07-26 Tier-A pin preserved).
r13 = run('0-24408', method='template_mapping', cands=[PG_WIT], fmts=formats(UNI), pg_on=True, authoritative=True)
check('AUTHORITATIVE winner declines prefix-garble adopt -> FLAG (07-26 Tier-A pin)',
      r13['value'] == '0-24408' and r13['confidence'] == 69 and r13.get('corrected_to') == 'DN-24408')
# A DIFFERENT-tail witness is NOT the same token -> never adopted (identity guard).
r14 = run('0-24408', method='template_mapping',
          cands=[{'stage': '1_keyword', 'value': 'DN-99999', 'method': 'keyword', 'confidence': 93}],
          fmts=formats(UNI), pg_on=True)
check('different-tail witness is NOT a prefix-garble adopt (winner kept, flagged)',
      r14['value'] == '0-24408' and r14['confidence'] == 69)

print()
if fails:
    print(f'{fails} CHECK(S) FAILED')
    sys.exit(1)
print('ALL PINS PASS')
