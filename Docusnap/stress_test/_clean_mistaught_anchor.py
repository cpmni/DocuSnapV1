"""REVERSIBLE removal of the mis-taught Cloud VPS invoice_number anchor (field_anchors id=24).
See HANDOVER_2026-07-09.md. Preferred alternative: Settings -> Learning -> Learning Recovery ->
Clear anchors (the audited in-app path). This script is the backup.

  py stress_test/_clean_mistaught_anchor.py backup    # dump matching rows to a restore file (READ-ONLY)
  py stress_test/_clean_mistaught_anchor.py delete     # backup THEN delete (mutates the live DB)
  py stress_test/_clean_mistaught_anchor.py restore     # re-insert from the backup file (undo)

Targets ONLY authoritative invoice_number anchors for supplier 'Cloud VPS'. Close the ScanFinder app
first (so nothing else holds the DB). NOT run automatically.
"""
import sqlite3, os, json, sys
DB = os.path.join(os.environ['APPDATA'], 'ScanFinder', 'docusnap.db')
BK = os.path.join(os.path.dirname(__file__), 'out', 'mistaught_anchor_backup.json')
SEL = ("SELECT * FROM field_anchors WHERE field_key='invoice_number' "
       "AND LOWER(TRIM(supplier_name))='cloud vps' AND last_authoritative_at IS NOT NULL")

def backup():
    con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True); con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute(SEL)]; con.close()
    os.makedirs(os.path.dirname(BK), exist_ok=True)
    json.dump(rows, open(BK, 'w'), indent=2)
    print(f"backed up {len(rows)} row(s) -> {BK}\n{json.dumps(rows, indent=2)}")
    return rows

def delete():
    rows = backup()
    if not rows: print("nothing to delete"); return
    con = sqlite3.connect(DB)
    con.execute("DELETE FROM field_anchors WHERE id IN (%s)" % ",".join(str(r['id']) for r in rows))
    con.commit(); con.close()
    print(f"deleted {len(rows)} row(s). Reprocess a Cloud VPS / City Office invoice to see the correct read.")

def restore():
    rows = json.load(open(BK)); con = sqlite3.connect(DB)
    for r in rows:
        cols = ",".join(r.keys()); ph = ",".join("?" for _ in r)
        con.execute(f"INSERT INTO field_anchors ({cols}) VALUES ({ph})", list(r.values()))
    con.commit(); con.close(); print(f"restored {len(rows)} row(s)")

{'backup': backup, 'delete': delete, 'restore': restore}.get(sys.argv[1] if len(sys.argv) > 1 else 'backup', backup)()
