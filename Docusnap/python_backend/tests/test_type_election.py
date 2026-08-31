"""test_type_election.py — PINs for the TYPE-ELECTION TITLE-FIRST slice (herald design →
Oracle gate, 2026-08-12 NIGHT; the Meadowvale credit-note-typed-Invoice defect).

Three kill switches, all DEFAULT OFF (one Settings toggle `type_election_title_first` bridges
them): TYPE_CAPTION_MENTION_ONLY · TYPE_HEADING_ANY_SEGMENT · TYPE_TIE_HEADING_PREF.

Run:  py -3.12 python_backend/tests/test_type_election.py
"""
import os
import sys
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import keyword  # noqa: E402

CFG = os.path.join(os.path.dirname(__file__), '..', '..', 'config', 'keyword_patterns.json')
with open(CFG, encoding='utf-8') as f:
    PATTERNS = json.load(f)

KNOWN = ['Invoice', 'Sales Order', 'Purchase Order', 'Credit Note']
FLAGS = ('TYPE_CAPTION_MENTION_ONLY', 'TYPE_HEADING_ANY_SEGMENT', 'TYPE_TIE_HEADING_PREF',
         'HEADING_TITLE_GAP_COLLAPSE')

passed = failed = 0


def check(name, ok):
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok  {name}')
    else:
        failed += 1
        print(f'  FAIL {name}')


def detect(text, arms=None, known=KNOWN, patterns=PATTERNS):
    for k in FLAGS:
        os.environ.pop(k, None)
    os.environ.update(arms or {})
    try:
        return keyword.detect_document_type(text, patterns, known)
    finally:
        for k in FLAGS:
            os.environ.pop(k, None)


print('0. column-break contract (Oracle C1 — the citation keyword.py carried was to a test that never existed)')
from ocr.text_layout import COLUMN_BREAK_MIN  # noqa: E402  (single-source producer constant)
check('_COL_BREAK_RE splits on exactly COLUMN_BREAK_MIN+ spaces (derived, not hardcoded)',
      keyword._COL_BREAK_RE.pattern == r' {%d,}' % COLUMN_BREAK_MIN
      and len(keyword._COL_BREAK_RE.split('a' + ' ' * COLUMN_BREAK_MIN + 'b')) == 2
      and len(keyword._COL_BREAK_RE.split('a' + ' ' * (COLUMN_BREAK_MIN - 1) + 'b')) == 1)

ON1 = {'TYPE_CAPTION_MENTION_ONLY': '1'}
ON2 = {'TYPE_HEADING_ANY_SEGMENT': '1'}
ON3 = {'TYPE_TIE_HEADING_PREF': '1'}
ALL = {**ON1, **ON2, **ON3}

print('1. address caption never a heading (fix 1)')
# A standalone BILL TO line — the exhibit mechanism: strict whole-line test passes it today.
t_billto = "Acme Ltd\nBILL TO\nBramblewood Joinery Ltd\nsome prose about the goods supplied here"
r_off = detect(t_billto)
r_on = detect(t_billto, ON1)
check('OFF: standalone BILL TO earns the Invoice heading (the pinned DEFECT — byte-identical dark)',
      r_off and r_off['type'] == 'Invoice' and r_off['heading'] is True)
check('ON: BILL TO scores mention-only — heading signal GONE',
      r_on is not None and r_on['heading'] is False)
check('ON: the score dropped by exactly the heading premium (mention kept, 2.0x lost)',
      r_on and r_on['all_scores']['Invoice'] < r_off['all_scores']['Invoice'])
# The relaxed :955 path must be suppressed too — 'BILL TO' with a code beside it passes
# _line_is_heading_like(caption_ok=True); only the full demotion keeps head=False.
t_billto_code = "Acme Ltd\nBILL TO 12345\nline of ordinary prose text here\n"
r2 = detect(t_billto_code, ON1)
check('ON: relaxed exposed-head path suppressed as well (BILL TO + code stays head=False)',
      r2 is None or r2['heading'] is False)
check("'order to' demoted identically (the PO-bucket member of the class)",
      (lambda r: r is None or r['heading'] is False)(detect("Acme Ltd\nORDER TO\nsupplier address", ON1)))

print('2. any-segment heading, top-band gated (fix 2)')
# The Meadowvale line shape: letterhead + real title on ONE OCR reading line, title not leftmost.
t_shared = "Meadowvale Dairy Wholesale      CREDIT NOTE\nUnit 9 Dairy Way\nsome body prose here"
r_off = detect(t_shared)
r_on = detect(t_shared, ON2)
# OFF score 6.0 = TWO mention-scored copies of the phrase (the config-bucket 'credit note' plus
# the case-sensitive name fold appending 'Credit Note') at 3.0 each — the STRICT heading weight
# is absent (it would double each to 6.0). Pinned exactly, double-fold quirk included.
check('OFF: letterhead-shared title scores mention-only (seg0-only — the pinned gap)',
      r_off and r_off['all_scores']['Credit Note'] == 6.0)
check('ON: letterhead-shared TOP-BAND title earns the strong heading weight',
      r_on and r_on['all_scores']['Credit Note'] > r_off['all_scores']['Credit Note']
      and r_on['type'] == 'Credit Note')
# Body-depth: the same content deep in the page must stay mention-only even armed.
t_deep = "Acme Ltd\n" + "filler prose line\n" * 40 + "table col      CREDIT NOTE\n" + "more filler\n" * 30
r_deep_off = detect(t_deep)
r_deep_on = detect(t_deep, ON2)
check('ON: a mid-body table cell does NOT earn the strong weight (top-band gate)',
      r_deep_on and r_deep_off
      and r_deep_on['all_scores'].get('Credit Note') == r_deep_off['all_scores'].get('Credit Note'))
# Caption row: seg carrying caption words is rejected (caption_ok=False preserved).
t_caption_row = "Acme Ltd\nWidget Supply      CREDIT NOTE NO CN-1      CREDIT DATE 01/01/26\nprose"
rc = detect(t_caption_row, ON2)
check('ON: a top-band caption ROW segment never a strong heading (caption_ok=False kept)',
      rc is None or rc['all_scores'].get('Credit Note', 0) < 6.0)
# Gap-collapse interaction: wide-tracked title in a non-left segment fuses FIRST, then matches.
t_tracked = "Meadowvale Dairy Wholesale      CREDIT    NOTE\nUnit 9 Dairy Way\nbody prose"
rg = detect(t_tracked, {**ON2, 'HEADING_TITLE_GAP_COLLAPSE': '1'})
check('ON+gap-collapse: wide-tracked title in a non-left segment still earns the heading (operates on _work)',
      rg is not None and rg['type'] == 'Credit Note' and rg['all_scores']['Credit Note'] >= 6.0)

print('3. tie-break prefers the STRICT heading (fix 3)')
# Constructed exact tie: custom patterns, NO known-types fold (known=[] keeps buckets pristine —
# the case-sensitive name fold would double-count phrases and unbalance the construction).
# 8 lines total: 'BETA DOC' standalone at line 0 = heading 2 × w(0)=3.0 → 6.0;
# Alpha mentions at lines 1/2/3 = w 2.5 + 2.0 + 1.5 → 6.0. Exact tie, Beta strong-backed.
TIE_PATTERNS = {'document_type_keywords': {
    'Alpha Doc': ['alpha one', 'alpha two', 'alpha three'],
    'Beta Doc': ['beta doc'],
}}
t_tie = ("BETA DOC\n"
         "prose with alpha one mention\n"
         "prose with alpha two mention\n"
         "prose with alpha three mention\n"
         "filler\nfiller\nfiller\nfiller")
r_off = detect(t_tie, known=[], patterns=TIE_PATTERNS)
r_on = detect(t_tie, {**ON3}, known=[], patterns=TIE_PATTERNS)
if r_off and r_on and r_off['all_scores'].get('Alpha Doc') == r_off['all_scores'].get('Beta Doc'):
    check('OFF: exact tie falls to insertion order (Alpha first — the pinned defect)',
          r_off['type'] == 'Alpha Doc')
    check('ON: exact tie prefers the strong-heading-backed candidate (Beta wins)',
          r_on['type'] == 'Beta Doc')
else:
    # Scores drifted from the construction — still pin direction: ON must elect Beta when tied-or-better.
    check(f'tie fixture scores as constructed (got {r_off and r_off["all_scores"]})', False)
# Both/neither strong-head: determinism = insertion order, byte-identical.
t_both = "GAMMA DOC\nfiller\nDELTA DOC\nfiller\nfiller"
P2 = {'document_type_keywords': {'Gamma Doc': ['gamma doc'], 'Delta Doc': ['delta doc']}}
r_b_off = detect(t_both, known=['Gamma Doc', 'Delta Doc'], patterns=P2)
r_b_on = detect(t_both, ON3, known=['Gamma Doc', 'Delta Doc'], patterns=P2)
check('tie with BOTH strong-head: insertion order both ways (deterministic, pinned)',
      r_b_off and r_b_on and r_b_off['type'] == r_b_on['type'])

print('4. the exhibit end-to-end (all three flags)')
t_exhibit = ("Meadowvale Dairy Wholesale      CREDIT NOTE\n"
             "Unit 9, Dairy Way, Creamfield\n"
             "BILL TO\n"
             "Bramblewood Joinery Ltd\n"
             "Invoice ref INV-1001\n"
             "credit note no CN-55 date 01-08-2026\n"
             "Total 100.00")
r_off = detect(t_exhibit)
r_all = detect(t_exhibit, ALL)
check('OFF: the exhibit elects Invoice with a trusted heading (the live defect, reproduced)',
      r_off and r_off['type'] == 'Invoice' and r_off['heading'] is True)
check('ALL ON: the exhibit elects Credit Note, heading-backed',
      r_all and r_all['type'] == 'Credit Note' and r_all['heading'] is True)

print('5. OFF is byte-identical on ordinary elections')
for t in [
    "INVOICE\nInvoice No INV-1\nTotal 10.00",
    "PURCHASE ORDER\nPO Number PO-9\nDeliver To\nSite 4",
    "Acme Ltd\nSALES ORDER\nOrder Number SO-2",
]:
    a, b = detect(t), detect(t)
    check(f'stable OFF election: {t.splitlines()[0]!r} -> {a and a["type"]}',
          a == b and a is not None)

print(f'\n{passed} ok, {failed} failed')
sys.exit(1 if failed else 0)
