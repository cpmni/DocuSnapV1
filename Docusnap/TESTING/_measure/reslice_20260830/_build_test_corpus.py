"""Build the DURABLE deduplicated test corpus (owner convention 2026-08-30: "only run 1 version of each doc —
no duplicates … put them in a safe folder you can use for testing in future").

One representative FILE per PAPER — key (type slug, normalised supplier, normalised ref, normalised date), the
HIGHEST confirmed doc id with a resolvable file (working_path, else stored_path); a doc with an EMPTY ref or date is
never collapsed. Same rule as _dedup_ids.py (the realdoc RR_IDS list).

Output <dest>/:
  <type_slug>/doc<id>_<original_filename>     (the id prefix disambiguates repeated filenames)
  ground_truth.json                           (per file: id, type, supplier, ref, date, total, subtotal, source)
  rr_ids.txt                                  (the same ids, comma-separated — feed realdoc via RR_IDS)
  README.txt

Usage: py -3.12 _build_test_corpus.py <db-copy> <dest>
Reads the DB copy read-only; copies files; never touches the live DB or the source folders.
"""
import json, os, re, shutil, sqlite3, sys, collections, datetime

db_path, dest = sys.argv[1], sys.argv[2]
db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True); db.row_factory = sqlite3.Row
rows = db.execute(
    "select d.id, d.original_filename, d.stored_path, d.working_path, d.supplier_name, d.reference_number, "
    "d.doc_date, dt.slug from documents d left join document_types dt on dt.id = d.document_type_id "
    "where d.status='confirmed' order by d.id desc").fetchall()
ns = lambda s: re.sub(r'[^a-z0-9]+', ' ', str(s or '').lower()).strip()
nr = lambda s: re.sub(r'\s+', '', str(s or '').upper())
nd = lambda s: re.sub(r'[^0-9]', '', str(s or ''))

def src(r):
    for p in (r['working_path'], r['stored_path']):
        if p and os.path.exists(p):
            return p
    return None

ex = {}
for e in db.execute("select e.document_id, e.field_key, e.display_value from extractions e "
                    "join documents d on d.id = e.document_id where d.status='confirmed'"):
    ex.setdefault(e['document_id'], {})[e['field_key']] = e['display_value']

rep, nofile = {}, 0
for r in rows:
    p = src(r)
    if not p:
        nofile += 1
        continue
    ref, date = nr(r['reference_number']), nd(r['doc_date'])
    key = (r['slug'], ns(r['supplier_name']), ref, date) if (ref and date) else ('__individual__', r['id'])
    rep.setdefault(key, (r, p))

os.makedirs(dest, exist_ok=True)
gt, per_type = {}, collections.Counter()
for (r, p) in rep.values():
    slug = r['slug'] or 'untyped'
    tdir = os.path.join(dest, slug)
    os.makedirs(tdir, exist_ok=True)
    fname = f"doc{r['id']}_{os.path.basename(r['original_filename'] or os.path.basename(p))}"
    shutil.copy2(p, os.path.join(tdir, fname))
    per_type[slug] += 1
    e = ex.get(r['id'], {})
    gt[f"{slug}/{fname}"] = {
        "id": r['id'], "type_slug": slug, "supplier": r['supplier_name'],
        "ref": r['reference_number'], "date": r['doc_date'],
        "total": e.get('total') if e.get('total') is not None else e.get('total_amount'),
        "subtotal": e.get('subtotal'), "source": p,
    }
with open(os.path.join(dest, 'ground_truth.json'), 'w', encoding='utf-8') as f:
    json.dump(gt, f, indent=1, ensure_ascii=False)
with open(os.path.join(dest, 'rr_ids.txt'), 'w', encoding='utf-8') as f:
    f.write(",".join(str(v[0]['id']) for v in sorted(rep.values(), key=lambda v: v[0]['id'])))
with open(os.path.join(dest, 'README.txt'), 'w', encoding='utf-8') as f:
    f.write(
        "ScanFinder TEST CORPUS — one file per PAPER, no duplicates (owner convention 2026-08-30).\n"
        f"Built {datetime.date.today().isoformat()} from a db.backup() copy of the live DB "
        f"({len(rows)} confirmed rows -> {len(gt)} papers; {nofile} rows had no file).\n"
        "Dedupe key: (type, supplier, ref, date), normalised; representative = the highest confirmed doc id.\n"
        "ground_truth.json = the CONFIRMED values per file (the same GT the realdoc harness scores against).\n"
        "rr_ids.txt = the ids, for the DB-based harness: set RR_IDS to its contents.\n"
        "USE THIS FOLDER (or RR_IDS) for testing — never the raw duplicate-heavy import folders.\n"
        "Regenerate after a big import: TESTING/_measure/reslice_20260830/_build_test_corpus.py <db-copy> <dest>.\n"
        "Do not confirm/teach from this folder into the LIVE app (it would re-import duplicates).\n")
print(f"papers: {len(gt)}  (confirmed rows {len(rows)}, no-file {nofile})")
print("per type:", dict(sorted(per_type.items(), key=lambda kv: -kv[1])))
print(f"-> {dest}")
