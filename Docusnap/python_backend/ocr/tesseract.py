"""
ocr/tesseract.py
----------------
Tesseract OCR wrapper. Handles both PDF and image files.
"""

import os
from pathlib import Path

import pytesseract
import pypdfium2 as pdfium
from PIL import Image, ImageOps, ImageFilter

# Noise-cleanup slider levels (1-3) → PIL MedianFilter kernel size.
# Larger kernels remove more speckle but blur fine text more.
NOISE_FILTER_SIZES = {1: 3, 2: 5, 3: 7}


def configure(tesseract_path: str | None = None):
    """Set Tesseract executable path if not on system PATH."""
    if tesseract_path and os.path.exists(tesseract_path):
        pytesseract.pytesseract.tesseract_cmd = tesseract_path


def ocr_image(img: Image.Image, config: str = "--oem 3 --psm 3") -> str:
    """Run Tesseract OCR on a PIL image."""
    return pytesseract.image_to_string(img, config=config)


def pdf_to_images(filepath: Path, dpi: int = 300) -> list[Image.Image]:
    """Convert each PDF page to a PIL Image using pypdfium2."""
    doc    = pdfium.PdfDocument(str(filepath))
    images = []
    for page in doc:
        bitmap = page.render(scale=dpi / 72)
        images.append(bitmap.to_pil())
    return images


def _deskew(img: Image.Image) -> Image.Image:
    """
    Detect and correct small-angle document skew via horizontal projection variance.
    Operates on a downscaled binary copy for speed; rotation applied to the original
    at full resolution. Skew below 0.2° is ignored to avoid spurious micro-rotations.
    """
    import numpy as np

    gray   = img.convert('L') if img.mode != 'L' else img
    binary = gray.point(lambda p: 0 if p < 128 else 255)

    w, h  = binary.size
    scale = min(1.0, 800.0 / max(w, h))
    small = binary.resize((int(w * scale), int(h * scale)), Image.LANCZOS) if scale < 1.0 else binary
    arr   = np.array(small)

    def _score(deg: float) -> float:
        rot  = Image.fromarray(arr).rotate(deg, expand=False, fillcolor=255)
        proj = np.sum(np.array(rot) < 128, axis=1).astype(np.float64)
        return float(np.var(proj))

    # Coarse sweep: -15 to +15 degrees in 0.5-degree steps (61 iterations)
    coarse = [a * 0.5 for a in range(-30, 31)]
    best   = max(coarse, key=_score)

    # Fine sweep: ±0.5 around coarse best in 0.1-degree steps (11 iterations)
    base = round(best * 10)
    fine = [(base + d) / 10.0 for d in range(-5, 6)]
    best = max(fine, key=_score)

    if abs(best) < 0.2:
        return img  # no meaningful skew

    fill = 255 if img.mode == 'L' else (255, 255, 255)
    return img.rotate(best, expand=False, fillcolor=fill, resample=Image.BICUBIC)


def preprocess_for_ocr(img: Image.Image, params: dict | None) -> Image.Image:
    """
    Apply OCR preprocessing in a fixed pipeline order.
    params keys: grayscale (bool), autocontrast (bool), deskew (bool),
                 threshold (bool), threshold_level (int 50-220),
                 noise_level (int 0-3, 0 = off).
    Returns img unchanged when params is None or all options are falsy.
    Pipeline order is fixed here and must not be controlled by the caller.
    """
    if not params:
        return img

    # Normalise exotic modes (RGBA, P, etc.) before any operation
    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')

    # 1. Grayscale — required before autocontrast and threshold
    if params.get('grayscale') or params.get('autocontrast') or params.get('threshold'):
        if img.mode != 'L':
            img = img.convert('L')

    # 1.5. Noise cleanup / despeckle — median filter, before autocontrast/deskew
    # so contrast stretching and skew detection aren't thrown off by speckle.
    noise_level = int(params.get('noise_level') or 0)
    if noise_level > 0:
        size = NOISE_FILTER_SIZES.get(max(1, min(3, noise_level)), 3)
        img  = img.filter(ImageFilter.MedianFilter(size=size))

    # 2. Autocontrast / contrast normalisation
    if params.get('autocontrast'):
        img = ImageOps.autocontrast(img, cutoff=2)

    # 3. Deskew — after grayscale (projects well on grey), before threshold
    if params.get('deskew'):
        img = _deskew(img)

    # 4. Threshold / binarize
    if params.get('threshold'):
        level = max(1, min(254, int(params.get('threshold_level', 128))))
        img   = img.point(lambda p: 255 if p > level else 0)

    return img


def extract_text_and_images(
    filepath: Path,
    enhance_params: dict | None = None,
    born_digital: bool = False,
) -> tuple[str, list[Image.Image]]:
    """
    Extract OCR text from a document file.
    Returns (full_text, list_of_page_images).

    page_images are the original unenhanced images, kept for logo matching and
    zone OCR.  enhance_params, when provided, are applied only to the OCR text
    extraction pass — the returned pages are always the raw render.

    born_digital (default off): when on, a PDF page that carries a real embedded
    text layer (a generated invoice/statement) contributes its EXACT vector text
    instead of an OCR read — faster and exact. Image-only/scanned pages have no
    text layer and fall back to OCR unchanged. The page IMAGES are still rendered
    either way (logo/anchor/zone OCR need them). Gated by 'born_digital_enabled'.
    """
    ext   = filepath.suffix.lower()
    texts = []
    pages = []

    if ext == ".pdf":
        import pypdfium2 as pdfium
        from ocr import born_digital as _bd
        doc = pdfium.PdfDocument(str(filepath))
        for page in doc:
            img = page.render(scale=300 / 72).to_pil()
            pages.append(img)
            layer_text = None
            if born_digital:
                try:
                    ok, _n, _txt = _bd.assess_page(page)
                    if ok:
                        # Positional reading order (page_lines), not the layer's raw
                        # char order, so label-adjacency keyword extraction matches OCR.
                        layer_text = _bd.page_text(page)
                except Exception:
                    layer_text = None   # any text-layer failure -> OCR fallback
            texts.append(layer_text if layer_text is not None
                         else ocr_image(preprocess_for_ocr(img, enhance_params)))
    else:
        img = Image.open(filepath)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        pages = [img]
        texts.append(ocr_image(preprocess_for_ocr(img, enhance_params)))

    return "\n\n--- PAGE BREAK ---\n\n".join(texts), pages


SUPPORTED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp"
}
