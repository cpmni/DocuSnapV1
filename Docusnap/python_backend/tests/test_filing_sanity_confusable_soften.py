"""test_filing_sanity_confusable_soften.py — PINs for FILING_SANITY_CONFUSABLE_SOFTEN
(Oracle C1 SIGN-OFF 2026-09-09, docs/designs/CONFUSABLE_REREAD_ARC_2026-09-09.md).

The two 09-03/04 Gate-C softeners both need CONFIRMED HISTORY (a repeated confirmed literal), which a UNIQUE
reference (a fresh PO/invoice number) never has. So a first-time-correct crop read that the low-res whole-page
pass mis-segments as a one-glyph digit/letter confusable (O<->0, I<->1…) still shipped the scary "doesn't appear
on this page as written" note (the phantom Format-check card; live exhibit doc #45 'PO-22954' vs whole-page
'P0-22954'). When ON, Gate-C writes the truthful SOFT note for that case WITHOUT the confirmed-literal
requirement — CASE-FOLDS EXCLUDED (Oracle). Auto-file-NEUTRAL by construction (still a validation_note →
review-bound; the mirror case, page-form digit is the true value, is NEVER silently filed).

The AUTO-FILE half is a SEPARATE arc (prefix-history axis) — Oracle SEND BACK on the same-bitmap re-read lever.

RED-first: `_one_digit_letter_confusable` / `_FILING_SANITY_CONFUSABLE_SOFTEN` don't exist on pre-change code.

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_filing_sanity_confusable_soften.py
"""
import os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extraction import engine

_P = _F = 0
def check(name, ok):
    global _P, _F
    if ok: _P += 1; print(f"  ok  {name}")
    else:  _F += 1; print(f"  FAIL {name}")

C = engine._one_digit_letter_confusable

print("1. _one_digit_letter_confusable — admit digit/letter, EXCLUDE case-fold")
check("O<->0 exhibit (doc #45) -> True", C('PO-22954', 'P0-22954') is True)
check("I<->1 (Pelican) -> True", C('PI/26/9687', 'P1/26/9687') is True)
check("S<->5 -> True", C('SO2345', '5O2345') is True)
check("|<->1 -> True", C('ABC|23', 'ABC123') is True)
check("pure CASE-FOLD b/B excluded -> False (Oracle: case-folds not admitted)", C('Ab-1234', 'AB-1234') is False)
check("pure CASE-FOLD single upper/lower excluded -> False", C('order', 'Order') is False)
check("non-confusable letter diff (O<->X) -> False", C('PO-22954', 'PX-22954') is False)
check("TWO differing positions -> False", C('PO-2295', 'P0-2296') is False)
check("length mismatch -> False", C('PO-22954', 'PO-229544') is False)
check("identical (zero diffs) -> False", C('PO-22954', 'PO-22954') is False)

print("\n2. the page-form finder feeds it (the exhibit)")
check("_nearest_confusable_page_token finds the O<->0 page form",
      engine._nearest_confusable_page_token('Order No. P0-22954 Order Date', 'PO-22954') == 'P0-22954')
check("…and it IS a digit/letter confusable (soften fires)",
      C('PO-22954', engine._nearest_confusable_page_token('Order No. P0-22954 x', 'PO-22954')) is True)

print("\n3. reuses the (already non-sweepable) soften note — note-text only, review-bound")
note = engine._FILING_SANITY_SOFTEN_NOTE.format('PO-22954', 'P0-22954')
check("soft note carries NO ABSENT mark", engine._FILING_SANITY_ABSENT_MARK not in note)
check("soft note not sweepable by _is_verification_doubt_note", engine._is_verification_doubt_note(note) is False)
_js = open(os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'services', 'classFixService.js'), encoding='utf-8').read()
_marks = re.findall(r"""['"](.+?)['"]""", re.search(r'CLEARABLE_NOTE_MARKS\s*=\s*Object\.freeze\(\[(.*?)\]\)', _js, re.S).group(1))
check("no CLEARABLE_NOTE_MARK is a substring of the soft note", all(m not in note for m in _marks))

print("\n4. wiring / source-order (engine.py) + flag default")
check("flag defaults OFF (byte-identical off)", engine._FILING_SANITY_CONFUSABLE_SOFTEN is False)
src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'engine.py'), encoding='utf-8').read()
i_hist  = src.find('if _hist:')
i_conf  = src.find('elif (_near and _FILING_SANITY_CONFUSABLE_SOFTEN')
i_scary = src.find('_FILING_SANITY_ABSENT_MARK} — the page reads it as')
check("confusable branch sits AFTER the history branch and BEFORE the scary note", 0 < i_hist < i_conf < i_scary)
check("gated on the flag AND the digit/letter-only helper",
      '_near and _FILING_SANITY_CONFUSABLE_SOFTEN' in src and '_one_digit_letter_confusable(rv, _near)' in src)
check("writes the SOFT note + a distinct trace event, keeps it review-bound (calls _note)",
      "self._t('filing_sanity_ref_confusable_soften'" in src
      and src[i_conf:i_scary].count('_note(ref_field_key, _txt)') == 1)

print("\n5. JS wiring — env bridge + seed + GRADUATED to a customer default (mig 148 @DEFAULT_FLIP)")
_h = open(os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'modules', 'processing', 'handler.js'), encoding='utf-8').read()
check("handler.js bridges the setting -> FILING_SANITY_CONFUSABLE_SOFTEN env",
      "getSetting(db, 'filing_sanity_confusable_soften'" in _h and "env.FILING_SANITY_CONFUSABLE_SOFTEN = '1'" in _h)
_idx = open(os.path.join(os.path.dirname(__file__), '..', '..', 'database', 'index.js'), encoding='utf-8').read()
check("migration 147 seeds filing_sanity_confusable_soften = 'false' first",
      "VALUES ('filing_sanity_confusable_soften', 'false')" in _idx and "VALUES (147)" in _idx)
check("migration 148 @DEFAULT_FLIP force-defaults it ON (census PASS 2026-09-09)",
      "@DEFAULT_FLIP 148" in _idx
      and "INSERT INTO settings (key, value) VALUES ('filing_sanity_confusable_soften', 'true') ON CONFLICT(key) DO UPDATE SET value='true'" in _idx
      and "VALUES (148)" in _idx)
_dk = open(os.path.join(os.path.dirname(__file__), '..', '..', 'database', 'dark_switches.js'), encoding='utf-8').read()
check("GRADUATED — the key LEFT dark_switches TEST_SWITCH_KEYS (release gate forbids a TEST key as an in-place default)",
      "'filing_sanity_confusable_soften'" not in _dk)

print(f"\n{'ALL PASS' if _F == 0 else str(_F) + ' FAILED'}  ({_P} ok)")
sys.exit(1 if _F else 0)
