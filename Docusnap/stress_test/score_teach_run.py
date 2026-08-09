"""Score the teach-side test run against the corpus ground truth.

Answers the question the run exists to answer: after teaching ONE document per scope, how much of
the rest does the system get right — per issuer, per field, and by which rung won the value.

  py -3.12 stress_test/score_teach_run.py [--db <path>] [--json <captured extractions.json>]
                                          [--label <name>] [--compare <other.json>]

SCORING RULES, and why:
  • The TAUGHT document is excluded. It is trivially correct and would flatter every scope by 1/20.
  • A document the operator CONFIRMED is reported separately, not counted as a system read: a
    confirm is the human's answer. Its raw_value is still shown, because that IS what the system
    read before the human touched it.
  • A field the operator corrected is scored on raw_value (what the system produced), never on the
    corrected display_value.
  • EMPTY is counted apart from WRONG. A guard that withholds a value is not the same failure as
    one that commits a wrong one, and averaging them together hides which way a change moved.
"""
import argparse, collections, json, os, re, sqlite3, sys

HOME = os.path.expanduser('~')
CORPUS = os.path.join(HOME, 'Desktop', 'Customer Doc Test')
TESTING = os.path.join(HOME, 'Desktop', 'TESTING')

# ground-truth column -> app field key. The ref/date columns are per-type and resolved via the
# document type's structural roles, so they are not listed here.
# Types the BUYER issues: the document's own letterhead is the customer of the trading
# relationship, so the corpus's counterparty-named `issuer` column is inverted against the app's
# Document Issuer role. Verified at the pixels — see the swap site below.
BUYER_ISSUED = {'purchase_order'}

COLMAP = {'issuer': 'supplier_name', 'customer': 'customer_name', 'total': 'total',
          'vat_no': 'vat_no', 'account_no': 'account_no', 'po_ref': 'po_ref', 'serials': 'serials'}


def n_txt(s):
    return re.sub(r'[^a-z0-9]+', ' ', str(s or '').lower()).strip()


def n_ref(s):
    return re.sub(r'\s+', '', str(s or '').upper())


def n_date(s):
    return re.sub(r'[^0-9]', '', str(s or ''))


def n_money(s):
    m = re.sub(r'[^0-9.\-]', '', str(s or ''))
    try:
        return f'{float(m):.2f}'
    except ValueError:
        return None


NORM = {'total': n_money, 'ref': n_ref, 'date': n_date}


def load_gt():
    gt = {}
    for r in json.load(open(os.path.join(CORPUS, 'ground_truth.json'), encoding='utf-8')):
        gt[(os.path.basename(r['file']), r.get('rendition'))] = r
    return gt


def load_docs(db_path=None, json_path=None):
    if json_path:
        return json.load(open(json_path, encoding='utf-8'))
    con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    out = []
    for d in con.execute("SELECT * FROM documents WHERE status <> 'deleted'"):
        fields = {r['field_key']: {'v': r['display_value'], 'raw': r['raw_value'], 'c': r['confidence'],
                                   'm': r['extraction_method'], 'note': r['validation_note'],
                                   'corr': r['was_corrected']}
                  for r in con.execute('SELECT * FROM extractions WHERE document_id = ?', (d['id'],))}
        out.append({**{k: d[k] for k in d.keys()}, 'fields': fields})
    return out


def roles(db_path):
    con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    return {r[0]: (r[1], r[2]) for r in
            con.execute('SELECT slug, ref_field_key, date_field_key FROM document_types')}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=os.path.join(TESTING, '_sandbox', 'userData', 'docusnap.db'))
    ap.add_argument('--json')
    ap.add_argument('--label', default='run')
    ap.add_argument('--out')
    a = ap.parse_args()

    gt = load_gt()
    man = json.load(open(os.path.join(TESTING, 'run_manifest.json'), encoding='utf-8'))
    role = roles(a.db)
    taught = {s['teach_file'] for s in man['scopes']}
    scope_of = {}
    for s in man['scopes']:
        for f in s.get('import_files', []):
            scope_of[f] = (s['issuer'], s['type'], 'scan')   # ground_truth.json says 'scan', not 'scanned'
        for f in s.get('import2_files', []):
            scope_of[f] = (s['issuer'], s['type'], 'scan')   # ground_truth.json says 'scan', not 'scanned'
        scope_of[s['teach_file']] = (s['issuer'], s['type'], 'digital')

    docs = load_docs(a.db, a.json)
    per_scope = collections.defaultdict(lambda: collections.defaultdict(
        lambda: {'ok': 0, 'wrong': 0, 'empty': 0, 'examples': []}))
    rung = collections.Counter()
    skipped = {'taught': 0, 'confirmed': 0, 'no_gt': 0}
    detail = []

    for d in docs:
        fn = d['original_filename']
        if fn in taught:
            skipped['taught'] += 1
            continue
        sc = scope_of.get(fn)
        g = gt.get((fn, sc[2] if sc else None))
        if not g or not sc:
            skipped['no_gt'] += 1
            continue
        was_confirmed = d['status'] == 'confirmed'
        if was_confirmed:
            skipped['confirmed'] += 1
        issuer, tslug, _ = sc
        rk, dk = role.get(tslug, (None, None))
        colmap = dict(COLMAP)
        if tslug in BUYER_ISSUED:
            # The corpus labels every document by its COUNTERPARTY (the folder it lives in), which
            # for a BUYER-ISSUED document is not the document's issuer. Verified at the pixels on
            # Quillstone-Print_purchase_order_*: the letterhead — logo, address, VAT number — is
            # Bramblewood, with "SUPPLIER: Quillstone Print & Packaging" and "DELIVER TO:
            # Bramblewood". Bramblewood raised the order. So ground truth's `issuer` column names
            # Quillstone while the app's Document Issuer role correctly holds Bramblewood.
            # Both definitions are defensible; they simply differ for this direction of trade, and
            # scoring them against each other marks a CORRECT read wrong twice over (once on issuer,
            # once on customer). Swap the two columns so like is compared with like.
            colmap['issuer'], colmap['customer'] = COLMAP['customer'], COLMAP['issuer']
            # ...and DROP vat_no on the same grounds, verified at the pixels on
            # Quillstone-Print_purchase_order_0015: the page carries exactly ONE VAT number,
            # 'VAT Reg No GB 512 8846 27' in Bramblewood's own letterhead. The counterparty's VAT
            # (ground truth's `vat_no` column) is NOT PRINTED ANYWHERE on a buyer-issued order.
            # So the app reads the only VAT number on the page — correctly, by the field's role —
            # and scoring it against a number that does not appear marks a correct read wrong on
            # every purchase order. There is no ground truth here to score against, so this column
            # is skipped rather than swapped: unlike issuer/customer, there is no second column
            # holding the right answer.
            colmap.pop('vat_no', None)
        checks = [(c, k) for c, k in colmap.items()] + [('ref', rk), ('date', dk)]
        for col, key in checks:
            if not key or g.get(col) in (None, ''):
                continue
            f = (d['fields'] or {}).get(key) or {}
            # what the SYSTEM produced: raw_value when the human corrected it
            got = f.get('raw') if f.get('corr') else f.get('v')
            norm = NORM.get(col, n_txt)
            exp_n, got_n = norm(g[col]), norm(got)
            cell = per_scope[(issuer, tslug)][col]
            if not str(got or '').strip():
                cell['empty'] += 1
                state = 'EMPTY'
            elif exp_n == got_n:
                cell['ok'] += 1
                state = 'ok'
            else:
                cell['wrong'] += 1
                state = 'WRONG'
                if len(cell['examples']) < 3:
                    cell['examples'].append(f"{g[col]!r} -> {got!r} [{f.get('m')} {f.get('c')}]")
            if state != 'ok':
                detail.append({'doc': fn, 'issuer': issuer, 'type': tslug, 'field': col,
                               'expected': g[col], 'got': got, 'method': f.get('m'),
                               'conf': f.get('c'), 'note': f.get('note'), 'state': state,
                               'confirmed': was_confirmed})
            rung[(col, str(f.get('m')))] += 1

    print(f'=== TEACH RUN SCORE — {a.label} ===')
    print(f"scored {len(docs)} docs   (excluded: {skipped['taught']} taught, "
          f"{skipped['no_gt']} without ground truth; {skipped['confirmed']} were operator-confirmed "
          f"and are scored on raw_value)\n")

    cols = ['issuer', 'ref', 'date', 'customer', 'total', 'vat_no', 'account_no', 'po_ref', 'serials']
    w = max(len(f'{i} {t}') for i, t in per_scope) if per_scope else 20
    CW = 11   # wide enough for "100% 20/20" — a truncated denominator misreads as a tiny sample
    print(f"{'scope'.ljust(w)}  " + '  '.join(c[:CW].rjust(CW) for c in cols))
    tot = collections.defaultdict(lambda: {'ok': 0, 'wrong': 0, 'empty': 0})
    for (issuer, tslug), fields in sorted(per_scope.items()):
        cells = []
        for c in cols:
            r = fields.get(c)
            if not r or (r['ok'] + r['wrong'] + r['empty']) == 0:
                cells.append('-'.rjust(CW))
                continue
            n = r['ok'] + r['wrong'] + r['empty']
            for k in ('ok', 'wrong', 'empty'):
                tot[c][k] += r[k]
            cells.append(f"{100*r['ok']//n:3d}% {r['ok']:2d}/{n:2d}".rjust(CW))
        print(f'{f"{issuer} {tslug}".ljust(w)}  ' + '  '.join(cells))

    print(f'\n{"TOTAL".ljust(w)}  ' + '  '.join(
        (f"{100*tot[c]['ok']//max(1,sum(tot[c].values())):3d}%".rjust(CW) if sum(tot[c].values()) else '-'.rjust(CW))
        for c in cols))
    print('\nper field: ok / wrong / EMPTY')
    for c in cols:
        s = tot[c]
        if sum(s.values()):
            print(f"  {c:12s} ok {s['ok']:4d}   wrong {s['wrong']:4d}   empty {s['empty']:4d}")

    print('\nwinning rung, by field (top 4 each):')
    by_field = collections.defaultdict(collections.Counter)
    for (col, m), n in rung.items():
        by_field[col][m] += n
    for c in cols:
        if by_field.get(c):
            top = ', '.join(f'{m}×{n}' for m, n in by_field[c].most_common(4))
            print(f'  {c:12s} {top}')

    out = a.out or os.path.join(TESTING, f'score_{a.label}.json')
    json.dump({'label': a.label, 'per_scope': {f'{i}|{t}': dict(f) for (i, t), f in per_scope.items()},
               'failures': detail}, open(out, 'w', encoding='utf-8'), indent=1, default=str)
    print(f'\n{len(detail)} failing cells written to {out}')


if __name__ == '__main__':
    main()
