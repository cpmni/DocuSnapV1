"""readable_census.py — "how are we doing on the values that are ACTUALLY PRINTED?"

    py -3.12 stress_test/readable_census.py --db  <path to a docusnap.db>
    py -3.12 stress_test/readable_census.py --json <path to a teach_run_ab arm>

WHY THIS EXISTS. The owner's target is "100% detection on all fields where the data on the doc is
perfectly readable". The ordinary scorer cannot answer that, because it scores every ground-truth
column on every document — including columns whose value is NOT PRINTED ON THE PAGE. Measured on
this corpus, the account number appears on 60 of 200 documents; on the other 140 the ground truth
still names one. Scored the ordinary way that lane reads 60 ok / 40 wrong / 100 empty, which sounds
like a field that half works. Scored against what is actually on the page it reads:

    printed 60 · found 60 · missed 0 · INVENTED 40

— a field that is perfect at reading, and that has a separate, real defect: it puts a value in the
box on 40 documents where the page says nothing. That is the number worth fixing, and the ordinary
score buries it.

The four outcomes, and why each matters on its own:
  FOUND    the value is printed and we read it correctly           <- the owner's 100% target
  WRONG    the value is printed and we read something else         <- a reading defect
  MISSED   the value is printed and we left the field empty        <- a recall defect
  INVENTED the value is NOT printed anywhere, and we filled it in  <- the dangerous one: a
           confident value with no source on the page. Worse than empty, because a human reviewing
           it has nothing to compare against.

"Printed" is decided by searching the document's own stored OCR text for the ground-truth value,
compared with punctuation and case removed, so 'GB 903 3318 42' matches 'GB903331842'. That is
deliberately generous: a value the OCR garbled beyond recognition counts as NOT printed, which
flatters us on WRONG and is honest about INVENTED. Where a lane's truth is a LIST (serial numbers),
a document counts as printed when ANY of its values survived into the text, and as found only when
the committed value matches one of them.
"""
import argparse
import json
import os
import re
import sqlite3
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

HOME = os.path.expanduser('~')
CORPUS = os.path.join(HOME, 'Desktop', 'Customer Doc Test')

# ground-truth column -> the app's field key. Mirrors score_teach_run.COLMAP; ref/date are per-type
# and resolved through the document type's structural roles, so they are not listed here.
COLMAP = {'issuer': 'supplier_name', 'customer': 'customer_name', 'total': 'total',
          'vat_no': 'vat_no', 'account_no': 'account_no', 'po_ref': 'po_ref', 'serials': 'serials'}
BUYER_ISSUED = {'purchase_order'}


def squash(s):
    return re.sub(r'[^A-Z0-9]', '', str(s or '').upper())


# The COMMITTED-vs-TRUTH comparison must use the scorer's own comparators, or this census disagrees
# with the score for silly reasons: a first draft compared money by squashing punctuation and read
# `total` at 74% where the scorer reads 97%, because '3,604.80' and '£3604.8' squash differently.
# The PRINTED test below stays squash-based on purpose — it asks a different question ("do these
# characters appear on the page at all"), and it must tolerate the page's own spacing.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from score_teach_run import n_money, n_ref, n_txt
except Exception:                       # standalone use without the scorer beside it
    n_money = n_ref = n_txt = None

_CMP = {'total': 'money', 'account_no': 'ref', 'po_ref': 'ref', 'vat_no': 'ref',
        'issuer': 'txt', 'customer': 'txt', 'serials': 'ref'}


def same(col, got, truth):
    """Does the committed value match this truth, by the SAME rule the scorer applies?"""
    kind = _CMP.get(col, 'ref')
    if kind == 'money' and n_money:
        a, b = n_money(got), n_money(truth)
        return a is not None and a == b
    if kind == 'txt' and n_txt:
        return n_txt(got) == n_txt(truth)
    if n_ref:
        return n_ref(got) == n_ref(truth)
    return squash(got) == squash(truth)


def truth_values(v):
    """A ground-truth cell -> the list of acceptable strings (a lane may hold a list)."""
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        return [str(x) for x in v if x]
    s = str(v).strip()
    if s.startswith('[') and s.endswith(']'):
        try:
            return [str(x) for x in json.loads(s.replace("'", '"')) if x]
        except Exception:
            pass
    return [s] if s else []


def load_from_db(path):
    con = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    out = []
    for d in con.execute("SELECT * FROM documents WHERE status <> 'deleted'"):
        fields = {r['field_key']: r['display_value']
                  for r in con.execute('SELECT * FROM extractions WHERE document_id = ?', (d['id'],))}
        out.append({'original_filename': d['original_filename'], 'ocr_text': d['ocr_text'],
                    'fields': fields})
    return out


def load_from_json(path, db_for_text):
    """An arm file carries the committed values but no page text, so the text comes from the DB the
    arm was replayed from — the same documents, byte-identical."""
    text = {}
    if db_for_text:
        con = sqlite3.connect(f'file:{db_for_text}?mode=ro', uri=True)
        for fn, t in con.execute('SELECT original_filename, ocr_text FROM documents'):
            text[fn] = t
    out = []
    for d in json.load(open(path, encoding='utf-8')):
        fields = {k: (v or {}).get('v') for k, v in (d.get('fields') or {}).items()}
        out.append({'original_filename': d['original_filename'],
                    'ocr_text': text.get(d['original_filename'], ''), 'fields': fields})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db')
    ap.add_argument('--json')
    ap.add_argument('--text-db', help='where to read page text from when scoring an arm file')
    ap.add_argument('--corpus', default=CORPUS)
    a = ap.parse_args()

    gt = {}
    for r in json.load(open(os.path.join(a.corpus, 'ground_truth.json'), encoding='utf-8')):
        gt[os.path.basename(r['file'])] = r

    docs = load_from_db(a.db) if a.db else load_from_json(a.json, a.text_db or None)

    tally = {k: {'printed': 0, 'found': 0, 'wrong': 0, 'missed': 0, 'invented': 0, 'absent': 0}
             for k in COLMAP}
    invented_examples = {}
    for d in docs:
        g = gt.get(d['original_filename'])
        if not g:
            continue
        page = squash(d.get('ocr_text'))
        for col, key in COLMAP.items():
            # A buyer-issued document's letterhead is OUR company, so ground truth's issuer/customer
            # columns are the other way round and its VAT column names a company that is not on the
            # page at all. Same reasoning as score_teach_run.py; skipped rather than scored.
            if (g.get('type_slug') in BUYER_ISSUED) and col in ('issuer', 'customer', 'vat_no'):
                continue
            truths = truth_values(g.get(col))
            got = d['fields'].get(key)
            t = tally[col]
            printed = any(squash(v) and squash(v) in page for v in truths)
            if not truths:
                continue
            if printed:
                t['printed'] += 1
                if not got:
                    t['missed'] += 1
                elif any(same(col, got, v) for v in truths):
                    t['found'] += 1
                else:
                    t['wrong'] += 1
            else:
                t['absent'] += 1
                if got:
                    t['invented'] += 1
                    invented_examples.setdefault(col, []).append(
                        (d['original_filename'], got, truths[0] if truths else ''))

    print(f'{len(docs)} documents\n')
    print(f"{'field':12} {'PRINTED':>8} {'found':>7} {'wrong':>7} {'missed':>7} "
          f"{'| not on page':>13} {'INVENTED':>9}   readable score")
    for col, t in tally.items():
        pct = f"{100.0 * t['found'] / t['printed']:.0f}%" if t['printed'] else '   -'
        print(f"  {col:10} {t['printed']:8} {t['found']:7} {t['wrong']:7} {t['missed']:7} "
              f"{t['absent']:13} {t['invented']:9}   {pct:>6}")

    print('\nINVENTED — a value committed where the page carries none. These are the ones that can '
          '\nreach a human with nothing to check them against:')
    for col, ex in invented_examples.items():
        print(f"  {col}: {len(ex)} document(s), e.g. "
              + '; '.join(f'{os.path.basename(f)[:34]} -> {v!r}' for f, v, _ in ex[:2]))
    if not invented_examples:
        print('  (none)')


if __name__ == '__main__':
    main()
