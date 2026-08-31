"""Threshold LEVEL sweep on the four serial exhibits (owner's scans 11/13/1504 + sandbox 217): per level 190..240 step 5,
the serial VALUE words' conf (CT-…), plus each page's paper mode and the light-ink mode, so a paper-relative rule can be
fitted. Also runs the PRODUCT survivors filter at each level to count debris-like extras."""
import os, sys, sqlite3
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
from PIL import ImageOps
import pytesseract
from ocr import tesseract as T
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')
DPI = 200
db = sqlite3.connect('file:' + os.path.join(os.environ['APPDATA'], 'ScanFinder', 'docusnap.db') + '?mode=ro', uri=True)
PATHS = {r[0]: (r[1] if r[1] and os.path.exists(r[1]) else r[2]) for r in db.execute('SELECT id, working_path, stored_path FROM documents WHERE id IN (11, 13, 1504)')}
db.close()
PATHS['217s'] = r'C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\7d6d3681-0d48-43ad-9347-006abf53cf6f\scratchpad\chris-sandbox\userData\inbox\217.pdf'
LEVELS = list(range(190, 241, 5))

def base_for(img):
    main = T._words_from_data(pytesseract.image_to_data(img, config=T._with_dpi('--oem 3 --psm 3', DPI), output_type=pytesseract.Output.DICT))
    supp = T._words_from_data(pytesseract.image_to_data(img, config=T._with_dpi('--oem 3 --psm 6', DPI), output_type=pytesseract.Output.DICT))
    base = list(main); boxes = [(w[0], w[1], w[2], w[3]) for w in main]
    for sw in supp:
        if sw[5] >= T._SUPP_MIN_CONF and any(ch.isalnum() for ch in sw[4]) and not T._center_in_any(sw, boxes): base.append(sw)
    hs = sorted(w[3] for w in base if w[3] > 0); return base, (hs[len(hs) // 2] if hs else 10)

for did, p in PATHS.items():
    img = T.pdf_to_images(Path(p), dpi=DPI)[0]
    g = ImageOps.grayscale(img); hist = g.histogram()
    paper = max(range(128, 256), key=lambda i: hist[i])
    # light-ink mode: the histogram peak between 120 and paper-12 (the faint print's own luminance)
    lo, hi = 120, max(121, paper - 12)
    light_mode = max(range(lo, hi), key=lambda i: hist[i])
    base, med_h = base_for(img)
    print(f'\n=== doc {did}: paper_mode={paper} light_ink_mode={light_mode} base_words={len(base)} med_h={med_h}')
    for lvl in LEVELS:
        b = g.point(lambda p_, L=lvl: 0 if p_ < L else 255)
        raw = T._words_from_data(pytesseract.image_to_data(b, config=T._with_dpi(T._LIGHT_CONFIG, DPI), output_type=pytesseract.Output.DICT))
        vals = [(w[4], round(w[5])) for w in raw if w[4].startswith('CT') and sum(ch.isdigit() for ch in w[4]) >= 5]
        surv = T._light_survivors(raw, base, med_h, img.size[0], b)
        sv = [w for w in surv if w[4].startswith('CT') and sum(ch.isdigit() for ch in w[4]) >= 5]
        extras = [w[4] for w in surv if not (w[4].startswith('CT') or w[4] in ('Serial', 'No:'))]
        print(f'   L={lvl} (paper-{paper-lvl:3d}) values={vals} kept_values={len(sv)} survivors={len(surv)} extras={extras[:10]}')
