"""Miss-class probe (read-only): for the owner's re-imported worksheets that lost one serial, show per LEVEL what Tesseract
read on each "Serial" row (the caption row band), the merge outcome, and — for a value that was read — why it was dropped.
Levels: the default set plus 190 / 240 / 245 to see whether a wider set would have caught it."""
import os, sys, sqlite3
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
from PIL import ImageOps
import pytesseract
from ocr import tesseract as T
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')
DPI = 200
IDS = [int(x) for x in (sys.argv[1] if len(sys.argv) > 1 else '1707,1709,1713,1716,1720,1721,1719,1706').split(',')]
LEVELS = [190, 200, 210, 220, 230, 240, 245]
db = sqlite3.connect('file:' + os.path.join(os.environ['APPDATA'], 'ScanFinder', 'docusnap.db') + '?mode=ro', uri=True)
PATHS = {r[0]: (r[1] if r[1] and os.path.exists(r[1]) else r[2]) for r in db.execute(f"SELECT id, working_path, stored_path FROM documents WHERE id IN ({','.join('?'*len(IDS))})", IDS)}
db.close()

def data(img):
    return T._words_from_data(pytesseract.image_to_data(img, config=T._with_dpi(T._LIGHT_CONFIG, DPI), output_type=pytesseract.Output.DICT))

for did in IDS:
    p = PATHS.get(did)
    if not p: print(f'\n=== doc {did}: no file'); continue
    img = T.pdf_to_images(Path(p), dpi=DPI)[0]
    os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None); wo_off = {}; T.reconstruct_page_text(img, dpi=DPI, words_out=wo_off)
    os.environ['OCR_LIGHT_TEXT_RECOVERY'] = '1'; wo_on = {}; on = T.reconstruct_page_text(img, dpi=DPI, words_out=wo_on)
    os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None)
    base, med_h = wo_off['words'], wo_off['med_h']
    g = ImageOps.grayscale(img); hist = g.histogram(); paper = max(range(128, 256), key=lambda i: hist[i])
    print(f'\n=== doc {did} paper_mode={paper} med_h={med_h}  ON serial lines: {[l for l in on.split(chr(10)) if "Serial" in l or "CT-" in l]}')
    # per level: every word whose row band holds a "Serial" caption (light or base) → what sits on that row
    per_level = {}
    for lvl in LEVELS:
        b = g.point(lambda p_, L=lvl: 0 if p_ < L else 255)
        raw = data(b)
        per_level[lvl] = (raw, b)
    # the caption rows: union over levels of 'Serial' word centres
    rows = []
    for lvl, (raw, _) in per_level.items():
        for w in raw:
            if w[4].startswith('Serial') or w[4].startswith('Seria'):
                cy = w[1] + w[3] / 2
                if not any(abs(cy - r) <= med_h for r in rows): rows.append(cy)
    rows.sort()
    for cy in rows:
        print(f'   caption row yc≈{cy:.0f}:')
        for lvl in LEVELS:
            raw, b = per_level[lvl]
            on_row = sorted([w for w in raw if abs((w[1] + w[3] / 2) - cy) <= med_h * 0.7], key=lambda w: w[0])
            toks = []
            for w in on_row:
                why = ''
                if w[4].startswith('CT') or sum(ch.isdigit() for ch in w[4]) >= 5:
                    surv = T._light_survivors([w], base, med_h, img.size[0], b, min_conf=0, min_conf_digit=0)
                    why = '' if surv else '(geo-dropped)'
                toks.append(f'{w[4]}@{w[5]:.0f}{why}')
            print(f'      L{lvl}: {" ".join(toks)}')
    merged = [(w[4], round(w[5])) for w in wo_on.get('light_words', []) if w[4].startswith('CT')]
    print(f'   MERGED serial words: {merged}')
