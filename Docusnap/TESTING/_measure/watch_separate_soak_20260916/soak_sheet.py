"""soak_sheet.py <soakRoot> [prefix] — contact sheet of the FIRST page of every produced document (from produced.json),
labelled with id / name / pages / supplier / type / ref, so the split boundaries can be judged by eye.
Writes <soakRoot>/sheet_<prefix>.png (max 6 columns, thumbnails 220 px wide)."""
import json, os, sys
import pypdfium2 as pdfium
from PIL import Image, ImageDraw

root = sys.argv[1]
prefix = sys.argv[2] if len(sys.argv) > 2 else ''
docs = [d for d in json.load(open(os.path.join(root, 'produced.json'), encoding='utf-8')) if d['name'].startswith(prefix)]
W, H, PAD, TXT = 220, 300, 8, 58
cols = min(6, max(1, len(docs)))
rows = (len(docs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (W + PAD) + PAD, rows * (H + TXT + PAD) + PAD), 'white')
dr = ImageDraw.Draw(sheet)
for i, d in enumerate(docs):
    x = PAD + (i % cols) * (W + PAD); y = PAD + (i // cols) * (H + TXT + PAD)
    try:
        pdf = pdfium.PdfDocument(d['path']); pg = pdf[0]
        img = pg.render(scale=0.35).to_pil().convert('RGB'); img.thumbnail((W, H))
        sheet.paste(img, (x, y))
    except Exception as e:
        dr.rectangle([x, y, x + W, y + H], outline='red'); dr.text((x + 4, y + 4), f'render failed: {e}'[:40], fill='red')
    dr.rectangle([x, y, x + W, y + H], outline='gray')
    lines = [f"#{d['id']} {d['name']}"[:38], f"{d['pages']}p {d['status']}"[:38], f"{d['supplier'] or '-'}"[:38], f"{d['type'] or '-'} · {d['ref'] or '-'} · {d['date'] or '-'}"[:38]]
    for j, t in enumerate(lines): dr.text((x, y + H + 2 + j * 13), t, fill='black')
out = os.path.join(root, f'sheet_{prefix or "all"}.png'); sheet.save(out); print(out, f'{len(docs)} docs')
