"""test_confusion_precedence.py — PINs for CONFUSION_PRECEDENCE 2a (mine the human `corrections` table
into per-scope OCR-confusion FACTS, then correct a NEVER-SEEN serial toward the human-attested form —
REVIEW-BOUND, DARK, mig 119; reggie+gary → Oracle SIGN-OFF-W/COND 2026-09-04, conditions A1-A4).

The pure predicate `format_anomaly_checker.confusion_correct(value, fmt_entry)` corrects ONE position iff:
  • the read has >= 10 alphanumerics, the entry carries supplier-scoped `confusions` AND `value_counts`;
  • the confirmed edit-1 ball around the read is EMPTY (never touch a confirmed pre-value; a confirmed
    rival within one edit is leg-b's / ambiguity's territory — refuse);
  • exactly ONE fact qualifies: same length, `value[pos] == from`, BACKED letter<->digit (5<->8 never),
    support_docs >= 3 AND support_values >= 2 (A2), counter == 0, and the substitution would not turn a
    confirmed literal into ANOTHER confirmed literal (the 752/782 break-check).
Anything else -> None (fail-toward-review). The engine keeps the corrected value REVIEW-BOUND (conf<=70 +
a dedicated both-forms note whose MARK no note-clearer matches).

RED-first: `confusion_correct` / `_CONFUSION_MIN_DOCS` do not exist on pre-change code.

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_confusion_precedence.py
"""
import os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import format_anomaly_checker as fac

_P = _F = 0
def check(name, ok):
    global _P, _F
    if ok: _P += 1; print(f"  ok  {name}")
    else:  _F += 1; print(f"  FAIL {name}")

def fact(length, pos, frm, to, docs=3, values=2, counter=0):
    return {'len': length, 'pos': pos, 'from': frm, 'to': to,
            'support_docs': docs, 'support_values': values, 'counter': counter}

def E(facts, **counts):
    return {'value_counts': dict(counts), 'confusions': list(facts)}

CONF = {'RFH0738865': 7, 'H574240856': 8, 'RFC9508317': 8}   # Print Tracker-style confirmed serials
F_O0 = fact(10, 3, 'O', '0')                                    # "at pos 3 of a 10-char serial, O was corrected to 0"

print("1. THE HEAL — a never-seen serial with a backed slip at a supported position")
r = fac.confusion_correct('RFWO112233', E([F_O0], **CONF))
check("RFWO112233 (not within 1 edit of any confirmed) -> RFW0112233", r and r['value'] == 'RFW0112233')
check("result names the fact (pos/from/to/support) for the both-forms note",
      r and r['pos'] == 3 and r['from'] == 'O' and r['to'] == '0' and r['support_docs'] == 3)
check("digit->letter direction also backed (pos 0 '1'->'I' read as '1' on a letter position)",
      (fac.confusion_correct('1BCDEF2345', E([fact(10, 0, '1', 'I')], **CONF)) or {}).get('value') == 'IBCDEF2345')

print("\n2. A2 support floor + counter — each REFUSES")
check("support_docs 2 (< 3) -> None", fac.confusion_correct('RFWO112233', E([fact(10, 3, 'O', '0', docs=2)], **CONF)) is None)
check("support_values 1 (< 2) -> None", fac.confusion_correct('RFWO112233', E([fact(10, 3, 'O', '0', values=1)], **CONF)) is None)
check("one counter-example (opposite correction) -> None", fac.confusion_correct('RFWO112233', E([fact(10, 3, 'O', '0', counter=1)], **CONF)) is None)

print("\n3. BACKED only — an unbacked digit<->digit fact never fires")
check("5->8 fact (the doc196 human correction class) -> None",
      fac.confusion_correct('752923124N3M9', E([fact(13, 1, '5', '8')], **{'782923124N3M2': 1})) is None)
check("letter<->letter fact -> None", fac.confusion_correct('RFWO112233', E([fact(10, 3, 'O', 'Q')], **CONF)) is None)

print("\n4. Never touch a confirmed pre-value / refuse a confirmed rival within one edit")
check("read IS a confirmed literal -> None", fac.confusion_correct('RFH0738865', E([F_O0], **CONF)) is None)
check("read one edit from a confirmed literal (leg-b territory) -> None",
      fac.confusion_correct('RFHO738865', E([F_O0], **CONF)) is None)
check("read one INDEL from a confirmed literal -> None",
      fac.confusion_correct('RFH07388650', E([fact(11, 3, 'O', '0')], **CONF)) is None)

print("\n5. The break-check (752/782 defuse): a fact that maps one confirmed literal onto another is poison")
trap = {'AB1O2345678': 3, 'AB102345678': 2}      # both confirmed, one backed glyph apart at pos 3
check("fact (11,3,O->0) would turn confirmed 'AB1O2345678' into confirmed 'AB102345678' -> refused",
      fac.confusion_correct('ZZ9O8765432', E([fact(11, 3, 'O', '0')], **trap)) is None)
check("same fact with only ONE of the pair confirmed -> fires (no break)",
      (fac.confusion_correct('ZZ9O8765432', E([fact(11, 3, 'O', '0')], **{'AB102345678': 2})) or {}).get('value') == 'ZZ908765432')

print("\n6. Single-glyph v1 — ambiguity at or across positions refuses")
check("two facts qualify at two positions -> None (v1 single-position only)",
      fac.confusion_correct('RFWO11223S', E([F_O0, fact(10, 9, 'S', '5')], **CONF)) is None)
check("control: ONE target at pos 5 (1->I; no literal carries '1' there) -> fires",
      (fac.confusion_correct('RFW9912233', E([fact(10, 5, '1', 'I')], **CONF)) or {}).get('value') == 'RFW99I2233')
check("two distinct targets at one position (1->I and 1->l) -> None",
      fac.confusion_correct('RFW9912233', E([fact(10, 5, '1', 'I'), fact(10, 5, '1', 'l')], **CONF)) is None)
check("fact length != value length -> None", fac.confusion_correct('RFWO1122334', E([F_O0], **CONF)) is None)
check("value[pos] != from -> None", fac.confusion_correct('RFW9112233', E([F_O0], **CONF)) is None)

print("\n7. Fail-safe inputs")
check("too short (< 10 alnum) -> None", fac.confusion_correct('RFWO11', E([fact(6, 3, 'O', '0')], **CONF)) is None)
check("no confusions -> None", fac.confusion_correct('RFWO112233', {'value_counts': CONF}) is None)
check("no value_counts (cannot run the ball/break checks) -> None", fac.confusion_correct('RFWO112233', {'confusions': [F_O0]}) is None)
check("empty / None entry -> None", fac.confusion_correct('RFWO112233', None) is None and fac.confusion_correct('', E([F_O0], **CONF)) is None)
check("malformed fact rows are ignored, not raised",
      fac.confusion_correct('RFWO112233', E([{'len': 'x'}, {'pos': 3}, None], **CONF)) is None)
check("thresholds are module constants (A2: 3 docs / 2 values)", fac._CONFUSION_MIN_DOCS == 3 and fac._CONFUSION_MIN_VALUES == 2)

print("\n8. Oracle O3a — the MACHINE-confirmed literal union (confusion_literals) widens REFUSAL only")
# The live hazard: W2S8745899 was auto-filed 6x (machine-confirmed) -> absent from value_counts under the
# machine-confirm exclusion, but present in the union handler.js builds. It must read as SEEN.
def EU(facts, lits, **counts):
    return {'value_counts': dict(counts), 'confusions': list(facts), 'confusion_literals': list(lits)}
F_S5 = fact(10, 2, 'S', '5')
check("without the union a machine-confirmed 'W2S8745899' read looks never-seen -> would fire (the hazard)",
      (fac.confusion_correct('W2S8745899', E([F_S5], **CONF)) or {}).get('value') == 'W258745899')
check("with the union, the same read is INSIDE the ball (it IS a known literal) -> None",
      fac.confusion_correct('W2S8745899', EU([F_S5], list(CONF) + ['W2S8745899'], **CONF)) is None)
check("a read one edit from a machine-confirmed literal -> None (rival in the ball)",
      fac.confusion_correct('W2S8745898', EU([F_S5], list(CONF) + ['W2S8745899'], **CONF)) is None)
check("value_counts stays the LICENSING precondition: union present but value_counts empty -> None",
      fac.confusion_correct('RFWO112233', {'value_counts': {}, 'confusions': [F_O0], 'confusion_literals': list(CONF)}) is None)

print("\n9. Oracle O3b — FROM-GLYPH ATTESTATION protects the UNSEEN sibling of a machine-confirmed family")
check("'W2S9999999' (in no channel) with an S->5 fact: a known literal carries 'S' at pos 2 -> fact is poison -> None",
      fac.confusion_correct('W2S9999999', EU([F_S5], list(CONF) + ['W2S8745899'], **CONF)) is None)
check("attestation via a HUMAN literal too: confirmed 'RFHO111111' carries 'O' at pos 3 -> the O->0 fact dies",
      fac.confusion_correct('RFWO112233', E([F_O0], **{**CONF, 'RFHO111111': 2})) is None)
check("no attestation (no known literal has 'S' at pos 2) -> the same fact fires",
      (fac.confusion_correct('W2S9999999', EU([F_S5], list(CONF), **CONF)) or {}).get('value') == 'W259999999')

print("\n10. Oracle O3c — the ball and the attestation are CASE-INSENSITIVE")
check("a confirmed literal stored lower-case still puts the read inside the ball -> None",
      fac.confusion_correct('RFHO738865', E([F_O0], **{'rfh0738865': 7})) is None)
check("attestation is case-folded: confirmed 'rfho111111' (lower o) kills the O->0 fact",
      fac.confusion_correct('RFWO112233', E([F_O0], **{**CONF, 'rfho111111': 2})) is None)

print("\n11. gary G4 — the arc SELF-DISARMS: once the corrected value is confirmed, the same read is leg-b's")
before = fac.confusion_correct('RFWO112233', E([F_O0], **CONF))
after = fac.confusion_correct('RFWO112233', E([F_O0], **{**CONF, 'RFW0112233': 1}))
check("fires before the value is confirmed; refuses (ball non-empty) once it is -> no +confusion_resolved exclusion needed",
      before and before['value'] == 'RFW0112233' and after is None)

print(f"\n{'ALL PASS' if _F == 0 else str(_F) + ' FAILED'}  ({_P} ok)")
sys.exit(1 if _F else 0)
