"""READ-ONLY precision sweep for the prefix-outlier guard (Oracle's load-bearing gate — twin of
crossfield_sweep). Over the live DB's CONFIRMED reference-field values: build the prefix index, list
every scope that ARMS, and for each armed scope report the distinct code prefixes and which are
Hamming-1 OUTLIERS of the dominant (each would flag ONCE on first arrival, then self-heal). If the
outliers are all obvious misreads (e.g. Cascade IN/YN) and legit scopes carry a single clean prefix,
the guard is corpus-wide precise (no nag).

Run:  py -3.12 stress_test/prefix_outlier_sweep.py   (from python_backend/  OR repo root — auto-locates)
"""
import os, sys
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.join(os.path.dirname(_HERE), 'python_backend')
sys.path.insert(0, _BACKEND if os.path.isdir(_BACKEND) else os.path.dirname(_HERE))
import sqlite3
from extraction import ocr_corrector as oc

db = os.path.join(os.environ['APPDATA'], 'Roaming', 'ScanFinder', 'docusnap.db')
if not os.path.exists(db):
    db = os.path.join(os.environ['APPDATA'], 'ScanFinder', 'docusnap.db')
con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
rows = con.execute("""
    SELECT COALESCE(d.supplier_name,'') s, dt.slug dt, e.field_key fk,
           COALESCE(e.corrected_to, e.display_value, e.raw_value) v, COUNT(*) c
    FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
    JOIN extractions e ON e.document_id = d.id
    WHERE d.status='confirmed' AND e.field_key IN
          ('reference_number','invoice_number','sales_order_number','po_number')
      AND COALESCE(e.corrected_to, e.display_value, e.raw_value) <> ''
    GROUP BY s, dt, fk, v
""").fetchall()
con.close()

# assemble formats_data-shaped entries per scope
scopes = {}
for s, dt, fk, v, c in rows:
    scopes.setdefault((s, dt, fk), {})[v] = scopes.get((s, dt, fk), {}).get(v, 0) + c
formats_data = [{'supplier_name': s, 'document_type': dt, 'field_key': fk, 'value_counts': vc}
                for (s, dt, fk), vc in scopes.items()]
index = oc.build_prefix_index(formats_data)

armed = {k: v for k, v in index.items() if isinstance(k, tuple)}
scopes_lc = {(s.lower().strip(), dt.lower().strip(), fk): vc for (s, dt, fk), vc in scopes.items()}
print(f"scopes with confirmed ref values: {len(scopes)}   ARMED (dominant prefix >=5 & >=80%): {len(armed)}\n")
total_outlier_prefixes = 0
for (s, dt, fk), rec in sorted(armed.items()):
    vc = scopes_lc[(s, dt, fk)]
    prefs = {}
    for val, c in vc.items():
        p = oc.code_prefix(val)
        if p: prefs[p] = prefs.get(p, 0) + c
    outliers = [p for p in prefs if oc.is_prefix_outlier(p, rec)]      # would flag on FIRST arrival
    total_outlier_prefixes += len(outliers)
    tag = f"  <-- {len(outliers)} one-time-flag prefix(es): {outliers}" if outliers else ""
    print(f"  [{s[:22]:22} / {dt:14} / {fk}] dominant={rec['dominant']} prefixes={dict(prefs)}{tag}")

print(f"\nTOTAL distinct Hamming-1 outlier prefixes across all armed scopes: {total_outlier_prefixes}")
print("(each = ONE review on first arrival, then self-heals. Legit scopes should show 0; a non-zero"
      " here should be a genuine misread class, not a legit prefix.)")
