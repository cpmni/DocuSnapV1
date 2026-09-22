"""One representative per PAPER for the realdoc harness (owner: most confirmed docs are re-imports of the same
document under other filenames). Key = (type slug, normalised supplier, normalised ref, normalised date); a doc with an
EMPTY ref or date is never collapsed (kept individually — an empty key would merge unrelated papers). Representative =
the HIGHEST id with a resolvable file (the most recently confirmed copy). Also reports byte-identical files (SHA-1).
Writes tmp/runs/rr_ids_dedup.txt."""
import os, re, sqlite3, sys, hashlib, collections
db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True); db.row_factory = sqlite3.Row
rows = db.execute("select d.id, d.original_filename, d.stored_path, d.working_path, d.supplier_name, d.reference_number, d.doc_date, dt.slug "
                  "from documents d left join document_types dt on dt.id = d.document_type_id where d.status='confirmed' order by d.id desc").fetchall()
ns = lambda s: re.sub(r'[^a-z0-9]+', ' ', str(s or '').lower()).strip()
nr = lambda s: re.sub(r'\s+', '', str(s or '').upper())
nd = lambda s: re.sub(r'[^0-9]', '', str(s or ''))
def src(r):
    for p in (r['working_path'], r['stored_path']):
        if p and os.path.exists(p): return p
    return None
rep, kept_individual, hashes, nofile = {}, [], {}, 0
for r in rows:
    p = src(r)
    if not p: nofile += 1; continue
    h = hashlib.sha1(open(p, 'rb').read()).hexdigest()
    hashes.setdefault(h, r['id'])
    ref, date = nr(r['reference_number']), nd(r['doc_date'])
    if not ref or not date:
        kept_individual.append(r['id']); continue
    key = (r['slug'], ns(r['supplier_name']), ref, date)
    rep.setdefault(key, r['id'])
ids = sorted(set(rep.values()) | set(kept_individual))
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'runs', 'rr_ids_dedup.txt')
open(out, 'w', encoding='utf-8').write(",".join(str(i) for i in ids))
print(f"confirmed with a file: {len(rows) - nofile} (no file: {nofile}); byte-identical distinct files: {len(hashes)}")
print(f"distinct papers by (type, supplier, ref, date): {len(rep)}; kept individually (empty ref/date): {len(kept_individual)}")
print(f"representatives written: {len(ids)} -> {out}")
by_type = collections.Counter(k[0] for k in rep)
print("papers by type:", dict(by_type))
