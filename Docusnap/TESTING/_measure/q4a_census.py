#!/usr/bin/env python3
"""Q4a census (Oracle C4a.4, 2026-08-22): the type-heading nudge harvest over every document in a
sandbox DB, per arm — OFF · subtractive ON · subtractive + L0 — counting nudges offered / correct /
wrong / None against the GROUND-TRUTH type (the Demo-Docs filename convention
`<Sender>_<type_slug>_NNNN.pdf`; the owner's scans are all Service Worksheets).

The harvest only fires on an UNTYPED doc in production; here it is run on every doc's stored
ocr_text with NO installed types (the worst case — every page is a nudge candidate) and the doc's
own issuer read as exclude_texts, so the census measures the harvest itself.

    py -3.12 TESTING/_measure/q4a_census.py <db>
"""
import os
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python_backend"))
from extraction.keyword import _harvest_top_band_heading as H   # noqa: E402

db = sqlite3.connect(sys.argv[1])
db.row_factory = sqlite3.Row
rows = db.execute("""SELECT d.id, d.original_filename, d.supplier_name, d.ocr_text,
                            (SELECT display_value FROM extractions e WHERE e.document_id = d.id AND e.field_key = 'supplier_name' LIMIT 1) AS sup_read
                       FROM documents d WHERE d.ocr_text IS NOT NULL AND d.status <> 'deleted'""").fetchall()


def gt_type(fn):
    m = re.match(r"^[A-Za-z\-]+_([a-z_]+)_\d+", fn or "")
    if m:
        return m.group(1).replace("_", " ")
    if re.match(r"^Worksheet\.", fn or "") or re.match(r"^Print-Tracker", fn or ""):
        return "service worksheet" if fn.startswith("Worksheet") else "print tracker"
    return None


def run(label, excl, l0):
    os.environ["TYPE_NUDGE_ISSUER_EXCLUDE"] = excl
    os.environ["TYPE_NUDGE_L0"] = l0
    offered = correct = wrong = none = 0
    wrongs = {}
    for r in rows:
        gt = gt_type(r["original_filename"])
        got = H(str(r["ocr_text"]).split("\n"), [], exclude_texts=[r["supplier_name"], r["sup_read"]])
        if got is None:
            none += 1
            continue
        offered += 1
        if gt and got.lower() == gt:
            correct += 1
        else:
            wrong += 1
            wrongs[got] = wrongs.get(got, 0) + 1
    print(f"{label:28s} docs={len(rows)} offered={offered} correct={correct} wrong={wrong} none={none}")
    top = sorted(wrongs.items(), key=lambda kv: -kv[1])[:12]
    if top:
        print("   wrong offers:", ", ".join(f"{k!r}×{v}" for k, v in top))
    return offered, correct, wrong


off = run("OFF (today)", "0", "0")
sub = run("subtractive ON", "1", "0")
l0 = run("subtractive + L0 ON", "1", "1")
print()
print(f"subtractive gate: correct lost = {off[1] - sub[1]} (must be 0) · wrong removed = {off[2] - sub[2]}")
print(f"L0 gate: new wrong = {l0[2] - sub[2]} (must be 0) · correct gained = {l0[1] - sub[1]}")
