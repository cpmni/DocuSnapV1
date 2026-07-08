"""Agent 4 — Template & Anchor evaluation.

For each doc: was the right document TYPE identified (the project's Stage 0 learned-
template match doesn't fire on a brand-new corpus, so doc-type DETECTION is the proxy
— a coverage gap the report names explicitly); were the GT anchor tokens found in the
OCR, and how far did they drift from their expected positions; and which type
confusions / near-duplicate template confusions occur.

Writes metrics/template_anchor.json (consumed by Agent 5) and template_anchor.csv.
"""
from __future__ import annotations
import csv
import json
import os

from test_harness import fixtures as fx
from test_harness.metrics import load_json, iou, centre_dist, loose, norm_text

NAME_TO_SLUG = {d["name"].lower(): d["slug"] for d in fx.DOC_TYPES}


def _match_anchor(anchor, toks):
    """Best OCR token reading this anchor's first word; return (found, iou, loc_err)."""
    word = norm_text(anchor["token"]).split()[0] if anchor.get("token") else ""
    gb = anchor.get("bbox_norm")
    if not word or not gb:
        return None
    cands = [t for t in toks if loose(t["text"]) == loose(word)]
    if not cands:
        return (False, 0.0, None)
    best = min(cands, key=lambda t: centre_dist(t["bbox_norm"], gb))
    return (True, round(iou(best["bbox_norm"], gb), 3), round(centre_dist(best["bbox_norm"], gb), 4))


def eval_doc(gt, ext, raw):
    detected_name = (ext or {}).get("document_type")
    detected_slug = NAME_TO_SLUG.get((detected_name or "").lower(), "(none)" if not detected_name else detected_name)
    gt_slug = gt["doc_type"]
    engine_error = bool(ext and not ext.get("success", False))
    template_correct = 0 if engine_error else int(detected_slug == gt_slug)

    toks = [t for p in (raw or {}).get("pages", []) for t in p["tokens"]]
    found = total = 0
    ious, errs = [], []
    for a in gt.get("anchors", []):
        r = _match_anchor(a, toks)
        if r is None:
            continue
        total += 1
        ok, i_, e_ = r
        if ok:
            found += 1; ious.append(i_)
            if e_ is not None:
                errs.append(e_)
    return {
        "doc_id": gt["doc_id"], "doc_type": gt_slug, "template_id": gt["template_id"],
        "detected_type": detected_slug, "template_correct": template_correct,
        "engine_error": int(engine_error),
        "stage0_template_id": (ext or {}).get("template_id"),     # None on a fresh corpus
        "logo_phash": (ext or {}).get("logo_phash"),
        "anchor_total": total, "anchor_found": found,
        "mean_anchor_iou": round(sum(ious) / len(ious), 3) if ious else None,
        "mean_anchor_loc_err": round(sum(errs) / len(errs), 4) if errs else None,
        "confusion": "" if template_correct or engine_error else f"{gt_slug}->{detected_slug}",
    }


def run(cfg, paths, doc_ids=None):
    ids = doc_ids or _ids(paths)
    rows = []
    for did in ids:
        gt = load_json(paths.gt_path(did))
        if not gt:
            continue
        ext = load_json(os.path.join(paths.ocr, did, "extraction.json"))
        raw = load_json(os.path.join(paths.ocr, did, "raw_ocr.json"))
        rows.append(eval_doc(gt, ext, raw))
    with open(os.path.join(paths.metrics, "template_anchor.json"), "w", encoding="utf-8") as fh:
        json.dump(rows, fh, indent=2)
    if rows:
        cols = [k for k in rows[0].keys()]
        with open(os.path.join(paths.metrics, "template_anchor.csv"), "w", encoding="utf-8", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=cols); w.writeheader(); w.writerows(rows)
    stage0_fired = sum(1 for r in rows if r["stage0_template_id"])
    confusions = [r["confusion"] for r in rows if r["confusion"]]
    return {"docs": len(rows), "stage0_template_matches": stage0_fired,
            "type_correct": sum(r["template_correct"] for r in rows),
            "confusions": len(confusions)}


def _ids(paths):
    ids = []
    if os.path.exists(paths.manifest):
        with open(paths.manifest, encoding="utf-8") as fh:
            ids = [r["doc_id"] for r in csv.DictReader(fh)]
    return ids
