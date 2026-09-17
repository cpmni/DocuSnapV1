"""seg_probe5.py TEMPLATES DOCTYPES PATTERNS DB GT BUNDLES_DIR [prefixes] — measure a TEMPLATE-FREE identity-change signal:
  name = a page whose TOP BAND names a KNOWN supplier (templates' names + every confirmed supplier in the DB) that
         differs from the current document's named supplier → boundary. Combined with today's base signals + the veto.
Arms: base | both (cascade+veto, the shipped-dark pair) | both+name. Per-page right / lost-vs-base / over-splits.
"""
import json, os, re, sqlite3, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\python_backend")
import pypdfium2 as pdfium, pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
from ocr import segmentation as S
from extraction.template_matcher import identify_template, extract_keyword_fingerprint
from extraction import keyword as K

templates = json.load(open(sys.argv[1], encoding="utf-8")); doctypes = json.load(open(sys.argv[2], encoding="utf-8"))
patterns = json.load(open(sys.argv[3], encoding="utf-8")); dbp = sys.argv[4]; gt = json.load(open(sys.argv[5], encoding="utf-8")); bdir = sys.argv[6]
only = tuple(sys.argv[7].split(",")) if len(sys.argv) > 7 else None
con = sqlite3.connect(dbp)
known = {r[0].strip() for r in con.execute("SELECT DISTINCT supplier_name FROM documents WHERE status='confirmed' AND supplier_name IS NOT NULL AND TRIM(supplier_name)<>''")}
known |= {(t.get("name") or "").strip() for t in templates} | {(t.get("dominant_supplier") or "").strip() for t in templates}
known = sorted({k for k in known if len(k) >= 6}, key=len, reverse=True)
print(f"{len(known)} known supplier names")
TOP = 12
_RECIP = ("bill to", "invoice to", "billed to", "sold to", "ship to", "deliver to", "customer", "supplier", "site /", "to:")
def lines_of(text): return [l for l in (text or "").lower().splitlines() if l.strip()]
def named_supplier(text, mode="len"):
    """mode: len = longest known name anywhere in the top band (the first measurement);
             pos = the known name that appears EARLIEST (by line) in the top band — the letterhead sits above a recipient block;
             top4 = only within the first 4 non-empty lines (letterhead position);
             ctx = earliest by line, but a line (or the line above it) carrying a recipient/customer marker never counts."""
    ls = lines_of(text)[:TOP]
    if mode == "len":
        band = "\n".join(ls)
        for k in known:
            if k.lower() in band: return k
        return None
    lim = 4 if mode == "top4" else TOP
    excl = _RECIP + (("c/o", "care of", "delivered by", "collected by", "via ", "attn", "f.a.o", "fao ") if mode in ("co", "num") else ())
    for i, l in enumerate(ls[:lim]):
        if mode in ("ctx", "co", "num"):
            prev = ls[i - 1] if i > 0 else ""
            if any(m in l for m in excl) or any(m in prev for m in excl): continue
        for k in known:
            if k.lower() in l: return k
    return None
_NUM = S._NUMBER_MARKERS + ("reference no", "ref no", "ref.", "job no", "job sheet no", "quote no", "quotation no", "credit note no",
                            "delivery note no", "docket no", "note no", "order confirmation", "no.")
_DAT = S._DATE_MARKERS + ("date ",)
def has_doc_marker(text):
    low = (text or "").lower()
    return any(m in low for m in _NUM) or any(m in low for m in _DAT)
title_ctx = {"patterns": patterns, "doc_types": doctypes}
def signals(img, text):
    m_base = identify_template(img, text, templates); m_casc = S.page_match(img, text, templates, title_ctx)
    def sig(m):
        t = (m or {}).get("template") or {}; mid = t.get("id") if (m and t) else None
        return mid, (S.fingerprint_overlap(extract_keyword_fingerprint(text), t.get("keyword_fingerprint")) if mid else 0.0)
    ds = S.is_document_start(text); sc = S.is_continuation_page(text)
    nm = {m: named_supplier(text, m) for m in ("len", "pos", "top4", "ctx", "co", "num")}
    nm["_marker"] = has_doc_marker(text)
    return {a: (*sig(m_base if a == "base" else m_casc), ds, sc, nm) for a in ARMS}
def walk(sigs, veto, name, mode="len", unknown_rule=True, need_marker=False):
    flags = [True]; cur = sigs[0][0]; cur_name = sigs[0][4][mode]
    for i in range(1, len(sigs)):
        mid, ov, ds, sc, nmd = sigs[i]; nm = nmd[mode]
        if need_marker and not nmd["_marker"]: nm = None              # a page with no number/date marker cannot start a doc by name alone
        b = S.decide_boundary(mid, cur, ov, ds)
        if name and not b and nm and cur_name and nm != cur_name: b = True     # a DIFFERENT known supplier named
        if name and unknown_rule and not b and nm and not cur_name: b = True   # the current doc named nobody known; this page names one
        if b and veto and sc: b = False
        flags.append(b)
        if b: cur = mid; cur_name = nm if nm else cur_name
    return [i + 1 for i, f in enumerate(flags) if f]
# arm: (veto, name, mode, unknown_rule, need_marker)
ARMS = {"base": (False, False, "len", False, False), "both": (True, False, "len", False, False),
        "name_ctx": (True, True, "ctx", True, False), "name_co": (True, True, "co", True, False),
        "name_num": (True, True, "num", True, True), "name_num_strict": (True, True, "num", False, True)}
T = {a: {"right": 0, "lost": 0, "over": 0} for a in ARMS}; EXP = 0; FILES = 0
for name in sorted(gt):
    p = os.path.join(bdir, name)
    if not os.path.isfile(p) or (only and not name.startswith(only)): continue
    exp = [d["pages"][0] for d in gt[name]["docs"]]; inside = {pg for d in gt[name]["docs"] for pg in range(d["pages"][0] + 1, d["pages"][1] + 1)}
    doc = pdfium.PdfDocument(p); n = len(doc)
    if n < 2: continue
    per = {a: [] for a in ARMS}; names = []
    for i in range(n):
        page = doc[i]; img = page.render(scale=150 / 72).to_pil()
        text = S._page_text(page, img, True, pytesseract.pytesseract.tesseract_cmd) or ""
        s = signals(img, text); names.append(s["base"][4])
        for a in per: per[a].append(s[a])
    b = {a: walk(per[a], *ARMS[a]) for a in per}
    EXP += len(exp); FILES += 1
    line = f"{name:18} exp={exp}"
    for a in ARMS:
        right = len(set(b[a]) & set(exp)); lost = len((set(b["base"]) & set(exp)) - set(b[a])); over = len(set(b[a]) & inside)
        T[a]["right"] += right; T[a]["lost"] += lost; T[a]["over"] += over
        line += f" | {a}={b[a]} r={right} lost={lost} over={over}"
    print(line); print("     named:", names)
print(f"\nTOTAL files={FILES} expected={EXP} " + " | ".join(f"{a}: right={T[a]['right']} lost-vs-base={T[a]['lost']} over-splits={T[a]['over']}" for a in T))
