"""test_resolve_ref_near_miss.py — PINs for RESOLVE_REF_NEAR_MISS (leg-b of the single-glyph reference
resolver; reggie + gary → Oracle SIGN-OFF-W/COND 2026-09-04, v1 REVIEW-BOUND, DEFAULT OFF).

`unambiguous_near_miss` PRE-FILLS a confirmed reference literal only when the correction is unambiguous
(exactly one confirmed literal one BACKED OCR-slip away, len>=10) — HARDENING near_miss_confirmed, whose
count-ranking would pick the wrong one of two rivals (the 752/782 booby-trap). The engine co-locates it at
the near_miss_confirmed site so it inherits the <=70 cap; it keeps a DEDICATED note whose mark is NOT
matched by any note-clearer, so trust.js holds the doc (never auto-files).

RED-first: `unambiguous_near_miss` / `_RESOLVE_REF_NEAR_MISS` / `_REF_RESOLVE_NOTE` do not exist on
pre-change code, so this file fails to import against it.

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_resolve_ref_near_miss.py
"""
import os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import format_anomaly_checker as fac
from extraction import engine

_P = _F = 0
def check(name, ok):
    global _P, _F
    if ok: _P += 1; print(f"  ok  {name}")
    else:  _F += 1; print(f"  FAIL {name}")

def E(**counts):
    return {'value_counts': dict(counts)}

print("1. UNIQUE backed-confusable neighbour -> snap (the heal)")
uniq = E(**{'782923124N3M2': 4, 'H574240856': 8, 'RFC9508317': 8})
check("B->8 backed slip, sole neighbour, len 13 -> '782923124N3M2'",
      fac.unambiguous_near_miss('7B2923124N3M2', uniq) == '782923124N3M2')
check("O->0 backed slip elsewhere -> snaps",
      fac.unambiguous_near_miss('H574240856'.replace('0', 'O'), E(**{'H574240856': 8}) ) == 'H574240856')

print("\n2. THE 752/782 BOOBY-TRAP — every case REFUSES (both confirmed, one glyph apart)")
trap = E(**{'752923124N3M2': 3, '782923124N3M2': 1})
check("read '782…' (itself confirmed) -> None (ambiguous ball)", fac.unambiguous_near_miss('782923124N3M2', trap) is None)
check("read '752…' (itself confirmed) -> None (read in C)",       fac.unambiguous_near_miss('752923124N3M2', trap) is None)
check("garble '762…' (1 edit from BOTH) -> None",                 fac.unambiguous_near_miss('762923124N3M2', trap) is None)

print("\n3. Guards — each REFUSES")
check("UNBACKED digit<->digit slip (3<->8), even sole neighbour -> None",
      fac.unambiguous_near_miss('732923124N3M2', E(**{'782923124N3M2': 4})) is None)
check("too short (< 10 alnum) -> None", fac.unambiguous_near_miss('7B2', uniq) is None)
check("no value_counts -> None", fac.unambiguous_near_miss('7B2923124N3M2', {}) is None)
check("read is itself the sole confirmed literal -> None (nothing to correct)",
      fac.unambiguous_near_miss('782923124N3M2', E(**{'782923124N3M2': 4})) is None)
check("an INDEL-distance confirmed neighbour also makes it ambiguous -> None",
      # read ABCDEF1234: 'ABCDEFI234' is a backed 1<->I sub, 'ABCDEF12345' is a +1 insertion — BOTH within
      # one edit, so the ball is not a singleton -> refuse (indels count, a subs-only ball would miss it).
      fac.unambiguous_near_miss('ABCDEF1234', E(**{'ABCDEFI234': 4, 'ABCDEF12345': 2})) is None)
check("two confirmed BACKED neighbours (best_n trap) -> None (not the higher-count one)",
      fac.unambiguous_near_miss('AB1234567X', E(**{'AB1234567I': 9, 'AB123456TX': 2})) is None)

print("\n4. The resolver note is NOT sweepable by any note-clearer (Oracle bilingual condition)")
note = engine._REF_RESOLVE_NOTE.format('7B2923124N3M2', '782923124N3M2', 'B→8; confirmed 4 times before')
check("Python: _is_verification_doubt_note(note) is False (arm-F allowlist)",
      engine._is_verification_doubt_note(note) is False)
# JS classFixService.CLEARABLE_NOTE_MARKS — parsed live so a JS reword is caught here too
_js = open(os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'services', 'classFixService.js'),
           encoding='utf-8').read()
_blk = re.search(r'CLEARABLE_NOTE_MARKS\s*=\s*Object\.freeze\(\[(.*?)\]\)', _js, re.S).group(1)
_marks = re.findall(r"""['"](.+?)['"]""", _blk)
check("parsed the 4 JS clearable marks", len(_marks) == 4)
check("JS: no CLEARABLE_NOTE_MARK is a substring of the resolver note",
      all(m not in note for m in _marks))
check("no known arm/near-miss PREFIX starts the note",
      not any(note.startswith(p) for p in ('unexpected characters', 'Suggested name correction:', 'looks like a misread')))

print("\n5. The machine-literal UNION + human licensing + attestation (RELOCATION, Oracle C3/C5 — 2026-09-04 late)")
# Refusal reads the fullest evidence (human ∪ MACHINE literals via `confusion_literals`); licensing stays human.
def EU(lits, **counts):
    return {'value_counts': dict(counts), 'confusion_literals': list(lits)}
check("a MACHINE literal one edit from the read makes the ball size 2 -> None",
      fac.unambiguous_near_miss('AB1234567X', EU(['AB1234567I', 'AB123456TX'], **{'AB1234567I': 4})) is None)
check("a machine-ONLY target (not in value_counts) -> None (no human attestation — the deliberate dead zone)",
      fac.unambiguous_near_miss('1625802868', EU(['1G25802868', 'ZZ9999999999'], **{'ZZ9999999999': 1})) is None)
check("no confusion_literals -> identical to the value_counts-only behaviour (fallback)",
      fac.unambiguous_near_miss('7B2923124N3M2', uniq) == '782923124N3M2')
check("casefold: a lower-case confirmed literal still licenses (T->7 backed slip), returned in ORIGINAL case",
      fac.unambiguous_near_miss('AB123456TX', E(**{'ab1234567x': 4})) == 'ab1234567x')
check("two case-variants of the target in value_counts -> None (case-ambiguous)",
      fac.unambiguous_near_miss('AB123456TX', E(**{'ab1234567x': 4, 'AB1234567X': 1})) is None)
check("FROM-GLYPH ATTESTATION: a known literal carrying the READ's glyph at the diff position -> None",
      fac.unambiguous_near_miss('1625802868', E(**{'1G25802868': 2, '1725802868': 1})) is None)
check("…and the same read with no such literal -> the heal ('1G25802868')",
      fac.unambiguous_near_miss('1625802868', E(**{'1G25802868': 2, 'RFH0738865': 9})) == '1G25802868')
check("the wiring lives in _apply_ref_resolvers (see test_ref_resolvers_wiring.py); the old text-branch site is gone",
      'def _apply_ref_resolvers' in open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'), encoding='utf-8').read()
      and '_ua = (format_anomaly_checker.unambiguous_near_miss' not in open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'), encoding='utf-8').read())
check("flag default OFF (byte-identical off)", engine._RESOLVE_REF_NEAR_MISS is False)

print(f"\n{'ALL PASS' if _F == 0 else str(_F) + ' FAILED'}  ({_P} ok)")
sys.exit(1 if _F else 0)
