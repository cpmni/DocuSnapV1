#!/usr/bin/env python3
"""stress_test/crossfield_sweep.py — SLICE 0 of the cross-field duplication guard
(gary-designed, 2026-07-10 night; the KO_wor_41 "customer = Reference 'WS703182" case).

READ-ONLY sweep over the live DB's extractions: how often does a NAME-LIKE field's value
CONTAIN a sibling STRUCTURED field's committed value on the same document — and how many
of those hits carry NO validation note (the SILENT residual wordness/guards missed)?
Decision gate: silent == 0 -> documented do-nothing; silent > 0 -> build Slice 1.

Predicate (mirrors the Slice-1 spec exactly):
  target  = name-like field (value_quality.is_name_like_field on the KEY), non-empty,
            method != 'manual' (human-typed values are exempt).
  sibling = any OTHER field on the doc: NOT name-like, value len >= 5 (normalised),
            carries >= 1 DIGIT, confidence >= 80, and itself UN-NOTED.
  hit     = sibling's WHOLE normalised value appears TOKEN-BOUNDARY-aligned inside the
            target's normalised value (normalise_for_tokens + lower + non-alnum runs ->
            single spaces; padded-space containment). Whole-value containment kills the
            "2026 Holdings Ltd" class naturally: a date sibling is '30 12 2025', never '2026'.

    py -3.12 stress_test/crossfield_sweep.py
"""
import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python_backend"))
from extraction.text_normalise import normalise_for_tokens
from extraction.value_quality import is_name_like_field, contains_structured_sibling

DB = os.path.expandvars(r"%APPDATA%\ScanFinder\docusnap.db")


def norm(s):
    s = normalise_for_tokens(s or "").lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
con.row_factory = sqlite3.Row

rows = con.execute("""
    SELECT e.document_id, e.field_key, e.display_value, e.confidence,
           e.extraction_method, e.validation_note,
           d.original_filename, d.supplier_name, d.status
    FROM extractions e JOIN documents d ON d.id = e.document_id
    WHERE e.display_value IS NOT NULL AND e.display_value != ''
""").fetchall()
con.close()

docs = {}
for r in rows:
    docs.setdefault(r["document_id"], []).append(r)

total_hits, noted_hits, silent_hits = 0, 0, 0
examples_silent, examples_noted = [], []
per_supplier = {}

for did, fields in docs.items():
    names = [f for f in fields
             if is_name_like_field(f["field_key"])
             and (f["extraction_method"] or "") != "manual"]
    sibs = []
    for f in fields:
        if is_name_like_field(f["field_key"]):
            continue
        v = norm(f["display_value"])
        if len(v) >= 5 and int(f["confidence"] or 0) >= 80 \
                and not (f["validation_note"] or "").strip():
            sibs.append((f, v))
    for nf in names:
        nv = norm(nf["display_value"])
        if not nv:
            continue
        for sf, sv in sibs:
            if sf["field_key"] == nf["field_key"]:
                continue
            # SHARED predicate — the runtime guard's exact string logic (value_quality),
            # so this sweep is its offline regression twin by construction.
            if contains_structured_sibling(nf["display_value"], sf["display_value"]):
                total_hits += 1
                key = (nf["supplier_name"] or "?")
                per_supplier[key] = per_supplier.get(key, 0) + 1
                ex = (f"doc {did} ({nf['original_filename']}, {nf['status']}): "
                      f"{nf['field_key']}='{nf['display_value'][:40]}' contains "
                      f"{sf['field_key']}='{sf['display_value'][:24]}' "
                      f"[target conf {nf['confidence']}, method {nf['extraction_method']}]")
                if (nf["validation_note"] or "").strip():
                    noted_hits += 1
                    if len(examples_noted) < 5:
                        examples_noted.append(ex)
                else:
                    silent_hits += 1
                    if len(examples_silent) < 10:
                        examples_silent.append(ex)

print(f"documents scanned: {len(docs)}   extraction rows: {len(rows)}")
print(f"TOTAL cross-field duplication hits: {total_hits}")
print(f"  with an existing validation note (already caught): {noted_hits}")
print(f"  SILENT residual (no note — the class Slice 1 exists for): {silent_hits}")
if per_supplier:
    print("per-supplier hit counts:", dict(sorted(per_supplier.items(), key=lambda x: -x[1])))
if examples_noted:
    print("\nnoted examples:")
    for e in examples_noted:
        print("  ", e)
if examples_silent:
    print("\nSILENT examples:")
    for e in examples_silent:
        print("  ", e)
print("\nDECISION GATE:", "BUILD SLICE 1 (silent residual > 0)" if silent_hits
      else "DO-NOTHING (document + revisit on next sighting)")
