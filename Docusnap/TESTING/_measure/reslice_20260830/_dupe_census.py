"""Duplicate structure of the confirmed corpus in a DB copy + a deduped id list for the realdoc harness (RR_IDS).
One representative per distinct original_filename (the HIGHEST id = the most recently confirmed copy), keeping only
docs whose file still resolves. Writes tmp/runs/rr_ids_dedup.txt (comma-separated ids)."""
import os, sqlite3, sys, collections
db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True); db.row_factory = sqlite3.Row
q = lambda s: db.execute(s).fetchall()
n = q("select count(*) c from documents where status='confirmed'")[0]['c']
dn = q("select count(distinct original_filename) c from documents where status='confirmed'")[0]['c']
triple = q("select count(*) c from (select distinct supplier_name, reference_number, doc_date from documents where status='confirmed')")[0]['c']
multi = q("select count(*) c from (select original_filename from documents where status='confirmed' group by original_filename having count(*)>1)")[0]['c']
print(f"confirmed docs: {n}; distinct original_filename: {dn}; distinct (supplier,ref,date): {triple}; filenames with >1 copy: {multi}")
print("top duplicate counts:", [(r['original_filename'], r['c']) for r in q("select original_filename, count(*) c from documents where status='confirmed' group by original_filename order by c desc limit 6")])
print("by type (docs / distinct files):")
for r in q("select dt.slug slug, count(*) c, count(distinct d.original_filename) f from documents d left join document_types dt on dt.id=d.document_type_id where d.status='confirmed' group by dt.slug order by 2 desc"):
    print(f"   {r['slug']}: {r['c']} / {r['f']}")
# deduped representative set: highest id per original_filename with a resolvable file
rows = q("select id, original_filename, stored_path, working_path from documents where status='confirmed' order by id desc")
rep = {}
for r in rows:
    fn = r['original_filename']
    if fn in rep: continue
    src = r['working_path'] if r['working_path'] and os.path.exists(r['working_path']) else (r['stored_path'] if r['stored_path'] and os.path.exists(r['stored_path']) else None)
    if src: rep[fn] = r['id']
ids = sorted(rep.values())
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'runs', 'rr_ids_dedup.txt')
open(out, 'w', encoding='utf-8').write(",".join(str(i) for i in ids))
print(f"deduped representatives with a resolvable file: {len(ids)} -> {out}")
# are the duplicates confirmed IDENTICALLY? (same supplier/ref/date across copies)
diff = 0
for fn, in q("select original_filename from documents where status='confirmed' group by original_filename having count(*)>1"):
    vals = set((r['supplier_name'], r['reference_number'], r['doc_date']) for r in db.execute("select supplier_name, reference_number, doc_date from documents where status='confirmed' and original_filename=?", (fn,)))
    if len(vals) > 1: diff += 1
print(f"duplicate groups whose copies were confirmed DIFFERENTLY (supplier/ref/date): {diff}")
