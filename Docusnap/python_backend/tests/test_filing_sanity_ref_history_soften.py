"""test_filing_sanity_ref_history_soften.py — PINs for FILING_SANITY_REF_HISTORY_SOFTEN
(Oracle SIGN-OFF-W/COND 2026-09-04). Extends the mig-111 live soften to the HISTORY path: when the
committed reference is an EXACT confirmed literal whose ONLY page form is a BACKED one-glyph confusable
(O<->0, S<->5…) and there is NO live agreement (the correct value came from a +corrected adopt), swap the
scary "doesn't appear on this page as written" note for the truthful soft one — but ONLY when the page
form is not itself confirmed AND the literal is the UNIQUE confirmed value one backed-glyph from it (C1
unambiguity). Auto-file-neutral (a note either way -> review-bound); note-text-only.

RED-first: `_history_soften_ok` / `_FILING_SANITY_REF_HISTORY_SOFTEN` don't exist on pre-change code.

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_filing_sanity_ref_history_soften.py
"""
import os, re, sys, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import engine

_P = _F = 0
def check(name, ok):
    global _P, _F
    if ok: _P += 1; print(f"  ok  {name}")
    else:  _F += 1; print(f"  FAIL {name}")

E = engine.ExtractionEngine
S = types.SimpleNamespace()   # the unbound-method receiver (the helper reads nothing off self)
def ok(rv, near, counts):
    return E._history_soften_ok(S, rv, near, {'value_counts': counts})

print("1. C1 unambiguity — _history_soften_ok")
check("doc238: rv 'RFH0738865' confirmed, page 'RFHO738865' backed O<->0, unique -> True",
      ok('RFH0738865', 'RFHO738865', {'RFH0738865': 7, 'H574240856': 8, 'RFC9508317': 8}) is True)
check("page form is ITSELF a confirmed literal -> False (ambiguous)",
      ok('RFH0738865', 'RFHO738865', {'RFH0738865': 7, 'RFHO738865': 2}) is False)
check("TWO confirmed literals one backed-glyph from the page form -> False (two-neighbours)",
      # page 'SO2345': '5O2345' (S->5 pos0) AND 'S02345' (O->0 pos1) both confirmed, one backed-glyph away
      ok('5O2345', 'SO2345', {'5O2345': 3, 'S02345': 2}) is False)
check("rv is NOT a confirmed literal -> False",
      ok('ZZZ0738865', 'ZZZO738865', {'RFH0738865': 7}) is False)
check("page form is an UNBACKED one-glyph diff (5<->8) -> not a backed neighbour -> False",
      ok('752923124N3M2', '782923124N3M2', {'752923124N3M2': 3}) is False)
check("no value_counts -> False (fail toward the scary note)",
      ok('RFH0738865', 'RFHO738865', {}) is False)
check("the sole backed neighbour is a DIFFERENT confirmed literal, not rv -> False",
      ok('OTHER00000', 'RFHO738865', {'RFH0738865': 7}) is False)

print("\n2. the backed-confusable partition (why 5<->8 keeps the scary note / live path)")
check("_nearest_confusable_page_token finds the backed O<->0 page form",
      engine._nearest_confusable_page_token('serial RFHO738865 total', 'RFH0738865') == 'RFHO738865')
check("_nearest_confusable_page_token returns '' for an UNBACKED 5<->8 page form (history path never fires)",
      engine._nearest_confusable_page_token('serial 782923124N3M2 total', '752923124N3M2') == '')

print("\n3. reuses the (already non-sweepable) soften note")
note = engine._FILING_SANITY_SOFTEN_NOTE.format('RFH0738865', 'RFHO738865')
check("history path writes the SOFT note (no ABSENT mark)", engine._FILING_SANITY_ABSENT_MARK not in note)
check("Python: soft note not sweepable by _is_verification_doubt_note", engine._is_verification_doubt_note(note) is False)
_js = open(os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'services', 'classFixService.js'), encoding='utf-8').read()
_marks = re.findall(r"""['"](.+?)['"]""", re.search(r'CLEARABLE_NOTE_MARKS\s*=\s*Object\.freeze\(\[(.*?)\]\)', _js, re.S).group(1))
check("JS: no CLEARABLE_NOTE_MARK is a substring of the soft note", all(m not in note for m in _marks))

print("\n4. wiring / source-order (engine.py) + flag default")
check("flag defaults OFF (byte-identical off)", engine._FILING_SANITY_REF_HISTORY_SOFTEN is False)
src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'), encoding='utf-8').read()
i_soft = src.find('_witness = (self._ref_corrob_soften')
i_hist = src.find('_hist = bool(_ent) and self._history_soften_ok')
i_scary = src.find('_FILING_SANITY_ABSENT_MARK} — the page reads it as')
check("history path sits in the ELSE branch, before the scary note", 0 < i_soft < i_hist < i_scary)
check("history path is gated on the flag", '_FILING_SANITY_REF_HISTORY_SOFTEN and (not _ct or _ct == rv)' in src)
check("C5: only fires when the value is settled (corrected_to empty or == rv) — renderer _neitherOnPage moot",
      "not _ct or _ct == rv" in src)
check("history path writes the SOFT note + a distinct trace event, keeps it review-bound",
      "_FILING_SANITY_SOFTEN_NOTE.format(rv, _near)" in src and "filing_sanity_ref_history_soften" in src)

print(f"\n{'ALL PASS' if _F == 0 else str(_F) + ' FAILED'}  ({_P} ok)")
sys.exit(1 if _F else 0)
