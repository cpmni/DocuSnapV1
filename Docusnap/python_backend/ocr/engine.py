"""
ocr/engine.py — full-page OCR engine selection + safe Tesseract fallback (Stage 1).

SCOPE: this governs ONLY full-page document OCR (ocr.tesseract.extract_text_and_images).
Crop/zone/anchor/landmark OCR deliberately stays on Tesseract (pytesseract directly) and
is NOT routed through here — those paths depend on Tesseract's word-level image_to_data
boxes + 0-100 confidence and PSM single-line modes, which RapidOCR (line-level boxes +
0-1 scores, no PSM) does not provide. See CLAUDE.md.

DEFAULT IS TESSERACT and byte-identical: get_engine(None | 'tesseract' | anything-unknown)
-> TesseractEngine, whose read_page is exactly the previous inline
ocr_image(preprocess_for_ocr(...)) call. RapidOCR is opt-in ('rapidocr'); ANY
import/init/runtime failure falls back to Tesseract with a {"type":"log","level":"warn"}
line on stdout (the processing handler already surfaces those).
"""

import json


def _log(level, text):
    """Emit a process-progress log line on the same stdout channel/shape process_docs uses."""
    try:
        print(json.dumps({"type": "log", "level": level, "text": text}), flush=True)
    except Exception:
        pass


class TesseractEngine:
    """Full-page OCR via Tesseract — the historical path, kept byte-identical."""
    name = "tesseract"

    def read_page(self, img, enhance_params=None):
        # Lazy import to avoid any import cycle with ocr.tesseract.
        from ocr.tesseract import ocr_image, preprocess_for_ocr
        return ocr_image(preprocess_for_ocr(img, enhance_params))


class RapidOcrEngine:
    """Full-page OCR via RapidOCR (ONNX). Its detector handles skew/orientation, so the
    deskew/threshold enhance steps are intentionally skipped here. Any failure
    (import / init / inference) falls back to Tesseract for that page."""
    name = "rapidocr"

    def __init__(self, use_cls=True, intra_op_num_threads=None):
        self._engine = None  # constructed lazily in _ensure()
        # Speed knobs (RapidOCR-only; Tesseract path ignores them). use_cls=False
        # skips the angle-classifier pass per page — faster, assumes upright pages
        # (the detector still corrects skew; only ~180° flips are missed). Set by
        # the app in Fast mode. intra_op_num_threads caps the onnxruntime thread
        # pool so several parallel workers don't each grab every core and thrash
        # (None/<=0 = onnxruntime default = all cores, best single-doc latency).
        self._use_cls = use_cls
        self._intra_op_num_threads = intra_op_num_threads

    def _ensure(self):
        if self._engine is None:
            from rapidocr_onnxruntime import RapidOCR   # may raise ImportError
            kwargs = dict(self._local_model_kwargs())
            if self._intra_op_num_threads and self._intra_op_num_threads > 0:
                # RapidOCR's UpdateParameters routes a Global intra_op_num_threads
                # down to the Det/Cls/Rec ONNX sessions.
                kwargs["intra_op_num_threads"] = int(self._intra_op_num_threads)
            try:
                self._engine = RapidOCR(**kwargs) if kwargs else RapidOCR()  # may raise (missing model / DLL)
            except TypeError:
                # Installed RapidOCR build doesn't accept a kwarg -> retry with the
                # local model paths only, then bare. Either way uses the bundled
                # offline models (no download).
                mk = self._local_model_kwargs()
                try:
                    self._engine = RapidOCR(**mk) if mk else RapidOCR()
                except TypeError:
                    self._engine = RapidOCR()
        return self._engine

    @staticmethod
    def _local_model_kwargs():
        """OPTIONAL explicit offline model paths from the RAPIDOCR_MODEL_DIR env var.

        Returns {} (the default) when unset or incomplete — in which case RapidOCR uses
        the PP-OCR models bundled INSIDE the rapidocr-onnxruntime wheel
        (site-packages/rapidocr_onnxruntime/models/), which are already on disk and need
        NO download. Set RAPIDOCR_MODEL_DIR to a folder containing det.onnx, rec.onnx and
        cls.onnx to point at your own local models instead. Never triggers a network fetch.
        See python_backend/OCR_RUNTIME.md.
        """
        import os
        d = os.environ.get("RAPIDOCR_MODEL_DIR")
        if not d:
            return {}
        from pathlib import Path
        base = Path(d)
        det, rec, cls = base / "det.onnx", base / "rec.onnx", base / "cls.onnx"
        if det.exists() and rec.exists() and cls.exists():
            return {"det_model_path": str(det), "rec_model_path": str(rec),
                    "cls_model_path": str(cls)}
        return {}

    def read_page(self, img, enhance_params=None):
        try:
            import numpy as np
            eng = self._ensure()
            # RapidOCR does its own detection/orientation — feed greyscale and do NOT
            # pre-deskew/threshold (those fight its detector). The autocontrast/denoise
            # enhance_params are not applied at this full-page stage either.
            g = img.convert("L") if img.mode != "L" else img
            out = eng(np.array(g), use_cls=self._use_cls)
            result = out[0] if isinstance(out, tuple) else out
            if not result:
                return ""
            # Each row: [box(4 pts), text, score]. Rebuild reading order (row buckets
            # top-to-bottom, then left-to-right) so downstream keyword/anchor text
            # search sees Tesseract-like line order.
            rows = []
            for item in result:
                box, text = item[0], item[1]
                ys = [float(p[1]) for p in box]
                xs = [float(p[0]) for p in box]
                rows.append((min(ys), min(xs), text))
            rows.sort(key=lambda r: (round(r[0] / 10.0), r[1]))
            return "\n".join(t for _y, _x, t in rows)
        except Exception as e:
            _log("warn", f"RapidOCR failed on a page ({e.__class__.__name__}: {e}); "
                         f"using Tesseract for this page.")
            return TesseractEngine().read_page(img, enhance_params)


def get_engine(name=None, *, probe=True, use_cls=True, intra_op_num_threads=None):
    """Select a full-page OCR engine.

    Default / unknown / 'tesseract' -> TesseractEngine (byte-identical).
    'rapidocr' -> RapidOcrEngine if it imports + initialises, else TesseractEngine (logged).
    `probe` (default True) performs the one-time import/init up front, so a missing wheel
    or model degrades cleanly BEFORE processing rather than once per page.
    `use_cls`/`intra_op_num_threads` are RapidOCR-only speed knobs (the Tesseract path
    ignores them); the defaults (cls on, no thread cap) are byte-identical to before.
    """
    if (name or "tesseract").strip().lower() != "rapidocr":
        return TesseractEngine()
    engine = RapidOcrEngine(use_cls=use_cls, intra_op_num_threads=intra_op_num_threads)
    if probe:
        try:
            engine._ensure()
        except Exception as e:
            _log("warn", f"RapidOCR unavailable ({e.__class__.__name__}: {e}); "
                         f"falling back to Tesseract for full-page OCR.")
            return TesseractEngine()
    return engine
