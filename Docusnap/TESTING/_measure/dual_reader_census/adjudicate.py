#!/usr/bin/env python3
"""
Adjudicate the dual-reader census against GROUND TRUTH from the PDF text layer (if born-digital).
For every CONFIDENT AGREE (both readers ≥80 and equal), check whether the agreed value actually
appears in the document's embedded text — if not, it is a candidate common-mode error (both readers
confidently agreed on a WRONG value, the Oracle fear). Reports the rate + lists every suspect.

Usage: py -3.12 adjudicate.py "<corpus_dir>" "<out_dir>"
"""
import sys, csv, re
from pathlib import Path
import pypdfium2 as pdfium

corpus = Path(sys.argv[1]); out = Path(sys.argv[2])

def alnum(s):
    return re.sub(r"[^A-Za-z0-9]", "", str(s or "")).upper()

# index PDFs by stem for fast lookup
pdfs = {p.stem: p for p in corpus.rglob("*.pdf")}

_text_cache = {}
def doc_text(stem):
    if stem in _text_cache:
        return _text_cache[stem]
    p = pdfs.get(stem)
    t = ""
    if p:
        try:
            d = pdfium.PdfDocument(str(p))
            try:
                for i in range(min(2, len(d))):
                    t += d[i].get_textpage().get_text_range() + "\n"
            finally:
                d.close()
        except Exception:
            t = ""
    _text_cache[stem] = t
    return t

rows = list(csv.DictReader(open(out / "detection_log.csv", encoding="utf-8")))
born = sum(1 for s in set(r["doc"] for r in rows) if len(doc_text(s).strip()) > 40)
total_docs = len(set(r["doc"] for r in rows))
print(f"docs with a usable text layer (born-digital): {born}/{total_docs}")

if born < total_docs * 0.5:
    print("Most docs have NO text layer (scanned) — text-layer GT not viable; eyeball sampling needed.")
    sys.exit(0)

# confident agrees only
ca = [r for r in rows
      if r["agree"] == "1" and float(r["tess_conf"]) >= 80 and float(r["pp_conf"]) >= 80]
suspects = []
scored = 0
for r in ca:
    txt = doc_text(r["doc"])
    if len(txt.strip()) <= 40:
        continue                      # no GT for this doc
    scored += 1
    val = alnum(r["pp_read"])         # == tess_read (they agree)
    if val and val not in alnum(txt):
        suspects.append(r)

print(f"\nconfident-agrees scored against text-layer GT: {scored}")
print(f"confident-agree AND WRONG (common-mode candidates): {len(suspects)}")
if scored:
    print(f"common-mode error rate: {100*len(suspects)/scored:.3f}%")
print()
for r in suspects[:60]:
    print(f"- {r['field']:5} {r['doc']} p{r['page']}: both read '{r['pp_read']}' "
          f"(tess {r['tess_conf']}, pp {r['pp_conf']})  [{r['slice']}]")

# write a report
lines = [f"# Common-mode adjudication (text-layer GT)", "",
         f"born-digital docs: {born}/{total_docs}",
         f"confident-agrees scored: {scored}",
         f"confident-agree AND wrong (common-mode): {len(suspects)}",
         (f"common-mode rate: {100*len(suspects)/scored:.3f}%" if scored else ""), ""]
for r in suspects:
    lines.append(f"- {r['field']} {r['doc']} p{r['page']}: both='{r['pp_read']}' "
                 f"(tess {r['tess_conf']}, pp {r['pp_conf']}) [{r['slice']}]")
(out / "COMMON_MODE.md").write_text("\n".join(lines), encoding="utf-8")
print(f"\nreport -> {out/'COMMON_MODE.md'}")
