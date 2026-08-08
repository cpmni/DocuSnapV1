"""detect_angle.py — print a document page-0's detected skew angle as JSON.

Used by the TEACH_ANGLE_COMPOSE lazy heal (processing/handler.js buildTrainingArgs):
the pinned teach SAMPLE's working file is rendered RAW (the frame every teach surface
drew on — the working copy is post-auto-rotate) and detect_skew_angle measures the
tilt θ_t that the sample's stored teach coords carry. Detection is DPI-invariant
(detect_skew_angle downscales internally), so a modest render is fine AND
deterministic — the healed angle equals the display angle whose inverse the teach
surface baked in at draw time.

Usage: python -P detect_angle.py --file <pdf-or-image>
stdout: {"angle": <float degrees, PIL-CCW straighten convention>} — 0.0 = level.
Never writes anywhere; any failure prints {"angle": null}.
"""
import argparse
import json
import os
import sys

# Embeddable-python trap: spawned CLIs must re-add the backend root before package imports.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    args = ap.parse_args()
    try:
        from PIL import Image
        from ocr.tesseract import detect_skew_angle
        path = args.file
        if path.lower().endswith(".pdf"):
            import pypdfium2 as pdfium
            doc = pdfium.PdfDocument(path)
            try:
                img = doc[0].render(scale=150 / 72).to_pil()
            finally:
                doc.close()
        else:
            img = Image.open(path)
        angle = float(detect_skew_angle(img, 0.2))
        print(json.dumps({"angle": angle}))
    except Exception:
        print(json.dumps({"angle": None}))


if __name__ == "__main__":
    main()
