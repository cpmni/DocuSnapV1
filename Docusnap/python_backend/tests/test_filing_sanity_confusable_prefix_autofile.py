"""test_filing_sanity_confusable_prefix_autofile.py — PINs for FILING_SANITY_CONFUSABLE_PREFIX_AUTOFILE
(Oracle SIGN-OFF-W/COND 2026-09-09, docs/designs/CONFUSABLE_PREFIX_AUTOFILE_2026-09-09.md).

The AUTO-FILE half of the confusable case. When confirmed PREFIX history (an axis independent of the crop
read) resolves a one-glyph digit/letter confusable in the ref PREFIX, Gate-C suppresses the note so the field
auto-files. Guarded by the C2 mirror (any_confirmed_shares_head, counter==0 on the page-form head) + fail-safe.

RED-first: `_confusable_prefix_backed` / `_FILING_SANITY_CONFUSABLE_PREFIX_AUTOFILE` /
`ocr_corrector.any_confirmed_shares_head` don't exist on pre-change code.

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_filing_sanity_confusable_prefix_autofile.py
"""
import os, re, sys, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import engine, ocr_corrector

_P = _F = 0
def check(name, ok):
    global _P, _F
    if ok: _P += 1; print(f"  ok  {name}")
    else:  _F += 1; print(f"  FAIL {name}")

E = engine.ExtractionEngine
def W(rv, near, rec_p, bucket=None, sup='Copperfield Electrical', slug='purchase_order', key='po_number'):
    S = types.SimpleNamespace()
    S.confirmed_counts_index = {(sup.lower().strip(), slug.lower().strip(), key): bucket} if bucket else {}
    return E._confusable_prefix_backed(S, rv, near, rec_p, sup, slug, key)

BACKED = {'dominant': 'PO', 'counts': {'PO': 5}}          # ext_total 5, dn 5, share 1.0 → backed
WEAK   = {'dominant': 'PO', 'counts': {'PO': 4}}          # dn 4 < 5 → not backed

print("1. the witness — confirmed prefix history resolves an O/0 PREFIX confusable")
check("PO-22954 vs page P0-22954, dominant PO backed, no second convention → auto-file (True)",
      W('PO-22954', 'P0-22954', BACKED) is True)
check("NOT backed (<5 confirmed prefixes) → False (falls to the soft note)",
      W('PO-22954', 'P0-22954', WEAK) is False)
check("committed read does NOT use the dominant prefix (rv head != dom) → False",
      W('XY-22954', 'X0-22954', BACKED) is False)
check("rec_p absent → False", W('PO-22954', 'P0-22954', None) is False)

print("\n2. PREFIX-region only — a SUFFIX confusable never takes the pass")
# 5/S confusable in the SUFFIX: adopt('PO-5295S','PO')='PO-5295S' != rv 'PO-S295S'? build a clean suffix case:
check("suffix confusable (S/5 after the prefix) → witness False",
      W('PO-S2954', 'PO-52954', BACKED) is False)
check("two-position difference (not _one_confusable via adopt) → False",
      W('PO-22954', 'P0-22955', BACKED) is False)

print("\n3. C2 mirror guard — an established page-form second convention refuses (counter==0)")
check("a confirmed 'P0-…' in scope → page-form head 'P0' is a real series → witness False (no misfile)",
      W('PO-22954', 'P0-22954', BACKED, bucket={'P0-11111': 2}) is False)
check("a confirmed 'PO-…' (same as dom, not the page form) does NOT block → witness True",
      W('PO-22954', 'P0-22954', BACKED, bucket={'PO-99999': 9}) is True)
check("a SINGLE confirmed page-form doc (count 1) still refuses (counter==0, stricter than ratio)",
      W('PO-22954', 'P0-22954', BACKED, bucket={'P0-77777': 1}) is False)

print("\n4. any_confirmed_shares_head (ocr_corrector) — counter==0 head match")
A = ocr_corrector.any_confirmed_shares_head
check("shares the head → True", A({'P0-111': 2}, 'P0') is True)
check("does not share (PO != P0) → False", A({'PO-111': 2}, 'P0') is False)
check("empty bucket → False", A({}, 'P0') is False)
check("count 0 rows ignored → False", A({'P0-111': 0}, 'P0') is False)

print("\n5. confusable-class coverage — every _CONFUSE_TO_DIGIT pair is a prefix-confusable class")
_cov = all(engine._prefix_confusable_class(a, b) for a, b in engine._CONFUSE_TO_DIGIT.items())
check("every _CONFUSE_TO_DIGIT (a→b) is covered by a _PREFIX_CONFUSE_CLASSES class (no orphaned auto-file glyph)", _cov)

print("\n6. wiring / source-order (engine.py) + flag default")
check("flag defaults OFF (byte-identical off)", engine._FILING_SANITY_CONFUSABLE_PREFIX_AUTOFILE is False)
src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'), encoding='utf-8').read()
i_elif  = src.find('elif (_near and _FILING_SANITY_CONFUSABLE_SOFTEN')
i_auto  = src.find('_FILING_SANITY_CONFUSABLE_PREFIX_AUTOFILE\n', i_elif) if i_elif >= 0 else -1
i_auto2 = src.find('self._confusable_prefix_backed(rv, _near', i_elif) if i_elif >= 0 else -1
i_soft  = src.find("filing_sanity_ref_confusable_soften", i_elif) if i_elif >= 0 else -1
check("the prefix-autofile witness sits INSIDE the confusable elif, BEFORE the soft note",
      0 < i_elif < i_auto2 < i_soft)
check("gated on the flag AND the witness method",
      'and self._confusable_prefix_backed(rv, _near, _rec_p' in src)
check("the auto-file branch emits NO validation_note (never calls _note) + a distinct trace event",
      "self._t('filing_sanity_ref_confusable_prefix_autofile'" in src)
# the auto-file branch body (from the witness `if` up to its `else:`) must contain no _note(...) call
_seg = src[i_auto2:src.find('else:', i_auto2)]
check("no _note() inside the auto-file branch (note-free → auto-file-eligible)", "_note(ref_field_key" not in _seg)
check("C1 seam untouched — the arc does NOT fold O/0 into corroboration compare",
      "_corrob_values_agree" not in src[i_auto2:i_soft] and "_cmp_norm" not in src[i_auto2:i_soft])

print("\n7. JS wiring — env bridge + DARK seed OFF + TEST_SWITCH_KEYS")
_h = open(os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'modules', 'processing', 'handler.js'), encoding='utf-8').read()
check("handler.js bridges the setting -> FILING_SANITY_CONFUSABLE_PREFIX_AUTOFILE env",
      "getSetting(db, 'filing_sanity_confusable_prefix_autofile'" in _h and "env.FILING_SANITY_CONFUSABLE_PREFIX_AUTOFILE = '1'" in _h)
_idx = open(os.path.join(os.path.dirname(__file__), '..', '..', 'database', 'index.js'), encoding='utf-8').read()
check("migration 149 seeds it 'false' (DARK)",
      "VALUES ('filing_sanity_confusable_prefix_autofile', 'false')" in _idx and "VALUES (149)" in _idx)
_dk = open(os.path.join(os.path.dirname(__file__), '..', '..', 'database', 'dark_switches.js'), encoding='utf-8').read()
check("dark_switches.js lists the key in TEST_SWITCH_KEYS", "'filing_sanity_confusable_prefix_autofile'" in _dk)

print(f"\n{'ALL PASS' if _F == 0 else str(_F) + ' FAILED'}  ({_P} ok)")
sys.exit(1 if _F else 0)
