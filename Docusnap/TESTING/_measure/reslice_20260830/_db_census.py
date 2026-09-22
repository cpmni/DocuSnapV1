"""Census over the STORED extraction rows of a DB copy (read-only):
 (1) money fields whose corroboration record carries a dissent — is the dissenting value format-INVALID
     (template_mapper._money_wellformed False), numerically EQUAL to the display (a separator/symbol-only
     'disagreement'), or a genuine different amount?
 (2) noted total/ref/date fields: note text histogram + how many carry a mapping-family dissent (the 0023 class).
Usage: py -3.12 _db_census.py <db>"""
import json, os, sqlite3, sys, collections
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from extraction import template_mapper as TM, validator as V, keyword as KW, number_format as NF   # noqa: E402

db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
db.row_factory = sqlite3.Row
total_keys = {'total_amount', *KW.ROLE_KEY_ALIASES.get('total_amount', ())}
dts = {r['id']: r for r in db.execute('SELECT id, slug, ref_field_key, date_field_key FROM document_types')}
ref_keys = {r['ref_field_key'] for r in dts.values() if r['ref_field_key']}
date_keys = {r['date_field_key'] for r in dts.values() if r['date_field_key']}

def money_num(s):
    s = NF.strip_currency(str(s or '')) if hasattr(TM, 'number_format') else str(s or '')
    a = V.parse_amount(s)
    return None if a is None else round(a, 2)

# (1) money dissent census
c1 = collections.Counter(); ex1 = collections.defaultdict(list)
rows = db.execute("SELECT e.document_id, e.field_key, e.display_value, e.raw_value, e.extraction_method, e.corroboration, e.validation_note, d.status "
                  "FROM extractions e JOIN documents d ON d.id = e.document_id WHERE e.corroboration IS NOT NULL").fetchall()
n_money = 0
for r in rows:
    if r['field_key'] not in total_keys:
        continue
    n_money += 1
    try: rec = json.loads(r['corroboration'])
    except Exception: continue
    for d in (rec.get('disagree') or []):
        v = str(d.get('value') or '')
        wf = TM._money_wellformed(NF.strip_currency(v)) if v else False
        disp = str(r['display_value'] or '')
        if not wf:
            cls = 'format_invalid'
        elif money_num(v) is not None and money_num(v) == money_num(disp):
            cls = 'numeric_equal_separator_only'
        else:
            cls = 'genuine_different_amount'
        c1[cls] += 1
        if len(ex1[cls]) < 8:
            ex1[cls].append((r['document_id'], r['field_key'], disp, v, d.get('family'), r['extraction_method'], (r['validation_note'] or '')[:50]))
print(f"(1) money fields with a corroboration record: {n_money}; dissent classes: {dict(c1)}")
for k, xs in ex1.items():
    print(f"  {k}:")
    for x in xs: print("    ", x)

# (2) noted total/ref/date census
c2 = collections.Counter(); c2m = collections.Counter(); ex2 = collections.defaultdict(list)
rows = db.execute("SELECT e.document_id, e.field_key, e.display_value, e.extraction_method, e.corroboration, e.validation_note, d.status, d.document_type_id "
                  "FROM extractions e JOIN documents d ON d.id = e.document_id WHERE e.validation_note IS NOT NULL AND e.validation_note != ''").fetchall()
for r in rows:
    fk = r['field_key']
    if fk in total_keys: role = 'total'
    elif fk in ref_keys: role = 'ref'
    elif fk in date_keys: role = 'date'
    else: continue
    note = str(r['validation_note'])[:70]
    c2[(role, r['status'], note)] += 1
    has_map_dissent = False
    try:
        rec = json.loads(r['corroboration'] or '{}')
        has_map_dissent = any(d.get('family') == 'mapping' for d in (rec.get('disagree') or []))
    except Exception: pass
    if has_map_dissent:
        c2m[(role, note)] += 1
        if len(ex2[(role, note)]) < 5:
            ex2[(role, note)].append((r['document_id'], fk, r['display_value'], r['extraction_method'], r['status']))
print(f"\n(2) noted total/ref/date fields by (role, status, note): {sum(c2.values())}")
for k, n in sorted(c2.items(), key=lambda kv: -kv[1])[:40]:
    print(f"  {n:4d}  {k}")
print(f"\n(2b) of those, with a MAPPING dissent in the record (the 0023 class): {sum(c2m.values())}")
for k, n in sorted(c2m.items(), key=lambda kv: -kv[1]):
    print(f"  {n:4d}  {k}")
    for x in ex2[k]: print("        ", x)
