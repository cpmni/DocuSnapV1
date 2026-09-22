"""Read-only queries against the snapshot DB (007 pad-probe advisory, 2026-08-11)."""
import sqlite3, json

db = sqlite3.connect(r"file:C:\GIT Projects\Docusnap\TESTING\_measure\snap_007_padprobe.db?mode=ro", uri=True)
db.row_factory = sqlite3.Row
c = db.cursor()

print("=== settings of interest ===")
for k in ("deskew_on_import", "teach_angle_compose_scan", "registration_enabled",
          "ocr_dpi", "teach_box_word_snap", "template_target_word_snap",
          "template_abs_edge_guard", "auto_rotate_enabled"):
    r = c.execute("SELECT value FROM settings WHERE key=?", (k,)).fetchone()
    print(f"  {k} = {r['value'] if r else '<absent>'}")

print("\n=== template 7 ===")
cols = [r[1] for r in c.execute("PRAGMA table_info(templates)")]
print("  columns:", cols)
r = c.execute("SELECT * FROM templates WHERE id=7").fetchone()
if r:
    print("  row:", {k: r[k] for k in r.keys() if k not in ("keyword_fingerprint",)})

print("\n=== template_field_mappings tpl 7 ===")
cols = [r[1] for r in c.execute("PRAGMA table_info(template_field_mappings)")]
print("  columns:", cols)
for r in c.execute("SELECT * FROM template_field_mappings WHERE template_id=7"):
    print(" ", {k: r[k] for k in r.keys()})

print("\n=== template_landmarks tpl 7 ===")
for r in c.execute("SELECT COUNT(*) n, MIN(page_number) p0, MAX(page_number) p1 FROM template_landmarks WHERE template_id=7"):
    print(" ", dict(r))

print("\n=== Castellan docs: customer_name extractions ===")
rows = c.execute("""
    SELECT d.id, d.original_filename, e.raw_value, e.display_value, e.confidence, e.extraction_method
    FROM documents d JOIN extractions e ON e.document_id=d.id
    WHERE e.field_key='customer_name' AND d.supplier_name LIKE '%Castellan%'
    ORDER BY d.id""").fetchall()
print(f"  {len(rows)} rows")
for r in rows:
    print(f"  doc {r['id']:>4} {r['original_filename'][:40]:<42} "
          f"raw={r['raw_value']!r} disp={r['display_value']!r} conf={r['confidence']} m={r['extraction_method']}")
db.close()
