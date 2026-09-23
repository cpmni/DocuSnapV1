#!/usr/bin/env python3
"""
Dual-reader census — for every ref / date / total field in a corpus, crop the value and read it with
BOTH Tesseract and PP-OCR (Paddle, ocr.glyph_reader). Log both reads + confidences + whether they
agree, and SAVE every slice so capture quality can be eyeballed (chopped / mis-sliced check).

Question this answers (owner, 2026-09-23): "if I can see it with my eye the data is there" — how often
do the two engines CONFIDENTLY AGREE, and how often are they confidently agreed AND WRONG (the
common-mode error Oracle fears for the RELEASE)?

DB-FREE + label-anchored: it does NOT need learned templates. It finds each field by its printed LABEL
(via Tesseract word geometry), takes the value token(s) beside/below the label, and crops their union
+ a small pad. Conservative: emits a field ONLY when a label AND a value-shaped token are found — it
would rather SKIP a field than mis-slice one (coverage is in the log).

Usage:
  py -3.12 census.py "<corpus_dir>" "<out_dir>" [--limit N] [--supplier NAME] [--pages 2]
Outputs under <out_dir>:
  slices/<supplier>/<doc>__<field>.png   — every captured slice (owner verifies these)
  detection_log.csv                      — one row per captured field
  SUMMARY.md                             — agreement / disagreement tallies
"""
import os, sys, csv, re, argparse, io
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = HERE.parents[3]                      # repo root
sys.path.insert(0, str(ROOT / "python_backend"))

import pypdfium2 as pdfium
from PIL import Image
import pytesseract

from ocr import tesseract as tess
from ocr import glyph_reader as gr

# Tesseract binary (dev path; matches the app)
_TESS = os.environ.get("TESSERACT_EXE", r"C:\Program Files\Tesseract-OCR\tesseract.exe")
if os.path.exists(_TESS):
    pytesseract.pytesseract.tesseract_cmd = _TESS

RENDER_DPI = 200                            # the product's OCR DPI
SCALE = RENDER_DPI / 72.0

# ── Field label sets (printed captions) + value shape ─────────────────────────────
LABELS = {
    "ref": ["invoice no", "invoice number", "invoice #", "order no", "order number", "po no",
            "po number", "p.o. no", "reference", "ref no", "ref", "docket no", "docket",
            "delivery note", "delivery no", "sales order", "so no", "quote no", "quotation no",
            "credit note", "statement no", "account no", "our ref", "your ref", "document no"],
    "date": ["invoice date", "order date", "date of issue", "issue date", "delivery date",
             "due date", "date"],
    "total": ["total inc vat", "total (inc vat)", "grand total", "total due", "amount due",
              "balance due", "total amount", "invoice total", "total payable", "total"],
}
# value must LOOK like the field (so we don't crop a caption or a stray word)
VAL_RE = {
    "ref":   re.compile(r"^[A-Za-z0-9][A-Za-z0-9\-/.]{2,}$"),                 # alnum code, >=3 chars
    "date":  re.compile(r"\d"),                                              # contains a digit (date-ish; refined below)
    "total": re.compile(r"^[£$€]?\s?-?\d[\d,]*\.\d{2}$"),                    # money
}
_DATEISH = re.compile(r"(\d{1,4}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2}\s*[A-Za-z]{3,9}\s*\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{2,4})")


def render_page(pdf_path, page_index):
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        if page_index >= len(pdf):
            return None
        page = pdf[page_index]
        pil = page.render(scale=SCALE).to_pil().convert("RGB")
        return pil
    finally:
        pdf.close()


def page_words(img):
    """[(l, t, w, h, text, conf)] via Tesseract image_to_data (reusing the app's parser)."""
    data = pytesseract.image_to_data(img, config="--oem 3 --psm 3", output_type=pytesseract.Output.DICT)
    return tess._words_from_data(data)


def _lines(words, y_tol=8):
    """Group words into visual lines (by top-y), each sorted left→right."""
    rows = sorted(words, key=lambda w: (w[1], w[0]))
    lines, cur, cy = [], [], None
    for w in rows:
        if cy is None or abs(w[1] - cy) <= y_tol:
            cur.append(w); cy = w[1] if cy is None else cy
        else:
            lines.append(sorted(cur, key=lambda x: x[0])); cur = [w]; cy = w[1]
    if cur:
        lines.append(sorted(cur, key=lambda x: x[0]))
    return lines


def _norm_label(s):
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


def locate_fields(words):
    """Return {field: (value_str, (l,t,r,b), conf)} — label-anchored, conservative.
    For each field, scan lines for a label caption; take the value token(s) to the RIGHT on the
    same line, else the first value-shaped token on the NEXT line. Only emit on a value-shape match."""
    lines = _lines(words)
    out = {}
    for li, line in enumerate(lines):
        text = _norm_label(" ".join(w[4] for w in line))
        for field, labs in LABELS.items():
            if field in out:
                continue
            hit = next((lab for lab in labs if lab in text), None)
            if not hit:
                continue
            # index of the last label word on this line
            lab_last = _label_end_index(line, hit)
            cand = _value_after(line, lab_last, field) if lab_last is not None else None
            if cand is None and li + 1 < len(lines):
                cand = _value_after(lines[li + 1], -1, field)   # value on the next line
            if cand:
                out[field] = cand
    return out


def _label_end_index(line, lab):
    toks = [_norm_label(w[4]) for w in line]
    labtoks = lab.split()
    for i in range(len(toks) - len(labtoks) + 1):
        if toks[i:i + len(labtoks)] == labtoks:
            return i + len(labtoks) - 1
    # loose: last word that is part of the label
    for i in range(len(toks) - 1, -1, -1):
        if toks[i] and toks[i] in labtoks:
            return i
    return None


def _value_after(line, after_idx, field):
    """First value-shaped token group after position after_idx on this line."""
    vr = VAL_RE[field]
    i = after_idx + 1
    while i < len(line):
        l, t, w, h, txt, conf = line[i]
        raw = txt.strip().strip(":").strip()
        if not raw:
            i += 1; continue
        if field == "date":
            # gather up to 3 tokens to form a date span
            span = line[i:i + 3]
            joined = " ".join(x[4] for x in span).strip()
            m = _DATEISH.search(joined)
            if m:
                grp = _cover_tokens(span, m.group(0))
                return (m.group(0), _union_box(grp), _avg_conf(grp))
            i += 1; continue
        if field == "total":
            if vr.match(raw.replace(" ", "")):
                return (raw, _box(line[i]), conf)
            i += 1; continue
        # ref — a code (has a digit), but NOT a date and NOT a bare money amount
        if (vr.match(raw) and any(c.isdigit() for c in raw)
                and not _DATEISH.match(raw) and not VAL_RE["total"].match(raw.replace(" ", ""))):
            return (raw, _box(line[i]), conf)
        i += 1
    return None


def _cover_tokens(span, matched):
    """Which tokens of `span` overlap the matched substring (by greedy join)."""
    picked, acc = [], ""
    for w in span:
        picked.append(w)
        acc = (acc + " " + w[4]).strip()
        if matched.replace(" ", "") in acc.replace(" ", ""):
            break
    return picked


def _box(w):
    l, t, ww, h = w[0], w[1], w[2], w[3]
    return (l, t, l + ww, t + h)

def _union_box(ws):
    ls = [w[0] for w in ws]; ts = [w[1] for w in ws]
    rs = [w[0] + w[2] for w in ws]; bs = [w[1] + w[3] for w in ws]
    return (min(ls), min(ts), max(rs), max(bs))

def _avg_conf(ws):
    cs = [w[5] for w in ws if w[5] >= 0]
    return sum(cs) / len(cs) if cs else -1


def crop_pad(img, box, pad_px=6, pady=0.30):
    # SMALL fixed horizontal pad (a quiet zone, NOT a neighbouring word) + a modest vertical pad.
    # The earlier 35%-of-width pad bled the label ("No.") into the ref crop and the "Date" caption
    # into the date crop, manufacturing false disagreements. Value-only crop now.
    l, t, r, b = box
    h = b - t
    L = max(0, int(l - pad_px)); T = max(0, int(t - h * pady))
    R = min(img.width, int(r + pad_px)); B = min(img.height, int(b + h * pady))
    if R <= L or B <= T:
        return None
    return img.crop((L, T, R, B))


def tess_read_crop(crop):
    """Tight read of the crop (upscaled) — BEST of several PSMs so a single-PSM quirk doesn't
    manufacture a Tesseract 'failure'. Returns the highest-mean-confidence non-empty read."""
    up = crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS)
    best = ("", -1.0)
    for psm in (7, 6, 8, 11):
        d = pytesseract.image_to_data(up, config=f"--oem 3 --psm {psm}", output_type=pytesseract.Output.DICT)
        ws = tess._words_from_data(d)
        if not ws:
            continue
        txt = " ".join(w[4] for w in ws).strip()
        conf = _avg_conf(ws)
        if txt and conf > best[1]:
            best = (txt, conf)
    return best


def alnum(s):
    return re.sub(r"[^A-Za-z0-9]", "", str(s or "")).upper()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("corpus"); ap.add_argument("out")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--supplier", default="")
    ap.add_argument("--pages", type=int, default=2)
    a = ap.parse_args()

    corpus = Path(a.corpus); out = Path(a.out)
    (out / "slices").mkdir(parents=True, exist_ok=True)
    tess.configure(_TESS if os.path.exists(_TESS) else None)
    pp_ok = gr.available()
    print(f"Paddle available: {pp_ok}")

    pdfs = sorted(p for p in corpus.rglob("*.pdf")
                  if not a.supplier or a.supplier.lower() in str(p).lower())
    if a.limit:
        pdfs = pdfs[:a.limit]
    print(f"{len(pdfs)} PDFs")

    rows = []
    for n, pdf in enumerate(pdfs, 1):
        supplier = pdf.relative_to(corpus).parts[0]
        stem = pdf.stem
        try:
            for pi in range(a.pages):
                img = render_page(pdf, pi)
                if img is None:
                    break
                words = page_words(img)
                fields = locate_fields(words)
                for field, (val, box, tconf_page) in fields.items():
                    crop = crop_pad(img, box)
                    if crop is None:
                        continue
                    sup_dir = out / "slices" / re.sub(r"[^A-Za-z0-9 _-]", "", supplier)
                    sup_dir.mkdir(parents=True, exist_ok=True)
                    slice_name = f"{stem}__p{pi+1}__{field}.png"
                    crop.save(sup_dir / slice_name)
                    t_read, t_conf = tess_read_crop(crop)
                    p_read, p_conf = ("", -1.0)
                    if pp_ok:
                        pr = gr.read_crop(gr.prep_crop(crop))
                        if pr:
                            p_read, p_conf = pr[0], round(float(pr[1]) * 100, 1)
                    agree = bool(alnum(t_read) and alnum(t_read) == alnum(p_read))
                    rows.append({
                        "supplier": supplier, "doc": stem, "page": pi + 1, "field": field,
                        "label_value": val, "tess_read": t_read, "tess_conf": round(t_conf, 1),
                        "pp_read": p_read, "pp_conf": p_conf, "agree": int(agree),
                        "slice": f"slices/{sup_dir.name}/{slice_name}",
                    })
            if n % 25 == 0:
                print(f"  {n}/{len(pdfs)} … {len(rows)} fields")
        except Exception as e:
            print(f"  ERR {pdf.name}: {e}")

    # write log
    with open(out / "detection_log.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else
                            ["supplier", "doc", "page", "field", "label_value", "tess_read",
                             "tess_conf", "pp_read", "pp_conf", "agree", "slice"])
        wr.writeheader(); wr.writerows(rows)

    # summary
    def tally(pred):
        sub = [r for r in rows if pred(r)]
        n = len(sub)
        both = [r for r in sub if r["pp_conf"] >= 0 and r["tess_conf"] >= 0]
        agree = [r for r in both if r["agree"]]
        conf_agree = [r for r in agree if r["tess_conf"] >= 80 and r["pp_conf"] >= 80]
        disagree = [r for r in both if not r["agree"]]
        return n, len(both), len(agree), len(conf_agree), len(disagree)

    lines = ["# Dual-reader census — SUMMARY", "",
             f"corpus: {corpus}", f"Paddle available: {pp_ok}", f"fields captured: {len(rows)}", ""]
    lines.append("| field | captured | both-read | agree | confident-agree (both≥80) | disagree |")
    lines.append("|---|---|---|---|---|---|")
    for field in ("ref", "date", "total", "ALL"):
        pred = (lambda r: True) if field == "ALL" else (lambda r, f=field: r["field"] == f)
        n, both, ag, ca, dis = tally(pred)
        lines.append(f"| {field} | {n} | {both} | {ag} | {ca} | {dis} |")
    lines += ["", "DISAGREEMENTS (one reader is wrong — inspect the slice):", ""]
    for r in rows:
        if r["pp_conf"] >= 0 and r["tess_conf"] >= 0 and not r["agree"]:
            lines.append(f"- {r['field']:5} {r['doc']} p{r['page']}: tess='{r['tess_read']}'"
                         f"({r['tess_conf']}) vs pp='{r['pp_read']}'({r['pp_conf']})  [{r['slice']}]")
    (out / "SUMMARY.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"\nDone. {len(rows)} fields. Log + slices + SUMMARY.md under {out}")


if __name__ == "__main__":
    main()
