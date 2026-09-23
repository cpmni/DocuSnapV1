#!/usr/bin/env python3
"""Oracle C9: partition the 727 by confirm PROVENANCE — a machine confirm (scope_sweep / auto_*) can be circular with
the read under test. Dumps {doc_id: confirmed_via|"human"} from the read-only DB copy.
Usage: py -3.12 dump_via.py <db> <out.json>"""
import sqlite3, sys, json
con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
via = {str(r[0]): (r[1] or "human") for r in con.execute("SELECT id, confirmed_via FROM documents WHERE status='confirmed'")}
json.dump(via, open(sys.argv[2], "w", encoding="utf-8"))
print(f"{len(via)} docs; human={sum(1 for v in via.values() if v == 'human')}")
