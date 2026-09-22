"""Census (2): ref/date ROLE fields whose stored corroboration record carries a dissent — is the dissent
deterministically format-invalid (date: parse_date None) / what family / what note+status?
Usage: py -3.12 _db_census2.py <db>"""
import json, sqlite3, sys, collections
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from extraction import validator as V   # noqa: E402

db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True); db.row_factory = sqlite3.Row
dts = {r['id']: r for r in db.execute('SELECT id, slug, ref_field_key, date_field_key FROM document_types')}
c = collections.Counter(); ex = collections.defaultdict(list)
rows = db.execute("SELECT e.document_id, e.field_key, e.display_value, e.extraction_method, e.corroboration, e.validation_note, e.confidence, d.status, d.document_type_id "
                  "FROM extractions e JOIN documents d ON d.id = e.document_id WHERE e.corroboration IS NOT NULL").fetchall()
n_role = 0
for r in rows:
    dt = dts.get(r['document_type_id'])
    if not dt: continue
    role = 'ref' if r['field_key'] == dt['ref_field_key'] else ('date' if r['field_key'] == dt['date_field_key'] else None)
    if not role: continue
    n_role += 1
    try: rec = json.loads(r['corroboration'])
    except Exception: continue
    for d in (rec.get('disagree') or []):
        v = str(d.get('value') or '')
        if role == 'date':
            cls = 'date_invalid' if V.parse_date(v) is None else 'date_valid_different'
        else:
            cls = 'ref_different'
        key = (role, cls, d.get('family'), r['status'], bool(r['validation_note']))
        c[key] += 1
        if len(ex[key]) < 6:
            ex[key].append((r['document_id'], r['field_key'], r['display_value'], v, r['extraction_method'], r['confidence'], (r['validation_note'] or '')[:40]))
print(f"role fields with a record: {n_role}; dissents by (role, class, family, doc status, noted): {sum(c.values())}")
for k, n in sorted(c.items(), key=lambda kv: -kv[1]):
    print(f"  {n:4d} {k}")
    for x in ex[k]: print("       ", x)
