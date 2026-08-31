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

# ── 10. SEPARATOR COLLISION (reggie 2026-08-26): an element carrying the store separator is REFUSED ─
# The store joins with '; ', so 'AB;12' would read back as two elements on every reader. Refused at the
# ONE writer (never escaped, never split); its siblings survive; the renderer splits on ';' only.
page4 = "Serial No: NW-1\nSerial No: AB;12\nSerial No: NW-2\n"
r = keyword.extract_fields(page4, ["serials"], PATS, list_keys={"serials"})
assert r["serials"]["value"] == "NW-1; NW-2", r
ok("an element containing ';' is refused; the other occurrences still collect")

# ═══ 2026-08-27 — the List Review slice (panel barry/gary/reggie/eric/bob/Chris → Oracle SIGN-OFF-W/COND) ═══
# Conditions pinned here: (1) union across TAUGHT (override) captions only, page order; (2) the caption
# tail bound `(?![a-z])` lives ONLY under collect=True and ships TOGETHER with the union; (3) the digit
# gate for a list of CODES rides its own switch LIST_ELEMENT_DIGIT_GATE (default ON) and arms the
# known-caption vocab for list keys; (6) a list-typed ref-role field seeds its OWN label only.
# Every switch pin carries a POSITIVE CONTROL (feedback_vacuous_pin_traps): the OFF arm must differ.

# ── 11. UNION across taught captions, in PAGE order; `label` names every contributing caption ─
ovr = {"field_patterns": {"serials": {"labels": [{"text": "Serial No", "override": True},
                                                  {"text": "Serial Number", "override": True}],
                                       "directions": ["right"], "base_confidence": 80}},
       "validation_patterns": {}}
page_u = "Serial Number: NW-2\nSerial No: NW-1\nSerial Number: NW-3\n"
r = keyword.extract_fields(page_u, ["serials"], ovr, list_keys={"serials"})
assert r["serials"]["value"] == "NW-2; NW-1; NW-3", r
assert r["serials"]["label"] == "Serial No | Serial Number", r
ok("two TAUGHT captions union in page order; label names both (Oracle cond 1)")

# ── 12. An override that yielded → a PLAIN label never appends; no override yield → plain first-wins ─
mixed = {"field_patterns": {"serials": {"labels": [{"text": "Serial No", "override": True}, "Ref", "Code"],
                                         "directions": ["right"], "base_confidence": 80}},
         "validation_patterns": {}}
r = keyword.extract_fields("Serial No: NW-1\nRef: STRAY-9\nCode: C-1\n", ["serials"], mixed, list_keys={"serials"})
assert r["serials"]["value"] == "NW-1", r
ok("a taught caption yielded → the plain bank appends nothing")
r = keyword.extract_fields("Ref: R-1\nCode: C-1\n", ["serials"], mixed, list_keys={"serials"})
assert r["serials"]["value"] == "R-1", r
ok("no taught caption yielded → the first PLAIN label that yields owns the field (first-wins kept)")

# ── 13. TAIL BOUND: collect-only, positive control, and the union+bound pairing ─────────
bound_page = "Serial Nos: A\nSerial No: NW-1\n"
r_on = keyword.extract_fields(bound_page, ["serials"], PATS, list_keys={"serials"})
assert r_on["serials"]["value"] == "NW-1", r_on
_saved = keyword.LIST_CAPTION_TAIL_BOUND
keyword.LIST_CAPTION_TAIL_BOUND = False
try:
    r_off = keyword.extract_fields(bound_page, ["serials"], PATS, list_keys={"serials"})
    assert r_off["serials"]["value"] != "NW-1" and "NW-1" in r_off["serials"]["value"], r_off
    ok("tail bound ON drops the 'Serial Nos' debris element; OFF collects it (positive control)")
    # the scalar path is byte-identical whatever the switch says (Oracle cond 2: collect=True only)
    s_off = keyword.extract_fields(bound_page, ["serials"], PATS)
finally:
    keyword.LIST_CAPTION_TAIL_BOUND = _saved
s_on = keyword.extract_fields(bound_page, ["serials"], PATS)
assert s_on == s_off, (s_on, s_off)
ok("the scalar path is byte-identical with the bound ON or OFF — it lives under collect=True only")
glued = "Serial No1234\nSerial No: NW-1\n"
g_on = keyword.extract_fields(glued, ["serials"], PATS, list_keys={"serials"})
keyword.LIST_CAPTION_TAIL_BOUND = False
try:
    g_off = keyword.extract_fields(glued, ["serials"], PATS, list_keys={"serials"})
finally:
    keyword.LIST_CAPTION_TAIL_BOUND = _saved
assert g_on == g_off, (g_on, g_off)
ok("a caption glued to DIGITS ('Serial No1234') is untouched by the letter-only bound")
# THE PAIRING. The bound ALONE turns the "Serial Nos: A1" debris pill into an INVISIBLE MISS (A1 is
# simply gone); the union is what recovers it once the plural caption is taught too.
plural_page = "Serial Nos: NW-2001\nSerial No: NW-1\n"
r_alone = keyword.extract_fields(plural_page, ["serials"], PATS, list_keys={"serials"})
assert r_alone["serials"]["value"] == "NW-1", r_alone
ovr2 = {"field_patterns": {"serials": {"labels": [{"text": "Serial No", "override": True},
                                                   {"text": "Serial Nos", "override": True}],
                                        "directions": ["right"], "base_confidence": 80}},
        "validation_patterns": {}}
r_pair = keyword.extract_fields(plural_page, ["serials"], ovr2, list_keys={"serials"})
assert r_pair["serials"]["value"] == "NW-2001; NW-1", r_pair
ok("PINNED PAIRING: the bound alone MISSES the plural line; teaching the plural caption unions it back (page order)")

# ── 14. DIGIT GATE for a list of CODES (key role alphanumeric), own switch, documented trade ─
codes = {"field_patterns": {"serial_number": {"labels": ["Serial No"], "directions": ["right"],
                                              "base_confidence": 80}},
         "validation_patterns": {}}
# (control values chosen to pass the PRE-EXISTING guards: an ALL-CAPS token and a 2-char token are refused
#  on every path already — 'ABCDEF' / 'X9' would make the OFF arm vacuous.)
gate_page = "Serial No: Model\nSerial No: NW-1234\nSerial No: Abcdef\nSerial No: Xy-9\n"
r = keyword.extract_fields(gate_page, ["serial_number"], codes, list_keys={"serial_number"})
assert r["serial_number"]["value"] == "NW-1234", r
ok("digit gate ON: a header word ('Model'), a digitless token and a one-digit fragment are refused; the code survives")
_saved_g = keyword.LIST_ELEMENT_DIGIT_GATE
keyword.LIST_ELEMENT_DIGIT_GATE = False
try:
    r = keyword.extract_fields(gate_page, ["serial_number"], codes, list_keys={"serial_number"})
finally:
    keyword.LIST_ELEMENT_DIGIT_GATE = _saved_g
assert r["serial_number"]["value"] == "Model; NW-1234; Abcdef; Xy-9", r
ok("digit gate OFF (LIST_ELEMENT_DIGIT_GATE=0): everything collects (positive control)")
r = keyword.extract_fields(gate_page, ["serials"], PATS, list_keys={"serials"})
assert r["serials"]["value"] == "Model; NW-1234; Abcdef; Xy-9", r
ok("a list whose key is NOT a code role ('serials') is never digit-gated — text lists collect words")
ok("DOCUMENTED TRADE (pinned above): a digitless serial in a *_number list is refused while the gate is ON")

# ── 15. The known-caption vocab arms for LIST keys under the same switch (Oracle cond 3) ──
vocab = keyword.build_caption_vocab({"model": {"labels": ["Model"]}, "serials": {"labels": ["Serial No"]}}, None)
cap_page = "Serial No: Model\nSerial No: NW-1234\n"
r = keyword.extract_fields(cap_page, ["serials"], PATS, caption_vocab=vocab, list_keys={"serials"})
assert r["serials"]["value"] == "NW-1234", r
keyword.LIST_ELEMENT_DIGIT_GATE = False
try:
    r = keyword.extract_fields(cap_page, ["serials"], PATS, caption_vocab=vocab, list_keys={"serials"})
finally:
    keyword.LIST_ELEMENT_DIGIT_GATE = _saved_g
assert r["serials"]["value"] == "Model; NW-1234", r
ok("a candidate that IS a known caption dies at generation for a list key; switch OFF → it survives (control)")

# ── 16. SEED BANK: a list-typed ref-role field seeds its OWN label only (Oracle cond 6) ──
_defs = [{"key": "serial_number", "label": "Serial Number", "type": "list"}]
_cfg = {"field_patterns": {}, "validation_patterns": {}}
_prev = os.environ.get("LIST_FIELD_SCAN")
os.environ["LIST_FIELD_SCAN"] = "1"
try:
    seeded_on = keyword.seed_field_labels(dict(_cfg), _defs)
finally:
    if _prev is None:
        os.environ.pop("LIST_FIELD_SCAN", None)
    else:
        os.environ["LIST_FIELD_SCAN"] = _prev
_labels = lambda s: [str(l.get("text") if isinstance(l, dict) else l).lower()
                     for l in s["field_patterns"]["serial_number"]["labels"]]
on_labels = _labels(seeded_on)
assert on_labels and all("serial" in l for l in on_labels), on_labels
ok("LIST_FIELD_SCAN=1: a list-typed '*_number' field seeds its own label forms only — no generic ref bank")
os.environ.pop("LIST_FIELD_SCAN", None)
seeded_off = keyword.seed_field_labels(dict(_cfg), _defs)
off_labels = _labels(seeded_off)
assert any("ref" in l for l in off_labels), off_labels
ok("flag OFF: the generic ref bank still seeds (byte-identical OFF — positive control)")
if _prev is not None:
    os.environ["LIST_FIELD_SCAN"] = _prev

# ── 17. LONGEST CAPTION WINS PER LINE: a taught caption that is a word-prefix of another ─
prefix = {"field_patterns": {"serials": {"labels": [{"text": "Model", "override": True},
                                                     {"text": "Model No", "override": True}],
                                          "directions": ["right"], "base_confidence": 80}},
          "validation_patterns": {}}
# (a colon layout — "Model No: NW-2" — is already refused for the short caption by the pre-existing compound-caption
#  guard on every path; the seam is live on the NO-colon layouts worksheets print, so that is what is pinned)
prefix_page = "Model No NW-2\nModel NW-1\n"
r = keyword.extract_fields(prefix_page, ["serials"], prefix, list_keys={"serials"})
assert r["serials"]["value"] == "NW-2; NW-1", r
assert r["serials"]["label"] == "Model | Model No", r
ok("'Model' + 'Model No' both taught: the shorter caption's tail read ('No NW-2') is dropped on the shared line")
r = keyword.extract_fields(prefix_page, ["serials"],
                           {"field_patterns": {"serials": {"labels": [{"text": "Model", "override": True}],
                                                           "directions": ["right"], "base_confidence": 80}},
                            "validation_patterns": {}}, list_keys={"serials"})
assert r["serials"]["value"] == "No NW-2; NW-1", r
ok("positive control: with ONLY the short caption taught the tail read IS collected — the rule, not a phantom guard, drops it")

print(f"\n{passed} checks passed")
