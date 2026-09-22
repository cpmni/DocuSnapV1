"""Summarise a cProfile dump of a single-document import: top cumulative entries + the calls that matter
(Tesseract subprocesses, page renders, the light-text / deskew / barcode / OSD passes).
Usage: py -3.12 pstats_top.py <prof.out>"""
import pstats
import sys

p = pstats.Stats(sys.argv[1])
total = p.total_tt
print(f"total time in profile: {total:.1f}s")
print("\n== top 28 by cumulative time (callee-inclusive) ==")
p.sort_stats('cumulative').print_stats(28)
print("\n== the levers ==")
KEYS = ['image_to_data', 'image_to_string', 'image_to_osd', 'run_tesseract', 'subprocess', 'render', 'pdfium', 'light', 'deskew', 'straight', 'barcode', 'zxing', 'orientation', 'reconstruct_page_text', 'decode', 'canonical', 'extract(']
for func, (cc, nc, tt, ct, callers) in sorted(p.stats.items(), key=lambda kv: -kv[1][3]):
    name = f"{func[0].split(chr(92))[-1].split('/')[-1]}:{func[1]}({func[2]})"
    if any(k in name for k in KEYS) and ct >= 0.2:
        print(f"{ct:7.2f}s cum  {tt:6.2f}s own  {nc:5d} calls  {name}")
