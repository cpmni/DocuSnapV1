"""make_controls4.py OUT — the name rule's OWN failure controls: a continuation page (letterhead band, no marker) whose top
band carries "c/o <another known supplier>" (ctrl4_co_*) or "Delivered by <known haulier-like supplier>" (ctrl4_by_*)."""
import glob, json, os, sys
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
DEMO = os.path.join(os.path.expanduser('~'), 'Desktop', 'Demo Docs')
def font(sz):
    for f in (r"C:\Windows\Fonts\arial.ttf",): 
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
def src_page(sup, kind):
    c = sorted(glob.glob(os.path.join(DEMO, sup, kind, "**", "*.pdf"), recursive=True)); c = [p for p in c if "Processed" not in p] or c; return c[0]
def render(p): return pdfium.PdfDocument(p)[0].render(scale=200 / 72).to_pil().convert("RGB")
ITEMS = ["Description                     Qty     Unit      Amount", "Cable clips 20mm (box)           12     4.20       50.40",
         "Conduit 25mm x 3m                 8    11.90       95.20", "", "Sub total                                       145.60", "Total                                            174.72"]
gt = {}
for sup, other, tag in [("Copperfield Electrical", "Thornbury Fasteners", "copperfield"), ("Thornbury Fasteners", "Saltmarsh Seafoods", "thornbury")]:
    p1 = render(src_page(sup, "invoice")); W, H = p1.size; band = p1.crop((0, 0, W, int(H * 0.16)))
    for variant, line in (("co", f"c/o {other}"), ("by", f"Delivered by {other}")):
        p2 = Image.new("RGB", (W, H), "white"); p2.paste(band, (0, 0)); d = ImageDraw.Draw(p2)
        d.text((int(W * 0.06), int(H * 0.175)), line, fill="black", font=font(int(H * 0.016)))
        f = font(int(H * 0.014))
        for k, l in enumerate(ITEMS): d.text((int(W * 0.06), int(H * 0.22) + k * int(H * 0.022)), l, fill="black", font=f)
        name = f"ctrl4_{variant}_{tag}.pdf"; p1.save(os.path.join(out, name), "PDF", resolution=200.0, save_all=True, append_images=[p2])
        gt[name] = {"page_count": 2, "docs": [{"pages": [1, 2], "src": tag, "label": f"{sup} invoice; p2 = letterhead + '{line}' + items, no marker — must NOT split"}]}
        print(name)
json.dump(gt, open(os.path.join(out, "gt_controls4.json"), "w"), indent=1)
