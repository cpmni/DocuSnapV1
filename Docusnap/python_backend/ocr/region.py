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
    # --boxes: emit JSON {"text":..., "box":[left,top,width,height]} where box is
    # the union of detected word boxes in ORIGINAL (pre-upscale) crop pixels. Used
    # by the ⊕ tool to capture the taught LABEL's position so a drift-invariant
    # label→value offset can be stored. Default (no flag) is unchanged: plain text.
    parser.add_argument('--boxes', action='store_true')
    args = parser.parse_args()

    if args.tesseract and os.path.exists(args.tesseract):
        pytesseract.pytesseract.tesseract_cmd = args.tesseract

    # Load image from file
    try:
        img = Image.open(args.image_file).convert('L')  # greyscale
    except Exception as e:
        print('', end='')
        return

    # Upscale small crops for better accuracy. Track the factor so --boxes can map
    # word boxes back to the caller's ORIGINAL crop coordinates.
    w, h = img.size
    scale = 1
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

    if args.boxes:
        import json
        box = None
        try:
            data = pytesseract.image_to_data(img, config='--oem 3 --psm 6',
                                             output_type=pytesseract.Output.DICT)
            xs, ys, x2s, y2s = [], [], [], []
            for i in range(len(data.get('text', []))):
                if not (data['text'][i] or '').strip():
                    continue
                xs.append(data['left'][i]); ys.append(data['top'][i])
                x2s.append(data['left'][i] + data['width'][i])
                y2s.append(data['top'][i] + data['height'][i])
            if xs:
                # Union of word boxes, mapped back to original (pre-upscale) px.
                l, t = min(xs) / scale, min(ys) / scale
                bw, bh = (max(x2s) - min(xs)) / scale, (max(y2s) - min(ys)) / scale
                box = [l, t, bw, bh]
        except Exception:
            box = None
        print(json.dumps({"text": text, "box": box}), end='', flush=True)
        return

    print(text, end='', flush=True)

if __name__ == '__main__':
    main()
