"""Agent 3 — OCR & Detection.

Two passes per document, both saved under ocr/<doc_id>/:
  • raw_ocr.json    — token text + bbox + confidence from Tesseract image_to_data
                      (rendered page pixels), plus the reconstructed page text.
  • extraction.json — the project's OWN pipeline output (process_docs.py): detected
                      doc type, supplier, per-field value/confidence/method, template
                      match. This is what makes Agents 4/5 measure the real system.

The engine runs once over a flat staging folder (the project's batch path), so a 1000
-doc run is a single Python process. Raw OCR renders each PDF with pypdfium2 (BSD) at a
capped scale and reads it with the project's configured Tesseract.
"""
from __future__ import annotations
import gzip
import json
import os
import shutil
import subprocess
import sys

import pypdfium2 as pdfium

from test_harness import fixtures as fx

PROC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "process_docs.py")


def _save(path, obj, gzip_it):
    if gzip_it:
        with gzip.open(path + ".gz", "wt", encoding="utf-8") as fh:
            json.dump(obj, fh)
    else:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=2)


def _raw_ocr_doc(pdf_path, scale, tess_path):
    import pytesseract
    from PIL import Image
    if tess_path:
        pytesseract.pytesseract.tesseract_cmd = tess_path
    pdf = pdfium.PdfDocument(pdf_path)
    pages, all_text = [], []
    for i in range(len(pdf)):
        pil = pdf[i].render(scale=scale).to_pil().convert("RGB")
        W, H = pil.size
        data = pytesseract.image_to_data(pil, output_type=pytesseract.Output.DICT)
        toks = []
        for j, t in enumerate(data["text"]):
            if not t.strip():
                continue
            x, y, w, h = data["left"][j], data["top"][j], data["width"][j], data["height"][j]
            toks.append({"text": t, "conf": float(data["conf"][j]),
                         "bbox_px": [x, y, w, h],
                         "bbox_norm": [round(x / W, 4), round(y / H, 4), round(w / W, 4), round(h / H, 4)],
                         "page": i})
            all_text.append(t)
        pages.append({"page": i, "width": W, "height": H, "tokens": toks})
    confs = [t["conf"] for p in pages for t in p["tokens"] if t["conf"] >= 0]
    return {"pages": pages, "page_text": " ".join(all_text),
            "mean_conf": round(sum(confs) / len(confs), 2) if confs else 0.0,
            "token_count": len(all_text)}


def _run_engine(stage_dir, paths, cfg):
    """Run process_docs.py once over the staging folder; return {doc_id: file_done}."""
    dtf = os.path.join(paths.ocr, "_doc_types.json")
    with open(dtf, "w", encoding="utf-8") as fh:
        json.dump(fx.doc_types_payload(), fh)
    py = sys.executable if "python" in os.path.basename(sys.executable).lower() else "py"
    cmd = [py] if py != "py" else ["py", "-3.12"]
    cmd += [PROC, "--folder", stage_dir, "--mode", "fast", "--born-digital",
            "--doc-types-file", dtf]
    if cfg.get("tesseract_path"):
        cmd += ["--tesseract", cfg["tesseract_path"]]
    # Taught run: a teaching pass (test_harness.teach) sets cfg["anchors_file"] so the
    # engine extracts via learned anchors instead of cold. Absent => cold baseline.
    af = cfg.get("anchors_file")
    if af and os.path.isfile(af):
        cmd += ["--anchors-file", af]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    results = {}
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        if msg.get("type") == "file_done":
            doc_id = os.path.splitext(msg.get("original_filename", ""))[0]
            results[doc_id] = msg
    return results, proc.stderr


def run(cfg, paths, doc_ids=None):
    """OCR + extraction for all (or the given) docs. Returns a small summary dict."""
    gzip_it = bool(cfg.get("gzip_ocr_json", True))
    scale = float(cfg.get("ocr_render_dpi", cfg.get("render_dpi", 150))) / 72.0
    corpus = paths.corpus
    ids = doc_ids or sorted(d for d in os.listdir(corpus) if os.path.isdir(os.path.join(corpus, d)))

    # 1) Stage every PDF flat as <doc_id>.pdf, then run the engine once.
    stage = os.path.join(paths.ocr, "_stage")
    if os.path.isdir(stage):
        shutil.rmtree(stage)
    os.makedirs(stage, exist_ok=True)
    for did in ids:
        src = os.path.join(corpus, did, "document.pdf")
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(stage, did + ".pdf"))
    engine_out, stderr = _run_engine(stage, paths, cfg)
    if stderr and stderr.strip():
        with open(os.path.join(paths.ocr, "_engine_stderr.log"), "w", encoding="utf-8") as fh:
            fh.write(stderr)

    # 2) Per-doc raw OCR + persist both outputs.
    errors = []
    for did in ids:
        odir = os.path.join(paths.ocr, did)
        os.makedirs(odir, exist_ok=True)
        pdf_path = os.path.join(corpus, did, "document.pdf")
        try:
            raw = _raw_ocr_doc(pdf_path, scale, cfg.get("tesseract_path"))
        except Exception as e:
            raw = {"pages": [], "page_text": "", "mean_conf": 0.0, "token_count": 0, "error": str(e)}
            errors.append({"doc_id": did, "stage": "raw_ocr", "error": str(e)})
        _save(os.path.join(odir, "raw_ocr.json"), raw, gzip_it)
        ext = engine_out.get(did) or {"error": "engine produced no result", "success": False}
        if not ext.get("success", False):
            errors.append({"doc_id": did, "stage": "engine",
                           "error": ext.get("error", "no result")})
        with open(os.path.join(odir, "extraction.json"), "w", encoding="utf-8") as fh:
            json.dump(ext, fh, indent=2)

    shutil.rmtree(stage, ignore_errors=True)
    summary = {"docs": len(ids), "engine_results": len(engine_out), "errors": errors}
    with open(os.path.join(paths.ocr, "_ocr_summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    return summary
