"""weak_cut_census2.py TEMPLATES DOCTYPES PATTERNS KNOWN_JSON GT BUNDLES_DIR [prefixes]
Same as weak_cut_census.py but prints EVERY non-first boundary with its walk reason + doc_start + witness, and classifies
WEAK2 = a boundary decided by a TEMPLATE leg only (reason "first-page fingerprint" OR "different template") with NO
is_document_start on the page. "known supplier change" (needs a different admitted name + a witness) and
"document-start header" stay STRONG. Totals: weak2 expected vs over-split, and how many weak2 cuts are 1-page pairs."""
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
title_ctx = {"patterns": patterns, "doc_types": doctypes}
TNAME = {t.get("id"): f"{t.get('name')}/{t.get('document_type_slug')}" for t in templates}

def signals(i, img, text):
    title = S.page_title(text, title_ctx)
    match = S.page_match(img, text or "", templates, title_ctx, title)
    tmpl = (match or {}).get("template") or {}
    mid = tmpl.get("id") if match else None
    overlap = S.fingerprint_overlap(extract_keyword_fingerprint(text or ""), tmpl.get("keyword_fingerprint")) if match else 0.0
    names = S.known_names_in_band(text, KNOWN)
    witness = S.has_first_page_witness(text, bool(title and title[1]))
    wide = S.known_names_on_page(text, KNOWN)
    return (mid, overlap, S.is_document_start(text), bool(i > 0 and S.is_continuation_page(text)), names, witness, wide)

WEAK_REASONS = ("first-page fingerprint", "different template")
TOT = {"files": 0, "expected": 0, "boundaries": 0, "weak2": 0, "weak2_expected": 0, "weak2_over": 0, "strong_over": 0,
       "weak2_1page_pairs": 0, "by_reason": {}}
for name in sorted(gt):
    p = os.path.join(bdir, name)
    if not os.path.isfile(p) or (only and not name.startswith(only)): continue
    exp = {d["pages"][0] for d in gt[name]["docs"]}
    inside = {pg for d in gt[name]["docs"] for pg in range(d["pages"][0] + 1, d["pages"][1] + 1)}
    doc = pdfium.PdfDocument(p); n = len(doc)
    if n < 2: continue
    sig = []
    for i in range(n):
        page = doc[i]; img = page.render(scale=150 / 72).to_pil()
        text = S._page_text(page, img, True, pytesseract.pytesseract.tesseract_cmd) or ""
        sig.append(signals(i, img, text))
    flags, reasons = S.walk_boundaries(sig, S.FIRST_PAGE_FP_FLOOR, known_rule=True)
    starts = [i for i, f in enumerate(flags) if f]
    seglen = {s: ((starts[k + 1] if k + 1 < len(starts) else n) - s) for k, s in enumerate(starts)}
    TOT["files"] += 1; TOT["expected"] += len(exp); TOT["boundaries"] += len(starts) - 1
    det = []
    for k, i in enumerate(starts[1:], start=1):
        r = reasons[i]; ds = sig[i][2]
        weak = (r in WEAK_REASONS) and not ds
        cls = "EXPECTED" if (i + 1) in exp else ("OVER" if (i + 1) in inside else "?")
        key = f"{r}{'' if ds else ' (no doc-start)'}"
        TOT["by_reason"].setdefault(key, {"expected": 0, "over": 0}); TOT["by_reason"][key]["expected" if cls == "EXPECTED" else "over"] += 1
        prev_len = seglen[starts[k - 1]]; this_len = seglen[i]
        if weak:
            TOT["weak2"] += 1
            if cls == "EXPECTED": TOT["weak2_expected"] += 1
            if cls == "OVER": TOT["weak2_over"] += 1
            if prev_len == 1 and this_len == 1: TOT["weak2_1page_pairs"] += 1
        elif cls == "OVER":
            TOT["strong_over"] += 1
        det.append(f"p{i+1}:{cls}:{'WEAK' if weak else 'strong'} reason='{r}' doc_start={ds} tmpl={TNAME.get(sig[i][0])} prev_tmpl={TNAME.get(sig[starts[k-1]][0])} "
                   f"prev={prev_len}p this={this_len}p witness={sig[i][5]} names={sig[i][4]}")
    print(f"{name:28} exp={sorted(exp)} walk={[s + 1 for s in starts]}")
    for d in det: print("      " + d)
print("\nTOTAL", json.dumps(TOT))
