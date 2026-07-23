"""
test_gate_reread_clean.py — pins the Stage-4.5 gate-reread NORMALISATION-ONLY clean accept
(Oracle-signed 2026-07-23, conditions C1-C5). Run: py -3.12 python_backend/tests/test_gate_reread_clean.py

WHAT THIS PINS. The gate-failure re-read recovers a format-failing value by tight-crop re-reading
the page. Every adopted recovery used to be REVIEW-BOUND (cap 69 + "re-read from the page (was
...)" note + the doc-level format_anomaly flag) — even when the "correction" was a stray space
("DN -99718" -> "DN-99718"), which reads to an operator as a correction message with no correction,
and permanently holds the doc. The clean accept: when the re-read agrees with the original on EVERY
alphanumeric character (the 0-edit subset of targeted_reread's kinship band), it is two independent
reads (full-page pass vs crop ladder) agreeing on the content -> accept clean, un-noted, un-capped.

THE BLOCKING ORACLE CATCH (C1, pins F/G): for DATES, core equality is NOT value equality — separator
POSITION is semantic: '1/12/2026' and '11/2/2026' share the core '1122026' but are different days.
Dates require BOTH sides to PARSE and be CALENDAR-EQUAL; an unparseable side is NEVER clean. Do NOT
loosen this to _reads_disagree (its unparseable polarity is fail-open here).

ANTI-LOOSEN (pin B): a REAL character repair (1-2 edits, 'IN-'->'DN-') must STAY review-bound.
A future dev must not widen the clean accept beyond 0-edit — that silently auto-files a mangled read.
"""
import os, sys
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))
from extraction.engine import _reread_is_normalisation_only as clean

fails = 0
def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1

print("Pin A — normalisation-only recoveries CLEAN-ACCEPT:")
check("whitespace-only ref: 'DN -99718' -> 'DN-99718' -> True", clean("DN -99718", "DN-99718", "reference") is True)
check("case-only ref: 'dn-99718' -> 'DN-99718' -> True", clean("dn-99718", "DN-99718", "reference") is True)
# Deliberate, Oracle-accepted trade-off: a separator-glyph swap on a ref clean-accepts (the
# identifying content agrees; every downstream compare is separator/case-insensitive). Recorded
# here so a future reader knows it was chosen, not missed.
check("separator swap ref: 'DN/99718' -> 'DN-99718' -> True (pinned trade-off)", clean("DN/99718", "DN-99718", "reference") is True)

print("\nPin B — real character repairs STAY review-bound (anti-loosen):")
check("1-edit ref: 'IN-23333' -> 'DN-23333' -> False", clean("IN-23333", "DN-23333", "reference") is False)
check("digit change: 'DN-99718' -> 'DN-99719' -> False", clean("DN-99718", "DN-99719", "reference") is False)
check("empty garble -> False", clean("", "DN-1", "reference") is False)
check("punctuation-only (empty cores) -> False", clean("--", "-", "reference") is False)

print("\nPin F — DATE: core equality is NOT calendar equality (Oracle C1, blocking):")
check("'1/12/2026' vs '11/2/2026' (same core 1122026, different days) -> False", clean("1/12/2026", "11/2/2026", "date") is False)
check("'20/05/2026' vs '20-05-2026' (separator-only, SAME day) -> True", clean("20/05/2026", "20-05-2026", "date") is True)

print("\nPin G — an unparseable side is never clean on a date:")
check("'20/05/20 26' (unparseable) -> '20/05/2026' -> False", clean("20/05/20 26", "20/05/2026", "date") is False)

print("\nDate-shaped content on a NON-date field gets the same calendar bar:")
check("text field, '1/12/2026' vs '11/2/2026' -> False", clean("1/12/2026", "11/2/2026", "text") is False)
check("text field, '20/05/2026' vs '20-05-2026' -> True", clean("20/05/2026", "20-05-2026", "text") is True)

print("\nWiring (source) — kill switch, clean return shape, call-site skip:")
eng = open(os.path.join(_HERE, '..', 'extraction', 'engine.py'), encoding='utf-8').read()
i = eng.find("if GATE_REREAD_CLEAN_ACCEPT and _reread_is_normalisation_only(")
check("clean branch is gated on GATE_REREAD_CLEAN_ACCEPT (OFF => review-bound legacy, byte-identical)", i > -1)
# Slice exactly the clean RETURN DICT (from its log line to the review-bound log line), so the
# explanatory comments above it can't false-trip the "no flag keys" assertion.
cs = eng.find("(normalisation-only — accepted clean)", i)
ce = eng.find("(review-bound)", cs)
blk = eng[cs:ce] if (cs > -1 and ce > cs) else ""
check("clean return carries reread_clean and NO cap/was_corrected/corrected_to/validation_note",
      "'reread_clean':  True" in blk
      and "'was_corrected'" not in blk and "'corrected_to'" not in blk
      and "'validation_note'" not in blk and "_REREAD_CAP" not in blk)
j = eng.find("_reread.pop('reread_clean', False)")
check("call site pops reread_clean and continues BEFORE the n_flagged/format_anomaly bump",
      j > -1 and "continue" in eng[j:j + 1400]
      and eng.find("n_flagged += 1", j) > eng.find("continue", j))
k = eng.find("self.log(f\"  Stage 4.5: re-read '{garble}' -> '{adopted}' (review-bound)\")")
check("the review-bound path is INTACT (cap + note still emitted for 1-2-edit repairs)",
      k > -1 and "_REREAD_CAP" in eng[k:k + 700] and "re-read from the page" in eng[k:k + 700])

print(f"\n{fails} FAILED" if fails else "\nAll gate-reread clean-accept checks passed")
sys.exit(1 if fails else 0)
