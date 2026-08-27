"""Why do docs 11 / 1504 (owner's scans) recover no serial while 13 does? For each: the ON lines with Serial/CT-, the RAW
light-pass words matching serial-ish tokens with conf/box/h÷med_h, and which filter drops each (reasons)."""
import os, sys
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
from PIL import ImageOps
import pytesseract
from ocr import tesseract as T
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')
INBOX = os.path.join(os.environ['APPDATA'], 'ScanFinder', 'inbox')
DPI = 200

def reasons(lw, base, med_h, page_w, bin_img):
    l, t, w, h, txt, conf = lw
    out = []
    if conf < T._LIGHT_MIN_CONF: out.append(f'conf<{T._LIGHT_MIN_CONF}')
    if conf < T._LIGHT_MIN_CONF_DIGIT and any(ch.isdigit() for ch in txt): out.append(f'digit-conf<{T._LIGHT_MIN_CONF_DIGIT}')
    aln = sum(1 for ch in txt if ch.isalnum())
    if aln == 0 or (aln < 2 and conf < 90): out.append('alnum')
    if aln / float(max(1, len(txt))) < 0.5: out.append('ratio')
    if h < 6 or h < T._LIGHT_H_MIN * med_h or h > T._LIGHT_H_MAX * med_h: out.append(f'height({h}/{med_h})')
    if w > 0.6 * page_w: out.append('width')
    boxes = [(b[0], b[1], b[2], b[3]) for b in base]
    if T._center_in_any(lw, boxes): out.append('centre-in-base')
    if any(T._ioa((l, t, w, h), b) > T._LIGHT_IOA_MAX for b in boxes): out.append('ioa')
    d = T._ink_density(bin_img, (l, t, w, h))
    if d < T._LIGHT_INK_MIN or d > T._LIGHT_INK_MAX: out.append(f'ink({d:.2f})')
    return out

import sqlite3
_db = sqlite3.connect('file:' + os.path.join(os.environ['APPDATA'], 'ScanFinder', 'docusnap.db') + '?mode=ro', uri=True)
PATHS = {r[0]: (r[1] if r[1] and os.path.exists(r[1]) else r[2]) for r in _db.execute('SELECT id, working_path, stored_path FROM documents WHERE id IN (11, 13, 1504)')}
_db.close()
for did in (11, 13, 1504):
    p = PATHS.get(did)
    if not p or not os.path.exists(p):
        print(f'\n=== doc {did}: file not found ({p})'); continue
    img = T.pdf_to_images(Path(p), dpi=DPI)[0]
    os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None)
    wo_off = {}; off = T.reconstruct_page_text(img, dpi=DPI, words_out=wo_off)
    os.environ['OCR_LIGHT_TEXT_RECOVERY'] = '1'
    wo_on = {}; on = T.reconstruct_page_text(img, dpi=DPI, words_out=wo_on)
    os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None)
    base = wo_off['words']; med_h = wo_off['med_h']
    g = ImageOps.grayscale(img)
    hist = g.histogram(); paper = max(range(128, 256), key=lambda i: hist[i])
    print(f'\n=== doc {did}: size={img.size} base_words={len(base)} med_h={med_h} paper_mode={paper} '
          f'light_words={len(wo_on.get("light_words", []))} off_lines={len(off.splitlines())} on_lines={len(on.splitlines())}')
    for i, l in enumerate(on.split('\n')):
        if any(k in l for k in ('Serial', 'CT-', 'Reg No', 'Registered')): print(f'   ON line {i}: {l!r}')
    # raw light words for the serial class + why each was dropped
    level = T._light_threshold()
    bin_img = g.point(lambda p_: 0 if p_ < level else 255)
    data = pytesseract.image_to_data(bin_img, config=T._with_dpi(T._LIGHT_CONFIG, DPI), output_type=pytesseract.Output.DICT)
    raw = T._words_from_data(data)
    kept = set(wo_on.get('light_words', []))
    for lw in raw:
        if any(k.lower() in lw[4].lower() for k in ('serial', 'ct-', 'no:')) or (lw[4].startswith('CT') and any(ch.isdigit() for ch in lw[4])):
            print(f'   raw {lw[4]!r:14} conf={lw[5]:5.1f} box=({lw[0]},{lw[1]},{lw[2]},{lw[3]}) h/med={lw[3]/med_h:4.2f} '
                  f'{"KEPT" if lw in kept else "DROPPED: " + ",".join(reasons(lw, base, med_h, img.size[0], bin_img))}')
    # also: does a lower threshold or the raw grey image read the serial at all?
    for lvl in (215, 230):
        b2 = g.point(lambda p_, L=lvl: 0 if p_ < L else 255)
        d2 = T._words_from_data(pytesseract.image_to_data(b2, config=T._with_dpi(T._LIGHT_CONFIG, DPI), output_type=pytesseract.Output.DICT))
        hits = [(w[4], round(w[5])) for w in d2 if 'CT-' in w[4] or 'Serial' in w[4]]
        print(f'   threshold {lvl}: serial-ish words = {hits[:8]}')
