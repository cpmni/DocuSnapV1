"""Agent 6 — Reporter.

Reads the metrics artifacts and writes a human-readable report.md + machine-readable
report.json, plus CSVs (inventory, problem tally, failure buckets). Tallies problems by
OCCURRENCE COUNT (not just examples), lists thresholded failure buckets and the top-20
failure modes with representative doc ids + average metric, names coverage gaps, and
records exact reproduction commands. Suggests fixes only — never auto-remediates.
"""
from __future__ import annotations
import csv
import json
import os
from collections import Counter, defaultdict

# Mode -> (short description, suggested fix). Suggestions only; no code is changed.
PROBLEMS = {
    "engine_error": ("Pipeline raised / returned no text",
        "Near-blank or unreadable scans abort with 'OCR returned no text'. Add a "
        "low-text guard that still emits a needs_review record instead of an error, "
        "and a preprocessing escalation (the light->heavy ladder) for faint pages."),
    "ocr_high_cer": ("Character error rate over 20%",
        "Concentrated in low-quality/drifted scans. Trigger the heavier OCR recipe "
        "(denoise + Sauvola) on low mean-confidence pages before extraction."),
    "ocr_high_wer": ("Word error rate over 30%",
        "Same population as high CER; word-level breakage also implies layout/segment "
        "splitting. Consider deskew before OCR for rotated/skewed pages."),
    "wrong_doc_type": ("Document type detected incorrectly",
        "Types outside the 3 built-ins (receipt/statement/delivery/remittance/letter/"
        "form) have no shipped keyword detector and fall back. Seed keyword patterns or "
        "teach a template per type so Stage 0 can classify them."),
    "field_value_mismatch": ("Field value read but wrong",
        "Inspect by field: currency totals often differ only by a stripped symbol "
        "(loose-match passes) — confirm the desired normalisation; alphanumeric refs "
        "differing are genuine OCR glyph errors for the heavy/degraded subset."),
    "field_value_missing": ("Field expected but not extracted",
        "Supplier identity (from the header/logo) is unresolved with no learned logo "
        "fingerprints; totals are sometimes missed when the 'Total' row sits low. A "
        "teaching pass (logos + anchors) is the intended remedy."),
    "value_bbox_low_iou": ("Value localised far from ground truth",
        "Predominantly drifted (shift/rotate/skew) pages — the value moved but the read "
        "didn't follow. This is exactly what Stage 0.5 registration / anchor relocation "
        "targets; verify those rungs fire on these variants."),
    "anchor_missed": ("Expected anchor token not found in OCR",
        "The label was not read at all (degraded text) or read with different glyphs. "
        "Escalate the label crop OCR recipe and allow fuzzy anchor matching."),
    "anchor_high_loc_err": ("Anchor found but drifted beyond threshold",
        "Geometric drift; register the page (landmark transform) before resolving "
        "anchors so positions are mapped back to the taught frame."),
}
RELEVANT_METRIC = {"ocr_high_cer": "CER", "ocr_high_wer": "WER",
                   "value_bbox_low_iou": "IoU", "anchor_high_loc_err": "loc_err",
                   "field_value_mismatch": "ratio", "anchor_missed": "miss_frac"}


def _read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _num(x, default=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def run(cfg, paths, doc_ids=None):
    manifest = _read_csv(paths.manifest)
    per_doc = _read_csv(os.path.join(paths.metrics, "per_doc.csv"))
    failures = _read_csv(os.path.join(paths.metrics, "failures.csv"))
    drift_index = _read_csv(os.path.join(paths.metrics, "drift_index.csv"))
    aggregates = json.load(open(os.path.join(paths.metrics, "aggregates.json"), encoding="utf-8")) \
        if os.path.exists(os.path.join(paths.metrics, "aggregates.json")) else {}
    run_meta = json.load(open(paths.run_meta, encoding="utf-8")) if os.path.exists(paths.run_meta) else {}

    # ── counts ──
    by_modality = Counter(r["modality"] for r in manifest)
    by_type = Counter(r["doc_type"] for r in manifest)
    by_template = Counter(r["template_id"] for r in manifest)
    lq = sum(1 for r in manifest if r.get("low_quality") == "1")
    edges = Counter(r["edge_case"] for r in manifest if r.get("edge_case"))
    drift_by_family = Counter(r["family"] for r in drift_index)
    drift_by_type = Counter(r["drift_type"] for r in drift_index)
    drift_by_sev = Counter(r["severity"] for r in drift_index)

    # ── problem tally (by mode) ──
    tally = defaultdict(lambda: {"count": 0, "docs": [], "metrics": [], "severe": 0})
    for f in failures:
        t = tally[f["mode"]]
        t["count"] += 1
        if len(t["docs"]) < 25:
            t["docs"].append(f["doc_id"])
        mv = _num(f.get("metric"))
        if mv is not None:
            t["metrics"].append(mv)
        t["severe"] += int(f.get("severity") == "severe")
    problem_rows = []
    for mode, t in sorted(tally.items(), key=lambda kv: -kv[1]["count"]):
        desc, fix = PROBLEMS.get(mode, (mode, "Investigate."))
        avg = round(sum(t["metrics"]) / len(t["metrics"]), 4) if t["metrics"] else ""
        problem_rows.append({"problem": mode, "description": desc, "count": t["count"],
                             "severe": t["severe"], "avg_metric": avg,
                             "metric_name": RELEVANT_METRIC.get(mode, ""),
                             "example_doc_ids": ";".join(t["docs"][:10]), "suggested_fix": fix})

    # ── top-20 failure modes by (mode, detail) ──
    combo = defaultdict(lambda: {"count": 0, "docs": [], "metrics": []})
    for f in failures:
        key = (f["mode"], f.get("detail", ""))
        c = combo[key]
        c["count"] += 1
        if len(c["docs"]) < 8:
            c["docs"].append(f["doc_id"])
        mv = _num(f.get("metric"))
        if mv is not None:
            c["metrics"].append(mv)
    top20 = []
    for (mode, detail), c in sorted(combo.items(), key=lambda kv: -kv[1]["count"])[:20]:
        avg = round(sum(c["metrics"]) / len(c["metrics"]), 4) if c["metrics"] else ""
        top20.append({"mode": mode, "detail": detail, "count": c["count"],
                      "avg_metric": avg, "examples": ";".join(c["docs"])})

    # ── thresholded buckets ──
    buckets = {
        "CER>0.20": sum(1 for r in per_doc if (_num(r.get("cer")) or 0) > 0.20),
        "WER>0.30": sum(1 for r in per_doc if (_num(r.get("wer")) or 0) > 0.30),
        "value_IoU<0.50": sum(1 for r in per_doc if (_num(r.get("mean_value_iou")) or 1) < 0.50),
        "anchor_loc_err>0.05": sum(1 for r in per_doc if (_num(r.get("mean_anchor_loc_err")) or 0) > 0.05),
        "wrong_doc_type": sum(1 for r in per_doc if r.get("template_correct") == "0"),
        "engine_error": sum(1 for r in per_doc if r.get("engine_error") == "1"),
    }

    # ── coverage gaps (honest) ──
    stage0 = json.load(open(os.path.join(paths.metrics, "template_anchor.json"), encoding="utf-8")) \
        if os.path.exists(os.path.join(paths.metrics, "template_anchor.json")) else []
    stage0_fired = sum(1 for r in stage0 if r.get("stage0_template_id"))
    gaps = [
        f"Learned-template Stage 0 matching fired on {stage0_fired}/{len(stage0)} docs — a "
        "brand-new corpus has no learned templates/logos, so 'template classification' here "
        "measures keyword DOC-TYPE DETECTION, not Stage 0. Add an optional teaching pass to "
        "exercise true template matching, anchor learning and logo identity.",
        "Supplier identity is resolved via logo/template, which are unlearned here, so "
        "supplier_name reads as missing on most docs (expected, not a regression).",
        "Barcodes/QR are visual stress elements (non-decodable); decode-level metrics are "
        "not computed. Add a real code library for decode testing if required.",
        "RapidOCR A/B pass is configured but not run by default; only Tesseract is benchmarked.",
    ]

    overall = aggregates.get("overall", {})
    summary = {
        "harness_version": run_meta.get("harness_version"),
        "generated": run_meta.get("started_at"),
        "totals": {"docs": len(manifest), **dict(by_modality)},
        "templates": len(by_template), "doc_types": len(by_type),
        "low_quality_docs": lq, "drifted_docs": len(drift_index),
        "overall_metrics": overall, "failure_count": len(failures),
        "buckets": buckets,
        "confidence_review": aggregates.get("confidence_review", {}),
        "wordness_effect": aggregates.get("wordness_effect", {}),
    }

    # ── write CSVs ──
    _write(os.path.join(paths.reports, "inventory.csv"), manifest)
    _write(os.path.join(paths.reports, "problem_tally.csv"), problem_rows)
    _write(os.path.join(paths.reports, "failure_buckets.csv"),
           [{"bucket": k, "count": v} for k, v in buckets.items()])
    _write(os.path.join(paths.reports, "top20_failure_modes.csv"), top20)

    report = {"summary": summary, "counts": {
        "by_modality": dict(by_modality), "by_doc_type": dict(by_type),
        "by_template": dict(by_template), "edge_cases": dict(edges),
        "drift_by_family": dict(drift_by_family), "drift_by_type": dict(drift_by_type),
        "drift_by_severity": dict(drift_by_sev)},
        "aggregates": aggregates, "problem_tally": problem_rows,
        "top20_failure_modes": top20, "buckets": buckets, "coverage_gaps": gaps}
    with open(os.path.join(paths.reports, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    _write_markdown(paths, summary, by_modality, by_type, by_template, edges,
                    drift_by_family, drift_by_type, drift_by_sev, aggregates,
                    problem_rows, top20, buckets, gaps, cfg, run_meta)
    return {"failures": len(failures), "problems": len(problem_rows),
            "report": os.path.join(paths.reports, "report.md")}


def _write(path, rows):
    if not rows:
        open(path, "w").close(); return
    cols = list(rows[0].keys())
    with open(path, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader(); w.writerows(rows)


def _md_table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    for r in rows:
        out.append("| " + " | ".join(str(c) for c in r) + " |")
    return "\n".join(out)


def _write_markdown(paths, s, by_modality, by_type, by_template, edges, dfam, dtype, dsev,
                    agg, problems, top20, buckets, gaps, cfg, run_meta):
    o = []
    o.append("# Synthetic Document Test-Harness Report\n")
    o.append(f"_Harness {s['harness_version']} · generated {s['generated']}_\n")

    o.append("## Executive summary\n")
    om = s["overall_metrics"]
    o.append(f"- **Corpus:** {s['totals']['docs']} docs "
             f"({s['totals'].get('scanned', 0)} scanned-style / {s['totals'].get('text', 0)} text control), "
             f"{s['templates']} templates, {s['doc_types']} doc types.")
    o.append(f"- **Low-quality scans:** {s['low_quality_docs']} · **Drifted variants:** {s['drifted_docs']}.")
    if om:
        o.append(f"- **Overall:** doc-type accuracy {pct(om.get('template_acc'))}, "
                 f"field exact {pct(om.get('field_exact'))}, field fuzzy {pct(om.get('field_fuzzy'))}, "
                 f"mean CER {om.get('cer')}, mean WER {om.get('wer')}, "
                 f"mean value IoU {om.get('mean_value_iou')}, engine-error rate {pct(om.get('engine_error_rate'))}.")
    o.append(f"- **Failures logged:** {s['failure_count']} across {len(problems)} problem types. "
             f"Top problem: {problems[0]['problem'] if problems else 'none'}"
             f"{' (' + str(problems[0]['count']) + ')' if problems else ''}.")
    cr = s.get("confidence_review") or {}
    crall = cr.get("all_fields") or {}
    if crall.get("produced"):
        o.append(f"- **Confidence calibration:** mean confidence {crall.get('mean_conf_correct')}% on "
                 f"correct reads vs {crall.get('mean_conf_wrong')}% on wrong reads; "
                 f"silent-error rate {pct(crall.get('silent_error_rate'))} "
                 f"(wrong values auto-accepted), needless-review rate {pct(crall.get('needless_review_rate'))}.")
    o.append("- This harness **suggests fixes only** — it changed no documents and no production code.\n")

    if crall.get("produced"):
        o.append("## Confidence & review calibration\n")
        o.append(f"_A field counts as 'flagged for review' when confidence < {cr.get('threshold')} "
                 "OR it carries a validation note / correction candidate — the signals the Review UI "
                 "surfaces. Scored over values the engine actually produced._\n")
        cols = ["Scope", "Produced", "Accuracy", "Conf (correct)", "Conf (wrong)",
                "Silent-err", "Needless-rev", "Caught/Missed wrong"]
        rows = []
        for label, key in (("All fields", "all_fields"),
                           ("Date fields", "date_fields"),
                           ("Non-date fields", "non_date_fields")):
            b = cr.get(key) or {}
            if not b.get("produced"):
                continue
            rows.append([label, b.get("produced"), pct(b.get("accuracy")),
                         f"{b.get('mean_conf_correct')}%", f"{b.get('mean_conf_wrong')}%",
                         f"{pct(b.get('silent_error_rate'))} ({b.get('silent_error')})",
                         f"{pct(b.get('needless_review_rate'))} ({b.get('needless_review')})",
                         f"{b.get('caught_error')}/{b.get('silent_error')}"])
        o.append(_md_table(cols, rows) + "\n")

    we = s.get("wordness_effect") or {}
    if we.get("model_available"):
        crw = (we.get("confidence_review") or {}).get("all_fields") or {}
        o.append("## Wordness gate — counterfactual (name fields)\n")
        o.append("_Flag-only character-language signal on free-text NAME fields "
                 "(supplier/customer). Measured by OR-ing its review flag onto the baseline "
                 "engine output — faithful because the gate never changes the winning value._\n")
        o.append(f"- name-field reads considered: **{we.get('name_fields_considered')}**")
        o.append(f"- previously-silent errors now **caught**: **{we.get('new_silent_caught')}**")
        o.append(f"- correct names wrongly flagged (needless review): **{we.get('new_needless_review')}**")
        if crall.get("produced") and crw:
            o.append(f"- all-fields silent-error rate: {pct(crall.get('silent_error_rate'))} "
                     f"→ **{pct(crw.get('silent_error_rate'))}** with wordness; "
                     f"caught errors {crall.get('caught_error')} → **{crw.get('caught_error')}**.")
        o.append("")

    o.append("## Coverage\n")
    o.append(_md_table(["Modality", "Docs"], list(by_modality.items())) + "\n")
    o.append(_md_table(["Doc type", "Docs"], list(by_type.items())) + "\n")
    o.append(_md_table(["Template", "Docs"], list(by_template.items())) + "\n")
    if edges:
        o.append("**Edge cases:** " + ", ".join(f"{k} ({v})" for k, v in edges.items()) + "\n")
    if dtype:
        o.append("**Drift — by family:** " + ", ".join(f"{k} ({v})" for k, v in dfam.items()))
        o.append("**Drift — by type:** " + ", ".join(f"{k} ({v})" for k, v in dtype.items()))
        o.append("**Drift — by severity:** " + ", ".join(f"{k} ({v})" for k, v in dsev.items()) + "\n")

    o.append("## Thresholded failure buckets\n")
    o.append(_md_table(["Bucket", "Docs"], list(buckets.items())) + "\n")

    o.append("## Problem tally (by occurrence)\n")
    rows = [[p["problem"], p["count"], p["severe"],
             f"{p['avg_metric']} {p['metric_name']}".strip(),
             p["example_doc_ids"][:60]] for p in problems]
    o.append(_md_table(["Problem", "Count", "Severe", "Avg metric", "Example doc ids"], rows) + "\n")
    o.append("### Suggested fixes\n")
    for p in problems:
        o.append(f"- **{p['problem']}** ({p['count']}× — {p['description']}): {p['suggested_fix']}")
    o.append("")

    o.append("## Top 20 failure modes\n")
    rows = [[t["mode"], t["detail"], t["count"], t["avg_metric"], t["examples"][:50]] for t in top20]
    o.append(_md_table(["Mode", "Detail", "Count", "Avg metric", "Examples"], rows) + "\n")

    o.append("## Per-template metrics\n")
    o.append(_agg_table(agg.get("by_template", {})) + "\n")
    o.append("## Per-doc-type metrics\n")
    o.append(_agg_table(agg.get("by_doc_type", {})) + "\n")
    o.append("## Drift-induced degradation\n")
    o.append(_agg_table(agg.get("by_drift_type", {})) + "\n")
    o.append("## Scanned vs text control\n")
    o.append(_agg_table(agg.get("by_modality", {})) + "\n")

    o.append("## Coverage gaps & caveats\n")
    for g in gaps:
        o.append(f"- {g}")
    o.append("")

    o.append("## Reproducibility\n")
    o.append("```")
    o.append(f"harness    : {s['harness_version']}")
    o.append(f"python     : {run_meta.get('python')}   pillow {run_meta.get('pillow')}   numpy {run_meta.get('numpy')}")
    o.append(f"seed       : {cfg.get('seed')}   render_dpi {cfg.get('render_dpi')}   ocr_engines {cfg.get('ocr_engines')}")
    o.append(f"split      : {cfg.get('scanned_docs')} scanned / {cfg.get('text_docs')} text")
    o.append("")
    o.append("# regenerate the whole corpus + rerun every agent")
    o.append("cd python_backend")
    o.append("py -3.12 -m test_harness.run --config artifacts/test_harness/config.json")
    o.append("")
    o.append("# rerun a single document end-to-end (e.g. revalidate one failure)")
    o.append("py -3.12 -m test_harness.run --doc-id DOC_000123 --steps ocr template validate report")
    o.append("```")
    o.append("\n### Artifact layout")
    o.append("```")
    o.append("artifacts/test_harness/")
    o.append("  config.json  run_meta.json  manifest.csv")
    o.append("  corpus/<doc_id>/{document.pdf, ground_truth.json, pages/}")
    o.append("  ocr/<doc_id>/{raw_ocr.json[.gz], extraction.json}")
    o.append("  metrics/{per_doc.csv, fields.csv, failures.csv, template_anchor.csv, drift_index.csv, aggregates.json}")
    o.append("  reports/{report.md, report.json, inventory.csv, problem_tally.csv, failure_buckets.csv, top20_failure_modes.csv}")
    o.append("```")

    with open(os.path.join(paths.reports, "report.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(o))


def _agg_table(d):
    if not d:
        return "_(none)_"
    rows = [[k, v["docs"], pct(v.get("template_acc")), pct(v.get("field_exact")),
             v.get("cer"), v.get("wer"), v.get("mean_value_iou"), pct(v.get("engine_error_rate"))]
            for k, v in d.items()]
    return _md_table(["Group", "Docs", "TypeAcc", "FieldExact", "CER", "WER", "ValueIoU", "EngineErr"], rows)


def pct(x):
    return "—" if x is None else f"{x * 100:.0f}%"
