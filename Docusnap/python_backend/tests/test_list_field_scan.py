"""test_list_field_scan.py — the LIST field type: every occurrence, one scan, first-wins pinned.

Run: py -3.12 python_backend/tests/test_list_field_scan.py

OWNER ASK (2026-08-11, verbatim intent): "There needs to be an iteration for list types that scans
the whole doc for the label and pulls all occurrences and puts the serials in a list so they are
all captured." The corpus prints exactly that layout — gen_customer_test.py:523 emits one
'Serial No: <sn>' line PER serial — so the occurrence loop is the right collector for the owner's
own documents. NAMED RESIDUALS (documented, not hidden): a single caption above a vertical COLUMN
of values yields element 1 only; a misread caption occurrence yields a silently SHORT list (no
count witness in v1).

WHAT THESE PINS DEFEND (gary design + Oracle conditions, both 2026-08-11):
  * ONE scan, two exits: collect=True shares every occurrence skip-guard with the scalar path by
    construction (_search_for_label), and the per-value pipeline is the shared _post_label_value.
  * FIRST-WINS IS PINNED IN BOTH DIRECTIONS (Oracle-required): a scalar field must never start
    collecting, and a list field must never regress to first-wins.
  * Duplicate policy (Oracle C5): exact-match dedupe, first-seen order — a page-2 summary repeat
    is ONE element.
  * OFF is byte-identical: no list_keys -> scalar behaviour, whatever the field's type says.
"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import keyword  # noqa: E402

passed = 0


def ok(name):
    global passed
    passed += 1
    print(f"  ok  {name}")


PATS = {"field_patterns": {"serials": {"labels": ["Serial No"], "directions": ["right"],
                                       "base_confidence": 80}},
        "validation_patterns": {}}

PAGE = """SERVICE WORKSHEET
Serial No: NW-9931617
line of prose between occurrences
Serial No: NW-8597207
Serial No: NW-9931617
Total 100.00
"""

# ── 1. The headline: every occurrence collected, deduped, joined ─────────────
r = keyword.extract_fields(PAGE, ["serials"], PATS, list_keys={"serials"})
assert r["serials"]["value"] == "NW-9931617; NW-8597207", r
assert r["serials"]["method"] == "keyword_list", r
ok("all occurrences collected — 'NW-9931617; NW-8597207', method keyword_list")

# ── 2. Duplicate policy (Oracle C5): exact dedupe, FIRST-SEEN order ──────────
page2 = "Serial No: B-2\nSerial No: A-1\nSerial No: B-2\nSerial No: b-2\n"
r = keyword.extract_fields(page2, ["serials"], PATS, list_keys={"serials"})
assert r["serials"]["value"] == "B-2; A-1", r
ok("exact-match dedupe (case-insensitive), first-seen order — a summary repeat is ONE element")

# ── 3. FIRST-WINS PINNED, BOTH DIRECTIONS (Oracle) ───────────────────────────
r = keyword.extract_fields(PAGE, ["serials"], PATS)                    # no list_keys
assert r["serials"]["value"] == "NW-9931617" and r["serials"]["method"] == "keyword", r
ok("PINNED: a scalar field keeps FIRST-WINS — the refactor must never make scalars collect")
r = keyword.extract_fields(PAGE, ["serials"], PATS, list_keys=set())   # empty set = flag off
assert r["serials"]["value"] == "NW-9931617", r
ok("PINNED: an empty list_keys set (flag off) is byte-identical scalar behaviour")

# ── 4. Multi-page text (the scan is over the FULL document text) ─────────────
two_pages = PAGE + "\n--- page 2 ---\nSerial No: NW-0000001\n"
r = keyword.extract_fields(two_pages, ["serials"], PATS, list_keys={"serials"})
assert r["serials"]["value"] == "NW-9931617; NW-8597207; NW-0000001", r
ok("an occurrence on a later page is captured (full-document text, no new plumbing)")

# ── 5. Determinism (byte-identical reprocess) ────────────────────────────────
a = keyword.extract_fields(PAGE, ["serials"], PATS, list_keys={"serials"})
b = keyword.extract_fields(PAGE, ["serials"], PATS, list_keys={"serials"})
assert a == b
ok("two runs over the same text produce the identical string")

# ── 6. A rejected occurrence never poisons the rest ──────────────────────────
# Give the field a validation gate; one occurrence fails it, the others survive.
gated = {"field_patterns": {"serials": {"labels": ["Serial No"], "directions": ["right"],
                                        "base_confidence": 80, "validation": "alphanumeric"}},
         "validation_patterns": {"alphanumeric": [r"[A-Z]{2}-\d{5,}"]}}
noisy = "Serial No: NW-9931617\nSerial No: ???\nSerial No: NW-8597207\n"
r = keyword.extract_fields(noisy, ["serials"], gated, list_keys={"serials"})
assert r["serials"]["value"] == "NW-9931617; NW-8597207", r
ok("a bad occurrence is dropped by the SHARED validation pipeline; the rest are kept")

# ── 7. The caption itself can never be an element ────────────────────────────
# 'Serial No:' with NOTHING after it yields an empty right-read -> rejected by the shared
# pipeline; the live-DB defect (the caption committed as the value ×24) cannot re-enter here.
capt = "Serial No:\nSerial No: NW-1234567\n"
r = keyword.extract_fields(capt, ["serials"], gated, list_keys={"serials"})
assert r["serials"]["value"] == "NW-1234567", r
ok("a bare caption occurrence contributes nothing — the serials defect class stays dead")

# ── 8. First label with elements OWNS the field ──────────────────────────────
multi = {"field_patterns": {"serials": {"labels": ["Serial No", "Ref"], "directions": ["right"],
                                        "base_confidence": 80}},
         "validation_patterns": {}}
page3 = "Serial No: NW-1\nRef: STRAY-9\n"
r = keyword.extract_fields(page3, ["serials"], multi, list_keys={"serials"})
assert r["serials"]["value"] == "NW-1", r
ok("the first label that yields elements owns the field — a generic label appends no strays")

# ── 9. No occurrences -> field absent (empty -> review, never a guess) ───────
r = keyword.extract_fields("nothing here\n", ["serials"], PATS, list_keys={"serials"})
assert "serials" not in r, r
ok("no occurrences -> no result — the field stays empty for Review")

print(f"\n{passed} checks passed")
