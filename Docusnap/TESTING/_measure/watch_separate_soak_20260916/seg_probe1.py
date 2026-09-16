import json, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\python_backend")
import pypdfium2 as pdfium, pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
from ocr import segmentation as S
from extraction.template_matcher import identify_template
templates = json.load(open(sys.argv[1], encoding="utf-8"))
doc = pdfium.PdfDocument(sys.argv[2])
for i in [int(x) for x in sys.argv[3].split(",")]:
    page = doc[i - 1]; img = page.render(scale=150 / 72).to_pil()
    text = S._page_text(page, img, True, pytesseract.pytesseract.tesseract_cmd) or ""
    print(f"===== page {i} text head: {text[:160]!r}")
    sys.stderr.write(f"##### page {i}\n"); sys.stderr.flush()
    m = identify_template(img, text, templates)
    print("   -> match:", repr({k: (v if k != "template" else (v or {}).get("id")) for k, v in (m or {}).items()}))
