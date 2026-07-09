"""
Custom-doc-type TITLE ALIASES in detect_document_type — a doc titled by any of a type's
aliases detects as that type, while the detected TYPE stays the type NAME (so detected_slug /
heading-trust are unchanged). Pins the accepted trade-off (alias-EXACT, not fuzzy) so a future
dev can't loosen it. No DB, no OCR — calls keyword.detect_document_type directly.
Run: cd python_backend && py -3.12 tests/test_detect_type_aliases.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import keyword

fail = 0
def check(name, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {name}")
    if not cond: fail += 1

NAMES = ['Worksheet', 'Invoice']
ALIASES = {'Worksheet': ['Work Sheet', 'Job Sheet']}
def det(title, names=NAMES, aliases=ALIASES):
    return keyword.detect_document_type(title + "\nAcme Supplies Ltd\n1 High St", {}, names, aliases)

print("Alias titles detect the type (result type stays the NAME):")
for title in ['Work Sheet', 'WORK SHEET', 'Job Sheet', 'job sheet', 'Worksheet']:
    r = det(title)
    check(f"'{title}' -> Worksheet", r is not None and r['type'] == 'Worksheet')
# result["type"] is the NAME, never the alias — pins the detected_slug invariant
r = det('Work Sheet')
check("detected type is the NAME 'Worksheet' (not the alias 'Work Sheet')", r and r['type'] == 'Worksheet')

print("\nThe name itself still detects (no regression), and unseen types don't:")
check("'Invoice' still detects Invoice", (det('Invoice') or {}).get('type') == 'Invoice')
check("a doc with no type heading -> None", det('Dear Sir, thank you for your custom') is None)

print("\nHeading trust flows to aliases (the property the type-precedence fix relies on):")
check("alias as a standalone heading -> heading=True", (det('Work Sheet') or {}).get('heading') is True)
check("alias heading carrying a ref ('Job Sheet 42') -> heading=True", (det('Job Sheet 42') or {}).get('heading') is True)
# an alias appearing only INSIDE a sentence is a mention, not a heading -> title_trusted won't fire
r = keyword.detect_document_type("please complete the attached work sheet and return it\nAcme", {}, NAMES, ALIASES)
check("alias mentioned mid-sentence -> detects but heading=False (won't spuriously set title_trusted)",
      r is not None and r['type'] == 'Worksheet' and r['heading'] is False)

print("\nPINNED TRADE-OFF — alias-EXACT (not fuzzy) + null path byte-identical:")
# an UNLISTED variant must NOT match — detection is exact, never fuzzy. (Note: a PLURAL like
# "Worksheets" DOES match the multi-word alias "Work Sheet" -> work\s*sheet in slice 1 because
# that escape branch is not boundary-guarded; the universal boundary guard is deferred to slice 2.)
for variant in ['WkSht', 'W-Sheet', 'Wksheet', 'Wrk Sht']:
    check(f"unlisted variant '{variant}' does NOT match (not fuzzy)", det(variant) is None)
# with NO aliases, the reverse-split 'Work Sheet' does NOT detect single-word 'Worksheet' (proves
# the alias — not the name — provides the coverage, and the null path is unchanged)
check("type_aliases=None: 'Work Sheet' does NOT detect 'Worksheet' (null path byte-identical)",
      keyword.detect_document_type("Work Sheet\nAcme", {}, ['Worksheet'], None) is None)
check("type_aliases omitted (positional call) behaves the same",
      keyword.detect_document_type("Work Sheet\nAcme", {}, ['Worksheet']) is None)

print("\nAlias de-dup + an alias equal to the name folds once (no double-count):")
base = keyword.detect_document_type("Worksheet\nAcme", {}, ['Worksheet'], None)
dup  = keyword.detect_document_type("Worksheet\nAcme", {}, ['Worksheet'], {'Worksheet': ['Worksheet', 'WORKSHEET']})
check("alias == name (any case) folds ONCE — same score as no aliases",
      dup is not None and dup['type'] == 'Worksheet' and dup['all_scores']['Worksheet'] == base['all_scores']['Worksheet'])

print(f"\n{'ALL PASS' if fail == 0 else str(fail) + ' FAILED'}")
sys.exit(1 if fail else 0)
