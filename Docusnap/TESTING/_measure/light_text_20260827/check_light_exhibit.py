"""Real-Tesseract check of the PRODUCT code: reconstruct_page_text OFF vs ON (env) on the serial exhibit
(sandbox doc 217, page 1, app DPI 200). Prints the recovered lines, the OFF⊂ON containment check, timing."""
import os, sys, time
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
from ocr import tesseract as T
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')
EXHIBIT = r'C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\7d6d3681-0d48-43ad-9347-006abf53cf6f\scratchpad\chris-sandbox\userData\inbox\217.pdf'
img = T.pdf_to_images(Path(EXHIBIT), dpi=200)[0]
os.environ.pop('OCR_LIGHT_TEXT_RECOVERY', None)
t0 = time.time(); wo_off = {}; off = T.reconstruct_page_text(img, dpi=200, words_out=wo_off); t_off = time.time() - t0
os.environ['OCR_LIGHT_TEXT_RECOVERY'] = '1'
t0 = time.time(); wo_on = {}; on = T.reconstruct_page_text(img, dpi=200, words_out=wo_on); t_on = time.time() - t0
off_lines = off.split('\n'); on_lines = on.split('\n')
lb = set(wo_on.get('light_boxes', []))
print(f'OFF {t_off:.1f}s lines={len(off_lines)} words={len(wo_off["words"])} med_h={wo_off["med_h"]}')
print(f'ON  {t_on:.1f}s lines={len(on_lines)} words={len(wo_on["words"])} med_h={wo_on["med_h"]} light_boxes={len(lb)}')
def subseq(a, b):
    it = iter(b); return all(tok in it for tok in a)
missing = [l for l in off_lines if not any(subseq(l.split(), m.split()) for m in on_lines)]
print('OFF lines NOT contained in an ON line:', len(missing), missing[:5])
print('recovered words:', [(w[4], round(w[5])) for w in wo_on.get('light_words', [])])
print('base words identical OFF vs ON:', wo_on['words'] == wo_off['words'])
for i, l in enumerate(on_lines):
    if any(k in l for k in ('Serial', 'CT-', 'VAT', 'Registered', 'Reg No')):
        print(f'  ON line {i}: {l!r}')
print('OFF has Serial:', any('Serial' in l for l in off_lines))
