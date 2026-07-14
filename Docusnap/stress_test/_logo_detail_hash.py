"""_logo_detail_hash.py <docs.json> — render each PDF's page 1 and print its isolated-mark 256-bit
detail hash (colour + a bitonal/B&W-scan simulation), via python_backend/logo_detail. Helper for
stress_test/logo_detail_probe.js (the logo-discriminator GATE-0 gate)."""
import sys, json, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python_backend'))
import pypdfium2 as pdfium
from PIL import Image
import logo_detail as LD

docs = json.load(open(sys.argv[1], encoding='utf-8'))
out = {}
for p in docs:
    try:
        d = pdfium.PdfDocument(p)
        img = d[0].render(scale=200 / 72).to_pil().convert('RGB')
        d.close()
        bitonal = img.convert('L').point(lambda v: 0 if v < 128 else 255).convert('RGB')
        out[p] = {'colour': LD.detail_hash(img), 'bitonal': LD.detail_hash(bitonal)}
    except Exception as e:
        out[p] = {'error': str(e)}
print(json.dumps(out))
