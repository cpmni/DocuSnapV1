"""Do the serials survive the STRAIGHTEN road? For three of the owner's scans: the detected skew angle, then the page rotated
by the app's own _apply_skew_rotation at 0.6° / 1.5° / 3.0° (a tilted scan straightened lands on a resampled bitmap of the
same kind) → reconstruct_page_text OFF/ON at 200 DPI → serial values read. Read-only."""
import os, sys, sqlite3
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
from ocr import tesseract as T
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')
DPI = 200
db = sqlite3.connect('file:' + os.path.join(os.environ['APPDATA'], 'ScanFinder', 'docusnap.db') + '?mode=ro', uri=True)
PATHS = {r[0]: (r[1] if r[1] and os.path.exists(r[1]) else r[2]) for r in db.execute("SELECT id, working_path, stored_path FROM documents WHERE id IN (1727, 1732, 1738)")}
db.close()

def serials(text):
    return [l for l in text.split('\n') if 'Serial' in l]

for did, p in PATHS.items():
    img = T.pdf_to_images(Path(p), dpi=DPI)[0]
    try:
        ang = T.detect_skew_angle(img, 0.2)
    except Exception as e:
        ang = f'err {e}'
    print(f'\n=== doc {did}: detected skew = {ang}')
    for a in (0.0, 0.6, 1.5, 3.0):
        im2 = T._apply_skew_rotation(img, a) if a else img
        os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None); wo0 = {}; off = T.reconstruct_page_text(im2, dpi=DPI, words_out=wo0)
        os.environ['OCR_LIGHT_TEXT_RECOVERY'] = '1'; wo1 = {}; on = T.reconstruct_page_text(im2, dpi=DPI, words_out=wo1)
        os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None)
        vals = [w[4] for w in wo1.get('light_words', []) if w[4].startswith('CT-')]
        print(f'   rotate {a:3.1f}° size={im2.size} base_words={len(wo0["words"])} → ON serial lines: {serials(on)}  light CT words: {vals}')
