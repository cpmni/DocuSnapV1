"""Pins the SAFETY invariants of the review-bound whole-page straighten retry
(DESKEW_SLICE_REREAD_2026-08-30, revised — see process_docs.py). A future dev must not be able to quietly:
  - drop the "only on a doc already review-bound" gate (which is what stops it demoting a clean auto-file),
  - run it on an already-deskewed run or a reprocess, and
  - loosen the adopt comparison from STRICTLY-higher (a tie/drop must keep the raw read — no regression).
Pure-function pins only (no OCR); the corpus heal rate is proven by the Nordwind census, not here."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from process_docs import (_deskew_retry_should_run, _deskew_retry_adopt,
                          _deskew_retry_changed_fields, _deskew_retry_apply_holds, _DESKEW_CHANGED_NOTE,
                          _put_back_offerable)

fails = []
def check(name, cond):
    if not cond: fails.append(name)

# ── the review bind (2026-08-30 dead-guard correction): the ADOPTED read holds on the fields it CHANGED ──
# `_needs_review=True` is consulted by the handler only when autofile_gate_unify is OFF (ON on every mig-93
# install), so the retry's charter "never silently auto-files a straightened read" needs a NOTE — a member of
# the "— confirm once." lane-hold family, on exactly the changed fields, naming was/now.
raw = {"_overall_confidence": 80, "supplier_name": {"value": "Jordwind Refrigeration Ltd", "confidence": 88},
       "quote_number": {"value": "NRQ-1", "confidence": 90}, "quote_date": {"value": "", "confidence": 0},
       "total_amount": {"value": "1.00", "confidence": 90, "validation_note": "existing writer note"}}
straight = {"_overall_confidence": 96, "supplier_name": {"value": "Nordwind Refrigeration Ltd", "confidence": 95},
            "quote_number": {"value": "NRQ-1", "confidence": 97}, "quote_date": {"value": "01-02-2026", "confidence": 98},
            "total_amount": {"value": "2.00", "confidence": 92, "validation_note": "existing writer note"}}
chg = _deskew_retry_changed_fields(raw, straight)
check("changed = identity (garble healed) + first-filled date + total; NOT the unchanged ref",
      sorted(k for k, _w, _n in chg) == ["quote_date", "supplier_name", "total_amount"])
check("was/now carried", ("supplier_name", "Jordwind Refrigeration Ltd", "Nordwind Refrigeration Ltd") in chg
      and ("quote_date", "", "01-02-2026") in chg)
_deskew_retry_apply_holds(raw, straight)
check("changed identity carries the confirm-once note",
      straight["supplier_name"].get("validation_note") == _DESKEW_CHANGED_NOTE.format(was="Jordwind Refrigeration Ltd", now="Nordwind Refrigeration Ltd"))
check("first-filled date says was (empty)", "was '(empty)'" in straight["quote_date"].get("validation_note", ""))
check("the note is a lane-hold family member ('— confirm once.')", straight["supplier_name"]["validation_note"].endswith("— confirm once."))
check("unchanged ref gets NO note", not straight["quote_number"].get("validation_note"))
check("an existing writer note is never overwritten (one note per field)", straight["total_amount"]["validation_note"] == "existing writer note")
check("metadata keys ignored; a field empty on BOTH sides never counts",
      _deskew_retry_changed_fields({"a": {"value": ""}}, {"_m": 1, "a": {"value": ""}}) == [])
check("whitespace-only differences are not changes",
      _deskew_retry_changed_fields({"a": {"value": "PO  1"}}, {"a": {"value": "PO 1"}}) == [])
# Oracle C12: a field the straightened read EMPTIED is a change (a raw value lost on adopt must be seen)
_raw_e = {"po_ref": {"value": "PO-77", "confidence": 80}}
_str_e = {"_overall_confidence": 90}
check("C12: a raw value the straightened read LOST counts as a change (was 'PO-77', now '')",
      _deskew_retry_changed_fields(_raw_e, _str_e) == [("po_ref", "PO-77", "")])
_deskew_retry_apply_holds(_raw_e, _str_e)
check("C12: the emptied field gets a STUB row with the note + corrected_to = the raw value (plausible -> one-click put-back)",
      _str_e.get("po_ref", {}).get("value") == "" and "was 'PO-77', now '(empty)'" in _str_e["po_ref"]["validation_note"]
      and _str_e["po_ref"]["corrected_to"] == "PO-77" and _str_e["po_ref"]["validation_note"].endswith("— confirm once."))
# Oracle C13: the charter is FIELD-level — a same-value confidence lift is NOT a change and gets no note
check("C13: same value at a higher confidence -> no note (files through the normal predicate)",
      _deskew_retry_changed_fields({"a": {"value": "NRQ-1", "confidence": 60}}, {"a": {"value": "NRQ-1", "confidence": 95}}) == [])
# THE LIVE EXHIBIT (owner, 2026-08-30 20:15): skew garbled the raw date to '42-04-2025'; the straightened
# read fixed it to '12-04-2025' — and the hold offered `Use "42-04-2025"` (a day-42 date) as a one-click
# button. The put-back may NEVER offer a type-implausible value (rereadHolds C1 / the normaliseDate rule).
check("put-back: a garbled raw DATE ('42-04-2025' vs now '12-04-2025') gets NO button",
      not _put_back_offerable("42-04-2025", "12-04-2025"))
check("put-back: a VALID raw date does", _put_back_offerable("11-04-2025", "12-04-2025"))
check("put-back: garbled raw MONEY ('£9 32632.76' vs now '2,363.76') gets NO button",
      not _put_back_offerable("£9 32632.76", "2,363.76"))
check("put-back: valid raw money does", _put_back_offerable("2,463.76", "2,363.76"))
check("put-back: free text offers any non-empty old", _put_back_offerable("Jordwind Ltd", "Nordwind Ltd")
      and not _put_back_offerable("", "Nordwind Ltd"))
check("put-back: the USEFUL inverse (new is garbage, old valid) still offers the old",
      _put_back_offerable("12-04-2025", "42-04-2025"))
_raw_g = {"statement_date": {"value": "42-04-2025", "confidence": 88}}
_str_g = {"statement_date": {"value": "12-04-2025", "confidence": 96}}
_deskew_retry_apply_holds(_raw_g, _str_g)
check("apply: the exhibit — note names the garble, but corrected_to is ABSENT (no Use button)",
      "was '42-04-2025', now '12-04-2025'" in _str_g["statement_date"]["validation_note"]
      and not str(_str_g["statement_date"].get("corrected_to") or "").strip())
_raw_v = {"invoice_date": {"value": "11-04-2025", "confidence": 88}}
_str_v = {"invoice_date": {"value": "12-04-2025", "confidence": 96}}
_deskew_retry_apply_holds(_raw_v, _str_v)
check("apply: a plausible raw date still gets the one-click put-back", _str_v["invoice_date"].get("corrected_to") == "11-04-2025")
# Oracle C14: the holds are applied BEFORE the adopt assignment, inside the retry block, so the note reaches
# the emitted extractions (and trust.js's `flagged` refusal) — a helper-only pin would be a vacuous guard.
_src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "process_docs.py"), encoding="utf-8").read()
_i_apply = _src.find("_deskew_retry_apply_holds(raw_extractions, raw2)")
_i_adopt = _src.find("raw_extractions = raw2")
check("C14: _deskew_retry_apply_holds(raw_extractions, raw2) runs BEFORE `raw_extractions = raw2` in the retry block",
      0 < _i_apply < _i_adopt and (_i_adopt - _i_apply) < 600)
check("C14: the note is a member of the handler's lane-hold family (_isLaneHoldNote reads '— confirm once.')",
      _DESKEW_CHANGED_NOTE.endswith("— confirm once."))

# ── gate: runs ONLY when enabled AND review-bound AND not deskewed AND not reextract AND has pages ──
check("all-true runs",        _deskew_retry_should_run(True,  True,  False, False, True)  is True)
check("disabled  -> no",      _deskew_retry_should_run(False, True,  False, False, True)  is False)
check("auto-file -> no",      _deskew_retry_should_run(True,  False, False, False, True)  is False)  # never demote a clean auto-file
check("already-deskew -> no", _deskew_retry_should_run(True,  True,  True,  False, True)  is False)
check("reextract  -> no",     _deskew_retry_should_run(True,  True,  False, True,  True)  is False)
check("no pages   -> no",     _deskew_retry_should_run(True,  True,  False, False, False) is False)

# ── adopt: STRICTLY higher overall only ──
check("higher  -> adopt",     _deskew_retry_adopt(90, 97) is True)
check("equal   -> keep raw",  _deskew_retry_adopt(97, 97) is False)
check("lower   -> keep raw",  _deskew_retry_adopt(97, 80) is False)
check("from 0  -> adopt",     _deskew_retry_adopt(0, 60)  is True)
check("None base tolerant",   _deskew_retry_adopt(None, 50) is True)
check("None both -> keep",    _deskew_retry_adopt(None, None) is False)
check("garbage -> keep raw",  _deskew_retry_adopt("x", "y") is False)

if fails:
    print("FAIL:", ", ".join(fails)); sys.exit(1)
print("test_deskew_review_retry: 36/36 OK")
