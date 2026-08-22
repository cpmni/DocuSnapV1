"""A5 of the type-split arc (2026-08-22; Oracle SIGN OFF, MEASUREMENT ONLY — no fix design).

Question: how often is a document's printed TYPE heading absent from `documents.ocr_text` (the page
OCR's visual-row rebuild), and would a band re-read recover it? The owner's Nordwind quotes: the bold
"QUOTATION" banner is absent on 16/17 pages, so no trusted title can ever settle a type hold.

Per DB: every CONFIRMED doc with a type → is the type NAME or one of its ALIASES (document_types.
title_aliases + the catalog set below) present as a STANDALONE line (first column segment == phrase, or
phrase + a code/caption word) in ocr_text? For the ABSENT cases (bounded per type), render page 1
(pypdfium2, the app's DPI), crop the top 35 %, and run Tesseract PSM 11 + PSM 6 on: greyscale, each
RGB channel, and the INVERTED crop (Oracle: a white-on-black banner is classified as a graphic by PSM 3
and dropped entirely — the row rebuild may be innocent). Record present/absent per variant + the
banner's per-word confidence. Output: absent rate by type × supplier × provenance (born-digital vs
scan), and the recovery share per variant.

Usage:  PYTHONIOENCODING=utf-8 py -3.12 TESTING/_measure/heading_absent_census.py <db> [--limit N] [--dpi 200]
Read-only. Needs the PDFs on disk (stored_path / working_path).
"""
import os, re, sys, sqlite3, json, argparse, collections
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sys.path.insert(0, os.path.join(ROOT, 'python_backend'))
from PIL import Image, ImageOps
import pypdfium2 as pdfium
import pytesseract
from ocr import tesseract as _tess

_tess.configure(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
CATALOG_ALIASES = {
    'quote': ['quotation', 'estimate'], 'service worksheet': ['worksheet', 'job sheet'],
    'remittance advice': ['remittance'], 'statement': ['statement of account'],
    'purchase order': ['purchase order'], 'sales order': ['sales order', 'order confirmation'],
    'delivery note': ['delivery note', 'goods delivery note'], 'credit note': ['credit note'], 'invoice': ['invoice', 'tax invoice'],
}
COL = re.compile(r' {4,}')
CAPTION = {'no', 'no.', 'number', 'ref', 'ref.', 'reference', '#', ':'}


def phrases_for(name, aliases_json):
    out = {name.lower()}
    try:
        for a in json.loads(aliases_json or '[]') or []:
            out.add(str(a).lower())
    except Exception:
        pass
    out.update(CATALOG_ALIASES.get(name.lower(), []))
    return out


def _seg_is_banner(seg, phrases):
    for p in phrases:
        if seg == p:
            return True
        if p in seg:
            rest = seg.replace(p, ' ', 1).split()
            # BANNER test: the phrase alone or with a CODE; a caption word ("Ref", "No.") beside it
            # is the caption-tolerance case keyword.py already accepts as a relaxed heading — it is
            # exactly what we must NOT count here (the owner's "Quotation Ref NRQ-…" lines).
            if rest and all(any(c.isdigit() for c in t) for t in rest):
                return True
    return False


def standalone(lines, phrases):
    """Three buckets: 'verbatim' (the first column segment IS the banner), 'gap-split' (the banner is on
    the line but the page-text rebuild put a ≥4-space COLUMN gap inside it — 'SERVICE    WORKSHEET' —
    so it reads as two segments; collapsing runs of spaces recovers it), or None (dropped entirely)."""
    for ln in lines:
        low = ln.strip().lower()
        if _seg_is_banner(COL.split(low)[0].strip(), phrases):
            return 'verbatim'
    for ln in lines:
        low = re.sub(r' {2,}', ' ', ln.strip().lower())
        if _seg_is_banner(low, phrases) or any(_seg_is_banner(x.strip(), phrases) for x in COL.split(ln.strip().lower())):
            return 'gap-split'
    return None


def render_top(pdf_path, dpi, frac=0.35):
    pdf = pdfium.PdfDocument(pdf_path)
    page = pdf[0]
    img = page.render(scale=dpi / 72.0).to_pil().convert('RGB')
    w, h = img.size
    return img.crop((0, 0, w, int(h * frac)))


def ocr_variants(crop, dpi):
    """{variant: (text, [(word, conf)])} over grey / R / G / B / inverted, PSM 11 and 6."""
    out = {}
    imgs = {'grey': ImageOps.grayscale(crop)}
    r, g, b = crop.split()
    imgs.update({'R': r, 'G': g, 'B': b, 'inv': ImageOps.invert(ImageOps.grayscale(crop))})
    for vname, im in imgs.items():
        for psm in (11, 6):
            try:
                d = pytesseract.image_to_data(im, config=f"--oem 3 --psm {psm} --dpi {dpi}", output_type=pytesseract.Output.DICT)
                words = [(str(t), float(c)) for t, c in zip(d['text'], d['conf']) if str(t).strip()]
                out[f'{vname}/psm{psm}'] = (' '.join(w for w, _ in words), words)
            except Exception as e:
                out[f'{vname}/psm{psm}'] = ('', [])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('db'); ap.add_argument('--limit', type=int, default=6); ap.add_argument('--dpi', type=int, default=200)
    a = ap.parse_args()
    db = sqlite3.connect(f'file:{a.db}?mode=ro', uri=True); db.row_factory = sqlite3.Row
    types = {r['id']: r for r in db.execute('SELECT id, name, title_aliases FROM document_types')}
    rows = db.execute("""SELECT d.id, d.supplier_name, d.document_type_id, d.ocr_text, d.stored_path, d.working_path, d.page_provenance
                         FROM documents d WHERE d.status='confirmed' AND d.document_type_id IS NOT NULL AND d.ocr_text IS NOT NULL""").fetchall() \
        if 'page_provenance' in [c[1] for c in db.execute('pragma table_info(documents)')] else \
        db.execute("""SELECT d.id, d.supplier_name, d.document_type_id, d.ocr_text, d.stored_path, d.working_path, NULL AS page_provenance
                      FROM documents d WHERE d.status='confirmed' AND d.document_type_id IS NOT NULL AND d.ocr_text IS NOT NULL""").fetchall()
    tally = collections.defaultdict(lambda: [0, 0, 0])   # (type, supplier) -> [total, gap-split, dropped]
    absent_docs = collections.defaultdict(list)
    for r in rows:
        t = types.get(r['document_type_id'])
        if not t:
            continue
        lines = [l for l in (r['ocr_text'] or '').splitlines() if l.strip()]
        present = standalone(lines, phrases_for(t['name'], t['title_aliases']))
        key = (t['name'], r['supplier_name'] or '—')
        tally[key][0] += 1
        if present == 'gap-split':
            tally[key][1] += 1
        elif not present:
            tally[key][2] += 1
            absent_docs[t['name']].append(r)
    print(f"=== {os.path.basename(a.db)}: {len(rows)} confirmed typed docs")
    print("type × supplier: gap-split / DROPPED / total   (gap-split = banner on the line with a column gap inside it)")
    for (tn, sup), (tot, gs, dr) in sorted(tally.items(), key=lambda kv: -(kv[1][1] + kv[1][2])):
        print(f"  {gs:4d} / {dr:4d} / {tot:<4d} {tn:<20} {sup}")
    print(f"  TOTAL gap-split {sum(v[1] for v in tally.values())}  dropped {sum(v[2] for v in tally.values())}  of {len(rows)}")
    print("\nband re-read on absent cases (top 35 %), per variant: recovered/attempted  [avg banner word conf]")
    for tn, docs in absent_docs.items():
        t = next(x for x in types.values() if x['name'] == tn)
        phrases = phrases_for(tn, t['title_aliases'])
        rec = collections.Counter(); att = 0; confs = collections.defaultdict(list)
        for r in docs[:a.limit]:
            pdf = next((p for p in (r['working_path'], r['stored_path']) if p and os.path.exists(p)), None)
            if not pdf:
                continue
            try:
                crop = render_top(pdf, a.dpi)
            except Exception as e:
                print(f"    doc {r['id']}: render failed {e}"); continue
            att += 1
            for vname, (text, words) in ocr_variants(crop, a.dpi).items():
                low = text.lower()
                hit = next((p for p in phrases if p in low), None)
                if hit:
                    rec[vname] += 1
                    for w, c in words:
                        if w.lower().strip('.:') in hit.split():
                            confs[vname].append(c)
        if att:
            print(f"  {tn} ({att} attempted):")
            for vname in sorted(rec, key=lambda v: -rec[v]):
                avg = sum(confs[vname]) / len(confs[vname]) if confs[vname] else float('nan')
                print(f"      {vname:<12} {rec[vname]}/{att}  [{avg:.0f}]")
            missing = [v for v in ('grey/psm11', 'grey/psm6', 'inv/psm11', 'inv/psm6') if v not in rec]
            if missing:
                print(f"      never recovered by: {', '.join(missing)}")


if __name__ == '__main__':
    main()
