"""Slice 1 units for the targeted gate-failure re-read (ocr/targeted_reread.py).

Pure: no images, no Tesseract — the heavy deps (ladder/crop/image_to_data) are injected as
stubs, so this exercises the ADOPTION PREDICATE, the LOCATE, and the orchestration SEAM only.
ASCII-only output (a non-ASCII arrow once crashed a sibling test on the Windows cp1252 console).

Run:  py -3.12 tests/test_gate_fail_reread.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # python_backend/

from ocr import targeted_reread as tr           # noqa: E402
from extraction import format_anomaly_checker as fac   # noqa: E402

_fails = []


def check(name, cond):
    print(("OK   " if cond else "BAD  ") + name)
    if not cond:
        _fails.append(name)


# ── fixture: a Bramble sales-order-number format (learned SO-##### shape) ──────
REF_VALUES = ['SO-51337', 'SO-66820', 'SO-27481', 'SO-33736', 'SO-55005']
ENTRY = fac.classify_format(REF_VALUES, {v: 5 for v in REF_VALUES})
GARBLE = 'S0O-51337'      # the fused-glyph read that Stage 4.5 withholds; true value SO-51337

print("-- fixture preconditions --")
check('fixture learned a shape constraint', bool(ENTRY.get('shapes')))
check('true value is format-clean', fac.check_value('SO-51337', ENTRY) is None)
check('garbled value is withheld (format anomaly)', fac.check_value(GARBLE, ENTRY) is not None)

# ── is_adoptable ──────────────────────────────────────────────────────────────
print("-- is_adoptable --")
check('adopts a clean, kin re-read', tr.is_adoptable('SO-51337', ENTRY, GARBLE) is True)
check('rejects the garble itself (gate-failing)', tr.is_adoptable(GARBLE, ENTRY, GARBLE) is False)
check('rejects wrong-instance gate-valid value (kin > 2)',
      tr.is_adoptable('SO-99999', ENTRY, GARBLE) is False)
check('rejects charset-dirty candidate', tr.is_adoptable('SO@51337', ENTRY, GARBLE) is False)
check('rejects empty', tr.is_adoptable('', ENTRY, GARBLE) is False)
check('rejects None', tr.is_adoptable(None, ENTRY, GARBLE) is False)
check('config pattern gate rejects a mismatch',
      tr.is_adoptable('SO-51337', ENTRY, GARBLE, config_pattern=r'XX-\d+') is False)
check('config pattern gate passes a match',
      tr.is_adoptable('SO-51337', ENTRY, GARBLE, config_pattern=r'SO-\d{5}') is True)
check('a broken config pattern never blocks a clean kin candidate',
      tr.is_adoptable('SO-51337', ENTRY, GARBLE, config_pattern=r'SO-(') is True)

# kinship boundary: exactly 2 edits adopted, 3 rejected (shape permitting)
check('kinship helper: identical = 0', tr._levenshtein('so51337', 'so51337') == 0)
check('kinship helper: one deletion = 1', tr._levenshtein('so51337', 's0o51337') == 1)
check('kinship helper: bounded returns cap+1 past cap', tr._levenshtein('abcdef', 'zzzzzz', cap=2) == 3)


# ── locate ────────────────────────────────────────────────────────────────────
def page(words):
    """words: (text,left,top,w,h,block,par,line) -> image_to_data DICT (conf 90, seq word_num)."""
    keys = ['text', 'left', 'top', 'width', 'height', 'conf', 'block_num', 'par_num', 'line_num', 'word_num']
    d = {k: [] for k in keys}
    wn = {}
    for (t, l, tp, w, h, b, p, ln) in words:
        d['text'].append(t); d['left'].append(l); d['top'].append(tp)
        d['width'].append(w); d['height'].append(h); d['conf'].append(90)
        d['block_num'].append(b); d['par_num'].append(p); d['line_num'].append(ln)
        wk = (b, p, ln); wn[wk] = wn.get(wk, 0) + 1
        d['word_num'].append(wn[wk])
    return d


print("-- locate_value_region --")
pd_single = page([('Order', 10, 100, 60, 20, 1, 1, 1), ('No', 80, 100, 30, 20, 1, 1, 1),
                  (GARBLE, 120, 100, 120, 20, 1, 1, 1)])
box = tr.locate_value_region(pd_single, GARBLE)
check('single-word garble locates', box is not None and box[0] == 120 and box[2] == 120)

pd_split = page([('Serial', 10, 100, 50, 20, 1, 1, 1), ('1', 70, 100, 10, 20, 1, 1, 1),
                 ('102V03NL1', 85, 100, 110, 20, 1, 1, 1)])
box = tr.locate_value_region(pd_split, '1 102V03NL1')
check('inserted-space garble locates as an n-gram',
      box is not None and box[0] == 70 and (box[0] + box[2]) == 195)

pd_ambig = page([(GARBLE, 10, 100, 120, 20, 1, 1, 1), (GARBLE, 10, 300, 120, 20, 2, 1, 1)])
check('two equal matches on different lines, no label -> abstain',
      tr.locate_value_region(pd_ambig, GARBLE) is None)

pd_ambig_lab = page([('Order', 10, 100, 60, 20, 1, 1, 1), (GARBLE, 80, 100, 120, 20, 1, 1, 1),
                     ('Total', 10, 300, 50, 20, 2, 1, 1), (GARBLE, 80, 300, 120, 20, 2, 1, 1)])
box = tr.locate_value_region(pd_ambig_lab, GARBLE, label='Order')
check('label adjacency breaks the tie (picks the Order-row value)',
      box is not None and box[1] == 100)

check('garble absent from page -> abstain',
      tr.locate_value_region(page([('Hello', 10, 10, 40, 20, 1, 1, 1)]), GARBLE) is None)


# ── orchestration + seam #1 ─────────────────────────────────────────────────────
print("-- reread_field_value (orchestration) --")
PAGE_DATA = page([('Order', 10, 100, 60, 20, 1, 1, 1), (GARBLE, 80, 100, 120, 20, 1, 1, 1)])


def i2d(_img):
    return PAGE_DATA


def read_gatefail(_img, _box, _vt, _verify):
    return GARBLE                       # reader's best FAILING segment (non-None != adopted)


def read_good(_img, _box, _vt, _verify):
    return 'SO-51337'                   # a clean, kin read


c = {}
check('gate-failing reader return is NOT adopted (seam #1)',
      tr.reread_field_value(['img0'], GARBLE, 'Order', 'text', ENTRY, c,
                            i2d_fn=i2d, read_region_fn=read_gatefail) is None)
c = {}
check('a clean, kin reader return IS adopted',
      tr.reread_field_value(['img0'], GARBLE, 'Order', 'text', ENTRY, c,
                            i2d_fn=i2d, read_region_fn=read_good) == 'SO-51337')


def i2d_miss(_img):
    return page([('Nothing', 10, 10, 40, 20, 1, 1, 1)])


check('locate abstains -> None (withhold stands)',
      tr.reread_field_value(['img0'], GARBLE, 'Order', 'text', ENTRY, {},
                            i2d_fn=i2d_miss, read_region_fn=read_good) is None)
check('missing injected callable -> None (safe default)',
      tr.reread_field_value(['img0'], GARBLE, 'Order', 'text', ENTRY, {}, i2d_fn=i2d) is None)
check('no page images -> None',
      tr.reread_field_value([], GARBLE, 'Order', 'text', ENTRY, {},
                            i2d_fn=i2d, read_region_fn=read_good) is None)

# provenance gate: a born-digital page (page_ok False) is skipped -> abstain
check('page_ok False (born-digital) -> abstain',
      tr.reread_field_value(['img0'], GARBLE, 'Order', 'text', ENTRY, {},
                            page_ok=lambda _i: False, i2d_fn=i2d, read_region_fn=read_good) is None)
check('page_ok True (ocr) -> adopts',
      tr.reread_field_value(['img0'], GARBLE, 'Order', 'text', ENTRY, {},
                            page_ok=lambda _i: True, i2d_fn=i2d, read_region_fn=read_good) == 'SO-51337')

calls = {'n': 0}


def i2d_count(_img):
    calls['n'] += 1
    return PAGE_DATA


shared = {}
tr.reread_field_value(['img0'], GARBLE, 'Order', 'text', ENTRY, shared,
                      i2d_fn=i2d_count, read_region_fn=read_good)
tr.reread_field_value(['img0'], GARBLE, 'Order', 'text', ENTRY, shared,
                      i2d_fn=i2d_count, read_region_fn=read_good)
check('image_to_data is cached per page (1 call across 2 fields)', calls['n'] == 1)

print()
if _fails:
    print("FAILED: %d" % len(_fails))
    for f in _fails:
        print("   - " + f)
    sys.exit(1)
print("All targeted-reread slice-1 checks passed")
