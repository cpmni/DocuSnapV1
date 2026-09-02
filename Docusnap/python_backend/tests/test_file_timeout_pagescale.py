"""Pins the page-aware per-file watchdog budget (2026-09-02).

A flat 300s timeout dead-lettered legitimately large multi-page scans (a 34-page A4 scan needs ~340s and
went to Errors on every run). The budget must now scale with page count while staying byte-identical for a
1-page doc, and a disabled watchdog (base<=0) must stay disabled.

Run: py -3.12 python_backend/tests/test_file_timeout_pagescale.py
"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import process_docs as P

fails = 0
def ck(label, cond):
    global fails
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        fails += 1

PER = P._FILE_TIMEOUT_PER_PAGE_S

# ── budget math (the fix) ──────────────────────────────────────────────────────
# Simulate _start_file_watchdog storing the base, then _mark_file scaling by pages.
P._watch["base"] = 300.0
P._mark_file("x.pdf", 1)
ck("1-page doc -> budget == base (byte-identical to today)", P._watch["budget"] == 300.0)

P._mark_file("x.pdf", 34)
ck("34-page doc -> base + PER*(34-1)", P._watch["budget"] == 300.0 + PER * 33)
ck("34-page budget comfortably exceeds the ~340s the real doc needs", P._watch["budget"] > 340.0)

P._mark_file("x.pdf", 0)          # defensive: a 0/again-<1 count never subtracts below base
ck("page_count<1 -> budget == base (never below the floor)", P._watch["budget"] == 300.0)

# ── disabled watchdog stays disabled ───────────────────────────────────────────
P._watch["base"] = 0.0
P._mark_file("x.pdf", 34)
ck("base<=0 (watchdog off) -> budget 0 regardless of pages", P._watch["budget"] == 0.0)

# ── probe fallback: non-PDF / missing -> 1 (today's base budget), never throws ──
ck("probe a non-PDF path -> 1", P._probe_page_count(__import__("pathlib").Path("nope.txt")) == 1)
ck("probe a missing .pdf -> 1 (guarded, no throw)", P._probe_page_count(__import__("pathlib").Path("does-not-exist.pdf")) == 1)

# a real generated multi-page PDF (if pypdf is available) -> the true count
try:
    from pypdf import PdfWriter
    import pathlib
    w = PdfWriter()
    for _ in range(5):
        w.add_blank_page(width=595, height=842)
    tmp = pathlib.Path(tempfile.gettempdir()) / "ftpin_5p.pdf"
    with open(tmp, "wb") as fh:
        w.write(fh)
    ck("probe a real 5-page PDF -> 5", P._probe_page_count(tmp) == 5)
    try: tmp.unlink()
    except Exception: pass
except Exception as e:
    print(f"  (skip real-PDF probe: {e})")

print(f"\n{'ALL PASS' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
