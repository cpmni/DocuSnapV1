#!/usr/bin/env python3
"""
Build contact sheets of CONFIDENT-AGREE slices (both readers ≥80 and equal), each captioned with the
agreed read, so a human/Claude can eyeball dozens at once and count any where the slice image does NOT
match the agreed value (a common-mode error — both readers confidently wrong).

Prioritises confusable-bearing values (0/O,1/I,5/S,8/B,2/Z,6/G) and includes every field type.

Usage: py -3.12 contact_sheet.py "<out_dir>" [per_sheet] [max_total]
"""
import sys, csv, re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path(sys.argv[1])
PER = int(sys.argv[2]) if len(sys.argv) > 2 else 30
MAXT = int(sys.argv[3]) if len(sys.argv) > 3 else 150

rows = [r for r in csv.DictReader(open(out / "detection_log.csv", encoding="utf-8"))
        if r["agree"] == "1" and float(r["tess_conf"]) >= 80 and float(r["pp_conf"]) >= 80]

CONF = set("0O1I5S8B2Z6G")
def conf_score(r):
    v = r["pp_read"].upper()
    return sum(1 for c in v if c in CONF)

# spread across suppliers, prioritise confusable-heavy, guarantee field coverage
rows.sort(key=lambda r: (-conf_score(r), r["supplier"], r["doc"]))
# de-dupe by (supplier, field) a bit so it's not all one supplier's SO- refs
seen = {}
picked = []
for r in rows:
    k = (r["supplier"], r["field"])
    seen[k] = seen.get(k, 0) + 1
    if seen[k] <= 6:            # up to 6 per supplier+field
        picked.append(r)
    if len(picked) >= MAXT:
        break

try:
    font = ImageFont.truetype("arial.ttf", 22)
except Exception:
    font = ImageFont.load_default()

CELL_H = 60
LABEL_W = 620
SLICE_W = 360
sheets = 0
for s in range(0, len(picked), PER):
    batch = picked[s:s + PER]
    W = LABEL_W + SLICE_W + 20
    H = CELL_H * len(batch) + 20
    canvas = Image.new("RGB", (W, H), "white")
    dr = ImageDraw.Draw(canvas)
    y = 10
    for r in batch:
        cap = f"{r['field']}: '{r['pp_read']}'  (T{r['tess_conf']}/P{r['pp_conf']})  {r['doc'][:34]}"
        dr.text((8, y + 18), cap, fill="black", font=font)
        try:
            im = Image.open(out / r["slice"]).convert("RGB")
            scale = min(SLICE_W / im.width, (CELL_H - 8) / im.height)
            im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
            canvas.paste(im, (LABEL_W, y + 2))
        except Exception as e:
            dr.text((LABEL_W, y + 18), f"[missing slice]", fill="red", font=font)
        dr.line((0, y, W, y), fill="#cccccc")
        y += CELL_H
    sheets += 1
    canvas.save(out / f"contact_sheet_{sheets:02d}.png")
print(f"{len(picked)} confident-agree cells over {sheets} sheet(s) -> {out}/contact_sheet_*.png")
print(f"(sorted confusable-heavy first; up to 6 per supplier+field)")
