"""test_deskew_retry_field_adopt.py — PINs for DESKEW_RETRY_FIELD_ADOPT (mig 162, DARK; gary → Oracle
SIGN-OFF-W/COND C1-C11, 2026-09-12; docs/designs/DESKEW_RETRY_FIELD_ADOPT_2026-09-12.md).

The Ridgeway #358 exhibit (measured on the FULL process_docs path): a 1.7° skew mis-seats the taught ref box →
`VS-72672` @95 shape-valid + Gate C's absent note; the engine reports `_needs_review=False` (a note sets no flag)
so the straighten retry never opened; forced open, the straightened pass read `WS-73673` @82 (TAUGHT-CORROB-ADOPT,
mapping+keyword agree) but the WHOLE-DOC gate refused it (79 < 83 — the confident garble inflates raw overall).

Pins: the ROLE-note door (C1: only a noted, non-authoritative, un-corrected ref/date role field opens it; never
supplier-only) · the field-scoped adopt F1-F7 + C3 (overall = min) + C4 (lane-hold over a machine-clearable
note) + C5 (same supplier/template) + C6 (no put-back of a page-absent raw value; date twin) · every refusal
leaves raw deep-equal · OFF byte-identical · the C14 source pin of the parent stays intact · the whole-doc
leg stays gated on the RAW engine flag · the JS CLEARABLE_NOTE_MARKS twin · C2 (the exhibit is VACUOUS
without TCA: a straightened `MS.72672` + absent note refuses).

RED-first: `_deskew_retry_field_adopt` / `_deskew_field_adopt_door_keys` do not exist on pre-change code.
Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_deskew_retry_field_adopt.py
"""
import copy, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from process_docs import (_deskew_retry_should_run, _deskew_field_adopt_door_keys, _deskew_retry_field_adopt,
                          _deskew_note_machine_clearable, _deskew_same_identity, _DESKEW_CHANGED_NOTE,
                          _DESKEW_FOUND_NOTE, _DESKEW_MACHINE_CLEARABLE_MARKS, _put_back_offerable)
import process_docs as PD
from extraction import engine as E

fails = []
def check(name, cond):
    print(f"  {'OK ' if cond else 'BAD'} {name}")
    if not cond:
        fails.append(name)

ABSENT = E._FILING_SANITY_ABSENT_MARK
YEAR_ABSENT = E._FILING_SANITY_YEAR_ABSENT_MARK
TCA_NOTE = E._TCA_ADOPT_NOTE.format("WS-73673")
ROLE = {"supplier_name", "reference_number", "date"}
DATES = {"date"}
LIC = {"winner_family": "mapping", "agree": ["keyword"], "disagree": [], "independent_agree": True}

def raw358():
    return {
        "_supplier_name": "Ridgeway Plant Hire", "_template_id": 16, "_needs_review": False,
        "_overall_confidence": 83, "_shape_ok": {"reference_number": True},
        "_corroboration_emit": {
            "supplier_name": {"winner_family": "memory", "agree": ["hint", "mapping"], "disagree": [], "independent_agree": True},
            "date": {"winner_family": "mapping", "agree": ["keyword"], "disagree": [], "independent_agree": True},
            "reference_number": {"winner_family": "mapping", "agree": [], "disagree": [{"family": "keyword", "value": "WS-73673"}], "independent_agree": False}},
        "supplier_name": {"value": "Ridgeway Plant Hire", "confidence": 95, "method": "template_fixed"},
        "date": {"value": "13-04-2026", "confidence": 96, "method": "template_mapping"},
        "reference_number": {"value": "VS-72672", "confidence": 95, "method": "template_mapping",
                             "validation_note": E._FILING_SANITY_ABSENT_NOTE.format("VS-72672")},
    }

def straight358():
    return {
        "_supplier_name": "Ridgeway Plant Hire", "_template_id": 16, "_needs_review": False,
        "_overall_confidence": 79, "_shape_ok": {"reference_number": True},
        "_corroboration_emit": {
            "supplier_name": {"winner_family": "memory", "agree": ["hint", "mapping"], "disagree": [], "independent_agree": True},
            "date": {"winner_family": "mapping", "agree": ["keyword"], "disagree": [], "independent_agree": True},
            "reference_number": dict(LIC)},
        "supplier_name": {"value": "Ridgeway Plant Hire", "confidence": 95, "method": "template_fixed"},
        "date": {"value": "13-04-2026", "confidence": 96, "method": "template_mapping"},
        "reference_number": {"value": "WS-73673", "confidence": 82, "method": "template_mapping_corrobadopt",
                             "validation_note": TCA_NOTE},
    }

# ── 1. the door ──────────────────────────────────────────────────────────────────────────────────────
print("\n1. the door (C1)")
check("kwarg omitted: the 6 pre-change truth-table rows are unchanged",
      _deskew_retry_should_run(True, True, False, False, True) is True
      and _deskew_retry_should_run(False, True, False, False, True) is False
      and _deskew_retry_should_run(True, False, False, False, True) is False
      and _deskew_retry_should_run(True, True, True, False, True) is False
      and _deskew_retry_should_run(True, True, False, True, True) is False
      and _deskew_retry_should_run(True, True, False, False, False) is False)
check("note_held=True opens the door with needs_review=False", _deskew_retry_should_run(True, False, False, False, True, note_held=True) is True)
check("note_held never overrides disabled / deskewed / reextract / no-pages",
      _deskew_retry_should_run(False, False, False, False, True, note_held=True) is False
      and _deskew_retry_should_run(True, False, True, False, True, note_held=True) is False
      and _deskew_retry_should_run(True, False, False, True, True, note_held=True) is False
      and _deskew_retry_should_run(True, False, False, False, False, note_held=True) is False)
check("358: the noted template_mapping ref is a door key", _deskew_field_adopt_door_keys(raw358(), ROLE) == ["reference_number"])
sup_only = raw358(); sup_only["reference_number"].pop("validation_note")
sup_only["supplier_name"]["validation_note"] = "Matched by logo only — the page text doesn't confirm this company. Please check."
check("C1: a supplier-ONLY note never opens the door (a full straighten pass for zero upside)", _deskew_field_adopt_door_keys(sup_only, ROLE) == [])
cto = raw358(); cto["reference_number"]["corrected_to"] = "WS-73673"
check("C1: a noted ref with a corrected_to is not a door key", _deskew_field_adopt_door_keys(cto, ROLE) == [])
wc = raw358(); wc["reference_number"]["was_corrected"] = True
check("C1: a noted ref that was_corrected is not a door key", _deskew_field_adopt_door_keys(wc, ROLE) == [])
for m in ("manual", "keyword_override", "operator_pin", "template_fixed", "anchor_override"):
    hm = raw358(); hm["reference_number"]["method"] = m
    check(f"C1/F5: a noted ref read by a human/authoritative method ({m}) is not a door key", _deskew_field_adopt_door_keys(hm, ROLE) == [])
opt = raw358(); opt["reference_number"].pop("validation_note"); opt["po_ref"] = {"value": "X", "validation_note": "please verify"}
check("F1: a noted OPTIONAL field is not a door key", _deskew_field_adopt_door_keys(opt, ROLE) == [])
check("an untyped doc (supplier-only role set) has no door keys", _deskew_field_adopt_door_keys(raw358(), {"supplier_name"}) == [])
check("empty-string note is not a note", _deskew_field_adopt_door_keys({"reference_number": {"value": "A", "validation_note": "  "}}, ROLE) == [])

# ── 2. the 358 fixture — the adopt ────────────────────────────────────────────────────────────────────
print("\n2. the 358 fixture (adopt)")
raw = raw358(); st = straight358(); before = copy.deepcopy(raw)
out = _deskew_retry_field_adopt(raw, st, ROLE, date_keys=DATES, enabled=True)
r = raw["reference_number"]
check("returns [(reference_number, VS-72672, WS-73673)]", out == [("reference_number", "VS-72672", "WS-73673")])
check("value/conf/method adopted WHOLE, method verbatim (no suffix)",
      r["value"] == "WS-73673" and r["confidence"] == 82 and r["method"] == "template_mapping_corrobadopt")
check("the TCA note (deny-by-default, not machine-clearable) is kept as the hold", r.get("validation_note") == TCA_NOTE)
check("C6/ref rule: NO corrected_to — the raw note was the page-ABSENT claim (even though _put_back_offerable is True)",
      not str(r.get("corrected_to") or "").strip() and _put_back_offerable("VS-72672", "WS-73673") is True)
check("_needs_review forced True", raw["_needs_review"] is True)
check("C3: overall = min(83, 79) = 79", raw["_overall_confidence"] == 79)
check("the corroboration record is mirrored (licensed mapping+keyword)", raw["_corroboration_emit"]["reference_number"] == LIC)
check("_shape_ok mirrored", raw["_shape_ok"]["reference_number"] is True)
check("supplier + date dicts untouched", raw["supplier_name"] == before["supplier_name"] and raw["date"] == before["date"])
check("the dict object is mutated in place (never re-assigned)", raw is not st)

# ── 3. refusals — raw deep-equal, _needs_review unchanged ────────────────────────────────────────────
print("\n3. refusals (each leaves raw deep-equal)")
def refuses(name, mut_raw=None, mut_st=None, role=ROLE, dates=DATES):
    raw = raw358(); st = straight358()
    if mut_raw: mut_raw(raw)
    if mut_st: mut_st(st)
    snap = copy.deepcopy(raw)
    out = _deskew_retry_field_adopt(raw, st, role, date_keys=dates, enabled=True)
    check(name, out == [] and raw == snap)
raw = raw358(); snap = copy.deepcopy(raw)
check("OFF (enabled=False) → [] + raw deep-equal", _deskew_retry_field_adopt(raw, straight358(), ROLE, date_keys=DATES, enabled=False) == [] and raw == snap)
refuses("F1: a CLEAN raw role field (no note) is never touched, even with a differing corroborated straightened read",
        mut_raw=lambda r: r["reference_number"].pop("validation_note"))
refuses("F1/S9: supplier_name is never field-adopted (noted + corroborated)",
        mut_raw=lambda r: (r["reference_number"].pop("validation_note"),
                           r["supplier_name"].update({"method": "template_mapping", "validation_note": "please check"})),
        mut_st=lambda s: (s["supplier_name"].update({"value": "Ridgeway Plant Hire Ltd"}),
                          s["_corroboration_emit"].update({"supplier_name": dict(LIC)})))
refuses("F2: same value (whitespace-RUN-only diff, 'WS  73673' vs 'WS 73673') is not a change",
        mut_st=lambda s: s["reference_number"].update({"value": "WS  73673"}),
        mut_raw=lambda r: r["reference_number"].update({"value": "WS 73673"}))
refuses("F2: an EMPTIED straightened field never adopts", mut_st=lambda s: s["reference_number"].update({"value": ""}))
refuses("F3: independent_agree but a DISAGREE present → refuse",
        mut_st=lambda s: s["_corroboration_emit"]["reference_number"].update({"disagree": [{"family": "crop", "value": "WS-73678"}]}))
refuses("F3: agree=[crop] only (no keyword page-text witness) → refuse",
        mut_st=lambda s: s["_corroboration_emit"]["reference_number"].update({"agree": ["crop"]}))
refuses("F3: record missing → refuse", mut_st=lambda s: s["_corroboration_emit"].pop("reference_number"))
refuses("F6: winner_family memory (a recall, not a read) → refuse",
        mut_st=lambda s: s["_corroboration_emit"]["reference_number"].update({"winner_family": "memory", "agree": ["keyword", "mapping"]}))
refuses("F4a/C2: the straightened field carries the ABSENT mark (the exhibit WITHOUT TCA: `MS.72672` + absent) → refuse (vacuous)",
        mut_st=lambda s: s["reference_number"].update({"value": "MS.72672", "confidence": 90, "method": "template_mapping_padcodeflag",
                                                       "validation_note": E._FILING_SANITY_ABSENT_NOTE.format("MS.72672")}))
refuses("F4b: _shape_ok False → refuse", mut_st=lambda s: s["_shape_ok"].update({"reference_number": False}))
refuses("C5: straightened pass resolved a different supplier → refuse", mut_st=lambda s: s.update({"_supplier_name": "Ridgeway Plant Hire Ltd"}))
refuses("C5: straightened pass resolved a different template → refuse", mut_st=lambda s: s.update({"_template_id": 17}))
refuses("C5: a missing supplier on one side is not equal", mut_st=lambda s: s.update({"_supplier_name": None}))
raw = raw358(); st = straight358(); st.pop("_shape_ok"); snap_val = st["reference_number"]["value"]
check("F4b: _shape_ok ABSENT (no learned skeleton) → adopts (held regardless)",
      _deskew_retry_field_adopt(raw, st, ROLE, date_keys=DATES, enabled=True) == [("reference_number", "VS-72672", "WS-73673")]
      and raw["reference_number"]["value"] == snap_val and "reference_number" not in (raw.get("_shape_ok") or {}))
raw = raw358(); st = straight358()
check("C5: text_normalise-equal suppliers (case/space) are the SAME identity",
      _deskew_same_identity({"_supplier_name": "Ridgeway  Plant Hire", "_template_id": 16}, {"_supplier_name": "ridgeway plant hire", "_template_id": 16}))

# ── 4. dates (F7 + C6) ────────────────────────────────────────────────────────────────────────────────
print("\n4. dates")
def date_case(raw_note, st_val, st_note=None):
    raw = raw358(); st = straight358()
    raw["reference_number"].pop("validation_note")
    raw["date"].update({"value": "42-04-2026", "confidence": 88, "validation_note": raw_note})
    st["date"].update({"value": st_val, "confidence": 96})
    if st_note is not None: st["date"]["validation_note"] = st_note
    return raw, st
raw, st = date_case("the date looks unusual — please check", "12-04-2026")
out = _deskew_retry_field_adopt(raw, st, ROLE, date_keys=DATES, enabled=True)
check("date role: adopts a parseable corroborated straightened date; the deskew lane-hold is stamped (straightened dict had no note)",
      out == [("date", "42-04-2026", "12-04-2026")] and raw["date"]["value"] == "12-04-2026"
      # owner 2026-09-25: the invalid raw date '42-04-2026' is a garble, not an alternative — 'Found' framing, not named.
      and raw["date"]["validation_note"] == _DESKEW_FOUND_NOTE.format(now="12-04-2026")
      and "42-04-2026" not in raw["date"]["validation_note"]
      and raw["date"]["validation_note"].endswith("— confirm once."))
check("...and the garbled raw date ('42-04-2026') gets NO put-back button (the 08-30 rule)", not str(raw["date"].get("corrected_to") or "").strip())
raw, st = date_case("the date looks unusual — please check", "12-04-2026")
raw["date"]["value"] = "11-04-2026"
out = _deskew_retry_field_adopt(raw, st, ROLE, date_keys=DATES, enabled=True)
check("date role: a PLAUSIBLE raw date is offered as the put-back", raw["date"].get("corrected_to") == "11-04-2026")
raw, st = date_case(f"the year 2026 {YEAR_ABSENT} — please check the date before filing.", "12-04-2026")
raw["date"]["value"] = "11-04-2025"
out = _deskew_retry_field_adopt(raw, st, ROLE, date_keys=DATES, enabled=True)
check("C6: a raw Gate-B YEAR-ABSENT note → adopted, but NO put-back of the raw date (the ref ABSENT rule's date twin)",
      out == [("date", "11-04-2025", "12-04-2026")] and not str(raw["date"].get("corrected_to") or "").strip())
check("C6: the hoisted mark is the literal prose of the Gate B writer (engine.py) — unchanged wording",
      YEAR_ABSENT == "isn't printed anywhere on this page")
raw, st = date_case("please check", "not a date")
snap = copy.deepcopy(raw)
check("F7: an unparseable straightened DATE never adopts", _deskew_retry_field_adopt(raw, st, ROLE, date_keys=DATES, enabled=True) == [] and raw == snap)

# ── 5. C4 — a machine-clearable straightened note gets the lane-hold appended ─────────────────────────
print("\n5. C4 (machine-clearable notes)")
check("the JS CLEARABLE_NOTE_MARKS twin: every JS mark is in the Python tuple",
      all(m in _DESKEW_MACHINE_CLEARABLE_MARKS for m in
          re.findall(r"""^\s*['"](.+?)['"],""", open(os.path.join(HERE, "..", "..", "src", "services", "classFixService.js"), encoding="utf-8")
                     .read().split("CLEARABLE_NOTE_MARKS = Object.freeze([")[1].split("]);")[0], re.M)))
check("class-F (_SHAPE_TRIM_NOTE) is machine-clearable; the TCA note is not; empty is",
      _deskew_note_machine_clearable(E._SHAPE_TRIM_NOTE) and not _deskew_note_machine_clearable(TCA_NOTE)
      and _deskew_note_machine_clearable(""))
raw = raw358(); st = straight358(); st["reference_number"]["validation_note"] = E._SHAPE_TRIM_NOTE
_deskew_retry_field_adopt(raw, st, ROLE, date_keys=DATES, enabled=True)
n = raw["reference_number"]["validation_note"]
check("C4: a class-F straightened note keeps its text AND gets the lane-hold appended",
      n.startswith(E._SHAPE_TRIM_NOTE) and n.endswith("— confirm once.") and "was 'VS-72672', now 'WS-73673'" in n)
raw = raw358(); st = straight358(); st["reference_number"]["validation_note"] = "A wider reading of this box shows WS-73673 — please check which is printed"
_deskew_retry_field_adopt(raw, st, ROLE, date_keys=DATES, enabled=True)
check("C4: a class-fix clearable mark also gets the lane-hold", raw["reference_number"]["validation_note"].endswith("— confirm once."))
raw = raw358(); st = straight358(); st["reference_number"].pop("validation_note")
_deskew_retry_field_adopt(raw, st, ROLE, date_keys=DATES, enabled=True)
check("no note on the adopted dict → the lane-hold is stamped", raw["reference_number"]["validation_note"] == _DESKEW_CHANGED_NOTE.format(was="VS-72672", now="WS-73673"))

# ── 6. disjointness from DESKEW_CORROB_AUTOFILE ───────────────────────────────────────────────────────
print("\n6. S4 disjointness")
_saved = PD._DESKEW_CORROB_AUTOFILE
PD._DESKEW_CORROB_AUTOFILE = True
try:
    raw = raw358(); st = straight358(); st["reference_number"].pop("validation_note")
    _deskew_retry_field_adopt(raw, st, ROLE, date_keys=DATES, enabled=True)
    check("with DESKEW_CORROB_AUTOFILE armed the field adopt STILL leaves a hold note", bool(str(raw["reference_number"].get("validation_note") or "").strip()))
finally:
    PD._DESKEW_CORROB_AUTOFILE = _saved

# ── 7. source pins ───────────────────────────────────────────────────────────────────────────────────
print("\n7. source pins")
src = open(os.path.join(os.path.dirname(HERE), "process_docs.py"), encoding="utf-8").read()
i_apply = src.find("_deskew_retry_apply_holds(raw_extractions, raw2)")
i_adopt = src.find("raw_extractions = raw2")
i_field = src.find("_deskew_retry_field_adopt(raw_extractions, raw2")
i_pull = src.find("# Pull out metadata keys")
check("C14 (parent) intact: apply_holds precedes the whole-doc assignment within 600 chars", 0 < i_apply < i_adopt and (i_adopt - i_apply) < 600)
check("the field adopt call sits AFTER the whole-doc assignment and BEFORE the metadata pops", i_adopt < i_field < i_pull)
check("the whole-doc adopt stays gated on the RAW engine flag (the note door never reaches it)", "if _raw_flag and _deskew_retry_adopt(_oc0, _oc1):" in src)
check("the door call site passes note_held from the door keys", "note_held=bool(_door_keys)" in src)
check("the switch reads == '1' (EMPTY never reads as ON)", 'os.environ.get("DESKEW_RETRY_FIELD_ADOPT", "0") == "1"' in src)
check("C9: the note-only else-branch log names the reason", "whole-doc adopt not applicable (note-only hold)" in src)
check("C9: the trace event carries the door", '"door": "flag" if _raw_flag else "note"' in src)
check("the field path never consults DESKEW_CORROB_AUTOFILE", "_DESKEW_CORROB_AUTOFILE" not in src[src.find("def _deskew_retry_field_adopt"):src.find("# ── Per-file watchdog")])
hs = open(os.path.join(os.path.dirname(HERE), "..", "src", "modules", "processing", "handler.js"), encoding="utf-8").read()
check("handler._reconcileEnv nests the child under the parent", "env.DESKEW_RETRY_FIELD_ADOPT = '1'" in hs
      and hs.find("env.DESKEW_REVIEW_RETRY = '1'") < hs.find("env.DESKEW_RETRY_FIELD_ADOPT = '1'")
      and "deskew_retry_field_adopt" in hs)

print("\nFAIL: " + ", ".join(fails) if fails else "\ntest_deskew_retry_field_adopt: all pins OK")
sys.exit(1 if fails else 0)
