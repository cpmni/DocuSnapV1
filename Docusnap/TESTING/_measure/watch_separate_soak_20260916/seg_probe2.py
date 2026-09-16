"""seg_probe2.py TEMPLATES DOCTYPES PATTERNS GT_JSON BUNDLES_DIR — A/B of the separator's boundary decision:
  BASE  = identify_template(img, text, templates)                                  (today's pre-pass)
  TITLE = identify_template(img, text, templates, detected_slug, title_trusted)    (the full pipeline's call)
Per file: expected boundaries (gt), base boundaries, title boundaries, over-splits (a boundary inside a GT doc).
"""
import json, os, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\python_backend")
import pypdfium2 as pdfium, pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
from ocr import segmentation as S
from extraction.template_matcher import identify_template, extract_keyword_fingerprint
from extraction import keyword as K

templates = json.load(open(sys.argv[1], encoding="utf-8"))
doctypes = json.load(open(sys.argv[2], encoding="utf-8"))
patterns = json.load(open(sys.argv[3], encoding="utf-8"))
gt = json.load(open(sys.argv[4], encoding="utf-8"))
bdir = sys.argv[5]
only = tuple(sys.argv[6].split(",")) if len(sys.argv) > 6 else None
names = [d["name"] for d in doctypes]
slug_of = {d["name"]: d["slug"] for d in doctypes}
aliases = {}
for d in doctypes:
    al = d.get("title_aliases")
    if isinstance(al, str):
        try: al = json.loads(al)
        except Exception: al = []
    if al: aliases[d["name"]] = al

def signals(img, text, with_title):
    slug, trusted = None, False
    if with_title:
        det = K.detect_document_type(text, patterns, names, aliases or None)
        if det:
            slug = slug_of.get(det.get("type"))
            trusted = bool(det.get("heading") and (det.get("confidence") or 0) >= 70)
    m = identify_template(img, text, templates, slug, trusted) if with_title else identify_template(img, text, templates)
    t = (m or {}).get("template") or {}
    mid = t.get("id") if (m and t) else None
    ov = S.fingerprint_overlap(extract_keyword_fingerprint(text), t.get("keyword_fingerprint")) if mid else 0.0
    return mid, ov, S.is_document_start(text), (m or {}).get("type_refused"), slug, trusted

def boundaries(sig):
    flags = [True]; cur = sig[0][0]
    for i in range(1, len(sig)):
        mid, ov, ds = sig[i][0], sig[i][1], sig[i][2]
        b = S.decide_boundary(mid, cur, ov, ds); flags.append(b)
        if b: cur = mid
    return [i + 1 for i, f in enumerate(flags) if f]   # 1-based first pages

tot = {"exp": 0, "base_ok": 0, "title_ok": 0, "base_over": 0, "title_over": 0, "files": 0, "base_exact": 0, "title_exact": 0}
for name in sorted(gt):
    p = os.path.join(bdir, name)
    if not os.path.isfile(p): continue
    if only and not name.startswith(only): continue
    exp = [d["pages"][0] for d in gt[name]["docs"]]          # expected first pages
    inside = {pg for d in gt[name]["docs"] for pg in range(d["pages"][0] + 1, d["pages"][1] + 1)}  # non-first pages of GT docs
    doc = pdfium.PdfDocument(p); n = len(doc)
    if n < 2: continue
    sb, st = [], []
    for i in range(n):
        page = doc[i]; img = page.render(scale=150 / 72).to_pil()
        text = S._page_text(page, img, True, pytesseract.pytesseract.tesseract_cmd) or ""
        sb.append(signals(img, text, False)); st.append(signals(img, text, True))
    bb, tb = boundaries(sb), boundaries(st)
    b_ok = len(set(bb) & set(exp)); t_ok = len(set(tb) & set(exp))
    b_over = len(set(bb) & inside); t_over = len(set(tb) & inside)
    tot["exp"] += len(exp); tot["base_ok"] += b_ok; tot["title_ok"] += t_ok; tot["base_over"] += b_over; tot["title_over"] += t_over; tot["files"] += 1
    tot["base_exact"] += int(bb == exp); tot["title_exact"] += int(tb == exp)
    refused_b = sum(1 for s in sb if s[3]); refused_t = sum(1 for s in st if s[3])
    print(f"{name:20} exp={exp} base={bb} title={tb}  base_ok={b_ok}/{len(exp)} title_ok={t_ok}/{len(exp)} over(base/title)={b_over}/{t_over} refused(base/title)={refused_b}/{refused_t}")
print(f"\nTOTAL files={tot['files']} expected boundaries={tot['exp']}  base right={tot['base_ok']} exact-files={tot['base_exact']} over-splits={tot['base_over']}  |  title right={tot['title_ok']} exact-files={tot['title_exact']} over-splits={tot['title_over']}")
