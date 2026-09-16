"""make_controls.py OUT_DIR — genuine 2-page docs from a MULTI-TYPE-templated supplier (Copperfield: 5 sibling templates;
Thornbury: 3) whose page 2 repeats the LETTERHEAD:  ctrl_i_*  = letterhead + line items only (no heading);
ctrl_ii_* = letterhead + the SAME trusted heading + "Page 2 of 2" (the accepted exposure). GT: one doc each."""
import glob, json, os, sys
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
DEMO = os.path.join(os.path.expanduser('~'), 'Desktop', 'Demo Docs')
def font(sz):
    for f in (r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\segoeui.ttf"):
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
gt = {}
for sup, kind, heading, tag in [("Copperfield Electrical", "invoice", "INVOICE", "copperfield"), ("Thornbury Fasteners", "invoice", "INVOICE", "thornbury"),
                                 ("Copperfield Electrical", "sales_order", "SALES ORDER", "copperfield_so")]:
    cands = sorted(glob.glob(os.path.join(DEMO, sup, kind, "**", "*.pdf"), recursive=True))
    src = ([p for p in cands if "Processed" not in p] or cands)[0]
    page = pdfium.PdfDocument(src)[0]
    p1 = page.render(scale=200 / 72).to_pil().convert("RGB")
    W, H = p1.size
    band = p1.crop((0, 0, W, int(H * 0.16)))          # the letterhead band (logo + name + address)
    for variant in ("i", "ii"):
        p2 = Image.new("RGB", (W, H), "white"); p2.paste(band, (0, 0)); d = ImageDraw.Draw(p2)
        y = int(H * 0.19)
        if variant == "ii":
            d.text((int(W * 0.06), y), heading, fill="black", font=font(int(H * 0.028))); y += int(H * 0.05)
            d.text((int(W * 0.06), y), "Page 2 of 2", fill="black", font=font(int(H * 0.016))); y += int(H * 0.05)
        else:
            d.text((int(W * 0.06), y), "(continued)", fill="black", font=font(int(H * 0.016))); y += int(H * 0.05)
        f = font(int(H * 0.014))
        for k, line in enumerate(["Description                     Qty     Unit      Amount",
                                  "Cable clips 20mm (box)           12     4.20       50.40",
                                  "Conduit 25mm x 3m                 8    11.90       95.20",
                                  "Junction box IP65                 6     7.35       44.10",
                                  "Labour - second fix (hrs)        14    38.00      532.00",
                                  "", "Sub total                                       721.70",
                                  "VAT 20%                                          144.34",
                                  "Total                                            866.04",
                                  "", "Payment terms 30 days. Thank you for your business."]):
            d.text((int(W * 0.06), y + k * int(H * 0.022)), line, fill="black", font=f)
        name = f"ctrl_{variant}_{tag}.pdf"
        p1.save(os.path.join(out, name), "PDF", resolution=200.0, save_all=True, append_images=[p2])
        gt[name] = {"page_count": 2, "docs": [{"pages": [1, 2], "src": os.path.relpath(src, os.path.expanduser('~')), "label": f"genuine 2-page {kind} of a multi-type supplier — p2 repeats the letterhead{' + the trusted heading + Page 2 of 2' if variant == 'ii' else ' only'} — must NOT split"}]}
        print(name)
json.dump(gt, open(os.path.join(out, "gt_controls.json"), "w"), indent=1)
