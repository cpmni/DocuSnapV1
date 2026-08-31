"""Chris round 17 card 2(a)+(b) (2026-08-23; gary → Oracle SIGN-OFF-W/COND) — the WIDE debris leg of the
template_fixed seed keep, and the JUNK kind of the letterhead suggestion.

THE INCIDENT: a one-line issuer box over the stacked DOCUMENT / SOLUTIONS wordmark read "Gay" (a word not on
the page) at >=75 and DISPLACED the curated seed — the shipped debris rule is `len(fold) < 3`, so a 3-char
read passes it; near-match / garble compare the whole string; not-issuer needs a digit run. Then slice 2's
garble gate (tokens <6 exact) said "not a garble" → no suggestion → the row offered only "Keep Gay", the
letterhead hold had nothing to compare → one click filed `Output\\Gay\\2026\\May`.

Pins (a): kept — 'Gay', 'ba)', 'Poo', 'MENT', 'TIONS'; not kept — 'Nocument Ltd' (the garble arm's job),
'Tesco', 'Bramblewood Joinery Ltd' (the 08-06 "a different company still displaces" invariant); a short
FIXED name ('BP') never enters; TRADE-OFF PIN 'Asda' vs 'DOCUMENT SOLUTIONS' → kept (a <=4-char genuinely
different read no longer displaces a curated seed — safe ONLY because the leg fires under
TEMPLATE_IDENTITY_ON_PAGE, where the doc carries the seed only if the page names that company);
the engine branch 'debris' fires only with BOTH switches; OFF byte-identical.
Pins (b): 'Gay' / a date line / a 4-char scrap → suggested_supplier = canonical (kind 'junk');
'Quillstone Print & Packaging' vs 'Bramblewood Joinery Ltd' → NO suggestion (positive control — a
different company); IDENTITY_SUGGEST_CANONICAL_JUNK=0 → 'Gay' no suggestion while a garble still suggests.

Run:  PYTHONIOENCODING=utf-8 py -3.12 tests/test_fixed_seed_debris.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import name_match as nm
from extraction import engine as E
from extraction.engine import ExtractionEngine

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


F = "DOCUMENT SOLUTIONS"
print("-- (a) is_debris_read --")
for r in ("Gay", "ba)", "Poo", "MENT", "TIONS"):
    check(f"{r!r} against {F!r} → debris", nm.is_debris_read(r, F) is True)
for r in ("Nocument Ltd", "Tesco", "Bramblewood Joinery Ltd", "DOCUMENT", "NOCUMENT"):
    check(f"{r!r} → NOT debris", nm.is_debris_read(r, F) is False)
check("a short FIXED name never enters: 'Gay' vs fixed 'BP' → False (the 8-char floor)", nm.is_debris_read("Gay", "BP") is False)
check("equal folds → False", nm.is_debris_read("DOCUMENT SOLUTIONS", F) is False)
check("TRADE-OFF PIN: 'Asda' (a <=4-char genuinely different read) → debris under the on-page condition", nm.is_debris_read("Asda", F) is True)

print("\n-- (a) the engine branch --")
EX = {"value": F, "method": "template_fixed", "confidence": 95}
E._FIXED_DEBRIS_WIDE_ON = False
os.environ['TEMPLATE_IDENTITY_ON_PAGE'] = '1'
check("OFF: 'Gay' → no decline branch (byte-identical)", E._fixed_seed_declines_mapping("supplier_name", EX, {"value": "Gay"}) is None)
E._FIXED_DEBRIS_WIDE_ON = True
check("ON + on_page: 'Gay' → 'debris'", E._fixed_seed_declines_mapping("supplier_name", EX, {"value": "Gay"}) == 'debris')
check("ON + on_page: 'MENT' → 'debris'", E._fixed_seed_declines_mapping("supplier_name", EX, {"value": "MENT"}) == 'debris')
check("ON + on_page: 'Bramblewood Joinery Ltd' → None (a different company still displaces)", E._fixed_seed_declines_mapping("supplier_name", EX, {"value": "Bramblewood Joinery Ltd"}) is None)
os.environ['TEMPLATE_IDENTITY_ON_PAGE'] = '0'
check("ON but on_page OFF: 'Gay' → None (the leg needs the on-page guard)", E._fixed_seed_declines_mapping("supplier_name", EX, {"value": "Gay"}) is None)
os.environ['TEMPLATE_IDENTITY_ON_PAGE'] = '1'
check("customer_name untouched", E._fixed_seed_declines_mapping("customer_name", {"value": F, "method": "template_fixed"}, {"value": "Gay"}) is None)
E._FIXED_DEBRIS_WIDE_ON = False
src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'extraction', 'engine.py'), encoding='utf-8').read()
check("source: the flag reads TEMPLATE_FIXED_DEBRIS_WIDE, default OFF; _FRAGMENT_MAX_READ_LEN untouched (3)",
      "os.environ.get('TEMPLATE_FIXED_DEBRIS_WIDE', '0') != '0'" in src and nm._FRAGMENT_MAX_READ_LEN == 3)

print("\n-- (b) the JUNK kind of the letterhead suggestion --")
S = ExtractionEngine._suggest_identity_canonical
E._IDENTITY_SUGGEST_CANONICAL_ON = True
E._IDENTITY_SUGGEST_JUNK_ON = True
for r in ("Gay", "DATE 14-03-2026 Job Ref JB-8887", "Poo", "MENT"):
    f = {"value": r, "confidence": 70, "corrected_to": "X"}
    ok = S(f, {"text_led": F, "resolved": r})
    check(f"{r!r} → suggested_supplier = canonical (kind junk), corrected_to cleared", ok is True and f.get("suggested_supplier") == F and f.get("corrected_to") is None and f.get("suggested_kind") == 'junk')
f = {"value": "NOCUMENT", "confidence": 70}
check("a garble still suggests with kind 'garble'", S(f, {"text_led": F, "resolved": "NOCUMENT"}) is True and f.get("suggested_kind") == 'garble')
f = {"value": "Quillstone Print & Packaging", "confidence": 70, "corrected_to": "Q"}
check("POSITIVE CONTROL: a different company (buyer-issued PO) → NO suggestion, corrected_to untouched",
      S(f, {"text_led": "Bramblewood Joinery Ltd", "resolved": "Quillstone Print & Packaging"}) is False and "suggested_supplier" not in f and f["corrected_to"] == "Q")
f = {"value": "Tesco", "confidence": 70}
check("'Tesco' (5 chars, not a piece of the canonical) is neither kind → abstain (fail toward review)", S(f, {"text_led": F, "resolved": "Tesco"}) is False)
E._IDENTITY_SUGGEST_JUNK_ON = False
f = {"value": "Gay", "confidence": 70}
check("JUNK kill switch: 'Gay' → no suggestion, while a garble still suggests",
      S(f, {"text_led": F, "resolved": "Gay"}) is False and S({"value": "NOCUMENT", "confidence": 70}, {"text_led": F, "resolved": "NOCUMENT"}) is True)
E._IDENTITY_SUGGEST_JUNK_ON = True
E._IDENTITY_SUGGEST_CANONICAL_ON = False
check("slice 2 OFF: junk never suggests (rides slice 2)", S({"value": "Gay", "confidence": 70}, {"text_led": F, "resolved": "Gay"}) is False)
check("source: the junk switch reads IDENTITY_SUGGEST_CANONICAL_JUNK (default on under slice 2)", "os.environ.get('IDENTITY_SUGGEST_CANONICAL_JUNK', '1') != '0'" in src)

print()
if fails:
    print("FAILED: %d check(s)" % fails)
    sys.exit(1)
print("ALL PASS")
