"""Optional teaching pass — seeds the engine with field anchors derived from ground
truth, so the OCR step measures the TAUGHT pipeline (learned anchor -> value reads),
not the cold / never-seen baseline.

This mirrors a user teaching ONE clean example per template: for each visual template
we take a representative base doc (clean, non-drifted) and emit, per field, a Stage-2
anchor — the on-page label text, the value box (centre+dims, the _crop_and_ocr
convention) and the drift-invariant offset = value-centre - label-top-left.

Scoping: anchors are GLOBAL on the supplier axis (supplier_name = "") and keyed by
DOC-TYPE SLUG. Supplier identity is unlearned in this corpus (no logos), so the engine
resolves no supplier before the anchor stage; a global anchor fires on doc-type slug
match alone (anchor._anchor_matches), which is exactly the path we want to exercise.
The anchors are marked authoritative so a clean taught read wins its field, matching a
real teach. The harness still changes no production code — it only feeds the engine the
same training payload the app would pass via --anchors-file.
"""
from __future__ import annotations
import csv
import json
import os
import time

from test_harness import fixtures as fx
from test_harness.metrics import load_json

# Padding so a tight ground-truth box doesn't clip glyph edges when the engine re-crops
# (centre is preserved, only the dims grow — same as the app's value-box headroom).
_W_PAD_FACTOR = 1.30
_W_PAD_ABS = 0.008
_H_PAD_ABS = 0.012


def _manifest_rows(paths):
    if not os.path.exists(paths.manifest):
        return []
    with open(paths.manifest, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _representative_doc_per_template(rows):
    """Pick one clean, base, full-quality doc id per template_id (the teach example).
    Falls back to the first row of the template if no perfectly-clean one exists."""
    best = {}
    for r in rows:
        t = r.get("template_id")
        if not t:
            continue
        clean = (r.get("variant_id", "base") == "base"
                 and r.get("low_quality") == "0"
                 and not r.get("edge_case"))
        cur = best.get(t)
        if cur is None:
            best[t] = (r["doc_id"], clean)
        elif clean and not cur[1]:
            best[t] = (r["doc_id"], True)
    return {t: did for t, (did, _clean) in best.items()}


def _value_box_centre(bbox_norm):
    """GT bbox_norm is [x, y, w, h] top-left; the engine's anchor x/y_norm are the
    value-box CENTRE with w/h dims (the _crop_and_ocr convention)."""
    x, y, w, h = bbox_norm
    return (x + w / 2.0, y + h / 2.0, w, h)


def _build_anchors_for_doc(gt):
    slug = gt["doc_type"]
    labels = {a["field_key"]: a for a in gt.get("anchors", []) if a.get("field_key")}
    out = []
    for key, fld in (gt.get("fields") or {}).items():
        gb = fld.get("bbox_norm")
        if not gb:
            continue
        vcx, vcy, vw, vh = _value_box_centre(gb)
        w_norm = min(0.9, vw * _W_PAD_FACTOR + _W_PAD_ABS)
        h_norm = min(0.5, vh + _H_PAD_ABS)
        lab = labels.get(key)
        if lab and lab.get("bbox_norm"):
            lx, ly, lw, lh = lab["bbox_norm"]
            label_text = (lab.get("token") or "").strip()
            # value relative to the label's top-left (drift-invariant).
            off_dx = vcx - lx
            off_dy = vcy - ly
            # direction is a fallback only (offset drives placement); infer from geometry.
            direction = "below" if ly + lh <= gb[1] + 1e-6 else "right"
        else:
            label_text, off_dx, off_dy, direction = "", None, None, "right"
        out.append({
            "supplier_name": "",            # global on the supplier axis
            "document_type": slug,          # fires on doc-type slug match
            "field_key": key,
            "anchor_label": label_text,
            "direction": direction,
            "x_norm": round(vcx, 5), "y_norm": round(vcy, 5),
            "w_norm": round(w_norm, 5), "h_norm": round(h_norm, 5),
            "offset_dx_norm": None if off_dx is None else round(off_dx, 5),
            "offset_dy_norm": None if off_dy is None else round(off_dy, 5),
            "usage_count": 5,
            "confidence": 0.9,
            "last_authoritative_at": int(time.time()),
        })
    return out


def run(cfg, paths, doc_ids=None):
    """Build the taught anchors file from representative docs; point cfg at it so the
    next OCR step passes --anchors-file. Returns a small summary dict."""
    rows = _manifest_rows(paths)
    reps = _representative_doc_per_template(rows)
    anchors, used = [], {}
    for tmpl, did in sorted(reps.items()):
        gt = load_json(paths.gt_path(did))
        if not gt:
            continue
        a = _build_anchors_for_doc(gt)
        anchors.extend(a)
        used[tmpl] = {"doc_id": did, "anchors": len(a)}

    out_path = os.path.join(paths.root, "_anchors_taught.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(anchors, fh, indent=2)
    cfg["anchors_file"] = out_path   # consumed by ocr_detect._run_engine this run

    return {"templates_taught": len(used), "anchors": len(anchors),
            "examples": used, "anchors_file": out_path}
