"""Focused: do the HELD Copperfield POs resolve after the backfill heal? Read-only.
Reuses template_gate_probe's exact template loader + identify_template call.
Run: TEMPLATE_PROBE_DB=<db> py -3.12 stress_test/probe_held_pos.py
"""
import os
import sqlite3
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "python_backend"))
sys.path.insert(0, os.path.join(_HERE, "..", "python_backend", "extraction"))
import template_gate_probe as P  # noqa: E402

DB = os.environ.get("TEMPLATE_PROBE_DB")
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
templates = P.load_payload(con)
slug_of = {r["id"]: r["slug"] for r in con.execute("SELECT id, slug FROM document_types")}
held = [dict(r) for r in con.execute(
    "SELECT id, original_filename, supplier_name, status, document_type_id, logo_phash, logo_detail_hash, ocr_text "
    "FROM documents WHERE lower(supplier_name) LIKE '%copperfield%' "
    "AND document_type_id IN (SELECT id FROM document_types WHERE slug='purchase_order') "
    "AND ocr_text IS NOT NULL AND logo_phash IS NOT NULL ORDER BY id LIMIT 5")]
print(f"sample Copperfield POs: {len(held)} (expect they resolve to the purchase_order template, NOT invoice)")
for doc in held:
    own = slug_of.get(doc["document_type_id"])
    for (slug, trusted) in ((own, False), (own, True)):
        state, tpl = P.run_one(doc, templates, slug, trusted)
        tid = tpl["id"] if tpl else None
        tname = f"{tpl['name']} / {tpl['document_type_slug']}" if tpl else "-"
        print(f"  doc {doc['id']} '{doc['original_filename']}' cfg=(slug={slug}, title_trusted={trusted}): {state} -> tpl {tid} [{tname}]")
con.close()
