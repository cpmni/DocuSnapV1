"""Read-only: import timeline for the Castellan docs (007 advisory)."""
import sqlite3
db = sqlite3.connect(r"file:C:\GIT Projects\Docusnap\TESTING\_measure\snap_007_padprobe.db?mode=ro", uri=True)
db.row_factory = sqlite3.Row
c = db.cursor()
cols = [r[1] for r in c.execute("PRAGMA table_info(documents)")]
print("documents columns:", cols)
tcol = 'processed_at' if 'processed_at' in cols else ('imported_at' if 'imported_at' in cols else 'id')
garbled = {365, 366, 368, 372, 373, 374}
for r in c.execute(f"""
    SELECT d.id, d.{tcol} AS ts, d.status, d.stored_path
    FROM documents d WHERE d.id IN (221,222,244,361,362,365,366,368,370,372,373,374,375,379,380)
    ORDER BY d.id"""):
    tag = 'GARBLED' if r['id'] in garbled else ''
    print(f"doc {r['id']:>4} {tcol}={r['ts']} status={r['status']:<13} {tag}")
    print(f"        stored={r['stored_path']}")
db.close()
