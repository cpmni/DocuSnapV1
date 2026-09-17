"""make_controls4b.py OUT — BARE continuation pages (no letterhead) whose first lines carry "c/o <known supplier>" (must NOT split)."""
import glob, json, os, sys
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
DEMO = os.path.join(os.path.expanduser('~'), 'Desktop', 'Demo Docs')
def font(sz): return ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", sz)
def src_page(sup, kind):
    c = sorted(glob.glob(os.path.join(DEMO, sup, kind, "**", "*.pdf"), recursive=True)); c = [p for p in c if "Processed" not in p] or c; return c[0]
gt = json.load(open(os.path.join(out, "gt_controls4.json"), encoding="utf-8")) if os.path.exists(os.path.join(out, "gt_controls4.json")) else {}
for sup, other, tag in [("Copperfield Electrical", "Thornbury Fasteners", "copperfield"), ("Thornbury Fasteners", "Saltmarsh Seafoods", "thornbury")]:
    p1 = pdfium.PdfDocument(src_page(sup, "invoice"))[0].render(scale=200 / 72).to_pil().convert("RGB"); W, H = p1.size
    p2 = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(p2); f = font(int(H * 0.015))
    for k, l in enumerate([f"c/o {other}", "Unit 4, Trade Park", "", "Description                     Qty     Unit      Amount", "Cable clips 20mm (box)           12     4.20       50.40",
                           "Conduit 25mm x 3m                 8    11.90       95.20", "", "Sub total                                       145.60", "Total                                            174.72"]):
        d.text((int(W * 0.06), int(H * 0.08) + k * int(H * 0.024)), l, fill="black", font=f)
    name = f"ctrl4_bareco_{tag}.pdf"; p1.save(os.path.join(out, name), "PDF", resolution=200.0, save_all=True, append_images=[p2])
    gt[name] = {"page_count": 2, "docs": [{"pages": [1, 2], "src": tag, "label": f"{sup} invoice; p2 = BARE page starting 'c/o {other}', no letterhead, no marker — must NOT split"}]}
    print(name)
json.dump(gt, open(os.path.join(out, "gt_controls4.json"), "w"), indent=1)
