#!/usr/bin/env python3
"""
tools/ocr_bake_off.py — RapidOCR vs Tesseract field-level bake-off (READ-ONLY dev tool).

Runs the REAL extraction pipeline (process_docs.py) twice over a corpus — once with
full-page OCR on Tesseract, once on RapidOCR (via the already-landed --ocr-engine flag)
— and scores the extracted fields that matter (company, reference, date, total) plus
doc-type detection and the needs-review flag against the operator-confirmed values in
docusnap.db. The point is an evidence-based answer to "does RapidOCR help, hurt, or make
no meaningful difference for the fields that drive product value?", BEFORE anyone changes
the default engine.

READ-ONLY: it never writes to the app DB and changes no behaviour. It only spawns
process_docs.py (the existing pipeline) and reads confirmed values for ground truth.
The two runs use IDENTICAL training schema, so the engine-to-engine DELTA isolates the
OCR effect.

Usage (dev):
  py -3.12 python_backend/tools/ocr_bake_off.py --folder C:\\corpus [--db <docusnap.db>]
      [--tesseract "C:\\Program Files\\Tesseract-OCR\\tesseract.exe"] [--out bakeoff-out]
      [--mode fast]

Outputs <out>/bakeoff.json + <out>/bakeoff.csv and prints an aggregate summary.

NOTE: if RapidOCR isn't installed in this Python, the pipeline cleanly falls back to
Tesseract — the tool DETECTS this (a warn log) and flags that the RapidOCR column is a
fallback (i.e. identical to Tesseract), so you don't misread the result. Provision per
python_backend/OCR_RUNTIME.md, then re-run.
"""

import argparse
import csv
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # python_backend/
PROCESS_DOCS = ROOT / "process_docs.py"
DEFAULT_CONFIG = ROOT.parent / "config" / "keyword_patterns.json"
DEFAULT_TESS = os.environ.get("TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe")
FIELDS = ("company", "reference", "date", "total")
ENGINES = ("tesseract", "rapidocr")


# ── value normalisers (consistent across BOTH engines, so the comparison is fair) ──
def _norm_text(s):
    s = re.sub(r"[^\w\s]", " ", (s or "").lower(), flags=re.UNICODE)
    return re.sub(r"\s+", " ", s).strip()

def _norm_ref(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def _norm_date(s):
    return re.sub(r"\D", "", s or "")

def _norm_money(s):
    m = re.sub(r"[^\d.]", "", (s or "").replace(",", ""))
    try:
        return f"{float(m):.2f}" if m else ""
    except ValueError:
        return ""

_NORM = {"company": _norm_text, "reference": _norm_ref, "date": _norm_date, "total": _norm_money}


def score(truth, value, kind):
    """exact (raw equal) | match (normalised equal) | mismatch | missing | no_truth."""
    if truth is None or str(truth).strip() == "":
        return "no_truth"
    if value is None or str(value).strip() == "":
        return "missing"
    if str(value).strip() == str(truth).strip():
        return "exact"
    n = _NORM[kind]
    nv = n(str(value))
    if nv and nv == n(str(truth)):
        return "match"
    return "mismatch"


# ── ground truth + schema from the app DB (read-only) ─────────────────────────────
def load_truth(db_path):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    truth = {}
    rows = con.execute(
        """SELECT d.id, d.original_filename, d.supplier_name, d.reference_number, d.doc_date,
                  dt.name AS dt_name, dt.ref_field_key, dt.date_field_key
           FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
           WHERE d.status = 'confirmed'"""
    ).fetchall()
    for r in rows:
        total = None
        try:
            er = con.execute(
                """SELECT display_value, corrected_to, was_corrected FROM extractions
                   WHERE document_id = ? AND field_key = 'total_amount' LIMIT 1""", (r["id"],)
            ).fetchone()
            if er:
                total = er["corrected_to"] if (er["was_corrected"] and er["corrected_to"]) else er["display_value"]
        except sqlite3.Error:
            pass
        key = (r["original_filename"] or "").strip().lower()
        if key:
            truth[key] = {
                "company": r["supplier_name"], "reference": r["reference_number"],
                "date": r["doc_date"], "total": total, "doc_type": r["dt_name"],
                "ref_key": r["ref_field_key"], "date_key": r["date_field_key"],
            }
    con.close()
    return truth


def load_doctypes(db_path):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    dts = con.execute("SELECT id, name, slug, ref_field_key, date_field_key FROM document_types").fetchall()
    fields = con.execute("SELECT document_type_id, key, label, type, required FROM fields ORDER BY id").fetchall()
    con.close()
    by_dt, flat = {}, []
    for f in fields:
        fd = {"key": f["key"], "label": f["label"], "type": (f["type"] or "text"), "required": bool(f["required"])}
        by_dt.setdefault(f["document_type_id"], []).append(fd)
        flat.append(fd)
    doc_types = [{"name": d["name"], "slug": d["slug"], "ref_field_key": d["ref_field_key"],
                  "date_field_key": d["date_field_key"], "fields": by_dt.get(d["id"], [])} for d in dts]
    return doc_types, flat


# ── run the real pipeline for one engine ──────────────────────────────────────────
def run_engine(engine, py, folder, dt_file, fields_file, cfg, tess, mode):
    args = [py, str(PROCESS_DOCS), "--folder", str(folder), "--mode", mode,
            "--tesseract", tess, "--doc-types-file", dt_file, "--fields-file", fields_file,
            "--config-file", cfg, "--ocr-engine", engine]
    results, per_file, t_begin = {}, {}, {}
    fellback = False
    start = time.time()
    # stderr -> stdout so non-JSON lines just get skipped (no pipe-buffer deadlock).
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace")
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except (ValueError, json.JSONDecodeError):
            continue
        t = ev.get("type")
        if t == "file_begin":
            t_begin[ev.get("filename")] = time.time()
        elif t == "file_done":
            fn = ev.get("original_filename")
            results[fn] = ev
            if fn in t_begin:
                per_file[fn] = round(time.time() - t_begin[fn], 2)
        elif t == "log" and ev.get("level") == "warn" and "RapidOCR" in (ev.get("text") or ""):
            fellback = True
    proc.wait()
    return {"results": results, "per_file": per_file, "fellback": fellback,
            "total": round(time.time() - start, 2)}


def eng_field(fd, field, ref_key, date_key):
    ex = fd.get("extractions") or {}
    def g(k):
        return (ex.get(k) or {}).get("value") if k else None
    if field == "company":
        return fd.get("supplier_name")
    if field == "reference":
        return g(ref_key) or fd.get("invoice_number")
    if field == "date":
        return g(date_key) or fd.get("invoice_date")
    if field == "total":
        return g("total_amount") or fd.get("total_amount")
    return None


def main():
    ap = argparse.ArgumentParser(description="RapidOCR vs Tesseract field-level bake-off (read-only).")
    ap.add_argument("--folder", required=True, help="corpus folder of real PDFs/images")
    ap.add_argument("--db", default=os.path.join(os.environ.get("APPDATA", ""), "DocuSnap", "docusnap.db"),
                    help="docusnap.db for confirmed ground truth + doc-type schema")
    ap.add_argument("--tesseract", default=DEFAULT_TESS)
    ap.add_argument("--config", default=str(DEFAULT_CONFIG))
    ap.add_argument("--out", default="bakeoff-out")
    ap.add_argument("--mode", default="fast", choices=["fast", "smart"],
                    help="fast (default) isolates OCR+keyword+validation, no AI")
    ap.add_argument("--python", default=sys.executable, help="python used to run process_docs.py")
    args = ap.parse_args()

    folder = Path(args.folder)
    if not folder.is_dir():
        print(f"ERROR: --folder not found: {folder}"); sys.exit(2)
    if not Path(args.db).is_file():
        print(f"ERROR: --db not found: {args.db}"); sys.exit(2)

    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    truth = load_truth(args.db)
    doc_types, fields_flat = load_doctypes(args.db)
    dt_file = str(out / "_doctypes.json"); fields_file = str(out / "_fields.json")
    Path(dt_file).write_text(json.dumps(doc_types), encoding="utf-8")
    Path(fields_file).write_text(json.dumps(fields_flat), encoding="utf-8")

    print(f"Corpus: {folder}  |  confirmed truth docs in DB: {len(truth)}  |  mode: {args.mode}")
    runs = {}
    for eng in ENGINES:
        print(f"  running pipeline with --ocr-engine {eng} ...")
        runs[eng] = run_engine(eng, args.python, folder, dt_file, fields_file, args.config, args.tesseract, args.mode)
        print(f"    {len(runs[eng]['results'])} docs, {runs[eng]['total']}s"
              + ("   [RapidOCR FELL BACK to Tesseract — not installed?]" if runs[eng]["fellback"] else ""))

    # ── score ──
    filenames = sorted(set(runs["tesseract"]["results"]) | set(runs["rapidocr"]["results"]))
    agg = {f: {e: {"exact": 0, "match": 0, "mismatch": 0, "missing": 0, "denom": 0} for e in ENGINES} for f in FIELDS}
    dt_agree = {e: {"agree": 0, "denom": 0} for e in ENGINES}
    review = {e: {"yes": 0, "n": 0} for e in ENGINES}
    documents = []
    for fn in filenames:
        tkey = (fn or "").strip().lower()
        gt = truth.get(tkey)
        row = {"filename": fn, "has_truth": gt is not None,
               "doc_type_truth": gt["doc_type"] if gt else None, "per_field": {}, "doc_type": {}, "review": {}, "time": {}}
        for e in ENGINES:
            fd = runs[e]["results"].get(fn)
            row["time"][e] = runs[e]["per_file"].get(fn)
            row["doc_type"][e] = (fd or {}).get("document_type")
            if fd is not None:
                rv = (fd.get("needs_review") is True)
                review[e]["yes" if rv else "n"] += 1
                row["review"][e] = rv
            if gt and fd is not None:
                if gt["doc_type"]:
                    dt_agree[e]["denom"] += 1
                    if (fd.get("document_type") or "") == gt["doc_type"]:
                        dt_agree[e]["agree"] += 1
        for field in FIELDS:
            row["per_field"][field] = {"truth": gt[field] if gt else None}
            for e in ENGINES:
                fd = runs[e]["results"].get(fn) or {}
                val = eng_field(fd, field, gt["ref_key"], gt["date_key"]) if gt else eng_field(fd, field, None, None)
                res = score(gt[field], val, field) if gt else "no_truth"
                row["per_field"][field][e] = {"value": val, "result": res}
                if res != "no_truth":
                    agg[field][e]["denom"] += 1
                    if res in ("exact", "match", "mismatch", "missing"):
                        agg[field][e][res] += 1
        documents.append(row)

    def rate(c):
        correct = c["exact"] + c["match"]
        return (correct, c["denom"], (100.0 * correct / c["denom"] if c["denom"] else 0.0))

    aggregate = {"per_field": {}, "doc_type_agreement": {}, "needs_review_rate": {}, "time_total": {}}
    for field in FIELDS:
        entry = {}
        for e in ENGINES:
            correct, denom, pct = rate(agg[field][e])
            entry[e] = {**agg[field][e], "correct": correct, "rate_pct": round(pct, 1)}
        entry["delta_pct"] = round(entry["rapidocr"]["rate_pct"] - entry["tesseract"]["rate_pct"], 1)
        aggregate["per_field"][field] = entry
    for e in ENGINES:
        da = dt_agree[e]
        aggregate["doc_type_agreement"][e] = {**da, "rate_pct": round(100.0 * da["agree"] / da["denom"], 1) if da["denom"] else 0.0}
        tot = review[e]["yes"] + review[e]["n"]
        aggregate["needs_review_rate"][e] = {**review[e], "rate_pct": round(100.0 * review[e]["yes"] / tot, 1) if tot else 0.0}
        aggregate["time_total"][e] = runs[e]["total"]

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "corpus_folder": str(folder), "db": args.db, "mode": args.mode,
        "engines": list(ENGINES),
        "rapidocr_fellback": runs["rapidocr"]["fellback"],
        "training_note": "schema-only (doc types + fields from DB); no learned anchors/templates/hints. "
                         "Engine-to-engine DELTA isolates the OCR effect; absolute rates are a floor.",
        "documents": documents, "aggregate": aggregate,
    }
    (out / "bakeoff.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    # CSV (one wide row per document)
    cols = ["filename", "has_truth", "doc_type_truth", "tesseract_doctype", "rapidocr_doctype"]
    for field in FIELDS:
        cols += [f"{field}_truth", f"{field}_tesseract", f"{field}_tess_result",
                 f"{field}_rapidocr", f"{field}_rapid_result"]
    cols += ["tesseract_time_s", "rapidocr_time_s", "tesseract_review", "rapidocr_review"]
    with (out / "bakeoff.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); w.writerow(cols)
        for row in documents:
            line = [row["filename"], row["has_truth"], row["doc_type_truth"],
                    row["doc_type"].get("tesseract"), row["doc_type"].get("rapidocr")]
            for field in FIELDS:
                pf = row["per_field"][field]
                line += [pf["truth"], pf["tesseract"]["value"], pf["tesseract"]["result"],
                         pf["rapidocr"]["value"], pf["rapidocr"]["result"]]
            line += [row["time"].get("tesseract"), row["time"].get("rapidocr"),
                     row["review"].get("tesseract"), row["review"].get("rapidocr")]
            w.writerow(line)

    # ── printed summary ──
    print("\n================  BAKE-OFF SUMMARY  ================")
    if runs["rapidocr"]["fellback"]:
        print("!! RapidOCR fell back to Tesseract (runtime not installed). The 'rapidocr' column")
        print("!! equals Tesseract — provision per OCR_RUNTIME.md and re-run for a real comparison.\n")
    scored = sum(1 for d in documents if d["has_truth"])
    print(f"Docs run: {len(documents)}   with confirmed truth: {scored}\n")
    print(f"{'field':<10} {'Tesseract':>16} {'RapidOCR':>16} {'delta':>8}   verdict")
    for field in FIELDS:
        e = aggregate["per_field"][field]
        t, r = e["tesseract"], e["rapidocr"]
        d = e["delta_pct"]
        verdict = "no meaningful diff" if abs(d) < 1.0 else ("RapidOCR BETTER" if d > 0 else "RapidOCR WORSE")
        print(f"{field:<10} {t['correct']:>4}/{t['denom']:<4}({t['rate_pct']:>5.1f}%) "
              f"{r['correct']:>4}/{r['denom']:<4}({r['rate_pct']:>5.1f}%) {d:>+7.1f}%   {verdict}")
    print()
    for e in ENGINES:
        da, rv = aggregate["doc_type_agreement"][e], aggregate["needs_review_rate"][e]
        print(f"  {e:<10} doc-type agreement {da['rate_pct']:>5.1f}%   needs-review {rv['rate_pct']:>5.1f}%   total {aggregate['time_total'][e]}s")
    print(f"\nWrote {out/'bakeoff.json'} and {out/'bakeoff.csv'}")
    print("Reminder: schema-only training — the engine-to-engine delta is the signal; "
          "absolute rates rise with full learned data.")


if __name__ == "__main__":
    main()
