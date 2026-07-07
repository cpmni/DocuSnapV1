"""Config schema, defaults, and the shared artifact-directory layout."""
from __future__ import annotations
import json
import os

# Default config — mirrors the spec's example. Everything is overridable via the
# --config JSON. Counts are honoured exactly; the 900/100 scanned/text split is fixed.
DEFAULT_CONFIG = {
    "total_docs": 1000,
    "scanned_docs": 900,
    "text_docs": 100,
    "templates": 8,
    "drift_pct": 10,            # >= 10% of the corpus carries a drift variant
    "low_quality_pct": 20,      # >= 20% of the SCANNED corpus gets low-quality effects
    "include_handwritten": True,
    "include_tables": True,
    "include_barcodes": True,
    "include_ocr_noise": True,
    "languages": ["en"],
    "output_dir": "artifacts/test_harness",
    "seed": 42,
    # --- harness runtime knobs (not in the spec example, sensible defaults) ---
    "render_dpi": 150,          # scanned-page raster DPI (file-size vs detail trade-off)
    "keep_page_images": True,   # also save per-page PNGs (off => smaller artifacts)
    "ocr_engines": ["tesseract"],   # benchmark set (full-page OCR is Tesseract only)
    "tesseract_path": r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    "gzip_ocr_json": True,
}


def load_config(path: str | None) -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if path and os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as fh:
            cfg.update(json.load(fh) or {})
    # Invariants the spec fixes.
    cfg["scanned_docs"] = int(cfg.get("scanned_docs", 900))
    cfg["text_docs"] = int(cfg.get("text_docs", 100))
    cfg["total_docs"] = cfg["scanned_docs"] + cfg["text_docs"]
    return cfg


def save_config(cfg: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)


class Paths:
    """Resolved artifact layout under output_dir. One place so every agent agrees."""
    def __init__(self, cfg: dict):
        self.root = os.path.abspath(cfg["output_dir"])
        self.corpus = os.path.join(self.root, "corpus")        # per-doc: document.pdf + ground_truth.json + pages/
        self.ocr = os.path.join(self.root, "ocr")              # per-doc raw + structured OCR output
        self.metrics = os.path.join(self.root, "metrics")      # CSVs
        self.reports = os.path.join(self.root, "reports")      # report.md / report.json
        self.logos = os.path.join(self.root, "logos")          # one PNG per company logo_id
        self.manifest = os.path.join(self.root, "manifest.csv")
        self.run_meta = os.path.join(self.root, "run_meta.json")  # versions/seeds for reproducibility

    def ensure(self):
        for p in (self.root, self.corpus, self.ocr, self.metrics, self.reports, self.logos):
            os.makedirs(p, exist_ok=True)
        return self

    def doc_dir(self, doc_id: str) -> str:
        return os.path.join(self.corpus, doc_id)

    def gt_path(self, doc_id: str) -> str:
        return os.path.join(self.doc_dir(doc_id), "ground_truth.json")

    def pdf_path(self, doc_id: str) -> str:
        return os.path.join(self.doc_dir(doc_id), "document.pdf")
