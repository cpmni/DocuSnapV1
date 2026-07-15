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

print("\nCOLUMN-AWARE HEADING (Oracle 2026-07-12 — the WORKSHEET-stuck-as-invoice bug):")
lh = keyword._line_is_heading_like
# The incident: the title is in its OWN left column; a far-right date got merged onto the OCR row.
check("'WORKSHEET    Date 25/11/2026' (own column) -> heading-like", lh("WORKSHEET    Date 25/11/2026", "worksheet") is True)
check("detect: same merged line -> Worksheet, heading=True", (det("WORKSHEET    Date 25/11/2026") or {}).get('heading') is True)
check("generalise 'INVOICE    No. 10023' -> heading-like", lh("INVOICE    No. 10023", "invoice") is True)
check("generalise 'PURCHASE ORDER    Order Date 3/4/2026' -> heading-like", lh("PURCHASE ORDER    Order Date 3/4/2026", "purchase order") is True)
# Single-column: BYTE-IDENTICAL to the pre-column logic (no column break present).
check("single-column 'worksheet' -> heading-like", lh("worksheet", "worksheet") is True)
check("single-column 'Invoice No.' -> heading-like", lh("Invoice No.", "invoice") is True)
check("single-column 'Job Sheet 42' (own ref) -> heading-like", lh("Job Sheet 42", "job sheet") is True)
check("inline prose 'please complete the attached worksheet...' -> NOT heading", lh("please complete the attached worksheet and return it", "worksheet") is False)
# PINNED TRADE-OFF (gary): ONLY an own-column title relaxes — a type word beside a REAL word in the
# SAME column stays a mention, so a future dev can't widen this to any post-column mention.
check("PIN: 'notes    worksheet template' -> NOT heading (type word shares its column with a real word)",
      lh("notes    worksheet template", "worksheet") is False)
# PIN THE MARKER CONTRACT (Oracle C2): only a 4+-space run splits a column; 2- and 3-space gaps do NOT
# (proves {4,} — the image_to_string-fallback double/triple-space precision guard can't be silently loosened).
check("PIN marker: 2-space gap does NOT split -> 'worksheet  date x' NOT heading", lh("worksheet  date x", "worksheet") is False)
check("PIN marker: 3-space gap does NOT split -> 'worksheet   date x' NOT heading", lh("worksheet   date x", "worksheet") is False)

print("\nBLAST-RADIUS PIN (Oracle C3 — a low/table-header type-name must not hijack the type):")
# A table-header first column DOES read heading-like (the accepted widening)...
check("table-header column 'invoice    date    amount' reads heading-like (documented widening)",
      lh("invoice    date    amount", "invoice") is True)
# ...but the top-of-page POSITION weighting stops it WINNING the type when a real top title exists, so
# the newly-trusted heading never silently re-types a doc (the REFUSE it arms stays fail-toward-review).
r = keyword.detect_document_type(
    "WORKSHEET    Date 25/11/2026\nAcme Supplies Ltd\nDescription    Invoice    Amount\n1 High St",
    {}, NAMES, ALIASES)
check("a low 'Invoice' table column does NOT beat the top 'WORKSHEET' title -> type stays Worksheet",
      r is not None and r['type'] == 'Worksheet')

print("\nCOLUMN-BREAK CONTRACT (single source of truth — a producer width change must trip RED):")
from ocr.text_layout import COLUMN_BREAK, COLUMN_BREAK_MIN
check("COLUMN_BREAK is exactly 4 spaces (matches reconstruct_page_text / born_digital)",
      COLUMN_BREAK == "    " and COLUMN_BREAK_MIN == 4)
check("the heading splitter (derived from the constant) matches a 4-space run",
      keyword._COL_BREAK_RE.search("a    b") is not None)
check("the heading splitter does NOT match a 3-space run (pins {4,})",
      keyword._COL_BREAK_RE.search("a   b") is None)

print("\nPART B — COLUMN-AWARE heading SCORING (kill switch HEADING_SCORE_COLUMN_AWARE):")
sih = keyword._segment_is_heading
# C2(a) monotonicity: every line the STRICT scorer counted (line == phrase) still scores as a
# heading under the tighter column-aware SCORING variant (seg0 == phrase short-circuits any caption
# check), so a refactor can't drop a real heading below the 2.0 weight.
check("C2(a): _segment_is_heading('worksheet','worksheet',caption_ok=False) True (strict-counted still 2.0)",
      sih("worksheet", "worksheet", caption_ok=False) is True)
check("C2(a): a numeric code beside the title still scores ('worksheet 38')",
      sih("worksheet 38", "worksheet", caption_ok=False) is True)
# The SCORING variant (caption_ok=False) EXCLUDES caption WORDS (no column gap) so a table
# column-header segment 'purchase order no' can't earn the 2.0 weight; the relaxed EXPOSED-flag
# variant (caption_ok=True) still tolerates it (byte-identical to the old _HEADING_ADJ behaviour).
check("caption_ok=False: 'purchase order no' is NOT a scoring heading (caption word excluded)",
      sih("purchase order no", "purchase order", caption_ok=False) is False)
check("caption_ok=True: 'purchase order no' IS heading-like for the exposed flag (unchanged)",
      sih("purchase order no", "purchase order", caption_ok=True) is True)
# The core fix: a column-MERGED name/alias banner now earns the strong 2.0 weight — scoring HIGHER
# than the strict whole-line path that scored it 1.0 and let a body-mentioned type steal best_type.
MERGED = "WORKSHEET    Reference No. WS-65750\nAcme Supplies Ltd\n1 High St"
on = keyword.detect_document_type(MERGED, {}, NAMES, ALIASES)
os.environ['HEADING_SCORE_COLUMN_AWARE'] = '0'
off = keyword.detect_document_type(MERGED, {}, NAMES, ALIASES)
os.environ.pop('HEADING_SCORE_COLUMN_AWARE', None)
check("Part B ON: merged 'WORKSHEET  Reference No.' scores STRONGER than the strict path",
      bool(on and off and on['all_scores']['Worksheet'] > off['all_scores']['Worksheet']))
check("C2(b): a score-driven best_type carries heading=True (test-2 superset of test-3)",
      bool(on and on['type'] == 'Worksheet' and on['heading'] is True))
check("kill switch OFF -> strict whole-line scoring (still detects, lower score = byte-identical scoring path)",
      bool(off and off['type'] == 'Worksheet'))

print(f"\n{'ALL PASS' if fail == 0 else str(fail) + ' FAILED'}")
sys.exit(1 if fail else 0)
