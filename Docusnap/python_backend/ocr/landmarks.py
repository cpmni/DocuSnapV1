#!/usr/bin/env python3
"""
ocr/landmarks.py — derive registration landmarks from a template's sample page.

A "landmark" is a stable, high-confidence, UNIQUE word on the template's sample
document. At run time these words are re-located on the incoming page and matched
taught->found to fit the registration transform (see extraction/registration.py),
so taught target boxes follow a shifted/skewed/scaled scan.

The selection algorithm is what matters for reliability, so it is a pure function
(`select_landmarks`) tested without OCR. The CLI (`--image-file`) just renders the
words via Tesseract image_to_data and feeds them in.

Why these filters:
  * high confidence  — a misread landmark poisons the fit (RANSAC mitigates, but
    fewer outliers is better);
  * UNIQUE on the page — a token that appears twice is ambiguous to re-locate, so
    it can't be a reliable correspondence; drop all repeats;
  * alphabetic-dominant, length>=3 — dates/amounts/short noise drift or repeat;
    stable LABELS (e.g. "Invoice", "Ticket", a company word) are the good anchors;
  * spatially well-spread — landmarks clustered in one corner give a poorly-
    constrained transform; greedily maximise spread so the fit is stable.
"""

import sys


def _is_word(text):
    t = (text or "").strip()
    if len(t) < 3:
        return False
    alpha = sum(c.isalpha() for c in t)
    return alpha >= max(3, int(len(t) * 0.6))   # alphabetic-dominant


def select_landmarks(words, *, max_n=5, min_conf=80, page_number=0):
    """Pick up to `max_n` stable, unique, well-spread landmarks from `words`.

    `words`: iterable of dicts with text, conf, x_norm, y_norm, w_norm, h_norm
    (coords normalised to the page). Returns a list of landmark dicts ready for
    templates.setLandmarks. Deterministic for a given input."""
    # Confidence + shape filter.
    cand = []
    for w in words:
        try:
            conf = float(w.get("conf"))
        except (TypeError, ValueError):
            continue
        text = (w.get("text") or "").strip()
        if conf < min_conf or not _is_word(text):
            continue
        cand.append({
            "label_text": text,
            "x_norm": float(w["x_norm"]), "y_norm": float(w["y_norm"]),
            "w_norm": float(w["w_norm"]), "h_norm": float(w["h_norm"]),
            "ocr_conf": conf, "page_number": page_number,
        })

    # Drop ambiguous repeats (case-insensitive): a re-locatable landmark must be
    # unique on the page.
    seen = {}
    for c in cand:
        seen[c["label_text"].lower()] = seen.get(c["label_text"].lower(), 0) + 1
    cand = [c for c in cand if seen[c["label_text"].lower()] == 1]
    if not cand:
        return []

    def _centre(c):
        return (c["x_norm"] + c["w_norm"] / 2.0, c["y_norm"] + c["h_norm"] / 2.0)

    # Greedy spatial spread: seed with the highest-confidence word, then repeatedly
    # add the candidate whose nearest already-picked centre is farthest away.
    cand.sort(key=lambda c: c["ocr_conf"], reverse=True)
    picked = [cand[0]]
    pool = cand[1:]
    while pool and len(picked) < max_n:
        best, best_d = None, -1.0
        for c in pool:
            cx, cy = _centre(c)
            d = min((cx - px) ** 2 + (cy - py) ** 2
                    for px, py in (_centre(p) for p in picked))
            if d > best_d:
                best, best_d = c, d
        picked.append(best)
        pool.remove(best)
    return picked


# ── CLI ──────────────────────────────────────────────────────────────────────

def _win_long_path(path):
    """Mirror render/pages.py: bypass Win32 trailing-dot/space normalisation so a
    document filed under e.g. 'Acme Inc.' opens. Path is already absolute."""
    import os
    if os.name != "nt" or path.startswith("\\\\?\\"):
        return path
    if path.startswith("\\\\"):
        return "\\\\?\\UNC\\" + path.lstrip("\\")
    return "\\\\?\\" + path


def _render_page(file_path, page_number, scale=3.0):
    """Render one page of a PDF (or open an image) to a greyscale PIL image at a
    higher scale than the preview (~216 DPI) for better full-page OCR. Coords are
    normalised downstream, so the scale affects OCR quality only."""
    from PIL import Image
    lower = file_path.lower()
    if lower.endswith((".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp")):
        return Image.open(file_path).convert("L")
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(_win_long_path(file_path))
    page = doc[page_number]
    return page.render(scale=scale).to_pil().convert("L")


def _main():
    import argparse
    import json
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default=None, help="source PDF/image of the sample document")
    parser.add_argument("--image-file", default=None, help="pre-rendered PNG of the sample page")
    parser.add_argument("--tesseract", default=None)
    parser.add_argument("--page", type=int, default=0)
    parser.add_argument("--max", type=int, default=5)
    parser.add_argument("--min-conf", type=float, default=80.0)
    args = parser.parse_args()

    import pytesseract
    from PIL import Image
    if args.tesseract:
        pytesseract.pytesseract.tesseract_cmd = args.tesseract

    if args.file:
        img = _render_page(args.file, args.page)
    elif args.image_file:
        img = Image.open(args.image_file)
        if img.mode != "L":
            img = img.convert("L")
    else:
        print("[]")
        return 0
    W, H = img.size
    data = pytesseract.image_to_data(img, config="--oem 3 --psm 3",
                                     output_type=pytesseract.Output.DICT)
    words = []
    for i in range(len(data["text"])):
        words.append({
            "text": data["text"][i],
            "conf": data["conf"][i],
            "x_norm": data["left"][i] / W,
            "y_norm": data["top"][i] / H,
            "w_norm": data["width"][i] / W,
            "h_norm": data["height"][i] / H,
        })
    out = select_landmarks(words, max_n=args.max, min_conf=args.min_conf,
                           page_number=args.page)
    print(json.dumps(out))


if __name__ == "__main__":
    sys.exit(_main())
