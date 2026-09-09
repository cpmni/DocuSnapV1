#!/usr/bin/env python3
"""tests/test_pad_date_adopt.py — TEMPLATE_PAD_DATE_ADOPT (Q4, mig 143 DARK; gary design + reggie polarity).

The ADOPT twin of template_pad_date_containment_flag. A taught DATE box clipping the leading digit is READ
WIDE (template_mapper Case 3); today the tight (wrong) value is KEPT and only flagged (`_paddisagree`), so a
doc whose correct date is proven by the wider read + a keyword capture is HELD for a human. `_adopt_pad_date_
winners` SWAPS to the pad value IFF a second page family calendar-agrees with it AND it is page-present AND
the tight read is the uncorroborated outlier — then the corroborated correct date auto-files.

This pins the ADOPT and every trade-off gary/Oracle named so a future dev can't loosen one silently:
  - ADOPT: 2nd family agrees + page-present + tight outlier  -> swap, conf>=90, flags cleared, mapping method
  - NO adopt: arc OFF (byte-identical; witness still popped)
  - NO adopt: lone pad (no 2nd family agrees)  -> the held flag stays
  - NO adopt: the tight read is itself corroborated  -> never override a corroborated commit
  - NO adopt: pad value not page-present  -> fail toward the existing commit
  - NO adopt: calendar-EQUAL tight vs pad (a would-be Case-2)  -> nothing to do
  - the witness is ALWAYS popped (never persists), OFF or ON, adopted or not

Run: py -3.12 python_backend/tests/test_pad_date_adopt.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as E

fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1

DATE_KEYS = ("invoice_date",)
# The exhibit: taught box clips the leading '1' -> tight reads '4-10-2026', the page + keyword print
# '14-10-2026'. reggie's leading-digit-clip family (D-MM vs DD-MM). Page text carries the real date.
PAGE = "Invoice   Date 14/10/2026   Total 100.00   Account 55231"
def tight_win(method="template_mapping_paddisagree", value="4-10-2026", witness="14-10-2026", note="check it"):
    d = {"value": value, "confidence": 70, "method": method}
    if note is not None:
        d["validation_note"] = note
    if witness is not None:
        d["_pad_date_witness"] = witness
    return d

def kw_cand(value="14-10-2026"):
    return {"value": value, "method": "keyword", "stage": "1_keyword"}

def run(results, cands, on=True, keys=DATE_KEYS, page=PAGE):
    return E._adopt_pad_date_winners(results, cands, keys, page, on)

# ── ADOPT: the full corroborated exhibit ────────────────────────────────────────────────────────────
r = {"invoice_date": tight_win()}
adopted = run(r, {"invoice_date": [kw_cand()]})
w = r["invoice_date"]
check("ADOPT: returns the adopted date key", adopted == ["invoice_date"])
check("ADOPT: value swapped to the corroborated pad read", w.get("value") == "14-10-2026")
check("ADOPT: confidence lifted to >=90 (clears the 88 floor)", (w.get("confidence") or 0) >= 90)
check("ADOPT: method bucketed to mapping (template_mapping_padadopt)", w.get("method") == "template_mapping_padadopt")
check("ADOPT: the hold flag is cleared (validation_note/corrected_to/was_corrected gone)",
      not w.get("validation_note") and not w.get("corrected_to") and not w.get("was_corrected"))
check("ADOPT: the transient witness is popped (never persists)", "_pad_date_witness" not in w)
# the adopted winner + its keyword candidate now license the corroboration record on 2 page families
_rec_ok = E._corrob_record_bucket(None, w["method"])[0] == "mapping" and \
          E._corrob_record_bucket("1_keyword", "keyword")[0] == "keyword"
check("ADOPT: winner->mapping and the agree->keyword are DISTINCT page families (record will license)", _rec_ok)

# ── OFF: byte-identical (no swap), witness still popped ──────────────────────────────────────────────
r = {"invoice_date": tight_win()}
adopted = run(r, {"invoice_date": [kw_cand()]}, on=False)
w = r["invoice_date"]
check("OFF: no adopt (arc off)", adopted == [] and w.get("value") == "4-10-2026" and w.get("validation_note"))
check("OFF: the witness is STILL popped (never persists even off)", "_pad_date_witness" not in w)

# ── NO adopt: lone pad (no second family agrees) — the held flag stays ───────────────────────────────
r = {"invoice_date": tight_win()}
adopted = run(r, {"invoice_date": []})               # no candidates at all
w = r["invoice_date"]
check("NO adopt (lone pad): value + flag unchanged", adopted == [] and w.get("value") == "4-10-2026" and w.get("validation_note"))
check("NO adopt (lone pad): witness popped", "_pad_date_witness" not in w)
# a candidate that DISAGREES with the pad is not a second-family agreement either
r = {"invoice_date": tight_win()}
adopted = run(r, {"invoice_date": [kw_cand("9-09-2026")]})
check("NO adopt: a keyword candidate that disagrees with pad does not license", adopted == [])

# ── NO adopt: the tight read is itself corroborated (never override a corroborated commit) ────────────
# page prints the TIGHT value too -> _fallthrough_critical_corroborated(tight) True -> hold the swap.
r = {"invoice_date": tight_win(value="4-10-2026")}
adopted = run(r, {"invoice_date": [kw_cand()]}, page="Date 4/10/2026 and also 14/10/2026")
check("NO adopt: tight read corroborated on the page -> not overridden", adopted == [])

# ── NO adopt: pad value not page-present ─────────────────────────────────────────────────────────────
r = {"invoice_date": tight_win()}
adopted = run(r, {"invoice_date": [kw_cand()]}, page="Invoice Total 100.00 Account 55231")
check("NO adopt: pad value absent from the page -> fail toward the existing commit", adopted == [])

# ── NO adopt: calendar-EQUAL tight vs pad (a would-be Case-2, defensive) ─────────────────────────────
r = {"invoice_date": tight_win(value="14-10-2026", witness="14/10/2026")}
adopted = run(r, {"invoice_date": [kw_cand()]})
check("NO adopt: tight == pad calendar-equal -> nothing to do", adopted == [])

# ── scope: only the structural DATE role is adoptable; method must end _paddisagree ──────────────────
r = {"some_other_date": tight_win()}                 # a date-typed field NOT in date_field_keys
adopted = run(r, {"some_other_date": [kw_cand()]})
check("SCOPE: a non-role date field is not adopted", adopted == [])
check("SCOPE: the witness is popped from the non-role field too (never persists)",
      "_pad_date_witness" not in r["some_other_date"])
r = {"invoice_date": tight_win(method="template_mapping")}   # not a _paddisagree winner
adopted = run(r, {"invoice_date": [kw_cand()]})
check("SCOPE: a non-_paddisagree winner is not adopted", adopted == [])

# ── ADOPT above the containment hold: a `_padcontain` winner (mig 132) is the clipped-first-digit family;
#    adopt must win over its corrected_to hold when corroborated (else the Q4 exhibit stays held on a
#    -TEST build where containment is also armed). ─────────────────────────────────────────────────────
r = {"invoice_date": {"value": "5-03-2026", "confidence": 70, "method": "template_mapping_padcontain",
                      "validation_note": "check it", "corrected_to": "25-03-2026",
                      "_pad_date_witness": "25-03-2026"}}
adopted = run(r, {"invoice_date": [kw_cand("25-03-2026")]}, page="Date 25/03/2026 Ref 88213")
w = r["invoice_date"]
check("ADOPT over containment: a corroborated _padcontain winner is adopted",
      adopted == ["invoice_date"] and w.get("value") == "25-03-2026")
check("ADOPT over containment: the corrected_to hold is cleared", not w.get("corrected_to") and not w.get("validation_note"))

# ── mapper stash: _maybe_pad_date_flag stashes the witness on Case-3 ONLY when the adopt arc is on ────
from extraction import template_mapper as tm
_orig_read = tm._read_pad_window_date
_orig_win, _orig_adopt, _orig_contain = tm._PAD_WINDOW_READ_ON, tm._PAD_DATE_ADOPT_ON, tm._PAD_DATE_CONTAINMENT_ON
try:
    tm._PAD_WINDOW_READ_ON = True
    tm._PAD_DATE_CONTAINMENT_ON = False          # isolate the Case-3 disagree path
    tm._read_pad_window_date = lambda page, box: ("14-10-2026", 95)   # confident, different calendar date
    res = {"value": "4-10-2026", "confidence": 70, "method": "template_mapping"}
    tm._PAD_DATE_ADOPT_ON = True
    out_on = tm._maybe_pad_date_flag(None, {}, "date", dict(res), 70)
    check("mapper stash ON: Case-3 result carries _pad_date_witness == the pad read",
          out_on.get("method", "").endswith("_paddisagree") and out_on.get("_pad_date_witness") == "14-10-2026")
    tm._PAD_DATE_ADOPT_ON = False
    out_off = tm._maybe_pad_date_flag(None, {}, "date", dict(res), 70)
    check("mapper stash OFF: Case-3 result has NO witness (byte-identical to pre-arc)",
          out_off.get("method", "").endswith("_paddisagree") and "_pad_date_witness" not in out_off)
finally:
    tm._read_pad_window_date = _orig_read
    tm._PAD_WINDOW_READ_ON, tm._PAD_DATE_ADOPT_ON, tm._PAD_DATE_CONTAINMENT_ON = _orig_win, _orig_adopt, _orig_contain

print(("\n%d FAILED" % fails) if fails else "\nAll pad-date-adopt pins passed")
sys.exit(1 if fails else 0)
