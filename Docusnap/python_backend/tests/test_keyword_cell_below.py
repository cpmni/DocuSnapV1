#!/usr/bin/env python3
"""tests/test_keyword_cell_below.py — KEYWORD_CELL_BELOW (oscar design 2026-08-31, DEFAULT OFF;
Oracle SEND BACK 2026-08-31 → conditions C1-C5 applied, re-pinned per C4).

The Hard Set boxed meta_row class: a bordered label-above-value cell prints the caption ALONE in
its column segment. Stage-1's RIGHT leg grabs the NEIGHBOUR cell's caption, the shipped below leg
is column-blind (segment 0 only), and the read dies at validation — the field holds EMPTY cold.

The arm (ref/date only — Oracle C2; money labels ship right-ONLY by authorial intent): when the
caption stands alone in its cell AND the line is a real meta row (>=2 segments, C1 i) AND no digit
follows the label on its own line (the value would be same-line — the right leg owns it, C1 ii),
read the SAME column segment of the next line, only when the value line carries EXACTLY as many
segments (C1 iii — an empty cell shifts everything left and same-type steals pass the banks).
Candidate bared of border glyphs at both ends before every guard (C3). A DATE-shaped candidate
under a non-date caption is refused (G4 — the realdoc M=7 class gains no door). Confidence capped
85, under the pinned 88 critical auto-file floor.

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


def both(key, text, cfg=None):
    """(ON result, OFF result) for the same text — the ON==OFF equality pins."""
    setflag("KEYWORD_CELL_BELOW", "1")
    on = read(key, text, cfg)
    setflag("KEYWORD_CELL_BELOW", None)
    off = read(key, text, cfg)
    setflag("KEYWORD_CELL_BELOW", "1")
    return on, off


G = "    "  # a 4-space COLUMN_BREAK gap
BOXED = ("Invoice No" + G + "Date" + G + "Account\n"
         + "INV-73140" + G + "17-03-2025" + G + "ACC-2291\n")
TOTAL_ROW = ("Net" + G + "VAT" + G + "Total\n"
             + "120.00" + G + "24.00" + G + "144.00\n")
STACKED = "Invoice No\nINV-73140\n"                       # lone caption — the shipped leg's territory
WIDEGAP = "Invoice No" + G + "INV-123\nBramblewood Joinery Ltd\n"   # same-line wide-gap value
GBPROW = ("Invoice Total" + G + "GBP" + G + "118.83\n"
          + "Carriage 42 items\n")                        # the currency-code-skip row
UNEQUAL = ("Invoice No" + G + "Date\n"
           + "17-03-2025\n")                              # the ref cell is EMPTY — segments shift
DATEGRID = ("Invoice No" + G + "Date\n"
            + "17-03-2025" + G + "18-03-2025\n")          # equal counts — G4's real exhibit
DATEGRID_B = ("Invoice No" + G + "Date\n"
              + "17-03-2025 |" + G + "18-03-2025\n")      # a cell border glyph on the date (C3)
CAPTION_ROW = ("Invoice No" + G + "Date\n"
               + "Reference No" + G + "17-03-2025\n")     # a stray caption row under the header
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
v, _ = read("invoice_date", DATEGRID)
check("ON: equal-count grid, the DATE field adopts ITS column (k=1) -> '18-03-2025'",
      v == "18-03-2025")

# conf cap is LOAD-BEARING: with a base_confidence ABOVE 85 the cell-below read is still capped
cfg_hot = copy.deepcopy(CFG)
try:
    cfg_hot["field_patterns"]["invoice_number"]["base_confidence"] = 92
    v, c = read("invoice_number", BOXED, cfg_hot)
    check("ON: base 92 is CAPPED to 85 on a cell-below read (got %r @ %r)" % (v, c),
          v == "INV-73140" and c == 85)
except Exception as e:                                    # config shape drift = a real failure
    check("ON: base-92 cap probe ran (%s)" % e, False)

# ── Oracle C1: the arm must never TOUCH a non-boxed layout (ON == OFF incl. confidence) ─────────
print()
print("C1 discriminators — ON == OFF (value AND confidence) on the everyday layouts:")
on, off = both("invoice_number", STACKED)
check("C1(i) lone stacked caption: shipped below leg untouched (both %r, conf equal)" % (off[0],),
      on == off and off[0] == "INV-73140")
on, off = both("invoice_number", WIDEGAP)
check("C1(ii) wide-gap same-line value: the right leg owns it (both %r)" % (off[0],),
      on == off and off[0] == "INV-123")
on, off = both("total_amount", GBPROW)
check("C2+C1(ii) 'Invoice Total | GBP | 118.83': currency unarmed, code-skip untouched "
      "(both %r)" % (off[0],), on == off and off[0] == "118.83")
on, off = both("total_amount", TOTAL_ROW)
check("C2: money labels are right-ONLY — the boxed total stays EMPTY on/off "
      "(boxed totals = their own future slice)", on == off and off[0] is None)
on, off = both("invoice_number", UNEQUAL)
check("C1(iii) unequal segment counts (empty cell shift): the arm adds nothing (ON == OFF)",
      on == off)
on, off = both("invoice_date", UNEQUAL)
check("C1(iii) same for the date field (ON == OFF)", on == off)

# ── The guards on EQUAL-count grids (non-vacuous under C1 iii) ───────────────────────────────────
print()
print("guards (equal-count grids):")
v, _ = read("invoice_number", DATEGRID)
check("G4: the date under the REF caption is refused -> never '17-03-2025' (got %r)" % (v,),
      v != "17-03-2025" and v != "18-03-2025")
v, _ = read("invoice_number", DATEGRID_B)
check("C3: a border glyph can't smuggle the date past G4 ('17-03-2025 |' bared first; got %r)"
      % (v,), v not in ("17-03-2025", "17-03-2025 |", "18-03-2025"))
on, off = both("invoice_number", CAPTION_ROW)
check("G3: a stray caption row ('Reference No') is refused; ON == OFF", on == off)

# G4 is LOAD-BEARING, not vacuous: strip the date bank (a naive build with no date guard)
# and the equal-count grid's date IS adopted into the reference — the exact door G4 closes.
cfg_naive = copy.deepcopy(CFG)
cfg_naive.get("validation_patterns", {}).pop("date", None)
v, _ = read("invoice_number", DATEGRID, cfg_naive)
check("G4 load-bearing: with no date bank the naive arm ADOPTS '17-03-2025' as the reference "
      "(RED-first proof the guard closes a real door)", v == "17-03-2025")

# ── Same-line reads are untouched with the arm ON ────────────────────────────────────────────────
print()
print("same-line unchanged:")
on, off = both("invoice_number", INLINE)
check("'Label: value' line reads IDENTICALLY on/off (value + confidence, right +5)",
      on == off and off[0] == "INV-9081")
setflag("KEYWORD_CELL_BELOW", "1")
v, _ = read("invoice_date", INLINE)
check("'Label: value' date on the same line still reads (ON)", v == "01-02-2026")

setflag("KEYWORD_CELL_BELOW", None)
setflag("REF_ROLE_DIGIT_GATE", None)
print()
print("FAILED: %d" % fails if fails else "ALL PASS")
sys.exit(1 if fails else 0)
