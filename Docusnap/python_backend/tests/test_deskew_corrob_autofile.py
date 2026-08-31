"""
test_deskew_corrob_autofile.py — DESKEW_CORROB_AUTOFILE arc (owner ask 2026-08-31, Oracle SIGN-OFF-W/COND).

Drives _deskew_retry_apply_holds directly. The arc SKIPS the "Read differently after straightening —
confirm once" hold on a straighten-CHANGED field ONLY when it is a VERIFIED corroborated rescue:
  C2a  corroboration licensed (>=2 independent page families) AND a keyword page-text witness
  C2b/C2c/C3  the STRAIGHTENED value matches its learned skeleton (now_shape True)
  C4   the RAW read was NOT a credible competing reading (`was` empty OR its skeleton verdict False);
       a skeleton-valid `was` that merely differs KEEPS the note (two credible reads disagree -> human)
  C5   an emptied field holds
  C6   never file over a pre-existing note / corrected_to
Default OFF (module flag) -> byte-identical: the note is always placed.

Run:  py -3.12 python_backend/tests/test_deskew_corrob_autofile.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import process_docs as pd

fails = 0
def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1

DESKEW_NOTE_MARK = "after straightening"

def run(now, was, corrob, now_shape, was_shape, arc_on, prior_note=None, prior_ct=None):
    """Build a one-field raw/straightened pair, run apply_holds, return the field dict."""
    straight = {"invoice_number": {"value": now, "confidence": 90, "method": "anchor_crop_relocated"}}
    if prior_note:
        straight["invoice_number"]["validation_note"] = prior_note
    if prior_ct:
        straight["invoice_number"]["corrected_to"] = prior_ct
    straight["_corroboration_emit"] = {"invoice_number": corrob} if corrob else {}
    straight["_shape_ok"] = {} if now_shape is None else {"invoice_number": now_shape}
    raw = {"invoice_number": {"value": was, "confidence": 80, "method": "keyword"}}
    raw["_shape_ok"] = {} if was_shape is None else {"invoice_number": was_shape}
    pd._DESKEW_CORROB_AUTOFILE = bool(arc_on)
    pd._deskew_retry_apply_holds(raw, straight)
    return straight["invoice_number"]

def has_deskew_note(d):
    return DESKEW_NOTE_MARK in str(d.get("validation_note") or "")

LIC   = {"winner_family": "crop", "agree": ["keyword"], "disagree": [], "independent_agree": True}   # crop + keyword
NOKW  = {"winner_family": "crop", "agree": ["mapping"], "disagree": [], "independent_agree": True}    # crop + mapping, NO keyword
SINGLE= {"winner_family": "crop", "agree": [], "disagree": [], "independent_agree": True}             # one family
DIS   = {"winner_family": "crop", "agree": ["keyword"], "disagree": ["mapping"], "independent_agree": True}  # a disagree

print("DESKEW_CORROB_AUTOFILE — the skip decision")

# 1. the invoice_date-style rescue: was empty, now matches skeleton, corroborated + keyword, ON -> NO note
d = run("PI/26/7656", "", LIC, True, None, arc_on=True)
check("was empty + now shape-valid + corrob+keyword + ON -> NO hold (auto-files)", not has_deskew_note(d) and not d.get("corrected_to"))

# 2. the invoice_number-style rescue: was fails its skeleton (PO-29444 vs PI/NN/NNNN), now valid -> NO note
d = run("PI/26/7656", "PO-29444", LIC, True, False, arc_on=True)
check("was skeleton-FALSE + now shape-valid + corrob+keyword + ON -> NO hold", not has_deskew_note(d))

# 3. THE DANGER CASE: was is itself skeleton-valid and merely DIFFERS -> HOLD (two credible reads)
d = run("PI/26/7999", "PI/26/7656", LIC, True, True, arc_on=True)
check("was skeleton-TRUE (credible) and differs -> HOLD (never files over a correct raw read)", has_deskew_note(d))

# 4. OFF -> byte-identical: the note is always placed even on a perfect rescue
d = run("PI/26/7656", "", LIC, True, None, arc_on=False)
check("switch OFF -> note ALWAYS placed (byte-identical)", has_deskew_note(d))

# 5. uncorroborated (single family) -> HOLD
d = run("PI/26/7656", "", SINGLE, True, None, arc_on=True)
check("single-family corroboration -> HOLD", has_deskew_note(d))

# 6. corroborated but NO keyword witness (crop+mapping common-mode) -> HOLD
d = run("PI/26/7656", "", NOKW, True, None, arc_on=True)
check("crop+mapping, no keyword page-text witness -> HOLD (common-mode guard)", has_deskew_note(d))

# 7. a disagreeing family in the record -> HOLD
d = run("PI/26/7656", "", DIS, True, None, arc_on=True)
check("a disagree in the corroboration record -> HOLD", has_deskew_note(d))

# 8. now does NOT match the learned skeleton -> HOLD
d = run("PI/26/7656", "", LIC, False, None, arc_on=True)
check("now shape-FALSE -> HOLD", has_deskew_note(d))

# 9. now has NO learned skeleton verdict (fresh scope) -> HOLD (conservative — requires a matched skeleton)
d = run("PI/26/7656", "", LIC, None, None, arc_on=True)
check("now shape verdict ABSENT (no learned skeleton) -> HOLD (conservative)", has_deskew_note(d))

# 10. emptied field (now empty) -> HOLD (C5)
d = run("", "PI/26/7656", LIC, True, False, arc_on=True)
check("emptied field (now empty) -> HOLD (C5)", has_deskew_note(d))

# 11. a pre-existing note (e.g. learning-disagreement) is UNTOUCHED (C6 / one-note guard)
prior = "Read differently after learning — was 'PO-29444', now 'PI/26/7656'. Please check which is right."
d = run("PI/26/7656", "PO-29444", LIC, True, False, arc_on=True, prior_note=prior)
check("pre-existing (learning) note stands, arc does not touch it (C6)", d.get("validation_note") == prior)

# 12. a pre-existing corrected_to from another writer -> HOLD, never files over it (C6)
d = run("PI/26/7656", "", LIC, True, None, arc_on=True, prior_ct="SOMETHING-ELSE")
check("pre-existing corrected_to -> HOLD (never files over a pending correction)", has_deskew_note(d))

print(f"\n{fails} FAILED" if fails else "\nAll DESKEW_CORROB_AUTOFILE pins passed")
sys.exit(1 if fails else 0)
