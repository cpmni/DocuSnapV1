"""Agent 5 — Validator & Metrics.

Compares the project's OCR + extraction output to ground truth and computes, per doc:
CER/WER (raw OCR text vs GT page text), field exact + fuzzy accuracy, value-bbox IoU,
layout precision/recall, table-cell accuracy, plus the template/anchor row produced by
Agent 4. Writes per_doc.csv, fields.csv, failures.csv and aggregates.json (per template,
per drift type, per doc type, per modality). Changes no documents and no code.
"""
from __future__ import annotations
import csv
import gzip
import json
import os
import re

from test_harness import fixtures as fx

# Thresholds (the report's failure buckets).
T_CER, T_WER, T_IOU, T_ANCHOR_ERR = 0.20, 0.30, 0.50, 0.05

# A field is treated as "flagged for review" when its confidence is below this OR it
# carries a validation_note / correction candidate — the same signals the Review UI
# surfaces. Drives the confidence-calibration metric below.
REVIEW_CONF_THRESHOLD = 70


# ── small pure helpers (shared with Agent 4) ─────────────────────────────────────
def lev(a, b) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[-1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(ref, hyp):
    return lev(ref, hyp) / max(1, len(ref))


def wer(ref, hyp):
    rw, hw = ref.split(), hyp.split()
    return lev(rw, hw) / max(1, len(rw))


def ratio(a, b):
    m = max(len(a), len(b))
    return 1.0 if m == 0 else 1.0 - lev(a, b) / m


def iou(b1, b2):
    ax, ay, aw, ah = b1; bx, by, bw, bh = b2
    ix, iy = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    iw, ih = max(0, ix2 - ix), max(0, iy2 - iy)
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def centre_dist(b1, b2):
    c1 = (b1[0] + b1[2] / 2, b1[1] + b1[3] / 2)
    c2 = (b2[0] + b2[2] / 2, b2[1] + b2[3] / 2)
    return ((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2) ** 0.5


def norm_text(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def loose(s):
    return re.sub(r"[^0-9a-z]", "", (s or "").lower())


def load_json(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    if os.path.exists(path + ".gz"):
        with gzip.open(path + ".gz", "rt", encoding="utf-8") as fh:
            return json.load(fh)
    return None


# ── per-doc evaluation ───────────────────────────────────────────────────────────
def _eval_fields(gt, ext):
    """Return (field_rows, exact, fuzzy, scored)."""
    dt = fx.DOC_TYPE_BY_SLUG.get(gt["doc_type"], {})
    keys = [f["key"] for f in dt.get("fields", [])]
    date_key = dt.get("date_field_key")
    extr = (ext.get("extractions") or {}) if ext else {}
    rows, exact, fuzzy, scored = [], 0, 0, 0
    for k in keys:
        if k not in gt.get("fields", {}):
            continue
        gv = gt["fields"][k]["value"]
        fd = extr.get(k) or {}
        pv = fd.get("value")
        conf = fd.get("confidence")
        note = bool(fd.get("validation_note"))
        corrected = bool(fd.get("corrected_to"))
        scored += 1
        is_exact = pv is not None and norm_text(pv) == norm_text(gv)
        r = ratio(norm_text(pv or ""), norm_text(gv))
        is_loose = pv is not None and loose(pv) == loose(gv)   # ignores currency symbol etc.
        exact += int(is_exact)
        fuzzy += int(r >= 0.85 or is_loose)
        produced = pv not in (None, "")
        correct = is_exact or is_loose
        # The Review UI surfaces a field when its confidence is low OR it carries a
        # validation note / correction candidate. Mirror that to score the system's
        # "should a human check this?" decision against whether it was actually right.
        flagged = ((isinstance(conf, (int, float)) and conf < REVIEW_CONF_THRESHOLD)
                   or note or corrected)
        is_date = bool(date_key and k == date_key) or k.endswith("_date")
        rows.append({"key": k, "gt": gv, "pred": pv, "conf": conf,
                     "exact": int(is_exact), "loose": int(is_loose), "ratio": round(r, 3),
                     "note": int(note), "corrected": int(corrected),
                     "produced": int(produced), "correct": int(correct),
                     "flagged": int(flagged), "is_date": int(is_date)})
    return rows, exact, fuzzy, scored


def _bag(tokens):
    from collections import Counter
    return Counter(t for t in tokens if t)


def _value_iou(gt, raw):
    """Best-effort IoU between GT value boxes and OCR tokens that read the value."""
    toks = [t for p in (raw.get("pages") or []) for t in p["tokens"]]
    results = {}
    for k, fd in gt.get("fields", {}).items():
        gb = fd.get("bbox_norm"); val = norm_text(fd.get("value"))
        if not gb or not val:
            continue
        first = val.split()[0]
        cands = [t for t in toks if loose(t["text"]) and loose(t["text"]) == loose(first)]
        if not cands:
            cands = [t for t in toks if loose(first) and loose(first) in loose(t["text"])]
        if not cands:
            results[k] = 0.0
            continue
        best = max(cands, key=lambda t: iou(t["bbox_norm"], gb))
        results[k] = round(iou(best["bbox_norm"], gb), 3)
    return results


def _table_cells(gt, raw):
    items = gt.get("line_items") or []
    if not items:
        return None
    text = loose(raw.get("page_text", ""))
    total = found = 0
    for it in items:
        for cell in (it["description"], str(it["qty"]), f"{it['amount']:.2f}"):
            total += 1
            if loose(cell) and loose(cell) in text:
                found += 1
    return round(found / total, 3) if total else None


def evaluate_doc(gt, ext, raw, ta_row):
    ref = norm_text(" ".join(gt.get("page_text") or []))
    hyp = norm_text((raw or {}).get("page_text", ""))
    doc_cer = round(cer(ref, hyp), 4)
    doc_wer = round(wer(ref, hyp), 4)
    field_rows, exact, fuzzy, scored = _eval_fields(gt, ext)
    vious = _value_iou(gt, raw or {})
    cell_acc = _table_cells(gt, raw or {})
    # layout precision/recall (bag-of-words).
    gb = _bag(loose_tokens(ref)); hb = _bag(loose_tokens(hyp))
    inter = sum((gb & hb).values())
    prec = inter / max(1, sum(hb.values())); rec = inter / max(1, sum(gb.values()))
    return {
        "doc_id": gt["doc_id"], "modality": gt["modality"], "doc_type": gt["doc_type"],
        "template_id": gt["template_id"], "variant_id": gt.get("variant_id", "base"),
        "drift_type": (gt.get("drift") or {}).get("type", ""),
        "low_quality": int(gt.get("features", {}).get("low_quality", False)),
        "edge_case": gt.get("edge_case") or "",
        "engine_error": int(bool(ext and not ext.get("success", False))),
        "cer": doc_cer, "wer": doc_wer,
        "field_exact": round(exact / scored, 3) if scored else None,
        "field_fuzzy": round(fuzzy / scored, 3) if scored else None,
        "fields_scored": scored, "fields_exact": exact,
        "mean_value_iou": round(sum(vious.values()) / len(vious), 3) if vious else None,
        "table_cell_acc": cell_acc,
        "layout_precision": round(prec, 3), "layout_recall": round(rec, 3),
        "template_correct": ta_row.get("template_correct"),
        "detected_type": ta_row.get("detected_type"),
        "anchor_found": ta_row.get("anchor_found"), "anchor_total": ta_row.get("anchor_total"),
        "mean_anchor_iou": ta_row.get("mean_anchor_iou"),
        "mean_anchor_loc_err": ta_row.get("mean_anchor_loc_err"),
        "_field_rows": field_rows, "_value_iou": vious,
    }


def loose_tokens(s):
    return [loose(w) for w in s.split() if loose(w)]


# ── failures ─────────────────────────────────────────────────────────────────────
def doc_failures(m):
    F = []
    did = m["doc_id"]

    def add(mode, detail, metric=None, sev="severe", gt=None, pred=None):
        F.append({"doc_id": did, "mode": mode, "detail": detail,
                  "metric": "" if metric is None else round(metric, 4),
                  "severity": sev, "gt": gt or "", "pred": pred or ""})
    if m["engine_error"]:
        add("engine_error", m["doc_type"], sev="severe")
    if m["cer"] is not None and m["cer"] > T_CER:
        add("ocr_high_cer", "page", m["cer"], "severe" if m["cer"] > 0.4 else "mild")
    if m["wer"] is not None and m["wer"] > T_WER:
        add("ocr_high_wer", "page", m["wer"], "severe" if m["wer"] > 0.5 else "mild")
    if m["template_correct"] == 0:
        add("wrong_doc_type", f"{m['doc_type']}->{m['detected_type']}", sev="severe")
    for fr in m["_field_rows"]:
        if not fr["exact"] and not fr["loose"]:
            mode = "field_value_missing" if fr["pred"] in (None, "") else "field_value_mismatch"
            add(mode, fr["key"], fr["ratio"], "severe" if fr["ratio"] < 0.5 else "mild",
                gt=fr["gt"], pred=fr["pred"])
    for k, v in m["_value_iou"].items():
        if v < T_IOU:
            add("value_bbox_low_iou", k, v, "severe" if v < 0.2 else "mild")
    if m["anchor_total"] and m["anchor_found"] is not None and m["anchor_found"] < m["anchor_total"]:
        add("anchor_missed", f"{m['anchor_found']}/{m['anchor_total']}",
            1 - m["anchor_found"] / m["anchor_total"], "mild")
    if m["mean_anchor_loc_err"] not in (None, "") and m["mean_anchor_loc_err"] > T_ANCHOR_ERR:
        add("anchor_high_loc_err", "page", m["mean_anchor_loc_err"], "mild")
    return F


# ── aggregation + run ────────────────────────────────────────────────────────────
def _agg(metrics, key):
    groups = {}
    for m in metrics:
        g = groups.setdefault(m[key] or "(none)", [])
        g.append(m)

    def avg(rows, f):
        vals = [r[f] for r in rows if isinstance(r[f], (int, float))]
        return round(sum(vals) / len(vals), 3) if vals else None
    out = {}
    for name, rows in sorted(groups.items()):
        out[name] = {"docs": len(rows), "cer": avg(rows, "cer"), "wer": avg(rows, "wer"),
                     "field_exact": avg(rows, "field_exact"), "field_fuzzy": avg(rows, "field_fuzzy"),
                     "mean_value_iou": avg(rows, "mean_value_iou"),
                     "template_acc": avg(rows, "template_correct"),
                     "engine_error_rate": avg(rows, "engine_error")}
    return out


def apply_wordness_flags(field_rows):
    """Add a 'flagged_w' key to each row = baseline 'flagged' OR the wordness
    name-structure flag (engine.wordness), and return the marginal effect on NAME-like
    fields. This is the COUNTERFACTUAL for the (flag-only) wordness gate: because the
    gate never changes the winning value, OR-ing its flag onto the existing engine
    output reproduces exactly what enabling it would have scored — no second engine run.
    Inert (flagged_w == flagged) if the model/table is unavailable."""
    try:
        from extraction import wordness, value_quality
        on = wordness.available()
    except Exception:
        on = False
    new_caught = new_needless = name_considered = 0
    for r in field_rows:
        base = bool(r.get("flagged"))
        wflag = False
        if on and r.get("produced") and value_quality.is_name_like_field(r.get("key")):
            name_considered += 1
            wflag = wordness.looks_like_garble(r.get("pred") or "")
            if wflag and not base:
                if r.get("correct"):
                    new_needless += 1
                else:
                    new_caught += 1
        r["flagged_w"] = base or wflag
    return {"model_available": on, "name_fields_considered": name_considered,
            "new_silent_caught": new_caught, "new_needless_review": new_needless}


def confidence_review(field_rows, flag_key="flagged"):
    """Calibration of confidence + review-flagging vs correctness.

    Computed over PRODUCED values (the engine actually returned something) — that is
    where a confidence/review decision exists at all. Per produced field we cross
    'was it correct?' with 'was it flagged for review?' (conf < threshold OR a
    validation note / correction candidate), giving the four cells that matter:

      auto_accept_correct  correct & not flagged  — the ideal (no human time spent)
      needless_review      correct & flagged      — wasted operator attention
      silent_error         wrong   & not flagged  — DANGER: a wrong value slips through
      caught_error         wrong   & flagged      — the safety net working

    A well-calibrated system has high mean_conf on correct reads, low on wrong ones,
    a low silent_error_rate, and a tolerable needless_review_rate. The date subset is
    broken out because the date-confidence rules (clean date floored to 90, single
    salvaged date to 80) act here: a correctly-read date should clear the threshold
    and NOT be needlessly flagged."""
    def block(rows):
        prod = [r for r in rows if r.get("produced")]
        n = len(prod)
        correct = [r for r in prod if r.get("correct")]
        wrong = [r for r in prod if not r.get("correct")]

        def mean_conf(rs):
            cs = [r["conf"] for r in rs if isinstance(r.get("conf"), (int, float))]
            return round(sum(cs) / len(cs), 1) if cs else None

        tn = sum(1 for r in correct if not r.get(flag_key))
        fp = sum(1 for r in correct if r.get(flag_key))
        fn = sum(1 for r in wrong if not r.get(flag_key))
        tp = sum(1 for r in wrong if r.get(flag_key))
        return {
            "produced": n, "correct": len(correct), "wrong": len(wrong),
            "accuracy": round(len(correct) / n, 3) if n else None,
            "mean_conf_correct": mean_conf(correct),
            "mean_conf_wrong": mean_conf(wrong),
            "auto_accept_correct": tn, "needless_review": fp,
            "silent_error": fn, "caught_error": tp,
            "silent_error_rate": round(fn / n, 3) if n else None,
            "needless_review_rate": round(fp / len(correct), 3) if correct else None,
            "review_precision": round(tp / (tp + fp), 3) if (tp + fp) else None,
            "review_recall": round(tp / (tp + fn), 3) if (tp + fn) else None,
        }
    return {
        "threshold": REVIEW_CONF_THRESHOLD,
        "all_fields": block(field_rows),
        "date_fields": block([r for r in field_rows if r.get("is_date")]),
        "non_date_fields": block([r for r in field_rows if not r.get("is_date")]),
    }


def run(cfg, paths, doc_ids=None):
    ids = doc_ids or _manifest_ids(paths)
    ta = {r["doc_id"]: r for r in load_json(os.path.join(paths.metrics, "template_anchor.json")) or []}
    metrics, fail_rows, field_rows = [], [], []
    for did in ids:
        gt = load_json(paths.gt_path(did))
        if not gt:
            continue
        ext = load_json(os.path.join(paths.ocr, did, "extraction.json"))
        raw = load_json(os.path.join(paths.ocr, did, "raw_ocr.json"))
        m = evaluate_doc(gt, ext, raw, ta.get(did, {}))
        metrics.append(m)
        fail_rows.extend(doc_failures(m))
        for fr in m["_field_rows"]:
            field_rows.append({"doc_id": did, "doc_type": m["doc_type"], **fr})

    wordness_effect = apply_wordness_flags(field_rows)        # adds 'flagged_w' to rows
    clean = [{k: v for k, v in m.items() if not k.startswith("_")} for m in metrics]
    _write_csv(os.path.join(paths.metrics, "per_doc.csv"), clean)
    _write_csv(os.path.join(paths.metrics, "fields.csv"), field_rows)   # now incl. flagged_w
    _write_csv(os.path.join(paths.metrics, "failures.csv"), fail_rows)
    conf_review = confidence_review(field_rows)
    conf_review_w = confidence_review(field_rows, flag_key="flagged_w")
    wordness_effect["confidence_review"] = conf_review_w
    aggregates = {"by_template": _agg(metrics, "template_id"),
                  "by_drift_type": _agg(metrics, "drift_type"),
                  "by_doc_type": _agg(metrics, "doc_type"),
                  "by_modality": _agg(metrics, "modality"),
                  "confidence_review": conf_review,
                  "wordness_effect": wordness_effect,
                  "overall": _agg([{**m, "_all": "all"} for m in metrics], "_all")["all"]}
    with open(os.path.join(paths.metrics, "aggregates.json"), "w", encoding="utf-8") as fh:
        json.dump(aggregates, fh, indent=2)
    with open(os.path.join(paths.metrics, "confidence_review.json"), "w", encoding="utf-8") as fh:
        json.dump({"baseline": conf_review, "with_wordness": conf_review_w,
                   "effect": {k: v for k, v in wordness_effect.items() if k != "confidence_review"}},
                  fh, indent=2)
    return {"docs": len(metrics), "failures": len(fail_rows),
            "silent_error_rate": conf_review["all_fields"]["silent_error_rate"],
            "wordness_new_caught": wordness_effect["new_silent_caught"],
            "wordness_new_needless": wordness_effect["new_needless_review"]}


def _manifest_ids(paths):
    ids = []
    if os.path.exists(paths.manifest):
        with open(paths.manifest, encoding="utf-8") as fh:
            ids = [r["doc_id"] for r in csv.DictReader(fh)]
    return ids


def _write_csv(path, rows):
    if not rows:
        open(path, "w").close(); return
    keys = list({k for r in rows for k in r.keys()})
    # stable column order: first row's keys then any extras
    cols = list(rows[0].keys()) + [k for k in keys if k not in rows[0]]
    with open(path, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})
