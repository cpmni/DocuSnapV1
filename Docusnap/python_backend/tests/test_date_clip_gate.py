"""Pins for Slice B — the date-clip gate (Oracle 2026-08-05, B-C1..B-C4) + the
parse_date year floor. A right-cut taught box reads a clean date FRAGMENT that
passes the shared date pattern's \\d{2,4} year branch and commits at 90; Stage-4
then expands it to a confidently-wrong full date. The gate rejects the two clip
tells on the RAW read BEFORE salvage; the year floor kills 3-digit-year parses
at the sole gatekeeper for every stage.

Run: py -3.12 python_backend/tests/test_date_clip_gate.py
"""
import importlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


# ── default OFF (B-C4) ───────────────────────────────────────────────────────
os.environ.pop('TEMPLATE_DATE_CLIP_GATE', None)
import extraction.template_mapper as tm
importlib.reload(tm)
check("kill switch default OFF", tm._DATE_CLIP_GATE_ON is False)
VAL = {"date": [r"(?<!\d)\d{4}[/\-]\d{2}[/\-]\d{2}(?!\d)",
                r"(?<!\d)\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)"]}
v, _, _ = tm._gate_value('07-01-20-', 'date', 'invoice_date', VAL, None, shape_mode='ignore')
check("OFF: clipped fragment still passes (byte-identical today)", v == '07-01-20-')

# ── armed ────────────────────────────────────────────────────────────────────
os.environ['TEMPLATE_DATE_CLIP_GATE'] = '1'
importlib.reload(tm)
check("switch arms", tm._DATE_CLIP_GATE_ON is True)

# predicate matrix (B-C3)
check("REJECT dangling-separator 2-digit year ('07-01-20-')", tm._date_clip_suspect('07-01-20-'))
check("REJECT 3-digit year ('03-06-202')", tm._date_clip_suspect('03-06-202'))
check("ACCEPT complete 4-digit year + trailing debris ('07-01-2026.') — B-C1",
      not tm._date_clip_suspect('07-01-2026.'))
check("ACCEPT complete 4-digit year + trailing dash ('07-01-2026-')",
      not tm._date_clip_suspect('07-01-2026-'))
check("PIN: clean 2-digit year stays ACCEPTED ('07-01-20') — only geometry may catch it",
      not tm._date_clip_suspect('07-01-20'))
check("ACCEPT spaced range dash ('07/01/2026 -')", not tm._date_clip_suspect('07/01/2026 -'))
check("ACCEPT plain full date ('07/01/2026')", not tm._date_clip_suspect('07/01/2026'))
check("no numeric date at all -> not suspect ('Total 42.35')",
      not tm._date_clip_suspect('Total 42.35'))

# gate integration: fire -> (None, salvaged=False) with NO salvage resurrection (B-C2)
v, s, _ = tm._gate_value('07-01-20-', 'date', 'invoice_date', VAL, None, shape_mode='ignore')
check("armed: fragment rejected through _gate_value", v is None and s is False)
v, s, _ = tm._gate_value('03-06-202', 'date', 'invoice_date', VAL, None, shape_mode='ignore')
check("armed: 3-digit-year fragment rejected, salvage did not resurrect",
      v is None and s is False)
v, _, _ = tm._gate_value('07-01-2026.', 'date', 'invoice_date', VAL, None, shape_mode='ignore')
check("armed: complete date + debris still passes the gate", v is not None)
v, _, _ = tm._gate_value('07-01-20', 'date', 'invoice_date', VAL, None, shape_mode='ignore')
check("armed PIN: clean 2-digit-year date still passes the gate", v == '07-01-20')

# ── parse_date year floor (unswitched companion) ─────────────────────────────
from extraction import validator
check("parse_date rejects a 3-digit year ('03-06-202')",
      validator.parse_date('03-06-202') is None)
check("parse_date keeps 4-digit years ('03-06-2026')",
      validator.parse_date('03-06-2026') is not None)
d = validator.parse_date('03-06-26')
check("parse_date keeps 2-digit years ('03-06-26' -> 2026)",
      d is not None and d.year == 2026)
check("salvage_date cannot resurrect a 3-digit-year fragment",
      validator.salvage_date('x 03-06-202 y') in (None, ''))

os.environ.pop('TEMPLATE_DATE_CLIP_GATE', None)
importlib.reload(tm)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All date-clip gate checks passed.")
