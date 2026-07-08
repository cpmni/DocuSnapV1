"""Agent 2 — Page drift.

Applies controlled drift to a deterministic >= drift_pct subset of the SCANNED docs
(text docs stay clean as the control). Drift families:
  geometric    shift · rotate · skew         (GT bboxes transformed analytically)
  structural   insert_page · remove_page · reorder   (page indices / counts updated)
  degradation  crop(occlude) · resize · blur · noise · jpeg   (bboxes unchanged)

The drifted image-only PDF + page PNGs are re-saved IN PLACE and ground_truth.json is
updated: fields/anchors stay truthful to the drifted pixels, the ORIGINAL geometry is
preserved under gt['drift']['original'], and gt['variant_id'] becomes drift_<type>.
Idempotent — a doc already carrying a drift block is skipped.
"""
from __future__ import annotations
import csv
import json
import math
import os

import pypdfium2 as pdfium
from PIL import Image, ImageDraw

from test_harness import render as R

GEOMETRIC = ["shift", "rotate", "skew"]
STRUCTURAL = ["insert_page", "remove_page", "reorder"]
DEGRADATION = ["crop", "resize", "blur", "noise", "jpeg"]
DRIFT_TYPES = GEOMETRIC + STRUCTURAL + DEGRADATION

MAG = {  # (mild, severe)
    "shift": (0.02, 0.08), "rotate": (2.0, 7.0), "skew": (0.02, 0.06),
    "crop": (0.06, 0.16), "resize": (0.8, 0.5), "blur": (1.2, 2.4),
    "noise": (18, 34), "jpeg": (45, 22),
}


def _load_pages(paths, did, gt):
    pdir = os.path.join(paths.doc_dir(did), "pages")
    imgs = []
    if os.path.isdir(pdir):
        for i in range(gt["page_count"]):
            p = os.path.join(pdir, f"page_{i}.png")
            if os.path.exists(p):
                imgs.append(Image.open(p).convert("RGB"))
    if len(imgs) != gt["page_count"]:
        scale = gt["render"]["dpi"] / 72.0
        pdf = pdfium.PdfDocument(paths.pdf_path(did))
        imgs = [pdf[i].render(scale=scale).to_pil().convert("RGB") for i in range(len(pdf))]
    return imgs


def _transform_bbox(b, dtype, p, W, H):
    x, y, w, h = b
    if dtype == "shift":
        return [x + p["dx"] / W, y + p["dy"] / H, w, h]
    if dtype == "rotate":
        return R.rotate_bbox(b, p["angle"], W, H)
    if dtype == "skew":
        return [x + p["kx"] * (H / W) * ((y + h / 2) - 0.5), y, w, h]
    return b


def _apply_geometric(imgs, dtype, p):
    out = []
    for im in imgs:
        if dtype == "shift":
            out.append(R.geo_shift(im, p["dx"], p["dy"]))
        elif dtype == "rotate":
            out.append(R.geo_rotate(im, p["angle"]))
        elif dtype == "skew":
            out.append(R.geo_skew(im, p["kx"]))
    return out


def _apply_degradation(imgs, dtype, p, rng):
    out = []
    for im in imgs:
        if dtype == "crop":
            q = im.copy(); d = ImageDraw.Draw(q); W, H = q.size
            side = p["side"]; f = p["frac"]
            box = {"bottom": [0, int(H * (1 - f)), W, H], "top": [0, 0, W, int(H * f)],
                   "left": [0, 0, int(W * f), H], "right": [int(W * (1 - f)), 0, W, H]}[side]
            d.rectangle(box, fill=(250, 250, 248)); out.append(q)
        elif dtype == "resize":
            out.append(R.deg_resize(im, p["scale"]))
        elif dtype == "blur":
            out.append(R.deg_blur(im, p["radius"]))
        elif dtype == "noise":
            out.append(R.deg_noise(im, rng, p["strength"]))
        elif dtype == "jpeg":
            out.append(R.deg_jpeg(im, p["quality"]))
    return out


def _occluded(b, side, frac):
    """True if a bbox centre falls inside the cropped-away strip (value lost)."""
    cx, cy = b[0] + b[2] / 2, b[1] + b[3] / 2
    return {"bottom": cy > 1 - frac, "top": cy < frac,
            "left": cx < frac, "right": cx > 1 - frac}[side]


def drift_one(paths, did, gt, dtype, severity, rng):
    imgs = _load_pages(paths, did, gt)
    W, H = gt["render"]["width"], gt["render"]["height"]
    dpi = gt["render"]["dpi"]
    orig = {"page_count": gt["page_count"],
            "fields": {k: v["bbox_norm"] for k, v in gt["fields"].items()},
            "page_text": list(gt.get("page_text") or [])}
    params = {}

    if dtype in GEOMETRIC:
        m = MAG[dtype][0 if severity == "mild" else 1]
        if dtype == "shift":
            params = {"dx": int((m if rng.random() < .5 else -m) * W),
                      "dy": int((m if rng.random() < .5 else -m) * H)}
        elif dtype == "rotate":
            params = {"angle": round((m if rng.random() < .5 else -m), 2)}
        else:
            params = {"kx": round(m if rng.random() < .5 else -m, 3)}
        imgs = _apply_geometric(imgs, dtype, params)
        for fk, fv in gt["fields"].items():
            fv["bbox_norm"] = [round(c, 4) for c in _transform_bbox(fv["bbox_norm"], dtype, params, W, H)]
        for a in gt["anchors"]:
            a["bbox_norm"] = [round(c, 4) for c in _transform_bbox(a["bbox_norm"], dtype, params, W, H)]

    elif dtype in DEGRADATION:
        if dtype == "crop":
            params = {"side": rng.choice(["bottom", "top", "left", "right"]),
                      "frac": MAG["crop"][0 if severity == "mild" else 1]}
            imgs = _apply_degradation(imgs, dtype, params, rng)
            for fk, fv in list(gt["fields"].items()):
                if _occluded(fv["bbox_norm"], params["side"], params["frac"]):
                    fv["occluded"] = True       # value cropped out of the scan
        else:
            key = {"resize": "scale", "blur": "radius", "noise": "strength", "jpeg": "quality"}[dtype]
            params = {key: MAG[dtype][0 if severity == "mild" else 1]}
            imgs = _apply_degradation(imgs, dtype, params, rng)

    else:  # STRUCTURAL
        if dtype == "insert_page":
            filler = Image.new("RGB", (W, H), (252, 252, 250))
            d = ImageDraw.Draw(filler)
            d.text((int(dpi * 0.6), int(dpi * 0.6)), "INSERTED PAGE — terms & conditions",
                   font=R.font(R.FONTS[0], int(dpi * 0.09)), fill=(120, 120, 120))
            imgs.insert(1, filler)
            for fv in list(gt["fields"].values()) + gt["anchors"]:
                if fv.get("page", 0) >= 1:
                    fv["page"] += 1
            (gt.get("page_text") or []).insert(1, "inserted page terms and conditions")
            params = {"at": 1}
        elif dtype == "remove_page" and len(imgs) > 1:
            imgs.pop()
            if gt.get("page_text"):
                gt["page_text"].pop()
            params = {"removed": "last"}
        elif dtype == "reorder" and len(imgs) > 1:
            imgs = list(reversed(imgs))
            n = len(imgs)
            for fv in list(gt["fields"].values()) + gt["anchors"]:
                fv["page"] = n - 1 - fv.get("page", 0)
            if gt.get("page_text"):
                gt["page_text"] = list(reversed(gt["page_text"]))
            params = {"order": "reversed"}
        else:
            # single-page doc can't lose/reorder — fall back to a shift so the slot isn't wasted
            dtype, params = "shift", {"dx": int(0.05 * W), "dy": int(0.05 * H)}
            imgs = _apply_geometric(imgs, "shift", params)
            for fv in list(gt["fields"].values()) + gt["anchors"]:
                fv["bbox_norm"] = [round(c, 4) for c in _transform_bbox(fv["bbox_norm"], "shift", params, W, H)]

    gt["page_count"] = len(imgs)
    gt["variant_id"] = f"drift_{dtype}"
    gt["drift"] = {"type": dtype, "family": _family(dtype), "severity": severity,
                   "params": params, "original": orig}

    # Re-save the drifted image-only PDF + page PNGs + ground truth.
    imgs[0].save(paths.pdf_path(did), "PDF", resolution=dpi, save_all=True, append_images=imgs[1:])
    pdir = os.path.join(paths.doc_dir(did), "pages")
    if os.path.isdir(pdir):
        for f in os.listdir(pdir):
            os.remove(os.path.join(pdir, f))
        for i, im in enumerate(imgs):
            im.save(os.path.join(pdir, f"page_{i}.png"))
    with open(paths.gt_path(did), "w", encoding="utf-8") as fh:
        json.dump(gt, fh, indent=2)
    return {"doc_id": did, "drift_type": dtype, "family": _family(dtype),
            "severity": severity, "params": json.dumps(params)}


def _family(dtype):
    return ("geometric" if dtype in GEOMETRIC else
            "structural" if dtype in STRUCTURAL else "degradation")


def run(cfg, paths, doc_ids=None):
    import random
    rows = []
    manifest = []
    with open(paths.manifest, encoding="utf-8") as fh:
        manifest = list(csv.DictReader(fh))
    pc = {r["doc_id"]: int(r["page_count"]) for r in manifest}
    scanned = [r["doc_id"] for r in manifest if r["modality"] == "scanned"]
    if doc_ids:
        scanned = [d for d in scanned if d in doc_ids]
    total_docs = len(manifest)
    n_drift = max(1, (total_docs * int(cfg.get("drift_pct", 10)) + 99) // 100)
    stride = max(1, len(scanned) // n_drift)
    selected = scanned[::stride][:n_drift]

    # Route page removal/reorder (which need >1 page) to multi-page docs; everything
    # else (geometric + degradation + page insert, all single-page safe) to the rest.
    multipage = [d for d in selected if pc.get(d, 1) > 1]
    singlepage = [d for d in selected if pc.get(d, 1) == 1]
    struct_cycle = ["reorder", "remove_page", "insert_page"]
    other_cycle = GEOMETRIC + DEGRADATION + ["insert_page"]
    plan = [(d, struct_cycle[i % len(struct_cycle)]) for i, d in enumerate(multipage)]
    plan += [(d, other_cycle[i % len(other_cycle)]) for i, d in enumerate(singlepage)]

    for i, (did, dtype) in enumerate(plan):
        gt = json.load(open(paths.gt_path(did), encoding="utf-8"))
        if gt.get("drift"):                       # idempotent
            continue
        severity = "mild" if i % 2 == 0 else "severe"
        rng = random.Random(cfg["seed"] * 7 + i + 1)
        rows.append(drift_one(paths, did, gt, dtype, severity, rng))
    with open(os.path.join(paths.metrics, "drift_index.csv"), "w", encoding="utf-8", newline="") as fh:
        if rows:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    return {"drifted": len(rows), "selected": len(selected),
            "by_family": {f: sum(1 for r in rows if r["family"] == f) for f in ("geometric", "structural", "degradation")}}
