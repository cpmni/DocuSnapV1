import os, sys
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
from ocr import tesseract as T
import pytesseract
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')
SB = r'C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\7d6d3681-0d48-43ad-9347-006abf53cf6f\scratchpad\chris-sandbox'
scan = Path(SB + r'\userData\inbox\217.pdf')
def hits(s): return [l for l in s.split('\n') if 'erial' in l or 'CT-' in l or 'CT ' in l]
for dpi in (200, 300):
    img = T.pdf_to_images(scan, dpi=dpi)[0]
    print('\n=== DPI', dpi, img.size, img.mode)
    plain = T.ocr_image(img, T._with_dpi('--oem 3 --psm 3', dpi))
    print(' plain psm3 lines:', hits(plain))
    wo = {}
    rebuilt = T.reconstruct_page_text(img, dpi=dpi, words_out=wo)
    print(' rebuilt lines:', hits(rebuilt))
    print(' med_h', wo.get('med_h'), 'words', len(wo.get('words') or []))
    for cfg in ('--oem 3 --psm 3', '--oem 3 --psm 6', '--oem 3 --psm 11'):
        data = pytesseract.image_to_data(img, config=T._with_dpi(cfg, dpi), output_type=pytesseract.Output.DICT)
        found = [(data['text'][i], data['conf'][i], data['left'][i], data['top'][i], data['width'][i], data['height'][i])
                 for i in range(len(data['text'])) if data['text'][i] and ('erial' in data['text'][i] or 'CT-' in data['text'][i] or data['text'][i].startswith('CT'))]
        print('  raw', cfg, '->', found)
    # what sits on the item rows: words with top between the two item rows
    ws = wo.get('words') or []
    for w in ws:
        if any(k in w[4] for k in ('NVR', 'Dome', 'Camera', 'Channel')):
            print('  item word', w)
txt, pages = T.extract_text_and_images(scan, enhance_params=None, born_digital=True)
print('\n=== APP PATH (extract_text_and_images) hits:', hits(txt))
print(txt)
