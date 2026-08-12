"""type_election_census.py — READ-ONLY stored-text TYPE-election census (herald Gate 2,
type-election title-first slice, 2026-08-12 NIGHT).

Replays keyword.detect_document_type over every stored documents.ocr_text in a SNAPSHOT of the
live DB, under 5 arms (OFF · each flag solo · ALL ON), and reports:
  - every doc whose (type, heading) flips vs the OFF arm, per arm — grouped so the fix-2 admit
    class (cross-reference header cells) is visible;
  - the exact-tie population (fix-3's whole constituency);
  - flips on docs whose OFF election MATCHED the human-confirmed type = candidate REGRESSIONS
    (must be adjudicated individually; M=0 outside the healed class is the gate).

Usage:  py -3.12 stress_test/type_election_census.py <snapshot-db-path>
NEVER point it at a DB the app holds — snapshot first (better-sqlite3 backup / file copy while closed).
"""
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python_backend'))
from extraction import keyword  # noqa: E402

if len(sys.argv) < 2:
    print('usage: type_election_census.py <snapshot-db>')
    sys.exit(2)

DB = sys.argv[1]
CFG = os.path.join(os.path.dirname(__file__), '..', 'config', 'keyword_patterns.json')
with open(CFG, encoding='utf-8') as f:
    PATTERNS = json.load(f)

con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
con.row_factory = sqlite3.Row

# Known types + title aliases, as the engine threads them.
types = con.execute('SELECT name, slug, title_aliases FROM document_types').fetchall()
KNOWN = [t['name'] for t in types]
ALIASES = {}
for t in types:
    try:
        a = json.loads(t['title_aliases'] or '[]')
        if a:
            ALIASES[t['name']] = a
    except Exception:
        pass
NAME_BY_SLUG = {t['slug']: t['name'] for t in types}
SLUG_BY_NAME = {t['name']: t['slug'] for t in types}

# Mirror the LIVE install's heading env (the bridge flags) so the replay matches production.
BASE_ENV = {}
srow = dict(con.execute("SELECT key, value FROM settings WHERE key='heading_absent_reread'").fetchone() or {})
if srow.get('value') == 'true':
    BASE_ENV.update({'HEADING_ABSENT_REREAD': '1', 'HEADING_TITLE_GAP_COLLAPSE': '1',
                     'REPROCESS_HEADING_GEOM': '1'})

ARMS = {
    'OFF':  {},
    'f1':   {'TYPE_CAPTION_MENTION_ONLY': '1'},
    'f2':   {'TYPE_HEADING_ANY_SEGMENT': '1'},
    'f3':   {'TYPE_TIE_HEADING_PREF': '1'},
    'ALL':  {'TYPE_CAPTION_MENTION_ONLY': '1', 'TYPE_HEADING_ANY_SEGMENT': '1',
             'TYPE_TIE_HEADING_PREF': '1'},
}
FLAG_KEYS = ['TYPE_CAPTION_MENTION_ONLY', 'TYPE_HEADING_ANY_SEGMENT', 'TYPE_TIE_HEADING_PREF']


def run_arm(text, arm):
    for k in FLAG_KEYS:
        os.environ.pop(k, None)
    os.environ.update(BASE_ENV)
    os.environ.update(ARMS[arm])
    return keyword.detect_document_type(text, PATTERNS, KNOWN, ALIASES)


docs = con.execute("""SELECT d.id, d.original_filename, d.status, d.ocr_text, dt.name AS confirmed_type
  FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
  WHERE d.ocr_text IS NOT NULL AND TRIM(d.ocr_text) <> ''""").fetchall()
print(f'docs with stored text: {len(docs)} | base env: {BASE_ENV or "(none)"}')

ties = 0
flips = {a: [] for a in ARMS if a != 'OFF'}
regressions = {a: [] for a in ARMS if a != 'OFF'}
for d in docs:
    base = run_arm(d['ocr_text'], 'OFF')
    bt = base and base.get('type')
    bs = (base or {}).get('all_scores') or {}
    if len(bs) > 1 and sorted(bs.values())[-1] == sorted(bs.values())[-2]:
        ties += 1
    for arm in flips:
        r = run_arm(d['ocr_text'], arm)
        rt = r and r.get('type')
        if rt != bt or (r or {}).get('heading') != (base or {}).get('heading'):
            line = (f"#{d['id']} {d['original_filename']} [{d['status']}] "
                    f"OFF={bt}/{(base or {}).get('heading')} {arm}={rt}/{(r or {}).get('heading')} "
                    f"confirmed={d['confirmed_type']}")
            flips[arm].append(line)
            # Candidate regression: OFF matched the human-confirmed type and the arm flips AWAY.
            if (d['status'] == 'confirmed' and d['confirmed_type'] and bt == d['confirmed_type']
                    and rt != d['confirmed_type']):
                regressions[arm].append(line)

print(f'exact-tie population (fix-3 constituency): {ties}')
for arm, rows in flips.items():
    print(f'\n=== arm {arm}: {len(rows)} flips vs OFF')
    for l in rows[:40]:
        print('  ' + l)
    if len(rows) > 40:
        print(f'  ... +{len(rows) - 40} more')
print('\n=== CANDIDATE REGRESSIONS (OFF matched confirmed type, arm flips away — adjudicate each):')
any_reg = False
for arm, rows in regressions.items():
    for l in rows:
        any_reg = True
        print(f'  [{arm}] {l}')
if not any_reg:
    print('  none')
con.close()
