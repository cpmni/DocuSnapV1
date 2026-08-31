"""Read-only: on the residual docs (0021-2 → 1726, 0025-2 → 1736, 0027-2 → 1742), find each recovered caption row
('… No:') with NO value to its right, crop the value slot exactly as an operator's ⊕ box would, and run the product's
crop ladder (ocr.region_core.process — the ⊕ / draw-box reader). Control: a slot the light pass DID read."""
import os, sys, sqlite3
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
from ocr import tesseract as T
from ocr import region_core
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')
DPI = 200
db = sqlite3.connect('file:' + os.path.join(os.environ['APPDATA'], 'ScanFinder', 'docusnap.db') + '?mode=ro', uri=True)
PATHS = {r[0]: (r[1] if r[1] and os.path.exists(r[1]) else r[2]) for r in db.execute("SELECT id, working_path, stored_path FROM documents WHERE id IN (1726, 1736, 1742)")}
db.close()
for did, p in PATHS.items():
    img = T.pdf_to_images(Path(p), dpi=DPI)[0]
    os.environ['OCR_LIGHT_TEXT_RECOVERY'] = '1'; wo = {}; on = T.reconstruct_page_text(img, dpi=DPI, words_out=wo)
    os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None)
    med_h = wo['med_h']; light = set(wo.get('light_words', []))
    print(f'\n=== doc {did} med_h={med_h}')
    for ws in wo['rows']:
        caps = [w for w in ws if w[4].rstrip('.').lower() in ('no:', 'no') and w in light]
        if not caps: continue
        cap = caps[0]
        right = [w for w in ws if w[0] > cap[0] + cap[2] and w[0] < cap[0] + cap[2] + 30 * med_h]
        row_top = min(w[1] for w in ws); row_bot = max(w[1] + w[3] for w in ws)
        x0 = cap[0] + cap[2] + 3; x1 = min(img.size[0], x0 + int(28 * med_h)); y0 = max(0, row_top - 6); y1 = min(img.size[1], row_bot + 6)
        crop = img.crop((x0, y0, x1, y1))
        try:
            res = region_core.process(crop, boxes=True)
            txt = (res.get('text') or '').strip(); words = [(w.get('t'), round(float(w.get('c', -1)))) for w in (res.get('words') or [])]
        except Exception as e:
            txt, words = f'ERR {e}', []
        kind = 'EMPTY slot' if not right else 'control (light read: ' + ' '.join(w[4] for w in right) + ')'
        print(f'   row y={row_top}-{row_bot} {kind}: ladder text={txt!r} words={words}')
