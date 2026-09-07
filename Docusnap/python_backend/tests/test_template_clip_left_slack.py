"""tests/test_template_clip_left_slack.py — TEMPLATE_CLIP_COMMIT_LEFT_SLACK + the honest inline-disagree note
(2026-09-07). The leading-glyph MIRROR of the Oracle-signed trailing edge slack (2026-08-06): a taught box that
cuts the FIRST character reads a confusable ('lNV-19842') against the double-witnessed inline 'INV-19842' and
fell through to `inline_disagree_flag` — the correct inline value capped @70 with the factually-false "differs
from the usual format" sentence (the owner's E2; 44/147 docs on the healed arm). Same legs as the trailing slack.
Run: py -3.12 tests/test_template_clip_left_slack.py   (from python_backend/)
"""
import os
import sys
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))
os.environ['TEMPLATE_CODE_FRAG_CLEAN'] = '1'
os.environ['TEMPLATE_CLIP_COMMIT'] = '1'
os.environ['TEMPLATE_CLIP_COMMIT_EDGE_SLACK'] = '1'
os.environ['TEMPLATE_CLIP_COMMIT_LEFT_SLACK'] = '1'
from extraction import template_mapper as tm                       # noqa: E402
from extraction import format_anomaly_checker as fac               # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1


ANCHOR = 'Invoice No.'


def entry_for(*samples):
    return fac.build_format_class_index([{'supplier_name': 's', 'document_type': 'd', 'field_key': 'invoice_number',
                                          'sample_values': list(samples), 'value_counts': {v: 3 for v in samples}}]) \
              .get(('s', 'd', 'invoice_number'))


INV = entry_for('INV-11111', 'INV-22222', 'INV-33333', 'INV-19842')


def inv_lookup(fk):
    return INV


def pick(rigid, inline, fl=inv_lookup, pl=None, ladder=True, locate='INV-19842', rigid_conf=44, inline_conf=91):
    return tm._pick_fuller_code(rigid, rigid_conf, inline, inline_conf, ANCHOR, 'alphanumeric', None,
                                field_key='invoice_number', format_lookup=fl, provisional_lookup=pl,
                                locate_token=locate, inline_from_ladder=ladder)


print("switch armed:")
check("flags ON", tm._CLIP_COMMIT_LEFT_SLACK_ON is True and tm._CLIP_COMMIT_EDGE_SLACK_ON is True)

print("\nleft-edge slack HEAL ('lNV-19842' -> 'INV-19842'):")
r = pick('lNV-19842', 'INV-19842')
check("heals CLEAN: value INV-19842, _heal clip_commit_left, no shapewarn, no note",
      r and r.get('value') == 'INV-19842' and r.get('_heal') == 'clip_commit_left'
      and 'shapewarn' not in r.get('method', '') and 'validation_note' not in r)
r = pick('|NV-19842', 'INV-19842')
check("a '|' leading glyph is stripped by _code_norm → a pure suffix → the OLDER unclip heal (unchanged road)", r and r.get('_heal') == 'unclip')
r = pick('iNV-19842', 'INV-19842')
check("a lowercase 'i' is case-folded by _code_norm → identical cores → keep the rigid (None)", r is None)
r = pick('1NV-19842', 'INV-19842')
check("a '1' leading confusable (a real glyph substitution) heals via the left slack", r and r.get('_heal') == 'clip_commit_left')

print("\nthe legs (each alone refuses the heal → the flag path):")
flag = lambda x: x and 'shapewarn' in x.get('method', '')
check("near-tie (gap < margin) → FLAGGED", flag(pick('lNV-19842', 'INV-19842', rigid_conf=80, inline_conf=90)))
check("None rigid_conf → FLAGGED", flag(pick('lNV-19842', 'INV-19842', rigid_conf=None)))
check("2-glyph leading diff ('l|V-19842') → FLAGGED (slack is exactly 1 glyph)", flag(pick('l|V-19842', 'INV-19842')))
check("interior mismatch ('lNV-18842') → FLAGGED (D1 preserved)", flag(pick('lNV-18842', 'INV-19842')))
check("length differs AND first glyph wrong ('lV-19842', not a suffix) → not slack → FLAGGED", flag(pick('lV-19842', 'INV-19842')))
check("NO shape evidence → FLAGGED (fail-toward-review)", flag(pick('lNV-19842', 'INV-19842', fl=None)))
check("locate token sides with the box ('lNV-19842') → FLAGGED", flag(pick('lNV-19842', 'INV-19842', locate='lNV-19842')))
check("inline not from the ladder → FLAGGED", flag(pick('lNV-19842', 'INV-19842', ladder=False)))
check("shared suffix below the prefix floor ('lNV' vs 'INV', 3 chars) → FLAGGED", flag(pick('lNV', 'INV', locate='INV', fl=entry_for('INV', 'ABC', 'DEF'))))

print("\nthe pure suffix still heals as unclip (unchanged):")
r = pick('NV-19842', 'INV-19842')
check("'NV-19842' -> unclip", r and r.get('_heal') == 'unclip')

print("\nthe honest note on the flag path:")
r = pick('lNV-19842', 'INV-19842', rigid_conf=80, inline_conf=90)
check("note names BOTH reads and says the box may be clipping the first character",
      r and "'lNV-19842'" in r.get('validation_note', '') and "'INV-19842'" in r.get('validation_note', '')
      and 'clipping the first character' in r.get('validation_note', ''))
check("…and no longer claims a format difference", r and 'usual format' not in r.get('validation_note', ''))
check("…still capped ≤70 (review-bound)", r and r.get('confidence', 99) <= 70)

print("\nOFF = byte-identical to today:")
tm._CLIP_COMMIT_LEFT_SLACK_ON = False
r = pick('lNV-19842', 'INV-19842')
check("switch OFF: 'lNV-19842' vs 'INV-19842' → FLAGGED (no heal)", flag(r) and r.get('_heal') == 'inline_disagree_flag')
tm._CLIP_COMMIT_LEFT_SLACK_ON = True
tm._INLINE_DISAGREE_HONEST_NOTE_ON = False
r = pick('lNV-19842', 'INV-19842', rigid_conf=80, inline_conf=90)
check("kill INLINE_DISAGREE_HONEST_NOTE=0 → the old shape-warn sentence", r and 'usual format' in r.get('validation_note', ''))
tm._INLINE_DISAGREE_HONEST_NOTE_ON = True

print("\nsource pins:")
src = open(os.path.join(_HERE, '..', 'extraction', 'template_mapper.py'), encoding='utf-8').read()
check("left slack defaults OFF", "_CLIP_COMMIT_LEFT_SLACK_ON = os.environ.get('TEMPLATE_CLIP_COMMIT_LEFT_SLACK', '0') != '0'" in src)
check("honest note defaults ON with a kill", "_INLINE_DISAGREE_HONEST_NOTE_ON = os.environ.get('INLINE_DISAGREE_HONEST_NOTE', '1') != '0'" in src)
check("the left leg mirrors the trailing leg's guards", "ni[1:] == _core2[1:] and ni[:1] != _core2[:1]" in src and "inline_conf >= rigid_conf + _CLIP_COMMIT_EDGE_SLACK_MARGIN" in src)

print(f"\n{'PASS' if not fails else 'FAIL'} -- {fails} failure(s)")
sys.exit(1 if fails else 0)
