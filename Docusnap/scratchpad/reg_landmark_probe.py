#!/usr/bin/env python3
"""READ-ONLY probe: reproduce _fit_page_transform for template 32 on real Castellan pages and show,
per landmark, WHICH locate path matched and how far the LINE-box centre (what the fit actually uses)
sits from the tight label_box centre (what the taught landmark actually is).

Confirms or refutes the frame-mismatch hypothesis. Writes nothing.

Usage: py -3.12 scratchpad/reg_landmark_probe.py [docid ...]
"""
import os
import sqlite3
import sys

REPO = r"c:/GIT Projects/Docusnap"
sys.path.insert(0, os.path.join(REPO, "python_backend"))

import pypdfium2 as pdfium
import pytesseract

# The pipeline is told where Tesseract lives via --tesseract; a bare `tesseract` is NOT on PATH here,
# so without this every OCR call fails and EVERY landmark silently reads "NOT FOUND".
_TESS = os.environ.get("TESSERACT_EXE", r"C:/Program Files/Tesseract-OCR/tesseract.exe")
if os.path.exists(_TESS):
    pytesseract.pytesseract.tesseract_cmd = _TESS
else:
    print(f"WARNING: tesseract not found at {_TESS} — results are meaningless")

from extraction import registration
from extraction import template_mapper as tm

DB = os.path.join(os.environ["APPDATA"], "ScanFinder", "docusnap.db")
DPI = int(os.environ.get("OCR_RENDER_DPI", "300"))
TPL = 32
DOCS = [int(a) for a in sys.argv[1:]] or [705, 723, 710, 721, 718, 714]

c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
c.row_factory = sqlite3.Row
lms = list(c.execute("SELECT * FROM template_landmarks WHERE template_id=? ORDER BY id", (TPL,)))
sup = c.execute("SELECT * FROM template_field_mappings WHERE template_id=? AND field_key='supplier_name'",
                (TPL,)).fetchone()
box = {"x_norm": sup["target_x_norm"], "y_norm": sup["target_y_norm"],
       "w_norm": sup["target_w_norm"], "h_norm": sup["target_h_norm"]}
THRESH = max(box["h_norm"] * 0.5, 0.02)


def render(path, dpi=DPI):
    pdf = pdfium.PdfDocument(path)
    page = pdf[0]
    return page.render(scale=dpi / 72.0).to_pil().convert("RGB")


def centre(b):
    return (b["x_norm"] + b["w_norm"] / 2.0, b["y_norm"] + b["h_norm"] / 2.0)


for docid in DOCS:
    r = c.execute("SELECT id, working_path, stored_path, supplier_name, original_filename "
                  "FROM documents WHERE id=?", (docid,)).fetchone()
    if not r:
        print(f"#{docid}: not found")
        continue
    src_path = r["working_path"] if (r["working_path"] and os.path.exists(r["working_path"])) \
        else r["stored_path"]
    if not src_path or not os.path.exists(src_path):
        print(f"#{docid}: NO FILE")
        continue
    page = render(src_path)
    line_cache = {}
    print(f"\n=== #{docid}  {r['original_filename'][:48]}   stored supplier={r['supplier_name']!r}")

    src, dst, dst_label = [], [], []
    for lm in lms:
        lbox = {"x_norm": float(lm["x_norm"]), "y_norm": float(lm["y_norm"]),
                "w_norm": float(lm["w_norm"]), "h_norm": float(lm["h_norm"])}
        text = lm["label_text"]
        path_used = "tight(exp=0)"
        found = tm._locate_anchor(page, lbox, text, 0.0, tm._ocr_lines,
                                  min_search=tm._ANCHOR_SEARCH_MIN, line_cache=line_cache)
        if not (found and found.get("matched_text") is not None):
            path_used = "PAGE-WIDE(exp=1.0)"
            found = tm._locate_anchor(page, lbox, text, 1.0, tm._ocr_lines,
                                      min_search=tm._ANCHOR_SEARCH_MIN, line_cache=line_cache)
        if not (found and found.get("matched_text") is not None):
            print(f"  {text!r:<11} NOT FOUND (dropped from the fit)")
            continue
        lc = centre(found)                                   # what _fit_page_transform USES (line box)
        lb = found.get("label_box")
        lbc = centre(lb) if lb else None                     # the tight matched-label centre
        taught = centre(lbox)
        delta = ((lc[0] - lbc[0]) ** 2 + (lc[1] - lbc[1]) ** 2) ** 0.5 if lbc else float("nan")
        print(f"  {text!r:<11} via {path_used:<19} matched={str(found.get('matched_text'))[:44]!r}")
        print(f"     taught centre  ({taught[0]:.4f},{taught[1]:.4f})")
        print(f"     LINE   centre  ({lc[0]:.4f},{lc[1]:.4f})   <- used by the fit")
        if lbc:
            print(f"     label  centre  ({lbc[0]:.4f},{lbc[1]:.4f})   line-vs-label offset = {delta:.4f}"
                  f"{'   <== FRAME MISMATCH' if delta > 0.005 else ''}")
        src.append(list(taught))
        dst.append(list(lc))
        dst_label.append(list(lbc) if lbc else list(lc))

    if len(src) < 2:
        print("  -> fewer than 2 correspondences: no transform (registration inert)")
        continue
    for name, d in (("AS SHIPPED (line centres)", dst), ("IF label_box centres were used", dst_label)):
        t = registration.fit_transform(src, d, kind="similarity")
        if t is None:
            print(f"  {name:<32} -> no fit")
            continue
        div = registration.box_divergence(t, box)
        print(f"  {name:<32} residual={t.residual:.6f} inliers={t.n_inliers} "
              f"conf={registration.registration_confidence(t)} supplier-box moves {div:.4f} "
              f"-> {'REGISTRATION OVERRIDES' if div > THRESH else 'absolute read kept'}")


# ── SIMULATION of candidate fix (a): require a BOUNDARY-ALIGNED whole-needle hit ───────────────
def boundary_hit(needle, haystack):
    """The same guard _label_score uses for its 1.0 branch."""
    import re as _re
    n = tm._normalise(needle)
    core = _re.sub(r'^[^a-z0-9#]+|[^a-z0-9#]+$', '', n) or n
    pre = r'(?<![a-z0-9])' if core[:1].isalnum() else ''
    post = r'(?![a-z0-9])' if core[-1:].isalnum() else ''
    return bool(_re.search(pre + _re.escape(core) + post, tm._normalise(haystack)))


print("\n\n########## SIMULATION: drop landmark matches that are NOT boundary-aligned ##########")
for docid in DOCS:
    r = c.execute("SELECT id, working_path, stored_path, supplier_name, original_filename "
                  "FROM documents WHERE id=?", (docid,)).fetchone()
    if not r:
        continue
    src_path = r["working_path"] if (r["working_path"] and os.path.exists(r["working_path"])) \
        else r["stored_path"]
    if not src_path or not os.path.exists(src_path):
        continue
    page = render(src_path)
    line_cache = {}
    kept, dropped = [], []
    for lm in lms:
        lbox = {"x_norm": float(lm["x_norm"]), "y_norm": float(lm["y_norm"]),
                "w_norm": float(lm["w_norm"]), "h_norm": float(lm["h_norm"])}
        text = lm["label_text"]
        found = tm._locate_anchor(page, lbox, text, 0.0, tm._ocr_lines,
                                  min_search=tm._ANCHOR_SEARCH_MIN, line_cache=line_cache)
        if not (found and found.get("matched_text") is not None):
            found = tm._locate_anchor(page, lbox, text, 1.0, tm._ocr_lines,
                                      min_search=tm._ANCHOR_SEARCH_MIN, line_cache=line_cache)
        if not (found and found.get("matched_text") is not None):
            continue
        if boundary_hit(text, found["matched_text"]):
            kept.append((text, found))
        else:
            dropped.append((text, found["matched_text"]))
    print(f"\n#{docid} {r['original_filename'][:44]}")
    for t, m in dropped:
        print(f"   DROPPED {t!r} (false match on {str(m)[:44]!r})")
    print(f"   kept {len(kept)} correspondence(s) -> "
          + ("NO TRANSFORM: registration inert, absolute read stands (FAIL-SAFE)"
             if len(kept) < 2 else "transform still built"))
