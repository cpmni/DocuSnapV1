"""owner_diff.py TEMPLATES DOCTYPES PATTERNS KNOWN_JSON DIR [DIR …] — the mig-179 SEGMENT-PLAN DIFF cell (Oracle C5 (b)):
over every multi-page PDF under the given folders (the owner's own inbox / processed / separated originals — READ-ONLY),
compare the two-switch plan (177+178) with the three-switch plan (177+178+179) using the SHIPPED functions, and print every
file whose plan changes (with the page's named known suppliers + witness so each delta can be reviewed by eye).
"""
import json, os, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\python_backend")
import pypdfium2 as pdfium, pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
from ocr import segmentation as S
from extraction.template_matcher import extract_keyword_fingerprint

templates = json.load(open(sys.argv[1], encoding="utf-8")); doctypes = json.load(open(sys.argv[2], encoding="utf-8"))
patterns = json.load(open(sys.argv[3], encoding="utf-8")); known_names = json.load(open(sys.argv[4], encoding="utf-8"))
KNOWN = S.prepare_known_suppliers(known_names); title_ctx = {"patterns": patterns, "doc_types": doctypes}
files = []
for d in sys.argv[5:]:
    for root, _, names in os.walk(d):
        for n in names:
            if n.lower().endswith(".pdf"): files.append(os.path.join(root, n))
print(f"{len(files)} PDFs under {sys.argv[5:]}")
multi = same = diff = 0
for p in sorted(files):
    try:
        doc = pdfium.PdfDocument(p); n = len(doc)
    except Exception as e:
        print(f"  unreadable: {p} ({e})"); continue
    if n < 2: continue
    multi += 1
    sig2, sig3, named = [], [], []
    for i in range(n):
        page = doc[i]; img = page.render(scale=150 / 72).to_pil()
        text = S._page_text(page, img, True, pytesseract.pytesseract.tesseract_cmd) or ""
        title = S.page_title(text, title_ctx); match = S.page_match(img, text, templates, title_ctx, title)
        tmpl = (match or {}).get("template") or {}; mid = tmpl.get("id") if match else None
        ov = S.fingerprint_overlap(extract_keyword_fingerprint(text), tmpl.get("keyword_fingerprint")) if match else 0.0
        ds = S.is_document_start(text); sc = bool(i > 0 and S.is_continuation_page(text))
        names = S.known_names_in_band(text, KNOWN); wit = S.has_first_page_witness(text, bool(title[1])); wide = S.known_names_on_page(text, KNOWN)
        sig2.append((mid, ov, ds, sc, [], False, [])); sig3.append((mid, ov, ds, sc, names, wit, wide)); named.append((names, wit, wide))
    f2, _ = S.walk_boundaries(sig2, S.FIRST_PAGE_FP_FLOOR, known_rule=False)
    f3, r3 = S.walk_boundaries(sig3, S.FIRST_PAGE_FP_FLOOR, known_rule=True)
    b2 = [i + 1 for i, f in enumerate(f2) if f]; b3 = [i + 1 for i, f in enumerate(f3) if f]
    if b2 == b3: same += 1
    else:
        diff += 1
        print(f"DELTA {p} ({n} pages): two-switch {b2} -> three-switch {b3}")
        for i, (nm, w, wd) in enumerate(named):
            print(f"     p{i + 1}: names={nm} witness={w} set={wd} reason={r3[i]}")
print(f"\nmulti-page PDFs {multi}: identical plan {same}, changed plan {diff}")
