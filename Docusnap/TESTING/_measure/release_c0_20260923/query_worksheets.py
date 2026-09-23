#!/usr/bin/env python3
"""Verify the shape-exemption census finding: for the worksheet docs whose taught read (CJB-####) violates the
learned @@-# shape, what did the OWNER confirm, what did the page print, and what does the corrections ledger say?
Read-only on the DB copy. Usage: py -3.12 query_worksheets.py <db> 375 376 ..."""
import sqlite3, sys
con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True); con.row_factory = sqlite3.Row
ids = [int(x) for x in sys.argv[2:]]
q = ",".join("?" * len(ids))
print("== documents (confirmed state)")
for r in con.execute(f"SELECT id, status, supplier_name, reference_number, original_filename, confirmed_via, "
                     f"document_type_id FROM documents WHERE id IN ({q}) ORDER BY id", ids):
    print(f"  #{r['id']} {r['status']} sup={r['supplier_name']!r} ref={r['reference_number']!r} via={r['confirmed_via']} "
          f"file={r['original_filename']}")
print("== extractions rows for the ref-role field(s) on those docs")
for r in con.execute(f"SELECT document_id, field_key, raw_value, display_value, corrected_to, was_corrected, "
                     f"extraction_method, confidence FROM extractions WHERE document_id IN ({q}) "
                     f"AND field_key LIKE '%job%' OR (document_id IN ({q}) AND field_key LIKE '%ref%') "
                     f"ORDER BY document_id, field_key", ids + ids):
    print(f"  #{r['document_id']} {r['field_key']}: raw={r['raw_value']!r} shown={r['display_value']!r} "
          f"corr={r['corrected_to']!r} was_corr={r['was_corrected']} via={r['extraction_method']} conf={r['confidence']}")
print("== corrections ledger (human edits) on those docs")
for r in con.execute(f"SELECT document_id, field_key, original_value, corrected_value FROM corrections "
                     f"WHERE document_id IN ({q}) ORDER BY document_id", ids):
    print(f"  #{r['document_id']} {r['field_key']}: {r['original_value']!r} -> {r['corrected_value']!r}")
print("== the worksheet doc type's ref role + fields")
for r in con.execute("SELECT dt.id, dt.name, dt.slug, dt.ref_field_key, f.key, f.label, f.type FROM document_types dt "
                     "JOIN fields f ON f.document_type_id = dt.id WHERE dt.slug='worksheet' ORDER BY f.key"):
    print(f"  type {r['id']} {r['name']} ref_role={r['ref_field_key']} · field {r['key']} '{r['label']}' ({r['type']})")
print("== confirmed ref values for (Castellan, worksheet) — the learned history")
for r in con.execute("SELECT reference_number, COUNT(*) n FROM documents WHERE status='confirmed' AND "
                     "supplier_name LIKE 'Castellan%' AND document_type_id IN (SELECT id FROM document_types WHERE slug='worksheet') "
                     "GROUP BY reference_number ORDER BY n DESC LIMIT 40"):
    print(f"  {r['reference_number']!r} ×{r['n']}")
