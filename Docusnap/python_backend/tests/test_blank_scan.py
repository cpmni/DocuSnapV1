#!/usr/bin/env python3
"""
tests/test_blank_scan.py
------------------------
Pins render/pages.py --blank-scan (oscar 2026-09-20): ink-coverage + spatial-concentration blank
detection for the graphical split popout. Fixtures are built with Pillow (already shipped — pdfium's
to_pil() uses it) as image-PDFs, so the measure runs on a real raster the way it will in production.

Asserts the load-bearing behaviours:
  - a clearly inked page          -> 'not_blank'
  - a pure-white page             -> 'very_likely' blank
  - a small CONCENTRATED mark     -> NEVER 'very_likely' (a signature/stamp must not be auto-offered for removal)
  - a faint diffuse wash (bleed)  -> detected as blank, NOT 'not_blank' (the contrast gap rejects bleed-through)

    py -3.12 python_backend/tests/test_blank_scan.py
"""

import sys, os, json, tempfile, subprocess
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).parent.parent
fails = 0


def check(label, cond, detail=''):
    global fails
    ok = bool(cond)
    print(f"  {'OK ' if ok else 'BAD'} {label}" + (f' — {detail}' if detail else ''))
    if not ok:
        fails += 1


def build_pdf(path):
    W, Hh = 850, 1100
    # p1 — clearly inked: a big black block + text bars
    p1 = Image.new('L', (W, Hh), 255); d = ImageDraw.Draw(p1)
    d.rectangle([100, 100, 750, 400], fill=0)
    for y in range(500, 900, 40):
        d.rectangle([100, y, 700, y + 18], fill=0)
    # p2 — pure white blank
    p2 = Image.new('L', (W, Hh), 255)
    # p3 — a small concentrated mark (signature-like) in one region
    p3 = Image.new('L', (W, Hh), 255); d3 = ImageDraw.Draw(p3)
    d3.rectangle([120, 950, 320, 1010], fill=10)      # concentrated, low total coverage
    # p4 — a faint diffuse wash (bleed-through ghosting): light grey, only ~20 below paper
    p4 = Image.new('L', (W, Hh), 235)
    imgs = [p.convert('RGB') for p in (p1, p2, p3, p4)]
    imgs[0].save(path, save_all=True, append_images=imgs[1:])


def main():
    with tempfile.TemporaryDirectory() as tmp:
        pdf = Path(tmp) / 'blank_fixture.pdf'
        build_pdf(pdf)
        script = ROOT / 'render' / 'pages.py'
        res = subprocess.run([sys.executable, str(script), '--file', str(pdf), '--blank-scan'],
                             capture_output=True, text=True)
        try:
            out = json.loads(res.stdout.strip())
        except json.JSONDecodeError:
            print(f'  BAD --blank-scan produced non-JSON: {res.stdout!r}\n{res.stderr}')
            return 1
        blanks = {b['page']: b for b in out.get('blanks', [])}
        check('4 pages measured', out.get('pages') == 4 and len(blanks) == 4, str(out))
        if len(blanks) == 4:
            check("p1 (inked block) -> not_blank",        blanks[1]['verdict'] == 'not_blank', str(blanks[1]))
            check("p2 (pure white) -> very_likely blank",  blanks[2]['verdict'] == 'very_likely', str(blanks[2]))
            check("p3 (small concentrated mark) is NOT very_likely (won't be auto-offered)",
                  blanks[3]['verdict'] != 'very_likely', str(blanks[3]))
            check("p4 (faint diffuse wash / bleed) detected as blank, not not_blank",
                  blanks[4]['verdict'] != 'not_blank', str(blanks[4]))
            check("p1 coverage clearly higher than p2", blanks[1]['coverage_pct'] > blanks[2]['coverage_pct'])
    print()
    if fails:
        print(f'{fails} check(s) FAILED.')
        return 1
    print('All blank-scan checks passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
