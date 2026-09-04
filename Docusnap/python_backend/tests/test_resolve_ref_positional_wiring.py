"""test_resolve_ref_positional_wiring.py — engine-wiring PINs for RESOLVE_REF_POSITIONAL (leg-a; Phase 2,
REVIEW-BOUND). The pure pieces are pinned in test_ref_positional_consensus.py; this locks the engine
integration: the flag defaults OFF (byte-identical), the note is non-sweepable in BOTH languages, the
helper fails safe, and the source-order (leg-a AFTER leg-b, BEFORE the near_miss suggestion, gated on the
ref role) is preserved so a future edit can't move it or let it auto-file.

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_resolve_ref_positional_wiring.py
"""
import os, re, sys, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import engine

_P = _F = 0
def check(name, ok):
    global _P, _F
    if ok: _P += 1; print(f"  ok  {name}")
    else:  _F += 1; print(f"  FAIL {name}")

print("1. flag + note")
check("flag defaults OFF (byte-identical when off)", engine._RESOLVE_REF_POSITIONAL is False)
note = engine._REF_POSITIONAL_NOTE.format('752923124N3M2', '782923124N3M2')
check("note names both the read and the consensus", '752923124N3M2' in note and '782923124N3M2' in note)

print("\n2. the note is NOT sweepable by any note-clearer (Oracle bilingual)")
check("Python: _is_verification_doubt_note(note) is False", engine._is_verification_doubt_note(note) is False)
_js = open(os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'services', 'classFixService.js'),
           encoding='utf-8').read()
_marks = re.findall(r"""['"](.+?)['"]""",
                    re.search(r'CLEARABLE_NOTE_MARKS\s*=\s*Object\.freeze\(\[(.*?)\]\)', _js, re.S).group(1))
check("JS: no CLEARABLE_NOTE_MARK is a substring of the leg-a note", all(m not in note for m in _marks))
check("leg-a mark differs from the leg-b mark (distinct census/clearer identity)",
      engine._REF_POSITIONAL_NOTE_MARK != engine._REF_RESOLVE_NOTE_MARK)
check("no arm/near-miss PREFIX starts the note",
      not any(note.startswith(p) for p in ('unexpected characters', 'Suggested name correction:', 'looks like a misread')))

print("\n3. _ref_positional_value fails safe")
fake = types.SimpleNamespace(_field_candidates={}, _s05_read_geom={}, _s05_pages=None,
                             _s05_mappings=[], _code_witnesses={}, _trace=False, _t=lambda *a, **k: None)
check("no candidates -> None (never raises)",
      engine.ExtractionEngine._ref_positional_value(fake, 'reference_number') is None)
fake2 = types.SimpleNamespace(_field_candidates={'reference_number': [
            {'value': '752923124N3M2', 'confidence': 85, 'method': 'anchor_crop', 'stage': '2', 'box': None},
            {'value': '782923124N3M2', 'confidence': 70, 'method': 'keyword', 'stage': '1', 'box': None}]},
        _s05_read_geom={}, _s05_pages=None, _s05_mappings=[], _code_witnesses={},
        _trace=False, _t=lambda *a, **k: None)
check("2 disagreeing sources but NO crop box (no read_geom) -> None (can't re-slice)",
      engine.ExtractionEngine._ref_positional_value(fake2, 'reference_number') is None)

print("\n4. wiring pins (engine.py) — RELOCATED to _apply_ref_resolvers (2026-09-04 late; the full set lives in test_ref_resolvers_wiring.py)")
src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'), encoding='utf-8').read()
_seg = src[src.find('def _apply_ref_resolvers'):src.find('def _apply_confusion_precedence')]
check("leg-a is gated on the flag AND the ref role inside the relocated pass", '_RESOLVE_REF_POSITIONAL and key == ref_field_key' in _seg)
check("leg-a is a SUGGESTION: corrected_to + <=70 + the dedicated note; no was_corrected, no method suffix (Oracle C2/S3)",
      "'corrected_to':    pc" in _seg and "_REF_POSITIONAL_NOTE.format(sval, pc)" in _seg
      and "'was_corrected'" not in _seg and "+ref_positional" not in _seg)
check("only writes when the consensus DIFFERS from the committed read", "if pc and pc != sval:" in _seg)
check("the old text-branch site is gone", '_pc = (self._ref_positional_value(key)' not in src)
check("witnesses are reset per-doc and kept OUT of the corroboration ledger",
      "self._code_witnesses = {}" in src and "self._code_witnesses[key] = wits" in src)

print(f"\n{'ALL PASS' if _F == 0 else str(_F) + ' FAILED'}  ({_P} ok)")
sys.exit(1 if _F else 0)
