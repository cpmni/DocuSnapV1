"""test_recon_note_demote.py — PINs for RECON_TOTAL_NOTE_DEMOTE (corroboration STEP 3,
slice 2 — the adjusted-total MONEY note; gary design → Oracle SIGN-OFF-W/COND C1-C5,
2026-08-13; DEFAULT OFF).

Slice-2 boundary vs slice 1 (dates): eligibility = EXACT equality with the hoisted
RECON_TOTAL_ADJUSTED_NOTE (no method gate possible — the pick commits the CANDIDATE's method);
witness = crop-side ledger read, un-noted, >=80, PENNY-EXACT (no tolerance) AND sign-agreeing
(Oracle C1 — parse_amount is sign-blind); arithmetic leg = total_reconciles(...) is True
(None/False keep the note — it is a stability re-check, NOT independence; the crop leg carries
the independence load); NO CONFIDENCE CHANGE AT ALL (deliberately below slice 1's E2 posture —
money has no shape rail, currency is self-validating).

Run:  py -3.12 python_backend/tests/test_recon_note_demote.py
"""
import os
import re
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


NOTE = engine.RECON_TOTAL_ADJUSTED_NOTE
SUB_NOTE = 'adjusted to the subtotal that balances against the total — please verify'


def mk_results(total_key='total', value='3,564.72', note=NOTE, conf=90,
               method='keyword', with_components=True, sub_note=None):
    """The Nordwind 0021-4 exhibit shape: picked total + the components that prove it.
    2,970.60 + 594.12 = 3,564.72 (reconciles exactly)."""
    r = {total_key: {'value': value, 'confidence': conf, 'method': method,
                     'validation_note': note, 'was_corrected': True, 'corrected_to': value}}
    if with_components:
        r['subtotal'] = {'value': '2,970.60', 'confidence': 88, 'method': 'keyword'}
        if sub_note:
            r['subtotal']['validation_note'] = sub_note
        r['vat_tax'] = {'value': '594.12', 'confidence': 88, 'method': 'keyword'}
    return r


def mk_witness(value='3,564.72', method='template_mapping', stage='0.5_mapping',
               located=False, noted=False, conf=90):
    # located=False DEFAULT deliberately: the mapping family is located BY CONSTRUCTION and the
    # ledger bit is never set for it (the slice-1 carve-out, live-proven on Nordwind) — the
    # default witness shape here must license without the flag.
    return {'value': value, 'method': method, 'stage': stage,
            'located': located, 'noted': noted, 'confidence': conf,
            'authoritative': True, 'box': None}


def run(results, cands, total_key='total', armed=True, displaced=None):
    if armed:
        os.environ['RECON_TOTAL_NOTE_DEMOTE'] = '1'
    else:
        os.environ.pop('RECON_TOTAL_NOTE_DEMOTE', None)
    fake = types.SimpleNamespace(_field_candidates={total_key: cands},
                                 _recon_displaced=displaced or {},
                                 _trace=False, _t=lambda *a, **k: None,
                                 log=lambda *a, **k: None)
    corrob = {}
    try:
        fired = engine.ExtractionEngine._demote_recon_total_corroborated_note(
            fake, results, corrob)
    finally:
        os.environ.pop('RECON_TOTAL_NOTE_DEMOTE', None)
    return fired, corrob


print('1. the exhibit — adjusted total with a penny-exact crop witness + reconciling arithmetic')
r = mk_results()
fired, corrob = run(r, [mk_witness()], displaced={'total': '3,864.72'})
d = r['total']
check('demote fired', fired is True)
check('note / was_corrected / corrected_to all cleared (trust.js blocks on note OR corrected_to)',
      'validation_note' not in d and 'was_corrected' not in d and 'corrected_to' not in d)
check("method gains '+corrob_clear' (lineage visible)", d['method'] == 'keyword+corrob_clear')
nd = (corrob.get('total') or {}).get('note_demoted') or {}
check('dissent survives: note_demoted carries witness AND the DISPLACED pre-swap read (C1 parity)',
      nd.get('witness_method') == 'template_mapping' and nd.get('rejected_read') == '3,864.72'
      and nd.get('arithmetic') is True)
check('independent_agree NEVER written (C4 — behavioural, the floor-lowering back door stays shut; '
      'the slice-1 structural window pin is DEAD, Oracle 2026-08-13 — this is the real guard)',
      'independent_agree' not in (corrob.get('total') or {}))

print('2. NO confidence minting — PINNED AT ZERO (deliberately below the slice-1 E2 posture)')
r = mk_results(conf=90)
fired, _ = run(r, [mk_witness()])
check('conf 90 stays exactly 90 after demote', fired and r['total']['confidence'] == 90)
r = mk_results(conf=78)
fired, _ = run(r, [mk_witness()])
check('conf 78 stays exactly 78 — below the 88 floor, doc still routes to review; a future '
      '"align with slice 1" lift goes RED here', fired and r['total']['confidence'] == 78)

print('3. witness equality — penny-exact, format-tolerant, sign-strict (Oracle C1)')
r = mk_results(value='3,564.72')
fired, _ = run(r, [mk_witness(value='£3,564.72')])
check('currency symbol / thousands-comma formatting differences still match', fired is True)
r = mk_results(value='3,564.72')
fired, _ = run(r, [mk_witness(value='3564.72')])
check('separator-free witness still matches (parse_amount both sides)', fired is True)
r = mk_results(value='3,564.72')
fired, _ = run(r, [mk_witness(value='3,564.71')])
check('one penny off → REFUSED (NO tolerance on the witness leg — the 2% tolerance belongs to '
      'the arithmetic leg only)', fired is False and r['total'].get('validation_note') == NOTE)
r = mk_results(value='-3,564.72')
fired, _ = run(r, [mk_witness(value='3,564.72')])
check('SIGN pin (Oracle C1 BLOCKING): committed -3,564.72 vs unsigned witness → REFUSED '
      '(parse_amount is sign-blind; 4th member of the 08-07 sign-blind comparator family)',
      fired is False)
r = mk_results(value='(3,564.72)')
fired, _ = run(r, [mk_witness(value='3,564.72')])
check('accounting-parens committed vs unsigned witness → REFUSED (same sign rule)', fired is False)
r = mk_results()
fired, _ = run(r, [mk_witness(value='no amount here')])
check('an unparseable witness → note stands', fired is False)

print('4. witness quality bars (B3, inherited from slice 1)')
r = mk_results()
fired, _ = run(r, [mk_witness(noted=True)])
check('a NOTED witness never licenses', fired is False)
r = mk_results()
fired, _ = run(r, [mk_witness(conf=79)])
check('a sub-80 witness never licenses', fired is False)
r = mk_results()
fired, _ = run(r, [mk_witness(method='anchor_crop', stage='2_anchor', located=False)])
check('an unlocated CROP-family witness never licenses (mapping exempt by construction)',
      fired is False)
r = mk_results()
fired, _ = run(r, [mk_witness(method='anchor_crop', stage='2_anchor', located=True)])
check('a LOCATED crop-family witness licenses', fired is True)

print('5. independence bars — keyword/hint NEVER license (crop-side family only)')
r = mk_results()
fired, _ = run(r, [mk_witness(method='keyword', stage='1_keyword')])
check('keyword-family same-value @90 → note STANDS (full-page text is not pixel-independent)',
      fired is False)
r = mk_results()
fired, _ = run(r, [mk_witness(method='hint_fill', stage='2.5_hint')])
check('hint agreement → note STANDS (memory never licenses)', fired is False)

print('6. arithmetic leg — a stability RE-CHECK that must be True (fail toward review)')
r = mk_results(with_components=False)
fired, _ = run(r, [mk_witness()])
check('no subtotal → total_reconciles is None → note STANDS (PIN: None is not True)',
      fired is False and r['total'].get('validation_note') == NOTE)
r = mk_results()
r['subtotal']['value'] = '1,000.00'   # 1,000 + 594.12 nowhere near 3,564.72
fired, _ = run(r, [mk_witness()])
check('components off (>2%) → note STANDS', fired is False)

print('7. eligibility bars')
r = mk_results(note=NOTE + ' Second unrelated warning.')
fired, _ = run(r, [mk_witness()])
check('a COMPOSED note is ineligible (exact equality only — C3 pattern)', fired is False)
r = mk_results(note='the amount may be negative on the page — check the sign before filing')
fired, _ = run(r, [mk_witness()])
check('the credit-sign note is ineligible (different rail, never unified)', fired is False)
r = mk_results(note=SUB_NOTE)
fired, _ = run(r, [mk_witness()])
check('the SUBTOTAL note string on the total is ineligible (never unified into the constant)',
      fired is False)
r = mk_results(total_key='total_amount')
fired, _ = run(r, [mk_witness()], total_key='total_amount')
check('canonical total_amount key demotes (alias walk, canonical first)', fired is True)
# Oracle C4: the live install's real money key is the CUSTOM field 'total' (08-09 NIGHT) — the
# exhibit tests above already run on it; this pins that an install with NEITHER key is inert.
r = {'grand_total': {'value': '3,564.72', 'confidence': 90, 'method': 'keyword',
                     'validation_note': NOTE},
     'subtotal': {'value': '2,970.60', 'confidence': 88, 'method': 'keyword'},
     'vat_tax': {'value': '594.12', 'confidence': 88, 'method': 'keyword'}}
fired, _ = run(r, [mk_witness()], total_key='grand_total')
check('an ALIASED custom key (grand_total) demotes — eligibility reuses the writer\'s alias walk '
      '(Oracle C4: a total_amount-only gate would be structurally inert on the founding install)',
      fired is True)

print('8. PASS-2 consequence — the subtotal note SURVIVES a total demote (pinned trade-off)')
r = mk_results(sub_note=SUB_NOTE)
fired, _ = run(r, [mk_witness()])
check('total demoted, subtotal note untouched (the any-note guard keeps the doc held — '
      'slice 2 buys PASS-2 docs one less field-flag, NOT an auto-file)',
      fired is True and r['subtotal'].get('validation_note') == SUB_NOTE
      and 'validation_note' not in r['total'])

print('9. flag OFF = byte-identical')
r = mk_results()
before = dict(r['total'])
fired, corrob = run(r, [mk_witness()], armed=False)
check('dark: nothing fires, results untouched, record untouched',
      fired is False and r['total'] == before and corrob == {})

print('10. structural pins (shipped source)')
eng_src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'),
               encoding='utf-8').read()
check('single-source constant: the literal appears exactly once (the definition); both write '
      'sites + the demoter reference RECON_TOTAL_ADJUSTED_NOTE',
      eng_src.count('adjusted to the total that balances against the line amounts') == 1
      and eng_src.count('RECON_TOTAL_ADJUSTED_NOTE') >= 4)
check('eligibility is EXACT equality in the demoter (a startswith/in refactor goes RED)',
      '!= RECON_TOTAL_ADJUSTED_NOTE' in eng_src)
check('the subtotal note stays a literal (never unified — doubly circular in PASS 2)',
      eng_src.count(SUB_NOTE) == 1)
check('displaced-value stash reset per doc beside the candidate ledger (Oracle C3 — batch '
      'pollution corrupts the retro-audit key)',
      re.search(r"_field_candidates = \{\}[\s\S]{0,600}_recon_displaced = \{\}", eng_src)
      or re.search(r"_recon_displaced = \{\}[\s\S]{0,600}_field_candidates = \{\}", eng_src))
check('B1 recompute shared: slice-2 result feeds the same recompute block (no inline or — '
      'short-circuit would skip slice 2)',
      re.search(r"_d2 = self\._demote_recon_total_corroborated_note", eng_src)
      and re.search(r"if _d1 or _d2:", eng_src))
check('sign agreement via validator._is_negative_value (raw-string based — never a normalised '
      'comparator, the 08-07 dead-guard lesson)',
      re.search(r"_demote_recon_total_corroborated_note[\s\S]{0,3000}_is_negative_value", eng_src))

print(f'\n{passed} ok, {failed} failed')
sys.exit(1 if failed else 0)
