#!/usr/bin/env python3
"""
ocr_region.py — receives a base64 PNG via --image argument, runs focused OCR.
Called by Electron for zone-selection field picking in the review window.
"""
import sys
import argparse
import base64
import tempfile
import os
from io import BytesIO
import pytesseract
from PIL import Image, ImageFilter, ImageOps

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-file', required=True, help='Path to PNG file')
    parser.add_argument('--tesseract', default=None,  help='Path to tesseract.exe')
    args = parser.parse_args()

    if args.tesseract and os.path.exists(args.tesseract):
        pytesseract.pytesseract.tesseract_cmd = args.tesseract

    # Load image from file
    try:
        img = Image.open(args.image_file).convert('L')  # greyscale
    except Exception as e:
        print('', end='')
        return

    # Upscale small crops for better accuracy
    w, h = img.size
    if w < 300:
        scale = max(2, 300 // w)
        img = img.resize((w * scale, h * scale), Image.LANCZOS)

    # Enhance contrast and sharpen
    img = ImageOps.autocontrast(img, cutoff=2)
    img = img.filter(ImageFilter.SHARPEN)

    # PSM 7 = single line (best for field values like invoice numbers, dates)
    # PSM 6 = block (fallback for multiline like addresses)
    text = pytesseract.image_to_string(img, config='--oem 3 --psm 7').strip()
    if not text:
        text = pytesseract.image_to_string(img, config='--oem 3 --psm 6').strip()

    # Clean up common OCR artifacts
    text = text.replace('\n', ' ').replace('\r', '').strip()

    print(text, end='', flush=True)

if __name__ == '__main__':
    main()
