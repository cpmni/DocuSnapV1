"""
teach_from_gt.py — derive Stage-0.5 field mappings from a TEACH document + its ground truth
(the customer-corpus scorer's TAUGHT arm, 2026-08-04). Simulates what the teach wizard stores:
for each (field_key, gt_value) locate the VALUE's word-run on page 1 (exact alnum match — no
fuzz: the teach doc's GT is known-true), take its word-union as the TARGET box (the same
word-snap discipline the wizard now applies), and the nearest same-row LEFT word-run as the
ANCHOR label (fallback: the row above; else a synthetic position-only anchor).

Usage (spawned by customer_corpus_score.js; one JSON job file in, mappings JSON out):
  py -3.12 stress_test/teach_from_gt.py --job <job.json> --tesseract <tesseract.exe>
job.json: {"pdf": path, "fields": {field_key: gt_value, ...}}
stdout:   {"mappings": [{field_key, anchor_text, anchor:{x,y,w,h}, target:{x,y,w,h}}], "misses": [...]}
Pure/deterministic; page-norm coords; never writes anywhere.
"""
import argparse
import json
import os
import re
import sys

import pypdfium2 as pdfium
import pytesseract
from PIL import Image

SCALE = 200 / 72.0          # ~200 DPI render — comfortably above the corpus's 150-DPI scans


def norm(s):
    return "".join(c for c in str(s or "") if c.isalnum()).upper()


def words_from_page(pdf_path, tesseract, angle_out=None):
    pytesseract.pytesseract.tesseract_cmd = tesseract
    doc = pdfium.PdfDocument(pdf_path)
    page = doc[0]
    bmp = page.render(scale=SCALE)
    img = bmp.to_pil()
    W, H = img.size
    # TEACH_SCANNED parity (Oracle C5, 2026-08-05): the DETECTED skew of the teach sample —
    # exactly what the app's lazy heal will store (detection error is part of the system
    # under test; never the generator's synthetic ground-truth tilt).
    if angle_out is not None:
        try:
            sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
                os.path.abspath(__file__))), "python_backend"))
            from ocr.tesseract import detect_skew_angle
            angle_out.append(float(detect_skew_angle(img, 0.2)))
        except Exception:
            angle_out.append(None)
    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    out = []
    for i in range(len(data["text"])):
        t = (data["text"][i] or "").strip()
        if not t:
            continue
        out.append({"text": t,
                    "x": data["left"][i] / W, "y": data["top"][i] / H,
                    "w": data["width"][i] / W, "h": data["height"][i] / H})
    return out


def rows_of(words):
    rows = []
    for wd in sorted(words, key=lambda w: (w["y"] + w["h"] / 2)):
        cy = wd["y"] + wd["h"] / 2
        for r in rows:
            if abs(r["c"] - cy) <= max(wd["h"], r["h"]) * 0.6:
                r["words"].append(wd)
                r["c"] = sum(x["y"] + x["h"] / 2 for x in r["words"]) / len(r["words"])
                r["h"] = max(r["h"], wd["h"])
                break
        else:
            rows.append({"c": cy, "h": wd["h"], "words": [wd]})
    for r in rows:
        r["words"].sort(key=lambda w: w["x"])
    return rows


def union(ws, pad=0.004):
    x1 = min(w["x"] for w in ws) - pad
    y1 = min(w["y"] for w in ws) - pad
    x2 = max(w["x"] + w["w"] for w in ws) + pad
    y2 = max(w["y"] + w["h"] for w in ws) + pad
    return {"x": max(0.0, x1), "y": max(0.0, y1),
            "w": min(1.0, x2) - max(0.0, x1), "h": min(1.0, y2) - max(0.0, y1)}


def find_value(rows, gt_value):
    """First (top-most) contiguous same-row word-run whose alnum join equals the GT value's."""
    target = norm(gt_value)
    if not target:
        return None
    for r in rows:
        ws = r["words"]
        for i in range(len(ws)):
            acc = ""
            for j in range(i, len(ws)):
                acc += norm(ws[j]["text"])
                if len(acc) > len(target):
                    break
                if acc == target:
                    return {"run": ws[i:j + 1], "row": r}
    return None


def _clean_label_run(run, gt_norms=()):
    """Label-quality discipline — MIRRORS the live wizard's rules (src/windows/shared/
    anchorLabel.js sanitizeAnchorLabel + the value-shape strip) so the harness can never
    store a neighbouring VALUE as an anchor label. Without this, 48/310 taught mappings
    anchored on another field's value (a date field anchored on 'VXC4484'), so the whole
    label-anchored heal family was structurally dead in the taught arm — the harness
    measured its own teach infidelity, not the app (Oracle 2026-08-05, Slice A).
    Rules: reject the WHOLE run when its normalised join equals one of the teach doc's
    OWN GT values; keep a standalone '#' ('#.'/'#:'); drop tokens with no letter (bare
    number / ref / date); drop code-like tokens carrying >=3 digits; a surviving label
    must still carry a letter and must not itself normalise to a GT value.
    Returns the kept words (anchor box unions ONLY these) or None (position-only)."""
    if not run:
        return None
    if norm(" ".join(w["text"] for w in run)) in gt_norms:
        return None
    kept = []
    for w in run:
        t = (w.get("text") or "").strip()
        if re.fullmatch(r"#[.:]?", t):
            kept.append(w)
            continue
        if not re.search(r"[a-zA-Z]", t):
            continue
        if len(re.findall(r"\d", t)) >= 3:
            continue
        kept.append(w)
    if not any(re.search(r"[a-zA-Z]", w["text"]) for w in kept):
        return None
    if norm(" ".join(w["text"] for w in kept)) in gt_norms:
        return None
    return kept


def find_label(rows, hit, gt_norms=()):
    """Nearest same-row LEFT run (contiguous words ending before the value, gap-bounded), else
    the nearest run on the row above overlapping the value's x. None → position-only anchor.
    Each candidate passes _clean_label_run; a rejected LEFT candidate falls to the ABOVE
    branch (mirroring the wizard's left→above ladder), never further left past the gap."""
    run, row = hit["run"], hit["row"]
    vx = run[0]["x"]
    left = [w for w in row["words"] if w["x"] + w["w"] <= vx + 1e-6 and norm(w["text"])]
    if left:
        # contiguous tail of the left words (gap between them < ~1.2 row heights)
        tail = [left[-1]]
        for w in reversed(left[:-1]):
            if tail[0]["x"] - (w["x"] + w["w"]) < row["h"] * 1.2:
                tail.insert(0, w)
            else:
                break
        if vx - (tail[-1]["x"] + tail[-1]["w"]) < row["h"] * 6:      # label near the value
            tail = _clean_label_run(tail, gt_norms)
            if tail:
                return tail
    # row above, x-overlapping the value
    above = [r for r in rows if r["c"] < row["c"] - row["h"] * 0.5]
    if above:
        r2 = max(above, key=lambda r: r["c"])
        ov = [w for w in r2["words"]
              if w["x"] < run[-1]["x"] + run[-1]["w"] and w["x"] + w["w"] > vx and norm(w["text"])]
        if ov and (row["c"] - r2["c"]) < row["h"] * 3:
            ov = _clean_label_run(ov, gt_norms)
            if ov:
                return ov
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--tesseract", required=True)
    args = ap.parse_args()
    job = json.load(open(args.job, encoding="utf-8"))
    _angle = []
    words = words_from_page(job["pdf"], args.tesseract, angle_out=_angle)
    rows = rows_of(words)
    # The teach doc's own GT values — a label candidate must never BE one of these
    # (value-as-label poisons every label-anchored heal on sibling docs).
    gt_norms = {norm(v) for v in (job.get("fields") or {}).values() if norm(v)}
    mappings, misses = [], []
    for key, val in (job.get("fields") or {}).items():
        hit = find_value(rows, val)
        if not hit:
            misses.append(key)
            continue
        target = union(hit["run"])
        label = find_label(rows, hit, gt_norms)
        if label:
            anchor = union(label)
            anchor_text = " ".join(w["text"] for w in label).strip()
        else:
            anchor = {"x": max(0.0, target["x"] - 0.10), "y": target["y"],
                      "w": min(0.10, target["x"]), "h": target["h"]}
            anchor_text = None
        mappings.append({"field_key": key, "anchor_text": anchor_text,
                         "anchor": anchor, "target": target})
    print(json.dumps({"mappings": mappings, "misses": misses,
                      "sample_angle": (_angle[0] if _angle else None)}))


if __name__ == "__main__":
    main()
