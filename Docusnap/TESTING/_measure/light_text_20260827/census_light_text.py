"""census_light_text.py — LIGHT-TEXT RECOVERY census (Oracle gate 3 + condition 7; read-only).

For every scanned document (page 1; status confirmed / needs_review / deferred) on a DB copy: run the PRODUCT
reconstruct_page_text OFF and ON (env OCR_LIGHT_TEXT_RECOVERY) at the app DPI (200) and record per page:
  base words, words added (text / conf / h÷med_h / y÷H), the added lines, whether every OFF line is contained in an
  ON line (the placement guarantee), light words placed INTO base rows, OFF column breaks lost, the letterhead band
  (`header_band_text`) OFF vs ON — shrank?, light words in the rung-2 heading window (h ≥ 1.8×med_h, top ≤ 0.30·H),
  added lines naming ANOTHER known supplier/template, digit-bearing survivors by conf band, footer-like / date-like /
  money-like added lines, the extra seconds.

Usage:  py -3.12 census_light_text.py <db-copy> <out.jsonl> [limit]
Never writes to the DB. Output is a JSONL (one line per page) + a summary on stdout.
"""
import json, os, re, sqlite3, sys, time
from pathlib import Path
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from ocr import tesseract as T
from ocr import born_digital as BD
from ocr.heading_reread import find_prominent_heading_band
from extraction.template_matcher import header_band_text
import pypdfium2 as pdfium
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')

DB, OUT = sys.argv[1], sys.argv[2]
LIMIT = int(sys.argv[3]) if len(sys.argv) > 3 else 0
DPI = 200
FOOTER_RE = re.compile(r'\b(vat|reg(istered)?|company|registration|customer|supplier|vendor|tel|fax|www|e-?mail)\b', re.I)
DATE_RE = re.compile(r'\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b')
MONEY_RE = re.compile(r'[£$€]\s?\d|\b\d{1,3}(,\d{3})*\.\d{2}\b')

con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
rows = con.execute("""SELECT d.id, d.supplier_name, dt.slug, d.working_path, d.stored_path, d.status
                        FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
                       WHERE d.status IN ('confirmed', 'needs_review', 'deferred') ORDER BY d.id""").fetchall()
names = set()
for (n,) in con.execute("SELECT DISTINCT supplier_name FROM documents WHERE supplier_name IS NOT NULL"): names.add(str(n).strip().lower())
for (n,) in con.execute("SELECT DISTINCT name FROM templates WHERE name IS NOT NULL"): names.add(str(n).strip().lower())
con.close()
NAMES = sorted(n for n in names if len(n) >= 6)

def subseq(a, b):
    it = iter(b); return all(tok in it for tok in a)

def other_supplier(lines, own):
    own = (own or '').strip().lower()
    hits = set()
    for l in lines:
        low = l.lower()
        for n in NAMES:
            if n != own and n in low and not (own and (n in own or own in n)):
                hits.add(n)
    return sorted(hits)

tot = {'pages': 0, 'pages_with_adds': 0, 'words_added': 0, 'viol_pages': 0, 'into_base_rows': 0, 'col_breaks_lost_pages': 0,
       'band_shrank_pages': 0, 'rung2_window_words': 0, 'other_supplier_pages': 0, 'footer_like_pages': 0, 'date_like_lines': 0,
       'money_like_lines': 0, 't_extra': 0.0, 'by_status': {}}
conf_hist = {'60-69': 0, '70-79': 0, '80-89': 0, '90+': 0}
digit_hist = {'80-89': 0, '90+': 0}
n_scanned = 0
with open(OUT, 'w', encoding='utf-8') as out:
    for (did, sup, slug, wp, sp, status) in rows:
        p = wp if wp and os.path.exists(wp) else (sp if sp and os.path.exists(sp) else None)
        if not p or not p.lower().endswith('.pdf'):
            continue
        try:
            doc = pdfium.PdfDocument(p); born = BD.assess_page(doc[0])[0]; doc.close()
        except Exception:
            born = True
        if born:
            continue
        n_scanned += 1
        if LIMIT and n_scanned > LIMIT:
            break
        try:
            img = T.pdf_to_images(Path(p), dpi=DPI)[0]
        except Exception as e:
            out.write(json.dumps({'id': did, 'error': str(e)}) + '\n'); continue
        os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None)
        t0 = time.time(); wo_off = {}; off = T.reconstruct_page_text(img, dpi=DPI, words_out=wo_off); t_off = time.time() - t0
        os.environ['OCR_LIGHT_TEXT_RECOVERY'] = '1'
        t0 = time.time(); wo_on = {}; on = T.reconstruct_page_text(img, dpi=DPI, words_out=wo_on); t_on = time.time() - t0
        os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None)
        tot['pages'] += 1; tot['t_extra'] += (t_on - t_off); tot['by_status'][status] = tot['by_status'].get(status, 0) + 1
        added = list(wo_on.get('light_words') or [])
        light_set = set(added)
        base_set = set(wo_off.get('words') or [])
        med_h = wo_off.get('med_h') or 1
        W, H = img.size
        off_lines = off.split('\n'); on_lines = on.split('\n')
        missing = [l for l in off_lines if not any(subseq(l.split(), m.split()) for m in on_lines)]
        added_lines = [l for l in on_lines if l not in off_lines]
        into_base = sum(1 for r in (wo_on.get('rows') or []) if any(w in light_set for w in r) and any(w in base_set for w in r))
        cb = T.COLUMN_BREAK
        lost = 0
        for l in off_lines:
            if cb not in l: continue
            m = next((m for m in on_lines if subseq(l.split(), m.split())), None)
            if m is not None and m.count(cb) < l.count(cb): lost += 1
        band_off, band_on = header_band_text(off), header_band_text(on)
        rung2 = sum(1 for w in added if w[3] >= 1.8 * med_h and w[1] <= 0.30 * H)
        others = other_supplier(added_lines, sup)
        digit_words = [w for w in added if any(ch.isdigit() for ch in w[4])]
        replaced = [(w[4], w[3]) for w in (wo_on.get('light_replaced') or [])]
        rep_txt = set(t for t, _h in replaced)
        # a violation is EXPLAINED when every token the OFF line lost is a replaced degenerate sliver
        unexplained = []
        for l in missing:
            best = max(on_lines, key=lambda m: sum(1 for tok in l.split() if tok in m.split()), default='')
            lost = [tok for tok in l.split() if tok not in best.split()]
            if any(tok not in rep_txt for tok in lost):
                unexplained.append(l)
        rec = {
            'id': did, 'status': status, 'supplier': sup, 'type': slug, 'base_words': len(base_set), 'med_h': med_h,
            'light_replaced': replaced, 'viol_unexplained': unexplained[:3], 'viol_unexplained_n': len(unexplained),
            'added': len(added), 'added_words': [(w[4], round(w[5]), round(w[3] / med_h, 2), round(w[1] / H, 3)) for w in added],
            'added_lines': added_lines[:12], 'off_lines_missing': len(missing), 'missing_sample': missing[:3],
            'into_base_rows': into_base, 'col_breaks_lost': lost, 'band_len_off': len(band_off), 'band_len_on': len(band_on),
            'band_shrank': len(band_on) < len(band_off), 'rung2_window': rung2,
            'heading_band_same': find_prominent_heading_band(wo_off) == find_prominent_heading_band(wo_on),
            'other_supplier_named': others, 'digit_words': [(w[4], round(w[5])) for w in digit_words],
            'off_text_identical': off == on, 't_off': round(t_off, 2), 't_on': round(t_on, 2),
            'footer_like': bool(FOOTER_RE.search(' '.join(added_lines))),
            'date_like': sum(1 for l in added_lines if DATE_RE.search(l)), 'money_like': sum(1 for l in added_lines if MONEY_RE.search(l)),
        }
        out.write(json.dumps(rec, ensure_ascii=False) + '\n'); out.flush()
        if added:
            tot['pages_with_adds'] += 1; tot['words_added'] += len(added)
            for w in added:
                c = w[5]; conf_hist['90+' if c >= 90 else '80-89' if c >= 80 else '70-79' if c >= 70 else '60-69'] += 1
            for w in digit_words:
                digit_hist['90+' if w[5] >= 90 else '80-89'] += 1
            tot['into_base_rows'] += into_base; tot['rung2_window_words'] += rung2
            if lost: tot['col_breaks_lost_pages'] += 1
            if rec['band_shrank']: tot['band_shrank_pages'] += 1
            if others: tot['other_supplier_pages'] += 1
            if rec['footer_like']: tot['footer_like_pages'] += 1
            tot['date_like_lines'] += rec['date_like']; tot['money_like_lines'] += rec['money_like']
        if missing: tot['viol_pages'] += 1
        if tot['pages'] % 25 == 0:
            print(f"[{tot['pages']}] adds={tot['pages_with_adds']} words={tot['words_added']} viol={tot['viol_pages']} "
                  f"into_rows={tot['into_base_rows']} cb_lost={tot['col_breaks_lost_pages']} band_shrank={tot['band_shrank_pages']} "
                  f"extra={tot['t_extra']/tot['pages']:.2f}s/page", flush=True)

summary = dict(tot); summary['extra_s_per_page'] = round(tot['t_extra'] / max(1, tot['pages']), 2); del summary['t_extra']
summary['conf_hist'] = conf_hist; summary['digit_hist'] = digit_hist
print(json.dumps(summary, indent=1))
