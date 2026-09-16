"""seg_probe4.py TEMPLATES DOCTYPES PATTERNS GT BUNDLES_DIR [prefixes] — THREE-arm per-PAGE probe of the separator:
  base = identify_template(img, text, templates)                                       (today)
  pipe = identify_template(img, text, templates, slug, trusted)  (slug even if untrusted — process_docs recipe)
  fb   = trusted-only + fallback: slug only when trusted; if that returns None/refuse → the base call   (gary's shape)
Per file: expected first pages; per arm: boundaries, LOST-vs-base (a boundary base had that the arm lacks), over-splits.
"""
import json, os, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\python_backend")
import pypdfium2 as pdfium, pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
from ocr import segmentation as S
from extraction.template_matcher import identify_template, extract_keyword_fingerprint
from extraction import keyword as K

templates = json.load(open(sys.argv[1], encoding="utf-8")); doctypes = json.load(open(sys.argv[2], encoding="utf-8"))
patterns = json.load(open(sys.argv[3], encoding="utf-8")); gt = json.load(open(sys.argv[4], encoding="utf-8")); bdir = sys.argv[5]
only = tuple(sys.argv[6].split(",")) if len(sys.argv) > 6 else None
names = [d["name"] for d in doctypes]; slug_of = {d["name"]: d["slug"] for d in doctypes}
aliases = {}
for d in doctypes:
    al = d.get("title_aliases")
    if isinstance(al, str):
        try: al = json.loads(al)
        except Exception: al = []
    if al: aliases[d["name"]] = al

def title(text):
    det = K.detect_document_type(text, patterns, names, aliases or None)
    if not det: return None, False, None
    return slug_of.get(det.get("type")), bool(det.get("heading") and (det.get("confidence") or 0) >= 70), det

def sig_of(m, text):
    t = (m or {}).get("template") or {}
    mid = t.get("id") if (m and t) else None
    ov = S.fingerprint_overlap(extract_keyword_fingerprint(text), t.get("keyword_fingerprint")) if mid else 0.0
    return mid, ov

def arms(img, text):
    slug, trusted, det = title(text)
    base = identify_template(img, text, templates)
    pipe = identify_template(img, text, templates, slug, trusted) if slug else base
    if slug and trusted:
        fb = identify_template(img, text, templates, slug, trusted)
        if not (fb or {}).get("template"): fb = identify_template(img, text, templates)
    else:
        fb = base
    # cascade: trusted call → untrusted-slug call (the :929 matching branch needs no trust) → baseline
    casc = None
    if slug and trusted:
        casc = identify_template(img, text, templates, slug, trusted)
    if slug and not (casc or {}).get("template"):
        casc = identify_template(img, text, templates, slug, False)
    if not (casc or {}).get("template"):
        casc = base
    ds = S.is_document_start(text)
    sc = S.is_continuation_page(text)          # the self-declared continuation veto (mig 177) — applied by walk() for the *+veto arms
    return {"base": (*sig_of(base, text), ds, sc), "pipe": (*sig_of(pipe, text), ds, sc), "fb": (*sig_of(fb, text), ds, sc),
            "casc": (*sig_of(casc, text), ds, sc), "cont": (*sig_of(base, text), ds, sc), "both": (*sig_of(casc, text), ds, sc)}, (slug, trusted)

VETO_ARMS = ("cont", "both")
def walk(sigs, veto=False):
    flags = [True]; cur = sigs[0][0]
    for i in range(1, len(sigs)):
        mid, ov, ds, sc = sigs[i]; b = S.decide_boundary(mid, cur, ov, ds)
        if b and veto and sc: b = False
        flags.append(b)
        if b: cur = mid
    return [i + 1 for i, f in enumerate(flags) if f]

ARMS = ("base", "pipe", "fb", "casc", "cont", "both")
T = {a: {"right": 0, "lost": 0, "over": 0} for a in ARMS}; EXP = 0; FILES = 0
for name in sorted(gt):
    p = os.path.join(bdir, name)
    if not os.path.isfile(p) or (only and not name.startswith(only)): continue
    exp = [d["pages"][0] for d in gt[name]["docs"]]; inside = {pg for d in gt[name]["docs"] for pg in range(d["pages"][0] + 1, d["pages"][1] + 1)}
    doc = pdfium.PdfDocument(p); n = len(doc)
    if n < 2: continue
    per = {a: [] for a in ARMS}; titles = []
    for i in range(n):
        page = doc[i]; img = page.render(scale=150 / 72).to_pil()
        text = S._page_text(page, img, True, pytesseract.pytesseract.tesseract_cmd) or ""
        s, tt = arms(img, text); titles.append(tt)
        for a in per: per[a].append(s[a])
    b = {a: walk(per[a], veto=(a in VETO_ARMS)) for a in per}
    EXP += len(exp); FILES += 1
    line = f"{name:18} exp={exp}"
    for a in ARMS:
        right = len(set(b[a]) & set(exp)); lost = len((set(b["base"]) & set(exp)) - set(b[a])); over = len(set(b[a]) & inside)
        T[a]["right"] += right; T[a]["lost"] += lost; T[a]["over"] += over
        line += f" | {a}={b[a]} r={right} lost={lost} over={over}"
    print(line)
    print("     titles:", [(f"p{i+1}", s, "T" if t else "-") for i, (s, t) in enumerate(titles)])
print(f"\nTOTAL files={FILES} expected={EXP} " + " | ".join(f"{a}: right={T[a]['right']} lost-vs-base={T[a]['lost']} over-splits={T[a]['over']}" for a in T))
