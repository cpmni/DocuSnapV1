import json, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\python_backend")
import pypdfium2 as pdfium, pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
from ocr import segmentation as S
from extraction.template_matcher import identify_template
from extraction import keyword as K
templates = json.load(open(sys.argv[1], encoding="utf-8")); doctypes = json.load(open(sys.argv[2], encoding="utf-8")); patterns = json.load(open(sys.argv[3], encoding="utf-8"))
names = [d["name"] for d in doctypes]; slug_of = {d["name"]: d["slug"] for d in doctypes}
aliases = {d["name"]: (json.loads(d["title_aliases"]) if isinstance(d.get("title_aliases"), str) else d.get("title_aliases")) for d in doctypes if d.get("title_aliases")}
for spec in sys.argv[4:]:
    f, pg = spec.rsplit(":", 1); doc = pdfium.PdfDocument(f); page = doc[int(pg) - 1]
    img = page.render(scale=150 / 72).to_pil(); text = S._page_text(page, img, True, pytesseract.pytesseract.tesseract_cmd) or ""
    det = K.detect_document_type(text, patterns, names, aliases or None)
    slug = slug_of.get((det or {}).get("type")); trusted = bool(det and det.get("heading") and (det.get("confidence") or 0) >= 70)
    m = identify_template(img, text, templates, slug, trusted)
    t = (m or {}).get("template") or {}
    heads = [l.strip() for l in text.splitlines() if l.strip()][:8]
    print(f"== {f.split('/')[-1]} p{pg}: det={det and {k: det.get(k) for k in ('type','confidence','heading')}} slug={slug} trusted={trusted}")
    print(f"     matcher -> {'tpl ' + str(t.get('id')) + ' ' + str(t.get('document_type_slug')) if t else {k: v for k, v in (m or {}).items() if k != 'template'}}")
    print(f"     top lines: {heads}")
