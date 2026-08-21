"""Slice 0 census (Oracle S0-C1/S0-C2): over a fixture corpus, through the REAL OCR path, compare the
shipped geometry pick (flag OFF) with the fragment-abstain pick (flag ON) and the text arm, against
the filename ground truth. Reports: unchanged correct/wrong/None · abstained → text arm
correct / wrong / None · any NEW wrong pick (must be 0). Read-only.
Usage: py -3.12 s0_census.py <dir-of-pdfs> [limit]"""
import os, sys, glob, collections
os.environ.setdefault('OCR_RENDER_DPI', '200')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'python_backend'))
from pathlib import Path                                      # noqa: E402
from ocr import tesseract as T                                 # noqa: E402
from extraction import letterhead as lh                       # noqa: E402
T.configure(r'C:\Program Files\Tesseract-OCR\tesseract.exe')

import json
from extraction.engine import _letterhead_type_phrases
_PATTERNS = json.load(open(os.path.join(HERE, '..', '..', 'config', 'keyword_patterns.json'), encoding='utf-8'))
TYPE_PHRASES = _letterhead_type_phrases(_PATTERNS)   # the engine's own exclusion set

GT = {'castellan-security': 'castellan security systems', 'harrowgate-timber': 'harrowgate timber supplies',
      'ironclad-tool-hire': 'ironclad tool hire', 'meadowvale-dairy': 'meadowvale dairy',
      'nordwind-refrigeration': 'nordwind refrigeration', 'oakhaven-electrical': 'oakhaven electrical wholesale',
      'pelican-office': 'pelican office interiors', 'quillstone-print': 'quillstone print',
      'silverbeck-cleaning': 'silverbeck cleaning supplies', 'veltrix-automotive': 'veltrix automotive parts'}
def gt_of(fn):
    b = os.path.basename(fn).lower()
    for k, v in GT.items():
        if b.startswith(k):
            return v
    return None
def norm(s):
    return ' '.join(str(s or '').lower().replace('ltd', '').split())
def verdict(pick, gt):
    if pick is None:
        return 'None'
    p = norm(pick)
    return 'correct' if (p and (p in gt or gt in p) and len(p) >= 0.6 * len(gt)) else 'wrong'

d = sys.argv[1]
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10**9
files = sorted(glob.glob(os.path.join(d, '*.pdf')))[:limit]
C = collections.Counter()
rows = []
for i, f in enumerate(files):
    gt = gt_of(f)
    if not gt:
        continue
    geom = {}
    try:
        text, _ = T.extract_text_and_images(Path(f), page0_words_out=geom)
    except Exception as e:
        C['ocr-error'] += 1; continue
    os.environ['LETTERHEAD_FRAGMENT_ABSTAIN'] = '0'
    old = lh.pick_issuer(text, type_phrases=TYPE_PHRASES, geometry=geom)
    os.environ['LETTERHEAD_FRAGMENT_ABSTAIN'] = '1'
    new = lh.pick_issuer(text, type_phrases=TYPE_PHRASES, geometry=geom)
    txt = lh.pick_issuer(text, type_phrases=TYPE_PHRASES, geometry=None)
    vo, vn = verdict(old, gt), verdict(new, gt)
    if old == new:
        key = f'unchanged-{vo}'
    else:
        key = f'abstained(old={vo})->text-arm-{verdict(txt, gt)}'
        rows.append(f'  {os.path.basename(f):48} old={old!r:30} new={new!r:10} text={txt!r}')
    if vn == 'wrong' and vo != 'wrong':
        C['NEW-WRONG'] += 1
    C[key] += 1
    if (i + 1) % 20 == 0:
        print(f'  …{i+1}/{len(files)}', flush=True)
print(f'\nDOCS {sum(C.values())}')
for k, v in sorted(C.items(), key=lambda t: -t[1]):
    print(f'  {v:4}  {k}')
print('\nCHANGED DOCS:')
print('\n'.join(rows) if rows else '  (none)')
