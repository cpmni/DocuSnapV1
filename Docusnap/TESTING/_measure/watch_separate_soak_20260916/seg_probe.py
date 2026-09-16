"""seg_probe.py TEMPLATES_JSON PDF [PDF...] — per-page probe of the separator's signals, calling the REAL functions
(segmentation._page_text / template_matcher.identify_template / fingerprint_overlap / is_document_start):
  page | matched template (id name/type) | overlap | doc_start | text chars | supplier names seen in the text
"""
import json, os, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\python_backend")
import pypdfium2 as pdfium
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
from ocr import segmentation as S
from extraction.template_matcher import identify_template, extract_keyword_fingerprint

templates = json.load(open(sys.argv[1], encoding="utf-8"))
by_id = {t.get("id"): t for t in templates}
names = sorted({(t.get("name") or "").strip() for t in templates if t.get("name")}, key=len, reverse=True)

for pdf in sys.argv[2:]:
    print(f"== {os.path.basename(pdf)}")
    doc = pdfium.PdfDocument(pdf)
    current = None
    for i in range(len(doc)):
        page = doc[i]
        img = page.render(scale=150 / 72).to_pil()
        text = S._page_text(page, img, True, pytesseract.pytesseract.tesseract_cmd) or ""
        m = identify_template(img, text, templates)
        t = (m or {}).get("template") or {}
        mid = t.get("id") if m else None
        ov = S.fingerprint_overlap(extract_keyword_fingerprint(text), t.get("keyword_fingerprint")) if m else 0.0
        ds = S.is_document_start(text)
        low = text.lower()
        seen = [n for n in names if n.lower() in low]
        # what identify_template returned vs the OTHER templates of the same supplier (sibling resolution)
        tname = f"{mid} {t.get('name')}/{t.get('document_type_slug')}" if m else "NONE"
        sibs = ""
        if m:
            others = [x for x in templates if x.get("name") == t.get("name") and x.get("id") != mid]
            ovs = [(x.get("document_type_slug"), round(S.fingerprint_overlap(extract_keyword_fingerprint(text), x.get("keyword_fingerprint")), 2)) for x in others]
            sibs = " siblings:" + str(ovs) if ovs else ""
        verdict = "START" if i == 0 else ("BOUNDARY" if S.decide_boundary(mid, current, ov, ds) else "continuation")
        print(f"  p{i+1}: {verdict:12} match={tname:45} ov={ov:.2f} ds={ds} chars={len(text):4} seen={seen[:2]} conf={(m or {}).get('confidence')} method={(m or {}).get('method')}{sibs}")
        if i == 0 or S.decide_boundary(mid, current, ov, ds):
            current = mid
