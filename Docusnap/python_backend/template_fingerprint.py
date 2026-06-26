#!/usr/bin/env python3
"""
template_fingerprint.py — (re)derive a template's KEYWORD FINGERPRINT from SEVERAL of
its documents and keep only the STABLE, RECURRING words. Born-digital aware (uses the
embedded text layer, so a generated PDF whose stored ocr_text was never captured still
yields a fingerprint), falling back to OCR for scanned pages — the same text path
processing uses.

Why cross-sample, not one sample: an email-alert layout (e.g. Print Tracker) puts the
VARIABLE recipient header ("From/Sent/To/Subject", the customer's name) at the TOP,
where a single-document header harvest would capture per-document noise ("Karen", "City
Office", "McConnell"). Intersecting across documents drops anything that doesn't recur
and keeps the stable identity ("alerts", "printtrackerpro", "Sent", "Subject", …), which
is present on EVERY alert — so the template matches by its branding instead of an
unreliable logo phash. Layout-agnostic: it also strengthens ordinary invoice/worksheet
fingerprints (the supplier's branding recurs; one document's quirks don't).

Input:  --files-file <path to JSON array of document file paths>
Output: {"fingerprint": ["…","…"], "docs": N}
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ocr.tesseract import extract_text_and_images
from extraction.template_matcher import extract_keyword_fingerprint

MAX_WORDS = 12   # cap the stored fingerprint


def _doc_words(path, born_digital, engine):
    try:
        text, _ = extract_text_and_images(Path(path), None,
                                          born_digital=born_digital, engine=engine)
    except Exception:
        return set()
    # A wider window than the default so the stable field labels below an email
    # header are reachable; recurrence (not position) is what keeps the word.
    return set(extract_keyword_fingerprint(text or "", max_words=40))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--files-file", required=True)
    ap.add_argument("--tesseract", default=None)
    ap.add_argument("--born-digital", action="store_true")
    ap.add_argument("--ocr-engine", default="tesseract")
    args = ap.parse_args()

    if args.tesseract:
        try:
            import pytesseract
            pytesseract.pytesseract.tesseract_cmd = args.tesseract
        except Exception:
            pass
    engine = None
    try:
        from ocr.engine import get_engine
        engine = get_engine(args.ocr_engine)
    except Exception:
        engine = None

    try:
        paths = json.loads(Path(args.files_file).read_text(encoding="utf-8"))
    except Exception as e:
        print(json.dumps({"fingerprint": [], "docs": 0, "error": str(e)}), end="")
        return

    per_doc = [_doc_words(p, args.born_digital, engine) for p in (paths or [])]
    per_doc = [w for w in per_doc if w]
    n = len(per_doc)
    if n == 0:
        print(json.dumps({"fingerprint": [], "docs": 0}), end="")
        return

    counts = Counter()
    for words in per_doc:
        counts.update(words)
    if n == 1:
        # Degraded: only one usable doc — keep its words (better than empty), the
        # backfill will refine once more docs of this template are confirmed.
        keep = [w for w, _ in counts.most_common()]
    else:
        # Stable = present in a MAJORITY of the documents (>=60%, min 2). This is
        # what discards a single document's recipient/entity noise.
        thresh = max(2, (n * 3 + 4) // 5)   # ceil(0.6 * n), floored at 2
        # Order by recurrence (most-recurring first), then alphabetically.
        keep = [w for w, c in sorted(counts.items(), key=lambda kc: (-kc[1], kc[0]))
                if c >= thresh]

    print(json.dumps({"fingerprint": keep[:MAX_WORDS], "docs": n}), end="")


if __name__ == "__main__":
    main()
