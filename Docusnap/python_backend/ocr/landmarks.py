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


def _norm_boxes(boxes):
    """Normalise an exclude-box list (dicts or 4-tuples) to (x, y, w, h) tuples."""
    out = []
    for b in (boxes or []):
        if isinstance(b, dict):
            try:
                out.append((float(b.get("x", b.get("x_norm", 0))),
                            float(b.get("y", b.get("y_norm", 0))),
                            float(b.get("w", b.get("w_norm", 0))),
                            float(b.get("h", b.get("h_norm", 0)))))
            except (TypeError, ValueError):
                continue
        elif b:
            try:
                out.append(tuple(float(v) for v in list(b)[:4]))
            except (TypeError, ValueError):
                continue
    return out


def _overlaps(box, boxes):
    """AABB intersection: does `box` (x,y,w,h) touch any of `boxes`?"""
    bx, by, bw, bh = box
    for ex, ey, ew, eh in boxes:
        if bx < ex + ew and bx + bw > ex and by < ey + eh and by + bh > ey:
            return True
    return False


def select_landmarks(words, *, max_n=5, min_conf=80, page_number=0, exclude_boxes=()):
    """Pick up to `max_n` stable, unique, well-spread landmarks from `words`.

    `words`: iterable of dicts with text, conf, x_norm, y_norm, w_norm, h_norm
    (coords normalised to the page). `exclude_boxes`: taught VALUE/anchor zones — a
    word overlapping one is rejected (those regions hold per-document values, never
    stable chrome). Returns a list of landmark dicts ready for templates.setLandmarks.
    Deterministic for a given input."""
    ex = _norm_boxes(exclude_boxes)
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
        box = (float(w["x_norm"]), float(w["y_norm"]), float(w["w_norm"]), float(w["h_norm"]))
        if ex and _overlaps(box, ex):
            continue   # never anchor on a taught value/anchor zone — those are variable
        cand.append({
            "label_text": text,
            "x_norm": box[0], "y_norm": box[1], "w_norm": box[2], "h_norm": box[3],
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


def select_cross_sample(docs_words, *, max_n=5, min_docs_frac=0.6, pos_tol=0.015,
                        min_conf=80, page_number=0, exclude_boxes=()):
    """Cross-sample landmark selection — the AUTOMATIC, no-human-judgement path.

    `docs_words`: a list of per-document word lists (each word a dict with text/conf
    and normalised x/y/w/h). A word becomes a landmark candidate only if it RECURS,
    at a STABLE position, across the confirmed corpus:
      * appears in >= ceil(min_docs_frac * N) documents (k-of-N, mirrors the keyword
        fingerprint's 0.6 intersection floor) — drops per-document VALUES; and
      * its centroid is stable across those docs (max pairwise distance <= pos_tol,
        kept tighter than registration's inlier band so a word that recurs but MOVES
        — a value that happens to repeat — is dropped).
    Survivors (one per text, at their MEDIAN centroid) are then run through
    select_landmarks for the existing uniqueness + spatial-spread + value-zone guard.
    This is what a human can't eyeball (e.g. that "Ticket" repeats 4x on a form)."""
    import math
    from collections import defaultdict

    docs = [d for d in (docs_words or []) if d]
    n = len(docs)
    if n < 1:
        return []
    need = max(2, math.ceil(min_docs_frac * n))

    # group by normalised text -> {doc_index: (cx, cy, conf, word)} (best per doc)
    groups = defaultdict(dict)
    for di, words in enumerate(docs):
        # A re-locatable landmark must be UNIQUE on its own page — a word that
        # appears more than once in a doc ("Ticket" x4 on a form) is ambiguous to
        # re-find, so drop it for THAT doc before considering cross-doc recurrence.
        counts = defaultdict(int)
        for w in words:
            t = (w.get("text") or "").strip().lower()
            if t:
                counts[t] += 1
        for w in words:
            try:
                conf = float(w.get("conf"))
            except (TypeError, ValueError):
                continue
            text = (w.get("text") or "").strip()
            if conf < min_conf or not _is_word(text):
                continue
            if counts[text.lower()] != 1:
                continue                                # ambiguous on this page
            cx = float(w["x_norm"]) + float(w["w_norm"]) / 2.0
            cy = float(w["y_norm"]) + float(w["h_norm"]) / 2.0
            prev = groups[text.lower()].get(di)
            if prev is None or conf > prev[2]:
                groups[text.lower()][di] = (cx, cy, conf, w)

    survivors = []
    for key, perdoc in groups.items():
        if len(perdoc) < need:
            continue                                    # not recurring enough
        centres = [(v[0], v[1]) for v in perdoc.values()]
        stable = all(
            ((centres[i][0] - centres[j][0]) ** 2 + (centres[i][1] - centres[j][1]) ** 2) ** 0.5 <= pos_tol
            for i in range(len(centres)) for j in range(i + 1, len(centres))
        )
        if not stable:
            continue                                    # recurs but moves -> a value
        xs = sorted(c[0] for c in centres)
        ys = sorted(c[1] for c in centres)
        mx, my = xs[len(xs) // 2], ys[len(ys) // 2]     # median centroid
        best = max(perdoc.values(), key=lambda v: v[2])
        w = best[3]
        survivors.append({
            "text": (w.get("text") or "").strip(),
            "conf": best[2],
            "x_norm": mx - float(w["w_norm"]) / 2.0, "y_norm": my - float(w["h_norm"]) / 2.0,
            "w_norm": float(w["w_norm"]), "h_norm": float(w["h_norm"]),
        })

    return select_landmarks(survivors, max_n=max_n, min_conf=min_conf,
                            page_number=page_number, exclude_boxes=exclude_boxes)


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
    parser.add_argument("--emit-phash", action="store_true",
                        help="also compute the page's logo phash and emit {landmarks, logo_phash}")
    parser.add_argument("--exclude-boxes", default=None,
                        help="JSON list of taught value/anchor boxes to avoid as landmarks")
    parser.add_argument("--emit-words", action="store_true",
                        help="emit the filtered candidate words (for cross-sample capture), not a selection")
    parser.add_argument("--cross-sample-file", default=None,
                        help="JSON {docs:[[words],...], exclude_boxes:[...]} -> cross-sample landmarks (no image)")
    args = parser.parse_args()

    # Cross-sample selection needs NO image — handle it before any OCR setup.
    if args.cross_sample_file:
        try:
            with open(args.cross_sample_file, encoding="utf-8") as f:
                payload = json.load(f)
        except Exception:
            print("[]")
            return 0
        docs = payload.get("docs") or []
        ex = payload.get("exclude_boxes") or []
        print(json.dumps(select_cross_sample(docs, max_n=args.max, min_conf=args.min_conf,
                                             exclude_boxes=ex)))
        return 0

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
    exclude = []
    if args.exclude_boxes:
        try:
            exclude = json.loads(args.exclude_boxes) or []
        except Exception:
            exclude = []

    if args.emit_words:
        # Raw filtered candidate words for cross-sample capture — top by confidence.
        cands = []
        for w in words:
            try:
                conf = float(w["conf"])
            except (TypeError, ValueError):
                continue
            text = (w["text"] or "").strip()
            if conf < args.min_conf or not _is_word(text):
                continue
            cands.append({"text": text, "conf": conf,
                          "x_norm": w["x_norm"], "y_norm": w["y_norm"],
                          "w_norm": w["w_norm"], "h_norm": w["h_norm"]})
        cands.sort(key=lambda c: c["conf"], reverse=True)
        print(json.dumps(cands[:40]))
        return 0

    out = select_landmarks(words, max_n=args.max, min_conf=args.min_conf,
                           page_number=args.page, exclude_boxes=exclude)
    if args.emit_phash:
        # Reuse the SAME logo hash the matcher uses (resizes the crop to a fixed
        # 256x256 before hashing, so it's largely render-DPI-independent). Lets the
        # caller seed identity on an empty-phash template from the sample we already
        # rendered — one render, one spawn. Best-effort; null on any failure.
        phash = None
        try:
            import os as _os
            sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
            from extraction.template_matcher import compute_logo_hash
            phash = compute_logo_hash(img)
        except Exception:
            phash = None
        print(json.dumps({"landmarks": out, "logo_phash": phash}))
    else:
        print(json.dumps(out))


if __name__ == "__main__":
    sys.exit(_main())
