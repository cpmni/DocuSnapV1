#!/usr/bin/env python3
"""How were the owner's confirmed docs confirmed (confirmed_via), overall and for Castellan worksheets?
Read-only. Usage: py -3.12 via_census.py <db>"""
import sqlite3, sys
con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True); con.row_factory = sqlite3.Row
print("== confirmed_via across all confirmed docs")
for r in con.execute("SELECT COALESCE(confirmed_via,'<null=human>') via, COUNT(*) n FROM documents WHERE status='confirmed' GROUP BY via ORDER BY n DESC"):
    print(f"  {r['via']:28} {r['n']}")
print("== Castellan worksheets: via × ref prefix")
for r in con.execute("SELECT COALESCE(confirmed_via,'<null=human>') via, substr(reference_number,1,3) pre, COUNT(*) n, "
                     "MIN(confirmed_at) first_c, MAX(confirmed_at) last_c FROM documents WHERE status='confirmed' AND supplier_name LIKE 'Castellan%' "
                     "AND document_type_id IN (SELECT id FROM document_types WHERE slug='worksheet') GROUP BY via, pre ORDER BY n DESC"):
    print(f"  {r['via']:28} {r['pre']:5} ×{r['n']}  {r['first_c']} → {r['last_c']}")
print("== switches that decide whether machine confirms feed learning")
for k in ("learning_exclude_machine_confirms", "learning_exclude_docs", "autofile_gate_unify", "taught_ref_disagree_suppress"):
    r = con.execute("SELECT value FROM settings WHERE key=?", (k,)).fetchone()
    print(f"  {k} = {r['value'] if r else '<unset>'}")
print("== learning_excluded_at set on any Castellan worksheet?")
r = con.execute("SELECT COUNT(*) n FROM documents WHERE supplier_name LIKE 'Castellan%' AND learning_excluded_at IS NOT NULL").fetchone()
print(f"  excluded: {r['n']}")
