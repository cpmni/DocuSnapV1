#!/usr/bin/env python3
"""READ-ONLY: can the supplier box be triangulated from the TAUGHT FIELD LABELS instead of
auto-picked landmark words?

Owner's proposal. Template 32's taught labels ('CREDIT REF' / 'CREDIT DATE' / 'TOTAL') locate
reliably (its ref+date read at conf 97) while the landmark word 'Qty' false-matches. This probe
locates each taught label on real pages, builds correspondences taught_anchor -> located_label,
fits BOTH an unconstrained similarity (4 DOF, what ships) and a rotation-locked translation/scale
fit (the 'straightened page' reading), maps the supplier box through each, and OCRs the result.

Writes nothing. Usage: py -3.12 scratchpad/label_triangulation_probe.py [docid ...]
"""
import itertools
import math
import os
import sqlite3
import sys

REPO = r"c:/GIT Projects/Docusnap"
sys.path.insert(0, os.path.join(REPO, "python_backend"))

import numpy as np
import pypdfium2 as pdfium
import pytesseract

_TESS = os.environ.get("TESSERACT_EXE", r"C:/Program Files/Tesseract-OCR/tesseract.exe")
if os.path.exists(_TESS):
    pytesseract.pytesseract.tesseract_cmd = _TESS

from extraction import registration as reg
from extraction import template_mapper as tm

DB = os.path.join(os.environ["APPDATA"], "ScanFinder", "docusnap.db")
DPI = int(os.environ.get("OCR_RENDER_DPI", "300"))
TPL = 32
DOCS = [int(a) for a in sys.argv[1:]] or [705, 723, 710, 721, 726, 718]
TRUE_SUPPLIER = "Castellan Security Systems"

c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
c.row_factory = sqlite3.Row
maps = list(c.execute("SELECT * FROM template_field_mappings WHERE template_id=?", (TPL,)))
sup = [m for m in maps if m["field_key"] == "supplier_name"][0]
labelled = [m for m in maps if (m["anchor_text"] or "").strip()]
SUPBOX = {"x_norm": sup["target_x_norm"], "y_norm": sup["target_y_norm"],
          "w_norm": sup["target_w_norm"], "h_norm": sup["target_h_norm"]}


def render(path):
    return pdfium.PdfDocument(path)[0].render(scale=DPI / 72.0).to_pil().convert("RGB")


def centre(b):
    return (b["x_norm"] + b["w_norm"] / 2.0, b["y_norm"] + b["h_norm"] / 2.0)


def fit_translation(src, dst):
    """Rotation-LOCKED, scale-LOCKED: 2 DOF over 2*N equations -> OVERDETERMINED, so the residual
    is meaningful and a bad correspondence cannot hide."""
    d = np.asarray(dst) - np.asarray(src)
    t = d.mean(axis=0)
    per = np.sqrt(((d - t) ** 2).sum(axis=1))
    return t, per, float(np.sqrt((per ** 2).mean()))


def ocr_box(page, box):
    crop = tm._crop(page, box)
    if crop is None:
        return ""
    try:
        return " ".join(pytesseract.image_to_string(tm._prep(crop), config="--oem 3 --psm 7").split())
    except Exception:
        return "(ocr failed)"


print(f"taught labels available on template {TPL}: "
      f"{[(m['field_key'], m['anchor_text']) for m in labelled]}")
print(f"true supplier box = {SUPBOX}\n")

for docid in DOCS:
    r = c.execute("SELECT id, working_path, stored_path, supplier_name, original_filename "
                  "FROM documents WHERE id=?", (docid,)).fetchone()
    if not r:
        continue
    path = r["working_path"] if (r["working_path"] and os.path.exists(r["working_path"])) else r["stored_path"]
    if not path or not os.path.exists(path):
        print(f"#{docid}: NO FILE")
        continue
    page = render(path)
    cache = {}
    print(f"=== #{docid} {r['original_filename'][:44]}  stored={r['supplier_name']!r}")

    pairs = []
    for m in labelled:
        abox = {"x_norm": m["anchor_x_norm"], "y_norm": m["anchor_y_norm"],
                "w_norm": m["anchor_w_norm"], "h_norm": m["anchor_h_norm"]}
        txt = m["anchor_text"]
        found = tm._locate_anchor(page, abox, txt, float(m["search_expansion"] or 0.0), tm._ocr_lines,
                                  min_search=tm._ANCHOR_SEARCH_MIN, line_cache=cache)
        if not (found and found.get("matched_text") is not None):
            found = tm._locate_anchor(page, abox, txt, 1.0, tm._ocr_lines,
                                      min_search=tm._ANCHOR_SEARCH_MIN, line_cache=cache)
        if not (found and found.get("matched_text") is not None):
            print(f"   {txt!r:<14} NOT LOCATED")
            continue
        lb = found.get("label_box") or found
        pairs.append((txt, centre(abox), centre(lb), found.get("matched_text")))
        dx = centre(lb)[0] - centre(abox)[0]
        dy = centre(lb)[1] - centre(abox)[1]
        print(f"   {txt!r:<14} located, shift=({dx:+.4f},{dy:+.4f})  matched={str(found.get('matched_text'))[:34]!r}")

    if len(pairs) < 2:
        print("   -> fewer than 2 labels located; cannot triangulate\n")
        continue

    src = [p[1] for p in pairs]
    dst = [p[2] for p in pairs]
    t, per, rms = fit_translation(src, dst)
    print(f"   TRANSLATION-locked fit from {len(pairs)} labels: shift=({t[0]:+.4f},{t[1]:+.4f}) "
          f"per-label residual={np.round(per,4).tolist()} RMS={rms:.4f}")
    moved = dict(SUPBOX)
    moved["x_norm"] += float(t[0])
    moved["y_norm"] += float(t[1])
    print(f"      supplier box -> ({moved['x_norm']:.4f},{moved['y_norm']:.4f})  OCR: {ocr_box(page, moved)!r}")

    sim = reg.fit_transform(src, dst, kind="similarity")
    if sim is not None:
        M = sim.matrix
        rot = math.degrees(math.atan2(-float(M[0, 1]), float(M[0, 0])))
        sc = math.hypot(float(M[0, 0]), float(M[0, 1]))
        sbox = sim.apply_box(SUPBOX)
        print(f"   UNCONSTRAINED similarity: residual={sim.residual:.6f} inliers={sim.n_inliers}"
              f" rot={rot:+.2f}deg scale={sc:.4f}")
        print(f"      supplier box -> ({sbox['x_norm']:.4f},{sbox['y_norm']:.4f})  OCR: {ocr_box(page, sbox)!r}")
    print(f"   baseline: untouched taught box OCR: {ocr_box(page, SUPBOX)!r}\n")
