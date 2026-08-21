"""Slice 0 probe: which letterhead ARM produced a fragment ('Cleaning') on a fixture, and what the
band/segments look like — through the REAL OCR path (extract_text_and_images + page0_words_out,
OCR_RENDER_DPI honoured, default 200 = the app). Read-only.
Usage: set OCR_RENDER_DPI=200 && py -3.12 s0_probe.py <pdf> [<pdf>...]"""
import os, sys
from pathlib import Path
os.environ.setdefault('OCR_RENDER_DPI', '200')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'python_backend'))
from ocr import tesseract as T                                 # noqa: E402
from extraction import letterhead as lh                       # noqa: E402
from extraction import chrome_band                            # noqa: E402
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')

for pdf in sys.argv[1:]:
    geom = {}
    text, _imgs = T.extract_text_and_images(Path(pdf), page0_words_out=geom)
    band = chrome_band.issuer_chrome_lines(text)
    print('=' * 100)
    print(os.path.basename(pdf), ' dpi', T._RENDER_DPI, ' geom rows', len(geom.get('rows') or []))
    print('BAND (issuer_chrome_lines):')
    for b in band[:8]:
        print('   |' + b.replace('    ', '␣␣␣␣') + '|')
    print('TEXT ARM (geometry=None):', repr(lh.pick_issuer(text, geometry=None)))
    print('GEOM ARM (page0 geometry):', repr(lh.pick_issuer_geometry(text, geom)))
    print('pick_issuer (as shipped, geometry arm first):', repr(lh.pick_issuer(text, geometry=geom)))
    if geom and geom.get('rows'):
        med = geom['med_h']
        by_text = {gl.strip(): i for i, gl in enumerate(geom['lines']) if gl.strip()}
        for bl in band[:5]:
            gi = by_text.get(bl.strip())
            if gi is None:
                print('   (band line not matched to a geometry row:', bl[:50], ')')
                continue
            segs = lh._row_segments(geom['lines'][gi].strip(), geom['rows'][gi])
            print(f"   row {gi}: " + ' | '.join(
                f"'{s}' h={lh._row_height(w)/med:.2f} cand={lh._is_geom_candidate(s, set())}" for s, w in segs))
