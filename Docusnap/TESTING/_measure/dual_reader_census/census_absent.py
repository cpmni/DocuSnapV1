#!/usr/bin/env python3
"""
FILTERED `_absent` dual-reader census — the Oracle's ONE open gate for the confusable RELEASE
(2026-09-23). The general census (census.py) measured the whole population; the RELEASE only ever
fires on the Gate-C SOFTEN set, which is enriched for the hardest crops. This re-measures EXACTLY
that set, replicating engine._flag_filing_value_sanity's trigger:

    _absent  = the crop read (rv) is NOT a whole token of the whole-page text (casefold, edge-punct
               stripped — the same tokeniser as engine.py:7951)
    _near    = engine._nearest_confusable_page_token(page, rv)  (a one-glyph confusable page token)
    soften   = _absent AND _near AND engine._one_digit_letter_confusable(rv, _near)
               (the mig-147/148 confusable soften = the RELEASE's trigger set)

For every ref row of the prior run (detection_log.csv), the page is re-rendered, the whole-page
text is rebuilt with the PRODUCT's own reconstructor (ocr.tesseract.reconstruct_page_text — PSM-3 +
PSM-6 merge, DPI 200), and the row is classified. For the soften set we record: rv (Tesseract crop),
_near (page form), pp_read, pp agrees with rv?, pp == _near?, and copy the slice into a contact
sheet for PIXEL adjudication (a human/Claude reads the slice and says which form is printed).

The RELEASE's risk = "crop WRONG and PP agrees with the wrong crop" (common-mode). Count it. 0 → flip.

Optional --clip-arm: a SYNTHETIC stress (NOT a gate — Oracle rejected synthetic pins): each soften
slice is re-cropped with its LEFT edge shaved by ~55% of one glyph width (a clipped taught box) and
both readers re-run; reports how often both AGREE on the clipped read (the "PP shares the loss" shape).

Usage:
  py -3.12 census_absent.py "<corpus_dir>" "<prior_out_dir>" "<out_dir>" [--limit N] [--clip-arm]
"""
import os, sys, csv, re, argparse, shutil
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "python_backend"))
sys.path.insert(0, str(HERE.parent))

from PIL import Image, ImageDraw, ImageFont
from ocr import tesseract as tess
from ocr import glyph_reader as gr
import census as C                                  # reuse render / crop / tess_read_crop / alnum
from extraction import engine as E                  # the REAL predicates (no copies)

RENDER_DPI = 200


def page_tokens(page_text):
    """engine.py:7951 verbatim."""
    return {t.strip('.,;:()[]{}"\'').casefold() for t in re.split(r'\s+', page_text)}


def classify(rv, page_text):
    """Return (absent, near, soften) for a crop read rv against the whole-page text."""
    rv = str(rv or '').strip()
    if len(rv) < 4 or len(page_text) <= 200:
        return (False, '', False)
    absent = rv.casefold() not in page_tokens(page_text)
    near = E._nearest_confusable_page_token(page_text, rv) if absent else ''
    soften = bool(absent and near and E._one_digit_letter_confusable(rv, near))
    return (absent, near, soften)


def clip_left(img, rv, frac=0.55):
    """Shave the left edge by frac of one glyph width (a clipped taught box)."""
    n = max(1, len(re.sub(r'[^A-Za-z0-9]', '', rv)))
    gw = img.width / n
    L = int(gw * frac)
    if img.width - L < 8:
        return None
    return img.crop((L, 0, img.width, img.height))


def contact_sheet(rows, out_png, cols=3, cell_w=520, cell_h=150):
    if not rows:
        return
    n = len(rows)
    rws = (n + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rws * cell_h), "white")
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 14)
    except Exception:
        font = ImageFont.load_default()
    for i, r in enumerate(rows):
        x = (i % cols) * cell_w; y = (i // cols) * cell_h
        try:
            im = Image.open(r["slice_path"]).convert("RGB")
            scale = min((cell_w - 20) / im.width, 70 / im.height, 3.0)
            im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
            sheet.paste(im, (x + 10, y + 8))
        except Exception:
            pass
        cap = (f"#{r['idx']} crop='{r['tess_read']}' page='{r['near']}' pp='{r['pp_read']}' "
               f"agree={'Y' if r['pp_agrees_crop'] else 'n'}")
        d.text((x + 10, y + 86), cap[:78], fill="black", font=font)
        d.text((x + 10, y + 104), f"{r['doc'][:60]} p{r['page']}", fill=(90, 90, 90), font=font)
        d.rectangle([x, y, x + cell_w - 1, y + cell_h - 1], outline=(200, 200, 200))
    sheet.save(out_png)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("corpus"); ap.add_argument("prior"); ap.add_argument("out")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--clip-arm", action="store_true")
    a = ap.parse_args()
    corpus, prior, out = Path(a.corpus), Path(a.prior), Path(a.out)
    (out / "slices").mkdir(parents=True, exist_ok=True)
    tess.configure(C._TESS if os.path.exists(C._TESS) else None)
    pp_ok = gr.available()
    print(f"Paddle available: {pp_ok}")

    with open(prior / "detection_log.csv", encoding="utf-8", newline="") as f:
        prior_rows = [r for r in csv.DictReader(f) if r["field"] == "ref" and r["tess_read"]]
    if a.limit:
        prior_rows = prior_rows[:a.limit]
    print(f"{len(prior_rows)} ref rows from the prior run")

    # index the corpus PDFs by stem (the prior log stores supplier + stem)
    pdf_by_key = {}
    for p in corpus.rglob("*.pdf"):
        pdf_by_key[(p.relative_to(corpus).parts[0], p.stem)] = p

    rows, page_cache = [], {}
    n_absent = n_soften = 0
    for i, r in enumerate(prior_rows, 1):
        key = (r["supplier"], r["doc"]); pi = int(r["page"]) - 1
        pdf = pdf_by_key.get(key)
        if not pdf:
            continue
        ck = (str(pdf), pi)
        try:
            if ck not in page_cache:
                img = C.render_page(pdf, pi)
                page_cache[ck] = (img, tess.reconstruct_page_text(img, dpi=RENDER_DPI) if img is not None else "")
            img, page_text = page_cache[ck]
            rv = r["tess_read"].strip()
            absent, near, soften = classify(rv, page_text)
            row = dict(idx=len(rows) + 1, supplier=r["supplier"], doc=r["doc"], page=r["page"],
                       tess_read=rv, tess_conf=r["tess_conf"], pp_read=r["pp_read"], pp_conf=r["pp_conf"],
                       pp_agrees_crop=int(bool(C.alnum(rv)) and C.alnum(rv) == C.alnum(r["pp_read"])),
                       absent=int(absent), near=near, soften=int(soften),
                       pp_equals_near=int(bool(near) and C.alnum(r["pp_read"]) == C.alnum(near)),
                       slice_path=str(prior / r["slice"]), clip_tess="", clip_pp="", clip_agree="")
            n_absent += int(absent); n_soften += int(soften)
            if soften:
                dst = out / "slices" / Path(r["slice"]).name
                try:
                    shutil.copy2(row["slice_path"], dst)
                    row["slice_path"] = str(dst)
                except Exception:
                    pass
                if a.clip_arm:
                    try:
                        im = Image.open(row["slice_path"]).convert("RGB")
                        cl = clip_left(im, rv)
                        if cl is not None:
                            t_read, _ = C.tess_read_crop(cl)
                            p = gr.read_crop(gr.prep_crop(cl)) if pp_ok else None
                            p_read = p[0] if p else ""
                            row["clip_tess"], row["clip_pp"] = t_read, p_read
                            row["clip_agree"] = int(bool(C.alnum(t_read)) and C.alnum(t_read) == C.alnum(p_read))
                            cl.save(out / "slices" / (Path(r["slice"]).stem + "__CLIP.png"))
                    except Exception as e:
                        row["clip_tess"] = f"ERR {e}"
            rows.append(row)
        except Exception as e:
            print(f"  ERR {r['doc']}: {e}")
        if i % 50 == 0:
            print(f"  {i}/{len(prior_rows)} … absent={n_absent} soften={n_soften}", flush=True)
        # keep the page cache bounded
        if len(page_cache) > 6:
            page_cache.pop(next(iter(page_cache)))

    fields = ["idx", "supplier", "doc", "page", "tess_read", "tess_conf", "pp_read", "pp_conf", "pp_agrees_crop",
              "absent", "near", "soften", "pp_equals_near", "slice_path", "clip_tess", "clip_pp", "clip_agree"]
    with open(out / "absent_log.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)

    soft = [r for r in rows if r["soften"]]
    abs_only = [r for r in rows if r["absent"] and not r["soften"]]
    agree_soft = [r for r in soft if r["pp_agrees_crop"]]
    pp_near = [r for r in soft if r["pp_equals_near"]]
    lines = ["# Filtered `_absent` dual-reader census — SUMMARY", "",
             f"ref rows re-measured: {len(rows)}",
             f"page-ABSENT (whole-token test, product page text): {len(abs_only) + len(soft)}",
             f"  of which SOFTEN set (absent + one-glyph digit/letter confusable page form) = **{len(soft)}**",
             f"    PP AGREES with the crop read (the RELEASE would fire): {len(agree_soft)}",
             f"    PP reads the PAGE form instead (PP disagrees with the crop): {len(pp_near)}",
             f"    PP reads something else: {len(soft) - len(agree_soft) - len(pp_near)}", "",
             "PIXEL ADJUDICATION NEEDED on the SOFTEN rows below (contact_sheet_absent_*.png): for each,",
             "read the slice — is the CROP form or the PAGE form printed? Common-mode = crop WRONG + PP agreed.", ""]
    lines.append("| # | doc | crop (Tesseract) | page form | PP read | PP agrees crop |")
    lines.append("|---|---|---|---|---|---|")
    for r in soft:
        lines.append(f"| {r['idx']} | {r['doc']} p{r['page']} | `{r['tess_read']}` | `{r['near']}` | `{r['pp_read']}` "
                     f"| {'YES' if r['pp_agrees_crop'] else 'no'} |")
    if a.clip_arm:
        cl = [r for r in soft if r["clip_tess"] and not str(r["clip_tess"]).startswith("ERR")]
        both = [r for r in cl if r["clip_agree"]]
        same_as_rv = [r for r in both if C.alnum(r["clip_tess"]) == C.alnum(r["tess_read"])]
        lines += ["", "## Synthetic CLIP arm (stress only — NOT a gate)",
                  f"clipped slices read by both: {len(cl)} · both AGREE on the clipped read: {len(both)} "
                  f"· of those, the agreed read == the original crop read (clip absorbed): {len(same_as_rv)}",
                  "", "| # | crop | clip Tesseract | clip PP | agree |", "|---|---|---|---|---|"]
        for r in cl:
            lines.append(f"| {r['idx']} | `{r['tess_read']}` | `{r['clip_tess']}` | `{r['clip_pp']}` | "
                         f"{'YES' if r['clip_agree'] else 'no'} |")
    (out / "SUMMARY_ABSENT.md").write_text("\n".join(lines), encoding="utf-8")
    for k in range(0, len(soft), 30):
        contact_sheet(soft[k:k + 30], out / f"contact_sheet_absent_{k // 30 + 1:02d}.png")
    print(f"\nDone. {len(rows)} rows; absent={len(abs_only) + len(soft)}; soften={len(soft)}; "
          f"PP-agrees-in-soften={len(agree_soft)}. See {out / 'SUMMARY_ABSENT.md'}")


if __name__ == "__main__":
    main()
