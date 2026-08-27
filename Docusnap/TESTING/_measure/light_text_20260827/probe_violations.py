"""Explain the census's OFF⊂ON violation pages: for each id, the OFF line that is not contained in any ON line, the ON rows
near it with word sources (B=base, L=light), and the light_replaced slivers. Read-only."""
import os, sys, sqlite3
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
from ocr import tesseract as T
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')
DPI = 200
S = sys.argv[1]
IDS = [int(x) for x in sys.argv[2].split(',')]
db = sqlite3.connect(f'file:{os.path.join(S, "rr_req_on.db")}?mode=ro', uri=True)
PATHS = {r[0]: (r[1] if r[1] and os.path.exists(r[1]) else r[2]) for r in db.execute(f"SELECT id, working_path, stored_path FROM documents WHERE id IN ({','.join('?'*len(IDS))})", IDS)}
db.close()
def subseq(a, b):
    it = iter(b); return all(tok in it for tok in a)
for did in IDS:
    img = T.pdf_to_images(Path(PATHS[did]), dpi=DPI)[0]
    os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None); wo0 = {}; off = T.reconstruct_page_text(img, dpi=DPI, words_out=wo0)
    os.environ['OCR_LIGHT_TEXT_RECOVERY'] = '1'; wo1 = {}; on = T.reconstruct_page_text(img, dpi=DPI, words_out=wo1)
    os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None)
    light = set(wo1.get('light_words', [])); rep = wo1.get('light_replaced', [])
    on_lines = on.split('\n')
    missing = [l for l in off.split('\n') if not any(subseq(l.split(), m.split()) for m in on_lines)]
    print(f'\n=== doc {did}: missing OFF lines={len(missing)} replaced slivers={[(w[4], w[3]) for w in rep]}')
    for l in missing:
        print(f'   OFF: {l!r}')
        # locate its words in the OFF rows to find the y band
        for ws in wo0['rows']:
            if ' '.join(w[4] for w in sorted(ws, key=lambda w: w[0])).split() == l.replace(T.COLUMN_BREAK, ' ').split():
                yc = sum(w[1] + w[3] / 2 for w in ws) / len(ws)
                for ws1 in wo1['rows']:
                    yc1 = sum(w[1] + w[3] / 2 for w in ws1) / len(ws1)
                    if abs(yc1 - yc) <= 40:
                        print(f'      ON row yc={yc1:.0f}: ' + ' '.join(f"{'L' if w in light else 'B'}:{w[4]}({w[3]})" for w in sorted(ws1, key=lambda w: w[0])))
                break
