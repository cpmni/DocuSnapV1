"""Where does the Search viewer's time go? Measures, on real corpus PDFs:
  (1) Python interpreter start + pypdfium2 import (the per-spawn fixed cost),
  (2) in-process: open, page count, render page 1 at the Search scale (3 = 216 DPI), PNG encode, JPEG/WebP encode,
      base64,
  (3) the real CLI path the app uses (render/pages.py --count / --thumb / --thumb --page 0 --scale 3) wall-clock,
  (4) pypdfium2 outline (table of contents) API on a generated PDF with nested bookmarks.
Writes a JSON report next to this script. Read-only on the corpus.
"""
import os, sys, time, json, base64, subprocess, statistics
from io import BytesIO

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = r"C:\GIT Projects\Docusnap"
PAGES_PY = os.path.join(REPO, "python_backend", "render", "pages.py")
CORPUS = r"C:\Users\cmccu\Desktop\ScanFinder Test Corpus"
PY = ["py", "-3.12"]

def wall(cmd, n=3):
    ts = []
    for _ in range(n):
        t0 = time.perf_counter()
        r = subprocess.run(cmd, capture_output=True, text=True)
        ts.append(time.perf_counter() - t0)
        if r.returncode != 0:
            return {"error": (r.stderr or "")[-300:], "times": ts}
    return {"mean_s": round(statistics.mean(ts), 3), "min_s": round(min(ts), 3), "n": n}

report = {}

# (1) fixed per-spawn cost
noop = os.path.join(HERE, "_noop.py"); open(noop, "w").write("pass\n")
imp = os.path.join(HERE, "_imp.py"); open(imp, "w").write("import pypdfium2\n")
imp2 = os.path.join(HERE, "_imp2.py"); open(imp2, "w").write("import pypdfium2\nfrom PIL import Image\n")
report["spawn_noop"] = wall(PY + [noop], 5)
report["spawn_import_pypdfium2"] = wall(PY + [imp], 5)
report["spawn_import_pypdfium2_pil"] = wall(PY + [imp2], 5)

# (2) in-process costs on a few corpus PDFs
t0 = time.perf_counter()
import pypdfium2 as pdfium
from PIL import Image
report["inproc_import_s"] = round(time.perf_counter() - t0, 3)
report["pypdfium2_version"] = getattr(pdfium, "V_PYPDFIUM2", None) or getattr(pdfium, "__version__", "?")

samples = [
    os.path.join(CORPUS, "sales_order", "doc1509_Harrowgate-Timber_sales_order_0039-4.pdf"),
    os.path.join(CORPUS, "invoice", "doc1044_CopperfieldElectrical_invoice_01.pdf"),
    os.path.join(CORPUS, "service_worksheet", "doc1281_Worksheet.27-05-2026.2605-0849-1-2.pdf"),
]
# add the largest PDF in the corpus (closest to a heavy scan)
biggest = None
for root, _d, files in os.walk(CORPUS):
    for f in files:
        if f.lower().endswith(".pdf"):
            p = os.path.join(root, f); sz = os.path.getsize(p)
            if biggest is None or sz > biggest[1]: biggest = (p, sz)
if biggest: samples.append(biggest[0])

per = []
for p in samples:
    if not os.path.exists(p): continue
    row = {"file": os.path.relpath(p, CORPUS), "bytes": os.path.getsize(p)}
    t = time.perf_counter(); doc = pdfium.PdfDocument(p); row["open_s"] = round(time.perf_counter() - t, 4)
    t = time.perf_counter(); row["pages"] = len(doc); row["count_s"] = round(time.perf_counter() - t, 4)
    page = doc[0]
    for scale in (1.5, 3):
        t = time.perf_counter(); bm = page.render(scale=scale); img = bm.to_pil(); r_s = time.perf_counter() - t
        w, h = img.size
        t = time.perf_counter(); b = BytesIO(); img.save(b, format="PNG"); png = b.getvalue(); png_s = time.perf_counter() - t
        t = time.perf_counter(); b = BytesIO(); img.convert("RGB").save(b, format="JPEG", quality=85); jpg = b.getvalue(); jpg_s = time.perf_counter() - t
        webp_s = None; webp_len = None
        try:
            t = time.perf_counter(); b = BytesIO(); img.convert("RGB").save(b, format="WEBP", quality=85, method=0); webp = b.getvalue(); webp_s = time.perf_counter() - t; webp_len = len(webp)
        except Exception as e:
            webp_s = f"n/a ({e.__class__.__name__})"
        t = time.perf_counter(); b64 = base64.b64encode(png).decode(); b64_s = time.perf_counter() - t
        row[f"scale{scale}"] = {"px": [w, h], "render_s": round(r_s, 3), "png_s": round(png_s, 3), "png_kb": len(png) // 1024,
                               "jpeg85_s": round(jpg_s, 3), "jpeg85_kb": len(jpg) // 1024,
                               "webp85_s": (round(webp_s, 3) if isinstance(webp_s, float) else webp_s), "webp85_kb": (webp_len // 1024 if webp_len else None),
                               "b64_of_png_s": round(b64_s, 3), "b64_kb": len(b64) // 1024}
    t = time.perf_counter(); bm = page.render(scale=0.3); img = bm.to_pil(); b = BytesIO(); img.save(b, format="PNG"); row["thumb0.3_s"] = round(time.perf_counter() - t, 3); row["thumb_kb"] = len(b.getvalue()) // 1024
    # (3) the real CLI path
    row["cli_count"] = wall(PY + [PAGES_PY, "--file", p, "--count"])
    row["cli_thumb"] = wall(PY + [PAGES_PY, "--file", p, "--thumb"])
    row["cli_page0_scale3"] = wall(PY + [PAGES_PY, "--file", p, "--thumb", "--page", "0", "--scale", "3"])
    per.append(row)
    doc.close()
report["samples"] = per

# (4) outline API on a generated PDF with nested bookmarks
outline = {"pypdf": None}
try:
    from pypdf import PdfWriter
    w = PdfWriter()
    for i in range(4): w.add_blank_page(width=595, height=842)
    top = w.add_outline_item("Chapter 1 — Introduction", 0)
    w.add_outline_item("1.1 Scope", 1, parent=top)
    w.add_outline_item("1.2 Terms", 1, parent=top)
    w.add_outline_item("Chapter 2 — Body", 2)
    w.add_outline_item("Appendix", 3)
    outp = os.path.join(HERE, "_outline_test.pdf")
    with open(outp, "wb") as fh: w.write(fh)
    outline["pypdf"] = "ok"
    d = pdfium.PdfDocument(outp)
    items = []
    toc = d.get_toc()
    for it in toc:
        items.append({"title": getattr(it, "title", None), "page_index": getattr(it, "page_index", None), "level": getattr(it, "level", None),
                      "attrs": [a for a in dir(it) if not a.startswith("_")][:12]})
    outline["items"] = items
    outline["api"] = "PdfDocument.get_toc()"
    # a doc WITHOUT an outline → empty
    d2 = pdfium.PdfDocument(samples[0]); outline["corpus_doc_toc_len"] = len(list(d2.get_toc())); d2.close()
    d.close()
except Exception as e:
    outline["error"] = f"{e.__class__.__name__}: {e}"
report["outline"] = outline

out = os.path.join(HERE, "report.json")
with open(out, "w", encoding="utf-8") as fh: json.dump(report, fh, indent=1)
print(json.dumps(report, indent=1))
