#!/usr/bin/env python3
"""tests/test_keyword_cell_below.py — KEYWORD_CELL_BELOW (oscar design 2026-08-31, DEFAULT OFF).

The Hard Set boxed meta_row class: a bordered label-above-value cell prints the caption ALONE in
its column segment ("Invoice No | Date | Account" over "INV-73140 | 17-03-2025 | ACC-2291").
Stage-1's RIGHT leg grabs the NEIGHBOUR cell's caption ("Date"), the shipped below leg is
column-blind (segment 0 only), and the read dies at validation — the field holds EMPTY cold
(or, with the digit gate off, cold-commits the caption "Date" as the reference — pinned below).

The arm: when the caption stands alone in its cell, read the SAME column segment of the NEXT
line, five guards (validation probe; caller digit gates unchanged; label/caption refusals; a
DATE-shaped candidate under a non-date caption refused — the realdoc M=7 leading-digit class
must not gain a new door; column-k alignment with shift-refuse; next-line-only window).
Confidence capped at 85 — under the pinned 88 critical-field auto-file floor.

    py -3.12 tests/test_keyword_cell_below.py   (from python_backend/)
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import keyword                                            # noqa: E402

CFG = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "config",
                                 "keyword_patterns.json"), encoding="utf-8"))
fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def setflag(name, v):
    if v is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = v


def read(key, text, cfg=None):
    r = keyword.extract_fields(text, [key], cfg or CFG).get(key) or {}
    return r.get("value"), r.get("confidence")


G = "    "  # a 4-space COLUMN_BREAK gap
BOXED = ("Invoice No" + G + "Date" + G + "Account\n"
         + "INV-73140" + G + "17-03-2025" + G + "ACC-2291\n")
TOTAL_ROW = ("Net" + G + "VAT" + G + "Total\n"
             + "120.00" + G + "24.00" + G + "144.00\n")
SHIFTED = ("Invoice No" + G + "Date\n"
           + "17-03-2025\n")                       # the ref cell is EMPTY — everything shifts left
CAPTION_ROW = ("Invoice No" + G + "Date\n"
               + "Reference No" + G + "17-03-2025\n")   # a stray caption row under the header
BLANKED = "Invoice No\n\nINV-73140\n"              # a blank line = a section break, never crossed
INLINE = "Invoice No: INV-9081" + G + "Date: 01-02-2026\n"

# ── OFF: byte-identical, and the corollary pinned ────────────────────────────────────────────────
print("OFF (KEYWORD_CELL_BELOW unset) — today's behaviour, pinned:")
setflag("KEYWORD_CELL_BELOW", None)
setflag("REF_ROLE_DIGIT_GATE", None)
v, _ = read("invoice_number", BOXED)
check("OFF + digit gate off: the RIGHT leg cold-commits the neighbour caption 'Date' "
      "(the oscar corollary — the digit gate is the only guard)", v == "Date")
setflag("REF_ROLE_DIGIT_GATE", "1")
v, _ = read("invoice_number", BOXED)
check("OFF + REF_ROLE_DIGIT_GATE=1: the boxed reference holds EMPTY (the Hard Set cold gap)",
      v is None)
v, _ = read("invoice_date", BOXED)
check("OFF: the boxed date holds EMPTY", v is None)
v, _ = read("total_amount", TOTAL_ROW)
check("OFF: the boxed total holds EMPTY", v is None)

# ── ON: the boxed cells fill from their OWN column ───────────────────────────────────────────────
print()
print("ON (KEYWORD_CELL_BELOW=1):")
setflag("KEYWORD_CELL_BELOW", "1")
v, c = read("invoice_number", BOXED)
check("ON: boxed reference reads its own cell (k=0) -> 'INV-73140'", v == "INV-73140")
check("ON: cell-below confidence <= 85 (under the 88 critical floor), got %r" % c,
      c is not None and c <= 85)
v, _ = read("invoice_date", BOXED)
check("ON: boxed date reads its own cell (k=1, column-aligned) -> '17-03-2025'",
      v == "17-03-2025")
v, _ = read("total_amount", TOTAL_ROW)
check("ON: boxed total reads its own cell (k=2) -> '144.00'", v == "144.00")

# conf cap is LOAD-BEARING: with a base_confidence ABOVE 85 the cell-below read is still capped
cfg_hot = copy.deepcopy(CFG)
try:
    cfg_hot["field_patterns"]["invoice_number"]["base_confidence"] = 92
    v, c = read("invoice_number", BOXED, cfg_hot)
    check("ON: base 92 is CAPPED to 85 on a cell-below read (got %r @ %r)" % (v, c),
          v == "INV-73140" and c == 85)
except Exception as e:                                    # config shape drift = a real failure
    check("ON: base-92 cap probe ran (%s)" % e, False)

# ── The guards ───────────────────────────────────────────────────────────────────────────────────
print()
print("guards:")
v, _ = read("invoice_number", SHIFTED)
check("G4: a shifted DATE under the ref caption is REFUSED (the M=7 class gains no door)",
      v is None)
# G5: the date caption's column (k=1) is missing on the value line -> the ARM refuses; what
# remains is the SHIPPED below leg's own segment-0 read — today's behaviour, byte-identical.
v_on, c_on = read("invoice_date", SHIFTED)
setflag("KEYWORD_CELL_BELOW", None)
v_off, c_off = read("invoice_date", SHIFTED)
setflag("KEYWORD_CELL_BELOW", "1")
check("G5: a MISSING column on the value line -> the arm adds NOTHING (ON == OFF, the shipped "
      "below leg's read either way: %r)" % (v_off,), (v_on, c_on) == (v_off, c_off))
v, _ = read("invoice_number", CAPTION_ROW)
check("G3: a stray CAPTION row under the header is refused ('Reference No' never a value)",
      v is None)
# Window: a BLANK line under the caption stops the ARM (never crossed); the SHIPPED below
# walk still skips blanks and reads on — today's behaviour, byte-identical ON vs OFF.
v_on, c_on = read("invoice_number", BLANKED)
setflag("KEYWORD_CELL_BELOW", None)
v_off, c_off = read("invoice_number", BLANKED)
setflag("KEYWORD_CELL_BELOW", "1")
check("window: a BLANK line stops the arm; ON == OFF (the shipped walk's read either way: %r)"
      % (v_off,), (v_on, c_on) == (v_off, c_off))

# G4 is LOAD-BEARING, not vacuous: strip the date bank (a naive build with no date guard)
# and the same shifted date IS adopted into the reference — the exact door the guard closes.
cfg_naive = copy.deepcopy(CFG)
cfg_naive.get("validation_patterns", {}).pop("date", None)
v, _ = read("invoice_number", cfg=cfg_naive, text=SHIFTED)
check("G4 load-bearing: with no date bank the naive arm ADOPTS '17-03-2025' as the reference "
      "(RED-first proof the guard closes a real door)", v == "17-03-2025")

# ── Same-line reads are untouched with the arm ON ────────────────────────────────────────────────
print()
print("same-line unchanged:")
v_on, c_on = read("invoice_number", INLINE)
v_dt, _ = read("invoice_date", INLINE)
setflag("KEYWORD_CELL_BELOW", None)
v_off, c_off = read("invoice_number", INLINE)
check("'Label: value' line reads IDENTICALLY on/off (value)", v_on == v_off == "INV-9081")
check("'Label: value' line reads IDENTICALLY on/off (confidence, right +5)", c_on == c_off)
check("'Label: value' date on the same line still reads (ON)", v_dt == "01-02-2026")

setflag("REF_ROLE_DIGIT_GATE", None)
print()
print("FAILED: %d" % fails if fails else "ALL PASS")
sys.exit(1 if fails else 0)
