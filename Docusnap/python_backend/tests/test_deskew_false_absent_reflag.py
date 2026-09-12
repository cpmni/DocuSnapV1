"""test_deskew_false_absent_reflag.py — PINs for DESKEW_FALSE_ABSENT_REFLAG (mig 163, DARK; gary → Oracle:
SEND BACK the note-DROP/auto-file "release" leg, SIGN OFF WITH CONDITIONS on this HOLD leg, 2026-09-12;
docs/designs/DESKEW_FALSE_ABSENT_REFLAG_2026-09-12.md).

The 6 Saltmarsh delivery-note class (the mirror of the #358 skew): a ~1.5° skew garbles the whole-page text
token → Gate C falsely marks the role field page-ABSENT (−12 penalty, held) even though the crop read the value
right and the page PRINTS it. When the straighten retry re-reads the SAME value with a keyword page-text witness
(no disagree), Phase-1 REPLACES the false absent note with a truthful "— confirm once." hold. Removes NO
checkpoint (still held; a role note is never soft). Value / confidence / method / overall / _needs_review are all
UNCHANGED — ONLY the note text. Measured census (`TESTING/_measure/deskew_hold_release_20260912/CENSUS.md`):
3/6 reflag correct (#130/#139/#140), #145 refused by F2 (its straighten HEALS to the correct DN-42798 → a
CHANGED value → mig-162's job), #144 by F3 (straightened mapping disagrees IN.96479), #136 by F4a (straightened
still absent). 0 wrong. The RELEASE (note-DROP → auto-file) leg is SEND BACK — see the design doc / oracle_log.

RED-first: `_deskew_retry_false_absent_reflag` / `_DESKEW_VERIFIED_NOTE` do not exist on pre-change code.
Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_deskew_false_absent_reflag.py
"""
import copy, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from process_docs import (_deskew_retry_false_absent_reflag, _deskew_field_adopt_door_keys,
                          _DESKEW_VERIFIED_NOTE, _DESKEW_MACHINE_CLEARABLE_MARKS)
import process_docs as PD
from extraction import engine as E

fails = []
def check(name, cond):
    print(f"  {'OK ' if cond else 'BAD'} {name}")
    if not cond:
        fails.append(name)

ABSENT = E._FILING_SANITY_ABSENT_MARK
YEAR_ABSENT = E._FILING_SANITY_YEAR_ABSENT_MARK
ABSENT_NOTE = E._FILING_SANITY_ABSENT_NOTE          # full Gate-C note template (contains ABSENT mark)
ROLE = {"supplier_name", "delivery_number", "delivery_date"}
DATES = {"delivery_date"}
V = "DN-92961"
# a keyword-LICENSED straightened record: >=2 independent page families, no disagree, a keyword page witness
LIC = {"winner_family": "crop", "agree": ["keyword", "mapping"], "disagree": [], "independent_agree": True}

def raw_sm(val=V, note=None, method="template_mapping"):
    """A Saltmarsh delivery note held ONLY by a false page-absent note on the ref role (engine _needs_review
    False). `note` defaults to Gate C's absent note for `val`."""
    return {
        "_supplier_name": "Saltmarsh Seafoods", "_template_id": 7, "_needs_review": False,
        "_overall_confidence": 82,
        "_shape_ok": {"delivery_number": True},
        "_corroboration_emit": {
            "delivery_number": {"winner_family": "mapping", "agree": [], "disagree": [], "independent_agree": False}},
        "supplier_name": {"value": "Saltmarsh Seafoods", "confidence": 95, "method": "template_fixed"},
        "delivery_date": {"value": "07-02-2026", "confidence": 98, "method": "template_mapping"},
        "delivery_number": {"value": val, "confidence": 90, "method": method,
                            "validation_note": (ABSENT_NOTE.format(val) if note is None else note)},
    }

def straight_sm(val=V, rec=None, note="", method="anchor_crop"):
    return {
        "_supplier_name": "Saltmarsh Seafoods", "_template_id": 7, "_needs_review": False,
        "_overall_confidence": 100,
        "_shape_ok": {"delivery_number": True},
        "_corroboration_emit": {"delivery_number": dict(rec if rec is not None else LIC)},
        "supplier_name": {"value": "Saltmarsh Seafoods", "confidence": 95, "method": "template_fixed"},
        "delivery_date": {"value": "07-02-2026", "confidence": 98, "method": "template_mapping"},
        "delivery_number": {"value": val, "confidence": 89, "method": method, "validation_note": note},
    }

# ── 1. the truthful note itself (Oracle P2) ────────────────────────────────────────────────────────────
print("\n1. the truthful note (P2: a lane-hold, out of every machine-clearable mark)")
VN = _DESKEW_VERIFIED_NOTE.format(val=V)
check("the note ends with '— confirm once.' (handler._isLaneHoldNote lane-hold family)", VN.endswith("— confirm once."))
check("the note contains NONE of the machine-clearable marks (Python twin of CLEARABLE_NOTE_MARKS)",
      not any(m in VN for m in _DESKEW_MACHINE_CLEARABLE_MARKS))
check("the note does NOT contain the page-absent mark (it replaces it, is not it)", ABSENT not in VN)
check("the note is NOT a class-F verification-doubt mark (P2, the Python half — never machine-cleared)",
      not E._is_verification_doubt_note(VN))

# ── 2. the fire (the 3-correct shape: #130/#139/#140) ──────────────────────────────────────────────────
print("\n2. reflag fires on a keyword-corroborated, unchanged, on-page role value")
raw, st = raw_sm(), straight_sm()
before = copy.deepcopy(raw)
out = _deskew_retry_false_absent_reflag(raw, st, ROLE, date_keys=DATES, enabled=True)
check("returns [(delivery_number, V)]", out == [("delivery_number", V)])
check("the ref note is now the TRUTHFUL note (the false absent note is gone)", raw["delivery_number"]["validation_note"] == VN)
check("F2 safety: the VALUE is unchanged", raw["delivery_number"]["value"] == V)
check("confidence UNCHANGED (raw's, not straightened's)", raw["delivery_number"]["confidence"] == before["delivery_number"]["confidence"])
check("method UNCHANGED (raw's)", raw["delivery_number"]["method"] == before["delivery_number"]["method"])
check("_overall_confidence UNCHANGED (still held; the release/auto-file leg was SEND BACK)", raw["_overall_confidence"] == 82)
check("_needs_review UNTOUCHED", raw["_needs_review"] == before["_needs_review"])
check("no _overall_confidence inheritance from the straightened pass (the Q2 seam is not built)", raw["_overall_confidence"] != st["_overall_confidence"])
check("sibling fields untouched", raw["supplier_name"] == before["supplier_name"] and raw["delivery_date"] == before["delivery_date"])

# ── 3. #145 — the landmine: a CHANGED value is mig-162's job, never re-flagged here (F2) ────────────────
print("\n3. #145 refuse by F2 (straighten HEALS the garble → CHANGED value → mig 162, not this)")
raw = raw_sm(val="DN-42", note=ABSENT_NOTE.format("DN-42"))
st = straight_sm(val="DN-42798")     # straightened reads the CORRECT, CHANGED value
before = copy.deepcopy(raw)
out = _deskew_retry_false_absent_reflag(raw, st, ROLE, date_keys=DATES, enabled=True)
check("returns [] (value changed)", out == [])
check("raw is byte-identical (the false-DN-42 hold is untouched → never auto-filed)", raw == before)

# ── 4. #144 — F3: the straightened frame has a disagree ─────────────────────────────────────────────────
print("\n4. #144 refuse by F3 (straightened mapping disagrees)")
raw = raw_sm()
st = straight_sm(rec={"winner_family": "crop", "agree": ["keyword"],
                      "disagree": [{"family": "mapping", "value": "IN.96479"}], "independent_agree": True})
before = copy.deepcopy(raw)
check("returns [] (disagree != [] → not keyword-licensed)", _deskew_retry_false_absent_reflag(raw, st, ROLE, date_keys=DATES, enabled=True) == [])
check("raw byte-identical", raw == before)

# S2 near-miss: a truncation garble whose page keyword reads the true longer token DISAGREES → refuse.
raw = raw_sm(val="DN-42", note=ABSENT_NOTE.format("DN-42"))
st = straight_sm(val="DN-42", rec={"winner_family": "crop", "agree": [],
                                   "disagree": [{"family": "keyword", "value": "DN-42798"}], "independent_agree": False})
check("S2: a truncation garble (DN-42) whose keyword reads DN-42798 disagrees → refuse", _deskew_retry_false_absent_reflag(raw, st, ROLE, date_keys=DATES, enabled=True) == [])

# ── 5. #136 — F4a: the straightened field STILL carries the absent mark ─────────────────────────────────
print("\n5. #136 refuse by F4a (straightened pass STILL can't find it → note persists)")
raw = raw_sm()
st = straight_sm(note=ABSENT_NOTE.format(V))          # licensed, but the straightened note is still absent
before = copy.deepcopy(raw)
check("returns [] (straightened note carries the absent mark)", _deskew_retry_false_absent_reflag(raw, st, ROLE, date_keys=DATES, enabled=True) == [])
check("raw byte-identical", raw == before)

# ── 6. the entry gate + door refusals ───────────────────────────────────────────────────────────────────
print("\n6. entry gate (absent mark ONLY) + door refusals + identity + enabled")
raw = raw_sm(note="The reference may be a shape mismatch — please check.")   # a NON-absent note
check("entry gate: a non-absent role note is out of scope → []", _deskew_retry_false_absent_reflag(raw, straight_sm(), ROLE, date_keys=DATES, enabled=True) == [])

sup = raw_sm(); sup["delivery_number"].pop("validation_note")
sup["supplier_name"]["validation_note"] = ABSENT_NOTE.format("Saltmarsh Seafoods")
check("supplier_name is never a door key (identity invariant) → []", _deskew_retry_false_absent_reflag(sup, straight_sm(), ROLE, date_keys=DATES, enabled=True) == [])

cto = raw_sm(); cto["delivery_number"]["corrected_to"] = "X"
check("a corrected_to ref is not a door key → []", _deskew_retry_false_absent_reflag(cto, straight_sm(), ROLE, date_keys=DATES, enabled=True) == [])
wc = raw_sm(); wc["delivery_number"]["was_corrected"] = True
check("a was_corrected ref is not a door key → []", _deskew_retry_false_absent_reflag(wc, straight_sm(), ROLE, date_keys=DATES, enabled=True) == [])
hum = raw_sm(method="keyword_override")
check("a human/authoritative method (keyword_override) is not a door key → []", _deskew_retry_false_absent_reflag(hum, straight_sm(), ROLE, date_keys=DATES, enabled=True) == [])

diff = straight_sm(); diff["_template_id"] = 99
check("C5: a different template → [] (never splice a note verified under another scope)", _deskew_retry_false_absent_reflag(raw_sm(), diff, ROLE, date_keys=DATES, enabled=True) == [])
diffsup = straight_sm(); diffsup["_supplier_name"] = "Someone Else"
check("C5: a different supplier → []", _deskew_retry_false_absent_reflag(raw_sm(), diffsup, ROLE, date_keys=DATES, enabled=True) == [])

r0 = raw_sm(); b0 = copy.deepcopy(r0)
check("enabled=False → [] and raw byte-identical (OFF)", _deskew_retry_false_absent_reflag(r0, straight_sm(), ROLE, date_keys=DATES, enabled=False) == [] and r0 == b0)

# ── 7. mutual exclusion with mig 162 (exclude) ──────────────────────────────────────────────────────────
print("\n7. exclude = the mig-162-adopted keys (162/163 disjoint by build)")
raw, st = raw_sm(), straight_sm()
check("a key in `exclude` is skipped even when it would otherwise reflag", _deskew_retry_false_absent_reflag(raw, st, ROLE, date_keys=DATES, exclude={"delivery_number"}, enabled=True) == [])

# ── 8. date-role variant (YEAR-ABSENT) ──────────────────────────────────────────────────────────────────
print("\n8. date role: the YEAR-ABSENT mark, unchanged + corroborated → reflag; changed → refuse")
rawd = raw_sm()
rawd["delivery_date"]["validation_note"] = f"The document year {YEAR_ABSENT} — please check the date before filing."
rawd["delivery_number"].pop("validation_note")     # only the date is noted now
std = straight_sm()
std["_corroboration_emit"] = {"delivery_date": dict(LIC)}
std["delivery_date"]["validation_note"] = ""
outd = _deskew_retry_false_absent_reflag(rawd, std, ROLE, date_keys=DATES, enabled=True)
check("date role reflags on YEAR-ABSENT + unchanged + corroborated", outd == [("delivery_date", "07-02-2026")])
check("the date note is now truthful", rawd["delivery_date"]["validation_note"] == _DESKEW_VERIFIED_NOTE.format(val="07-02-2026"))

# ── 9. SOURCE pins (the call site + the door + the env read) ─────────────────────────────────────────────
print("\n9. source pins")
SRC = open(os.path.join(os.path.dirname(HERE), "process_docs.py"), encoding="utf-8").read()
check("the door opens on `_fa_on or _hr_reflag_on`", "if (_fa_on or _hr_reflag_on) else []" in SRC)
check("`_hr_reflag_on = _DESKEW_FALSE_ABSENT_REFLAG_ON` is set", "_hr_reflag_on = _DESKEW_FALSE_ABSENT_REFLAG_ON" in SRC)
check("the reflag call passes exclude = the mig-162-adopted keys", "exclude={_k for _k, _w, _n in _fa}" in SRC)
check("the env const reads DESKEW_FALSE_ABSENT_REFLAG with the == '1' guard (EMPTY never ON)",
      'os.environ.get("DESKEW_FALSE_ABSENT_REFLAG", "0") == "1"' in SRC)
check("the reflag runs AFTER the mig-162 field-adopt loop (below `if _fa_on:`)",
      SRC.find("if _hr_reflag_on:") > SRC.find("if _fa_on:") > 0)

print(f"\n{'ALL OK' if not fails else 'FAILURES: ' + '; '.join(fails)} ({'0' if not fails else len(fails)} bad)")
sys.exit(1 if fails else 0)
