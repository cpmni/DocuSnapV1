"""Read-only probe: per page of real_34.pdf, which witness arms fire and what number/date-ish labels the page prints.
Uses the SHIPPED segmentation functions (no code change). Usage: py -3.12 probe_real34_witness.py <pdf>"""
import os, re, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\python_backend")
import pypdfium2 as pdfium
from ocr import segmentation as S

pdf = sys.argv[1]
tess = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
try:
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = tess
except Exception:
    pass
doc = pdfium.PdfDocument(pdf)
lab_re = re.compile(r"(?im)^.*\b(?:no\.?|number|ref|reference|date|dated|serial|account|alert|id)\b.*$")
for i in range(len(doc)):
    page = doc[i]
    img = page.render(scale=150 / 72).to_pil()
    text = S._page_text(page, img, True, tess) or ""
    low = text.lower()
    num = any(m in low for m in S._WITNESS_NUMBER_MARKERS)
    dat = any(m in low for m in S._WITNESS_DATE_MARKERS)
    rec = any(m in low for m in S._RECIPIENT_MARKERS) and bool(S._DATE_SHAPE_RE.search(low))
    ds = S.is_document_start(text)
    labels = [l.strip()[:70] for l in lab_re.findall(text)][:6]
    head = [l.strip()[:60] for l in text.split("\n") if l.strip()][:4]
    print(f"p{i+1:02d} witness num={num} date={dat} recip+date={rec} doc_start={ds} | head={head}")
    print(f"      label-ish lines: {labels}")
