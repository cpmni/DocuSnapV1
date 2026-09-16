"""make_controls3.py OUT_DIR — the KNOWN-SUPPLIER-NAME rule's own failure controls (B2B: the customer trades both ways):
  ctrl3_b2b_<sup>.pdf   p1 = a real <sup> invoice scan with a "Bill To" block naming ANOTHER known supplier stamped in
                        the top band; p2 = the same letterhead band + line items, NO marker → must NOT split
  ctrl3_b2bmk_<sup>.pdf the same with "Page 2 of 2" on p2 (the veto's case)                     → must NOT split
  ctrl3_switch_<sup>.pdf a 2-doc stack: <sup> invoice p1 (Bill To: known other) + a DIFFERENT known supplier's real
                        scan as p2 → MUST cut at p2 (the true identity change, with a B2B name on p1)
"""
import glob, json, os, sys
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
DEMO = os.path.join(os.path.expanduser('~'), 'Desktop', 'Demo Docs')
def font(sz):
    for f in (r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\segoeui.ttf"):
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
def src_page(sup, kind, idx=0):
    c = sorted(glob.glob(os.path.join(DEMO, sup, kind, "**", "*.pdf"), recursive=True)); c = [p for p in c if "Processed" not in p] or c
    return c[idx % len(c)]
def render(p, i=0): return pdfium.PdfDocument(p)[i].render(scale=200 / 72).to_pil().convert("RGB")
ITEMS = ["Description                     Qty     Unit      Amount", "Cable clips 20mm (box)           12     4.20       50.40",
         "Conduit 25mm x 3m                 8    11.90       95.20", "Labour - second fix (hrs)        14    38.00      532.00",
         "", "Sub total                                       721.70", "VAT 20%                                          144.34", "Total                                            866.04"]
def body(d, W, H, y, lines):
    f = font(int(H * 0.014))
    for k, line in enumerate(lines): d.text((int(W * 0.06), y + k * int(H * 0.022)), line, fill="black", font=f)
gt = {}
PAIRS = [("Copperfield Electrical", "Thornbury Fasteners", "copperfield"), ("Thornbury Fasteners", "Copperfield Electrical", "thornbury")]
for sup, other, tag in PAIRS:
    p1 = render(src_page(sup, "invoice")); W, H = p1.size
    # stamp a B2B recipient block INTO the top band (right column, under the letterhead line) — the other KNOWN supplier
    d = ImageDraw.Draw(p1)
    for k, line in enumerate(["Bill To", other, "12 Trade Park", "Bristol BS1 4TT"]):
        d.text((int(W * 0.55), int(H * 0.10) + k * int(H * 0.018)), line, fill="black", font=font(int(H * 0.015)))
    band = p1.crop((0, 0, W, int(H * 0.09)))   # letterhead only (above the stamped block)
    for variant, marker in (("b2b", None), ("b2bmk", "Page 2 of 2")):
        p2 = Image.new("RGB", (W, H), "white"); p2.paste(band, (0, 0)); dd = ImageDraw.Draw(p2)
        body(dd, W, H, int(H * 0.20), ITEMS)
        if marker: dd.text((int(W * 0.80), int(H * 0.96)), marker, fill="black", font=font(int(H * 0.014)))
        name = f"ctrl3_{variant}_{tag}.pdf"; p1.save(os.path.join(out, name), "PDF", resolution=200.0, save_all=True, append_images=[p2])
        gt[name] = {"page_count": 2, "docs": [{"pages": [1, 2], "src": tag, "label": f"{sup} invoice whose Bill To names {other} (a known supplier); p2 continuation{' + Page 2 of 2' if marker else ' (no marker)'} — must NOT split"}]}
        print(name)
    q1 = render(src_page(other, "invoice", 1))
    name = f"ctrl3_switch_{tag}.pdf"; p1.save(os.path.join(out, name), "PDF", resolution=200.0, save_all=True, append_images=[q1])
    gt[name] = {"page_count": 2, "docs": [{"pages": [1, 1], "src": tag, "label": f"{sup} invoice (Bill To {other})"}, {"pages": [2, 2], "src": "other", "label": f"{other}'s own invoice — MUST cut here"}]}
    print(name)
json.dump(gt, open(os.path.join(out, "gt_controls3.json"), "w"), indent=1)
