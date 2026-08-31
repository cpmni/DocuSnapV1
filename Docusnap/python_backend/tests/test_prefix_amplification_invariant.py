"""test_prefix_amplification_invariant.py — the pin that killed Slice 1 of the machine-pointer design.

Oracle SPLIT ruling, 2026-08-19. A design proposed unioning MACHINE-confirmed values into
`prefix_index` under an "amplify, never introduce" rule: admit a machine value only when its prefix
is already attested by a human-confirmed value. That rule governs WHICH prefixes may enter. It does
not govern COUNTS or TOTAL — and those are what the guards actually read.

THE INVARIANT this file exists to hold:
  1. a REFUSAL test may use the fullest evidence available (human + all machine);
  2. a LICENSING / rewrite-permission test may use human-attested evidence only;
  3. NEITHER may use evidence that a rewrite created;
  4. an index serving BOTH roles may never be amplified — split the input, not the switch.

`prefix_index` serves both roles: `_flag_prefix_outlier` (refusal), the clipped-suffix reconcile and
REF_LENGTH_WITNESS_RECONCILE (rewrite PERMISSION, default ON), the B demote and the P adopt lane.
Amplifying it to arm one consumer silently disarms the others.

The JS twin — the refusal half over `prefix_outlier.js` — is in
database/modules/test_rewrite_marker_exclusion.js. This file holds the REWRITE-PERMISSION half,
because `prefix_confirmed` is what the rewrite lane reads.

Run: py -3.12 tests/test_prefix_amplification_invariant.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import ocr_corrector  # noqa: E402

passed = failed = 0


def check(name, ok):
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok  {name}')
    else:
        failed += 1
        print(f'  FAIL {name}')


# The scenario, and it is an ordinary one: a scope whose codes run 'DN', where a skewed page once
# read 'IN' and a human confirmed it, and machine files then carried that same misread.
# 'IN' IS human-attested, so "amplify, never introduce" admits every one of them.
#
# SIZING MATTERS, and getting it wrong hides the defect. The two failure modes compete: if the
# machine rows are a large fraction of the scope, the dominant share falls under the 0.80 arming
# bar and the scope DISARMS (failure B) before the immunisation (failure A) can be observed — the
# guard is off either way, but for a different reason and with a different fix. A big established
# scope keeps the dominant comfortably over 0.80 while the misread count still clears its own
# proportional exemption bar, which is failure A in isolation. Both are pinned, separately.
HUMAN = {'DN/26/%d' % i: 1 for i in range(200)}
HUMAN['IN/26/9'] = 1
MACHINE = {'IN/26/1%d' % i: 1 for i in range(30)}


def rec(counts):
    return ocr_corrector.build_prefix_index([{
        'supplier_name': 'Delta Northern', 'document_type': 'invoice',
        'field_key': 'invoice_number', 'value_counts': counts,
    }]).get(('delta northern', 'invoice', 'invoice_number'))


rec_today = rec(HUMAN)
rec_amplified = rec({**HUMAN, **MACHINE})

print('the refusal half — is_prefix_outlier')
check('TODAY the guard catches the stray misread: IN is an outlier in a DN scope',
      rec_today is not None and ocr_corrector.is_prefix_outlier('IN', rec_today) is True)
check('AMPLIFIED it goes SILENT on the prefix it exists to catch — 31 sightings clear its own '
      'exemption bar max(3, ceil(0.10 * total)). A shape-valid misread then auto-files with no note',
      rec_amplified is not None and ocr_corrector.is_prefix_outlier('IN', rec_amplified) is False)

print('\nthe REWRITE-PERMISSION half — prefix_confirmed (this is the dangerous one)')
check('TODAY: DN is confirmed, IN is not', ocr_corrector.prefix_confirmed('DN', rec_today) is True
      and ocr_corrector.prefix_confirmed('IN', rec_today) is False)
check('AMPLIFIED: IN becomes a CONFIRMED prefix, so the ref-length witness lane (default ON) may '
      'write it onto a value with nothing else agreeing. The union does not merely fail to help — '
      'it hands out a rewrite permission that history alone never earned',
      ocr_corrector.prefix_confirmed('IN', rec_amplified) is True)

print('\nwhy "amplify, never introduce" does not save it')
check('the rule is honoured throughout — IN was human-attested before any machine row was admitted, '
      'so nothing was INTRODUCED. The harm is done entirely by counts and total, which the rule '
      'does not govern', 'IN' in (rec_today.get('known') or set()))

print('\nthe dilution leg — no misread required, only volume')
# A perfectly clean second series, machine-heavy, drags the dominant share under the arming bar.
diluted = rec({**{'DN/26/%d' % i: 1 for i in range(40)},
               **{'ZZ/26/%d' % i: 1 for i in range(15)}})
check('a scope that arms today DISARMS when the denominator grows — buildPrefixIndex needs the '
      'dominant at >= 0.80 of the total, so every field in that scope silently stops being checked',
      rec_today is not None and diluted is None)

print('\nthe refusal side is a DIFFERENT question and may see everything')
# both_forms_established is a refusal: more evidence can only make it answer "established" and
# stand an arm DOWN. Unioning machine counts there is safe, and is the slice that was signed off.
check('machine evidence on the refusal side only ever adds a veto, never a permission',
      ocr_corrector.both_forms_established(HUMAN, 'IN') is False
      and ocr_corrector.both_forms_established({**HUMAN, **MACHINE}, 'IN') is True)

print(f'\n{passed} ok, {failed} failed')
sys.exit(1 if failed else 0)
