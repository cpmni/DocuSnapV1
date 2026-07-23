"""
test_logo_detail_sparse_guard.py — pins the SPARSE-GUARD "suggest on miss, assert only on
conflict" (gary design → Oracle SIGN OFF WITH CONDITIONS 2026-07-23; kill
LOGO_DETAIL_MISS_SUGGEST=0 ⇒ the legacy assert-on-miss override).
Run: py -3.12 python_backend/tests/test_logo_detail_sparse_guard.py

THE COLLAPSE THIS FIXES (measured, activation A/B on copies, 390 docs): the Slice-D COARSE-MISS
fill arm asserted a CORRECT detail-hash pick at conf 69 + a review note on docs whose supplier
resolved the SAME name un-noted downstream — would-auto-file 268→131. The M 9→3 "healing" was
incidental (wrong-VALUE docs swept into the blanket hold). Now a coarse miss returns a
SUGGESTION; the engine consumes it at finalisation AFTER the last supplier writer: agree→clean
(the 137-doc arm), disagree→note (positive evidence only), still-empty→text-gated review-bound
fill. The winner-exists+detail-disagree OVERRIDE (the collision-healing arm) is UNCHANGED.

ORACLE PLACEMENT PINS (C1/C2 — the whole game): consumption sits AFTER _flag_branding_conflict
and BEFORE the _logo_abstained consumer (earlier placements re-create the collapse for
Stage-2.5a-resolved docs and can LOSE the disagree note — the only auto-file block on a
text-typed field); the interception sits BEFORE the LOGO_TEXT_GATE block (a suggestion must
never be text-gated mid-pipeline nor reach the fill block, whose dict shape it lacks).
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))
from PIL import Image                                        # noqa: E402
from extraction import anchor                                # noqa: E402
from extraction.engine import _resolve_detail_suggestion     # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1


def setenv(name, v):
    if v is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = v


norm = lambda s: ''.join(str(s or '').lower().split())

print("_resolve_detail_suggestion (pure):")
check("empty field -> 'fill'", _resolve_detail_suggestion(None, 'Acme Ltd', norm) == 'fill')
check("valueless dict -> 'fill'", _resolve_detail_suggestion({'value': ''}, 'Acme Ltd', norm) == 'fill')
check("agree (case/space variants) -> 'clean' (the 137-doc arm)",
      _resolve_detail_suggestion({'value': 'ACME  ltd', 'method': 'hint_text_match'}, 'Acme Ltd', norm) == 'clean')
check("disagree, un-noted -> 'note' (positive conflict only)",
      _resolve_detail_suggestion({'value': 'Rival Co', 'method': 'keyword'}, 'Acme Ltd', norm) == 'note')
check("operator_pin -> 'clean' (human authority never second-guessed)",
      _resolve_detail_suggestion({'value': 'Rival Co', 'method': 'operator_pin'}, 'Acme Ltd', norm) == 'clean')
check("already-noted -> 'clean' (one-note-per-field; doc already review-bound)",
      _resolve_detail_suggestion({'value': 'Rival Co', 'method': 'keyword', 'validation_note': 'x'}, 'Acme Ltd', norm) == 'clean')
check("broken norm -> 'clean' (an unjudgeable compare never manufactures a conflict)",
      _resolve_detail_suggestion({'value': 'Rival Co'}, 'Acme Ltd', lambda s: (_ for _ in ()).throw(ValueError())) == 'clean')

print("\nanchor.py slice 1 — the miss arm suggests, the switch restores the override:")
# Two suppliers with IDENTICAL coarse phashes -> the ±4 ambiguity margin forces winner=None (the
# deterministic coarse-miss), while their DETAIL sets separate decisively: the query mark is 0
# bits from Acme's set and ~120 from Rival's -> classify_supplier picks Acme.
D_ACME = '0' * 64
D_RIVAL = 'f' * 30 + '0' * 34
LOGOS = [
    {'supplier_name': 'Acme Ltd', 'phash': '0' * 16, 'detail_hash': D_ACME, 'match_count': 3},
    {'supplier_name': 'Rival Co', 'phash': '0' * 16, 'detail_hash': D_RIVAL, 'match_count': 3},
]
IMG = Image.new('L', (64, 64), 255)
setenv('LOGO_DETAIL_MISS_SUGGEST', None)   # default ON
r = anchor.try_logo_supplier_match(IMG, LOGOS, query_detail_hash=D_ACME)
check("coarse miss + detail hit -> suggest_only dict, NEVER an identity assertion",
      isinstance(r, dict) and r.get('suggest_only') is True and r.get('supplier_name') == 'Acme Ltd'
      and 'confidence' not in r and 'validation_note' not in r)
setenv('LOGO_DETAIL_MISS_SUGGEST', '0')
r2 = anchor.try_logo_supplier_match(IMG, LOGOS, query_detail_hash=D_ACME)
setenv('LOGO_DETAIL_MISS_SUGGEST', None)
check("kill switch =0 -> the legacy review-bound override (conf 69 + note) is restored",
      isinstance(r2, dict) and not r2.get('suggest_only') and r2.get('confidence') == 69
      and bool(r2.get('validation_note')))

print("\nWiring (source) — the Oracle placement pins:")
src = open(os.path.join(_HERE, '..', 'extraction', 'engine.py'), encoding='utf-8').read()
i_call = src.find('anchor.try_logo_supplier_match(_id_img')
i_stash = src.find('results["_logo_detail_suggest"]')
i_gate = src.find('os.environ.get("LOGO_TEXT_GATE", "1")')
check("C2: interception sits AFTER the match call and BEFORE the LOGO_TEXT_GATE block",
      -1 < i_call < i_stash < i_gate)
check("C2: the intercept nulls logo_match (a suggestion never reaches the fill block)",
      'logo_match = None' in src[i_stash:i_stash + 900])
i_bc = src.find('self._flag_branding_conflict(results, supplier_name, templates, ocr_text)')
i_consume = src.find('results.pop("_logo_detail_suggest", None)')
i_abst = src.find('_abst = results.get("_logo_abstained")')
i_hint = src.find("'hint_text_match'")
if i_hint == -1:
    i_hint = src.find('"hint_text_match"')
check("C1: consumption sits AFTER _flag_branding_conflict and BEFORE the _logo_abstained consumer",
      -1 < i_bc < i_consume < i_abst)
check("C1: consumption sits AFTER the Stage-2.5a hint writer (the earlier placement re-created the collapse)",
      -1 < i_hint < i_consume)
blk = src[i_consume:i_consume + 2600]
check("C4: the stash is popped in-engine (a dict, never a bool — the counter-crash class)",
      'results.pop("_logo_detail_suggest", None)' in src and 'isinstance(_sug, dict)' in blk)
check("fill arm mirrors _supplier_name + sets _needs_review (post-bake coherence)",
      'results["_supplier_name"] = _sname' in blk and 'results["_needs_review"] = True' in blk)
check("fill arm is text-gated; abstain rides the EXISTING _logo_abstained affordance",
      'decide_logo_text_gate(_sname' in blk and 'results.setdefault("_logo_abstained"' in blk)
import re as _re
_note = _re.search(r'The letterhead mark matches[^"]*', blk)
check("C3: the disagree copy does NOT arm isBrandingFlag (no button on a valued row — deliberate)",
      _note is not None and not _re.search(r'page branding reads|confirm the correct company', _note.group(0), _re.I))

print("\nAnti-regression + trade-off pins:")
# A sparse drift-tail set must NEVER suppress an identity today's coarse path would assign:
# a decisive coarse WINNER whose own detail sits >80 from the query but with NO rival <=80 —
# classify abstains, veto can't fire (positive-rival) -> the coarse winner survives untouched.
FAR = 'f' * 25 + '0' * 39   # 100 bits from D_ACME — beyond accept 80, inside no rival band
LOGOS2 = [{'supplier_name': 'Acme Ltd', 'phash': '0' * 16, 'detail_hash': FAR, 'match_count': 3}]
r3 = anchor.try_logo_supplier_match(IMG, LOGOS2, query_detail_hash=D_ACME)
r3_off = None
setenv('LOGO_DETAIL_PRIMARY', '0')
try:
    r3_off = anchor.try_logo_supplier_match(IMG, LOGOS2, query_detail_hash=D_ACME)
finally:
    setenv('LOGO_DETAIL_PRIMARY', None)
check("a 1-ref drift-tail set is BYTE-IDENTICAL to the coarse path (abstain is free; veto positive-rival only)",
      r3 == r3_off)
# Trade-off pin (the blanket hold may not return): the miss-arm suggestion carries NO note and
# no confidence — a future dev re-adding assert-on-miss "for safety" flips the suggest pin above.
check("trade-off: the suggestion dict is note-free BY SHAPE (the blanket hold cannot silently return)",
      isinstance(r, dict) and set(r.keys()) == {'suggest_only', 'supplier_name', 'detail_band'})

print(f"\n{fails} FAILED" if fails else "\nAll sparse-guard checks passed")
sys.exit(1 if fails else 0)
