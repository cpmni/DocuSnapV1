"""
READ-ONLY Phase-0 validator for the anti-poisoning proportional shape gate.

Replicates learning.getFieldFormats' grouping over CONFIRMED extractions, then compares the
CURRENT corpus-blind shape-acceptance rule (count >= 3) against the PROPOSED dual rule
(count >= ABS  OR  count >= max(FLOOR, ceil(RATIO*N))). Prints every shape the new rule would
NEWLY SUPPRESS so we can eyeball poison (good to suppress) vs a legitimate second format
(bad to suppress) before shipping the gate. Never writes.
"""
import os, sys, math, sqlite3
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import format_anomaly_checker as fac

# Proposed constants (tune here).
FLOOR = 3
RATIO = 0.10
ABS_  = 8

db_path = os.path.expandvars(r"%APPDATA%\ScanFinder\docusnap.db")
c = sqlite3.connect(db_path)
rows = c.execute("""
    SELECT d.supplier_name AS supplier, dt.slug AS doctype, e.field_key AS field,
           COALESCE(cr.corrected_value, e.display_value) AS val
    FROM extractions e
    JOIN documents d ON d.id = e.document_id
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    LEFT JOIN corrections cr ON cr.document_id = e.document_id AND cr.field_key = e.field_key
    WHERE d.status = 'confirmed'
      AND (e.display_value IS NOT NULL OR cr.corrected_value IS NOT NULL)
      AND (e.extraction_method IS NULL OR e.extraction_method <> 'shadow_reconcile')
""").fetchall()

groups = defaultdict(Counter)   # (supplier, doctype, field) -> Counter(final_value)
for supplier, doctype, field, val in rows:
    v = (val or "").strip()
    if not v or not field:
        continue
    if supplier and supplier != '__global__':
        groups[(supplier, doctype or '', field)][v] += 1
    if doctype:
        groups[('', doctype, field)][v] += 1

n_groups = 0
n_suppress = 0
for (supplier, doctype, field), vc in sorted(groups.items()):
    distinct, N = len(vc), sum(vc.values())
    if not (distinct >= 3 or N >= 3):      # getFieldFormats emit filter
        continue
    old = fac.classify_format(list(vc.keys()), dict(vc))    # CURRENT rule (c >= 3)
    old_shapes = old.get('shapes') or frozenset()
    if not old_shapes:
        continue
    n_groups += 1
    shape_counts = Counter()
    for val, n in vc.items():
        sig = fac.shape_signature(val)
        if sig:
            shape_counts[sig] += n
    thr = max(FLOOR, math.ceil(RATIO * N))
    new_shapes = {sig for sig, cc in shape_counts.items() if cc >= ABS_ or cc >= thr}
    suppressed = set(old_shapes) - new_shapes
    if not suppressed:
        continue
    dom_sig, dom_c = shape_counts.most_common(1)[0]
    print(f"\n[{supplier or '<any>'} | {doctype} | {field}]  N={N} distinct={distinct}  "
          f"dominant={dom_sig} ({dom_c}/{N}={dom_c/N:.0%})  thr={thr}")
    for sig in sorted(suppressed, key=lambda s: -shape_counts[s]):
        ex = [v for v in vc if fac.shape_signature(v) == sig][:3]
        n_suppress += 1
        print(f"    SUPPRESS shape {sig!r:16} count={shape_counts[sig]} "
              f"share={shape_counts[sig]/N:.0%}  examples={ex}")

print(f"\n=== summary: {n_groups} fields with trusted shapes; "
      f"{n_suppress} shape(s) would be newly suppressed (RATIO={RATIO}, ABS={ABS_}, FLOOR={FLOOR}) ===")
