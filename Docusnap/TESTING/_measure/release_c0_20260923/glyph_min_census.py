#!/usr/bin/env python3
"""Oracle C1 (2026-09-23, confusable RELEASE): publish PP-OCR's per-glyph MIN confidence on the filtered
census's on-disk soften slices — the 14 correct agrees, the 4 crop-wrong disagrees, and every synthetic
CLIP slice (incl. the both-wrong `30-82482`) — so the RELEASE's per-glyph floor T is set from data.

Usage: py -3.12 glyph_min_census.py "<Desktop\\TEMPTEST_dual_reader_absent>"
"""
import sys, csv
from pathlib import Path
HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[3] / "python_backend"))
from PIL import Image
from ocr import glyph_reader as gr

out = Path(sys.argv[1])
rows = list(csv.DictReader(open(out / "absent_log.csv", encoding="utf-8", newline="")))
soft = [r for r in rows if r["soften"] == "1"]
print(f"engine available: {gr.available()}")
print(f"{'idx':>5} {'kind':6} {'crop(tess)':12} {'pp text':14} {'mean':>6} {'min':>6}  agree")
for r in soft:
    for kind, p in (("narrow", Path(r["slice_path"])),
                    ("CLIP", out / "slices" / (Path(r["slice_path"]).stem + "__CLIP.png"))):
        if not p.exists():
            continue
        res = gr.read_crop(gr.prep_crop(Image.open(p).convert("RGB")))
        if not res:
            print(f"{r['idx']:>5} {kind:6} {r['tess_read']:12} {'<none>':14}"); continue
        txt, mean, gmin = res
        import re
        al = lambda s: re.sub(r"[^A-Za-z0-9]", "", s).upper()
        agree = al(txt) == al(r["tess_read"])
        print(f"{r['idx']:>5} {kind:6} {r['tess_read']:12} {txt:14} {mean:6.3f} {gmin:6.3f}  {'Y' if agree else 'n'}")
