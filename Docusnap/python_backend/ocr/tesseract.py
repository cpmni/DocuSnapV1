"""
ocr/tesseract.py
----------------
Tesseract OCR wrapper. Handles both PDF and image files.
"""

import os
from pathlib import Path

import pytesseract
import pypdfium2 as pdfium
from PIL import Image


def configure(tesseract_path: str | None = None):
    """Set Tesseract executable path if not on system PATH."""
    if tesseract_path and os.path.exists(tesseract_path):
        pytesseract.pytesseract.tesseract_cmd = tesseract_path


def ocr_image(img: Image.Image, config: str = "--oem 3 --psm 6") -> str:
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


def extract_text_and_images(filepath: Path) -> tuple[str, list[Image.Image]]:
    """
    Extract OCR text from a document file.
    Returns (full_text, list_of_page_images).
    Page images are kept for logo matching and zone OCR.
    """
    ext    = filepath.suffix.lower()
    texts  = []
    pages  = []

    if ext == ".pdf":
        pages = pdf_to_images(filepath)
        for page in pages:
            texts.append(ocr_image(page))
    else:
        img = Image.open(filepath)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        pages = [img]
        texts.append(ocr_image(img))

    return "\n\n--- PAGE BREAK ---\n\n".join(texts), pages


SUPPORTED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp"
}
