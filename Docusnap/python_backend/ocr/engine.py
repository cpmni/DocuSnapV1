"""
ocr/engine.py — full-page OCR engine (Tesseract).

SCOPE: this governs ONLY full-page document OCR (ocr.tesseract.extract_text_and_images).
Crop/zone/anchor/landmark OCR uses Tesseract directly (pytesseract) and is NOT routed
through here — those paths depend on Tesseract's word-level image_to_data boxes + 0-100
confidence and PSM single-line modes.

Full-page OCR is TESSERACT ONLY. get_engine() returns TesseractEngine for ANY argument
(a stale 'rapidocr' name from an old setting is tolerated -> Tesseract), so callers never
break. TesseractEngine.read_page rebuilds full-page text from word GEOMETRY
(reconstruct_page_text).
"""

import json


def _log(level, text):
    """Emit a process-progress log line on the same stdout channel/shape process_docs uses."""
    try:
        print(json.dumps({"type": "log", "level": level, "text": text}), flush=True)
    except Exception:
        pass


class TesseractEngine:
    """Full-page OCR via Tesseract."""
    name = "tesseract"

    def read_page(self, img, enhance_params=None, dpi=None, words_out=None):
        # Lazy import to avoid any import cycle with ocr.tesseract. Full-page text is
        # rebuilt from word GEOMETRY (reconstruct_page_text) so a right-aligned totals
        # value stays on its label's line instead of being stranded in a separate column
        # by Tesseract's page segmentation — see reconstruct_page_text. Falls back to
        # ocr_image on any error. `dpi` (the render/scan DPI) is passed to Tesseract so it
        # doesn't guess the scale and drop sparse cells at 300 DPI — see _with_dpi.
        # `words_out` (opt-in, default None ⇒ byte-identical): the geometry hand-off dict
        # reconstruct_page_text fills — see its contract (image-natural px, top-left).
        from ocr.tesseract import reconstruct_page_text, preprocess_for_ocr
        return reconstruct_page_text(preprocess_for_ocr(img, enhance_params), dpi=dpi,
                                     words_out=words_out)


def get_engine(name=None, *, probe=True, use_cls=True, intra_op_num_threads=None):
    """Return the full-page OCR engine. Full-page OCR is Tesseract only; every argument is
    accepted for caller compatibility and ignored — any name (including a stale 'rapidocr'
    from an old ocr_engine setting) returns TesseractEngine."""
    return TesseractEngine()
