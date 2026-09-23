#!/usr/bin/env python3
"""Contact sheet of the EXACT crops the second reader was handed (trace `slice` events with stage=glyph), captioned
with the box read, PP's read + confidence and the outcome — so a false hold / a common-mode agreement can be judged
against the pixels. Usage: py -3.12 glyph_slice_sheet.py <trace.jsonl> <out.png> [<consensus.jsonl>]"""
import sys, json, re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

tr = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
gt = {}
if len(sys.argv) > 3:
    for l in open(sys.argv[3], encoding="utf-8"):
        if l.strip():
            r = json.loads(l); gt[r["id"]] = r
idof = lambda d: (re.search(r"doc(\d+)\.pdf", str(d)) or [None, None])[1]
by = {}
for e in tr:
    by.setdefault(e.get("doc"), []).append(e)
tiles = []
for doc, evs in by.items():
    slices = [e for e in evs if e.get("event") == "slice" and e.get("stage") == "glyph"]
    verdicts = [e for e in evs if e.get("event") in ("glyph_check", "glyph_disagreement", "glyph_resolve")]
    for s in slices:
        v = verdicts[0] if verdicts else {}
        out = ("DISAGREE" if v.get("event") == "glyph_disagreement" else
               f"{'RESOLVE:' if v.get('event') == 'glyph_resolve' else ''}{v.get('outcome', '?')}{(':' + v['reason']) if v.get('reason') else ''}")
        did = idof(doc); g = gt.get(int(did)) if did and did.isdigit() else None
        tiles.append({"path": s["path"], "doc": doc, "tag": s.get("tag", ""),
                      "cap": f"#{did} box='{v.get('committed', '')}' pp='{v.get('pp_read', '')}' ({v.get('pp_conf', '')}) {out}"
                             + (f" boxOK={g['ref']['correct']}" if g and g.get('ref') else "")})
tiles.sort(key=lambda t: int(idof(t["doc"]) or 0))
cols, cw, ch = 2, 640, 150
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cw, max(1, rows) * ch), "white"); d = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype("arial.ttf", 14)
except Exception: font = ImageFont.load_default()
for i, t in enumerate(tiles):
    x = (i % cols) * cw; y = (i // cols) * ch
    try:
        im = Image.open(t["path"]).convert("RGB")
        sc = min((cw - 20) / im.width, 80 / im.height, 4.0)
        im = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))), Image.LANCZOS)
        sheet.paste(im, (x + 10, y + 8))
    except Exception as ex:
        d.text((x + 10, y + 20), f"(missing {t['path']}: {ex})", fill="red", font=font)
    d.text((x + 10, y + 96), t["cap"][:95], fill="black", font=font)
    d.text((x + 10, y + 114), f"{t['doc']} · {t['tag']}"[:95], fill=(90, 90, 90), font=font)
    d.rectangle([x, y, x + cw - 1, y + ch - 1], outline=(200, 200, 200))
sheet.save(sys.argv[2]); print(f"{len(tiles)} tiles → {sys.argv[2]}")
