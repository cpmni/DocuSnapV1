import sys
sys.path.insert(0, r'c:\GIT Projects\Docusnap\python_backend')
from pathlib import Path
from ocr import tesseract as T
SB = r'C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\7d6d3681-0d48-43ad-9347-006abf53cf6f\scratchpad'
scan = Path(SB + r'\chris-sandbox\userData\inbox\217.pdf')
born = Path(SB + r'\chris-sandbox\Output\Castellan-Security-Systems\2026\May\Service-Worksheet.06-05-2026.JB-4791.pdf')
img = T.pdf_to_images(scan, dpi=200)[0]
img.crop((80, 740, 1100, 980)).save(SB + r'\band_scan_200.png')
img.save(SB + r'\page_scan_200.png')
b = T.pdf_to_images(born, dpi=200)[0]
b.crop((80, 740, 1100, 980)).save(SB + r'\band_born_200.png')
print('saved', img.size, b.size)
