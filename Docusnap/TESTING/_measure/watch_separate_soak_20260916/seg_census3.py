"""seg_census3.py TEMPLATES DOCTYPES PATTERNS KNOWN_JSON GT BUNDLES_DIR [prefixes] — the mig-179 census with the SHIPPED
functions (Oracle C4/C5: never the probe's re-implementation). Per page it calls ocr.segmentation exactly as
detect_segments does (page_title / page_match / is_document_start / is_continuation_page / known_names_in_band /
has_first_page_witness) and walks with segmentation.walk_boundaries. KNOWN_JSON = the list written by known_names.js
(the shipped learning.getKnownSupplierNames), prepared here by the shipped prepare_known_suppliers.
Arms: base (all OFF) | both (177+178) | three (177+178+179) | veto_known (177+179: the 179-ON/178-OFF cell, C4 v).
Per file: expected boundaries hit / lost-vs-base / over-splits; totals at the end.
"""
import json, os, sys
sys.path.insert(0, r"C:\GIT Projects\Docusnap\python_backend")
import pypdfium2 as pdfium, pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
from ocr import segmentation as S
from extraction.template_matcher import extract_keyword_fingerprint

templates = json.load(open(sys.argv[1], encoding="utf-8")); doctypes = json.load(open(sys.argv[2], encoding="utf-8"))
patterns = json.load(open(sys.argv[3], encoding="utf-8")); known_names = json.load(open(sys.argv[4], encoding="utf-8"))
gt = json.load(open(sys.argv[5], encoding="utf-8")); bdir = sys.argv[6]
only = tuple(sys.argv[7].split(",")) if len(sys.argv) > 7 else None
KNOWN = S.prepare_known_suppliers(known_names)
print(f"{len(known_names)} names -> {len(KNOWN)} admitted: {[e['name'] for e in KNOWN]}")
title_ctx = {"patterns": patterns, "doc_types": doctypes}
# arm: (title_ctx or None, veto, known or None)
ARMS = {"base": (None, False, None), "both": (title_ctx, True, None), "three": (title_ctx, True, KNOWN), "veto_known": (None, True, KNOWN)}

def page_signals(i, img, text):
    out = {}
    for a, (tc, veto, known) in ARMS.items():
        title = S.page_title(text, tc) if tc else None
        match = S.page_match(img, text or "", templates, tc, title)
        tmpl = (match or {}).get("template") or {}
        mid = tmpl.get("id") if match else None
        overlap = S.fingerprint_overlap(extract_keyword_fingerprint(text or ""), tmpl.get("keyword_fingerprint")) if match else 0.0
        names = S.known_names_in_band(text, known) if known else []
        witness = S.has_first_page_witness(text, bool(title and title[1])) if known else False
        wide = S.known_names_on_page(text, known) if known else []
        out[a] = (mid, overlap, S.is_document_start(text), bool(veto and i > 0 and S.is_continuation_page(text)), names, witness, wide)
    return out

T = {a: {"right": 0, "lost": 0, "over": 0} for a in ARMS}; EXP = 0; FILES = 0
for name in sorted(gt):
    p = os.path.join(bdir, name)
    if not os.path.isfile(p) or (only and not name.startswith(only)): continue
    exp = [d["pages"][0] for d in gt[name]["docs"]]; inside = {pg for d in gt[name]["docs"] for pg in range(d["pages"][0] + 1, d["pages"][1] + 1)}
    doc = pdfium.PdfDocument(p); n = len(doc)
    if n < 2: continue
    per = {a: [] for a in ARMS}; named = []
    for i in range(n):
        page = doc[i]; img = page.render(scale=150 / 72).to_pil()
        text = S._page_text(page, img, True, pytesseract.pytesseract.tesseract_cmd) or ""
        s = page_signals(i, img, text); named.append((s["three"][4], s["three"][5], s["three"][6]))
        for a in per: per[a].append(s[a])
    b = {}
    for a, (tc, veto, known) in ARMS.items():
        flags, _ = S.walk_boundaries(per[a], S.FIRST_PAGE_FP_FLOOR, known_rule=bool(known))
        b[a] = [i + 1 for i, f in enumerate(flags) if f]
    EXP += len(exp); FILES += 1
    line = f"{name:26} exp={exp}"
    for a in ARMS:
        right = len(set(b[a]) & set(exp)); lost = len((set(b["base"]) & set(exp)) - set(b[a])); over = len(set(b[a]) & inside)
        T[a]["right"] += right; T[a]["lost"] += lost; T[a]["over"] += over
        line += f" | {a}={b[a]} r={right} lost={lost} over={over}"
    print(line); print("     named/witness:", named)
print(f"\nTOTAL files={FILES} expected={EXP} " + " | ".join(f"{a}: right={T[a]['right']} lost-vs-base={T[a]['lost']} over-splits={T[a]['over']}" for a in T))
