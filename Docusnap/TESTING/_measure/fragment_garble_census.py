"""Census for the garble-tolerant fragment keep (slice 1, 2026-08-22 evening).

Evaluates `engine._fragment_agreement_keeps_seed` OFF vs ON over real OCR text, three populations:
  A  stored Stage-0.5 issuer reads (extractions.supplier_name rows whose method is a mapping read)
  B  every issuer-band line's issuer column on every template-matched doc (what a ONE-LINE box reads)
  C  ADVERSARIAL: every CONFIRMED doc judged against every OTHER template's fixed name — a keep here
     means the rule would have kept a WRONG seed had the matcher mis-bound the doc. Must be 0.

Usage:  PYTHONIOENCODING=utf-8 py -3.12 TESTING/_measure/fragment_garble_census.py <db> [<db> ...]
Read-only (mode=ro). Pure-function census: no pipeline run, no DB writes.
"""
import os, sys, re, sqlite3
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'python_backend'))
os.environ.setdefault('TEMPLATE_FIXED_SEED_FRAGMENT_KEEP', '1')
from extraction import engine, chrome_band            # noqa: E402
from extraction.name_match import fold_identity       # noqa: E402

KEEP = engine._fragment_agreement_keeps_seed
FLAG = '_FIXED_SEED_FRAGMENT_GARBLE_ON'


def _keep(read, fixed, ocr_text, on):
    setattr(engine, FLAG, bool(on))
    return KEEP('supplier_name', {'method': 'template_fixed', 'value': fixed}, {'value': read}, ocr_text)


def _band_reads(ocr_text):
    out = []
    for ln in chrome_band.issuer_chrome_lines(ocr_text or ''):
        first = re.split(r' {4,}', ln.strip())[0] if ln.strip() else ''
        if first.strip():
            out.append(first.strip())
    return out


def census(path):
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    fixed = {}
    for r in db.execute("SELECT t.id, f.fixed_value FROM templates t JOIN template_fields f ON f.template_id=t.id "
                        "AND f.field_key='supplier_name' AND f.is_variable=0 WHERE f.fixed_value IS NOT NULL AND TRIM(f.fixed_value)<>''"):
        fixed[r['id']] = r['fixed_value'].strip()
    docs = [dict(r) for r in db.execute("SELECT id, status, supplier_name, template_id, ocr_text FROM documents "
                                         "WHERE ocr_text IS NOT NULL AND ocr_text<>''")]
    res = {'db': os.path.basename(path), 'templates_fixed': len(fixed), 'docs': len(docs)}

    # A — stored mapping reads
    a_off = a_on = 0; a_new = []
    for r in db.execute("SELECT e.document_id, e.raw_value, e.display_value, e.extraction_method, d.template_id, d.ocr_text, d.status, d.supplier_name "
                        "FROM extractions e JOIN documents d ON d.id=e.document_id WHERE e.field_key='supplier_name' "
                        "AND (e.extraction_method LIKE 'template_mapping%' OR e.extraction_method LIKE 'identity_variant_adopt%' "
                        "OR e.extraction_method LIKE 'letterhead_prefill%') AND d.template_id IS NOT NULL AND d.ocr_text IS NOT NULL"):
        F = fixed.get(r['template_id'])
        if not F:
            continue
        read = (r['raw_value'] or r['display_value'] or '').strip()
        if not read:
            continue
        off = _keep(read, F, r['ocr_text'], False); on = _keep(read, F, r['ocr_text'], True)
        a_off += off; a_on += on
        if on and not off:
            a_new.append((r['document_id'], read, F, r['status'], r['supplier_name']))
    res['A_off'], res['A_on'], res['A_new'] = a_off, a_on, a_new

    # B — synthetic one-line reads from the band
    b_off = b_on = b_total = 0; b_new = {}
    for d in docs:
        F = fixed.get(d['template_id'])
        if not F:
            continue
        for read in _band_reads(d['ocr_text']):
            b_total += 1
            off = _keep(read, F, d['ocr_text'], False); on = _keep(read, F, d['ocr_text'], True)
            b_off += off; b_on += on
            if on and not off:
                b_new[(read, F)] = b_new.get((read, F), 0) + 1
    res['B_total'], res['B_off'], res['B_on'], res['B_new'] = b_total, b_off, b_on, b_new

    # C — adversarial: confirmed docs vs every OTHER template's fixed name
    c_off = c_on = c_pairs = 0; c_hits = {}
    for d in docs:
        if d['status'] != 'confirmed' or not (d['supplier_name'] or '').strip():
            continue
        S = fold_identity(d['supplier_name'])
        reads = _band_reads(d['ocr_text'])
        for tid, F in fixed.items():
            if fold_identity(F) == S:
                continue
            c_pairs += 1
            for read in reads:
                off = _keep(read, F, d['ocr_text'], False); on = _keep(read, F, d['ocr_text'], True)
                c_off += off; c_on += on
                if on or off:
                    c_hits[(d['id'], d['supplier_name'], read, F)] = ('OFF+ON' if off else 'ON-only')
    res['C_pairs'], res['C_off'], res['C_on'], res['C_hits'] = c_pairs, c_off, c_on, c_hits
    return res


def main():
    for p in sys.argv[1:]:
        r = census(p)
        print(f"\n=== {r['db']}  docs={r['docs']} fixed-templates={r['templates_fixed']}")
        print(f"  A stored mapping reads : kept OFF {r['A_off']}  ON {r['A_on']}  newly-kept {len(r['A_new'])}")
        for x in r['A_new'][:12]:
            print(f"      doc {x[0]} read={x[1]!r} fixed={x[2]!r} status={x[3]} supplier={x[4]!r}")
        print(f"  B band-line reads      : total {r['B_total']}  kept OFF {r['B_off']}  ON {r['B_on']}  newly-kept {sum(r['B_new'].values())}")
        for (read, F), n in sorted(r['B_new'].items(), key=lambda kv: -kv[1])[:15]:
            print(f"      {n:3d}x read={read!r} fixed={F!r}")
        print(f"  C adversarial          : pairs {r['C_pairs']}  kept OFF {r['C_off']}  ON {r['C_on']}  (must be 0)")
        for k, v in list(r['C_hits'].items())[:10]:
            print(f"      {v}: doc {k[0]} confirmed={k[1]!r} read={k[2]!r} judged-against={k[3]!r}")


if __name__ == '__main__':
    main()
