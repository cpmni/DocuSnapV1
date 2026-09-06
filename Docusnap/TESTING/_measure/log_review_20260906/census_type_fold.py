"""Item 4(b) gate — corpus-wide RE-DETECT diff, OFF vs ON, over the stored OCR texts of a db.backup() copy.
Read-only. Usage: py -3.12 census_type_fold.py <db-copy> [out.md]
Winner changes must be exactly the uninstalled-heading docs; everything else byte-identical."""
import copy
import io
import json
import os
import sqlite3
import sys

REPO = r'c:\GIT Projects\Docusnap'
sys.path.insert(0, os.path.join(REPO, 'python_backend'))
from extraction import keyword  # noqa: E402

db_path = sys.argv[1]
out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'type_fold_census.md')
patterns = json.load(io.open(os.path.join(REPO, 'config', 'keyword_patterns.json'), encoding='utf-8'))
con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
con.row_factory = sqlite3.Row
types = con.execute('SELECT name, slug, title_aliases FROM document_types').fetchall()
known = [t['name'] for t in types]
aliases = {}
for t in types:
    try:
        a = json.loads(t['title_aliases']) if t['title_aliases'] else None
        if a:
            aliases[t['name']] = a
    except Exception:
        pass
docs = con.execute("SELECT d.id, d.supplier_name, d.status, dt.name AS tname, d.ocr_text FROM documents d "
                   "LEFT JOIN document_types dt ON dt.id = d.document_type_id WHERE d.ocr_text IS NOT NULL AND length(d.ocr_text) > 20").fetchall()

# mirror the app's live election switches for the ON/OFF pair (the ONLY difference is the fold)
base_env = {}
for k in ('TYPE_CAPTION_MENTION_ONLY', 'TYPE_HEADING_ANY_SEGMENT', 'TYPE_TIE_HEADING_PREF'):
    v = con.execute("SELECT value FROM settings WHERE key = 'type_election_title_first'").fetchone()
    base_env[k] = '1' if (v and v[0] == 'true') else '0'
for k, v in base_env.items():
    os.environ[k] = v


def run(text, on):
    if on:
        os.environ['TYPE_UNINSTALLED_HEADING_FOLD'] = '1'
    else:
        os.environ.pop('TYPE_UNINSTALLED_HEADING_FOLD', None)
    try:
        return keyword.detect_document_type(text, copy.deepcopy(patterns), known, aliases or None)
    finally:
        os.environ.pop('TYPE_UNINSTALLED_HEADING_FOLD', None)


changed, same = [], 0
by_change = {}
for d in docs:
    a, b = run(d['ocr_text'], False), run(d['ocr_text'], True)
    ta, tb = (a or {}).get('type'), (b or {}).get('type')
    if ta == tb and (a or {}).get('heading') == (b or {}).get('heading') and (a or {}).get('confidence') == (b or {}).get('confidence'):
        same += 1
        continue
    changed.append((d['id'], d['supplier_name'], d['tname'], d['status'], ta, (a or {}).get('confidence'), tb, (b or {}).get('confidence'), (b or {}).get('heading')))
    key = f"{ta} -> {tb}"
    by_change[key] = by_change.get(key, 0) + 1

lines = [f"# Item 4(b) TYPE_UNINSTALLED_HEADING_FOLD — re-detect census (OFF vs ON)", "",
         f"DB copy: `{db_path}` · installed types: {known} · docs with text: {len(docs)} · unchanged: {same} · changed: {len(changed)}", "",
         "| change | n |", "|---|---|"]
for k, n in sorted(by_change.items(), key=lambda kv: -kv[1]):
    lines.append(f"| {k} | {n} |")
lines += ["", "| doc | supplier | confirmed type | status | OFF type@conf | ON type@conf | ON heading |", "|---|---|---|---|---|---|---|"]
for row in changed:
    lines.append(f"| {row[0]} | {row[1]} | {row[2]} | {row[3]} | {row[4]}@{row[5]} | {row[6]}@{row[7]} | {row[8]} |")
io.open(out_path, 'w', encoding='utf-8').write("\n".join(lines) + "\n")
print("\n".join(lines[:12]))
print(f"... written {out_path}")
