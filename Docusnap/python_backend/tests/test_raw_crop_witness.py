#!/usr/bin/env python3.12
"""tests/test_raw_crop_witness.py — RAW-CROP WITNESS (gary → Oracle SIGN-OFF-W/COND C1-C6
2026-08-11, built 2026-08-12). The recipe-ladder confidence-inversion class (serif I→1, l→i,
ACC-229]): the untouched crop is read ONCE as a WITNESS; it may act only on a one-confusable-glyph
same-length difference against the PRE-repair rung string (C1 — post-repair strings differ in
LENGTH while the sep-guard is off, so a post-repair comparison heals zero documents), at BOTH
ladder exits. FLAG stashes the ambiguity; ADOPT (per census-evidenced pair) commits the witness
string VERBATIM.

Drives the REAL `_ocr_crop_laddered` — including the live `_repair_single_token` call site — with
SCRIPTED OCR reads (`_read_lines_full` + `_raw_witness_read` monkeypatched; the repair patched
per-pin where the length seam itself is the assertion). Run:
    py -3.12 python_backend/tests/test_raw_crop_witness.py
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from PIL import Image
from extraction import anchor

fails = 0
def check(label, cond, extra=''):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}{('  [' + str(extra) + ']') if (not cond and extra) else ''}")
    if not cond: fails += 1

CROP = Image.new('L', (200, 30), 255)   # <300px wide => witness in scope

def run(rung_text, witness_text, rung_conf=70.0, env=None, repair=None, val_type='alphanumeric'):
    """Scripted ladder run. rung_conf >= 60 exercises the GATE exit; < 60 the sub-floor exit."""
    old_rl, old_wit, old_rep = anchor._read_lines_full, anchor._raw_witness_read, anchor._repair_single_token
    saved = {}
    for k, v in (env or {}).items():
        saved[k] = os.environ.get(k)
        os.environ[k] = v
    try:
        anchor._read_lines_full = lambda img, psm: (rung_text, rung_conf, rung_conf, [])
        anchor._raw_witness_read = lambda crop, psm=7: witness_text
        if repair is not None:
            anchor._repair_single_token = repair
        meta = {}
        out = anchor._ocr_crop_laddered(CROP, val_type, verify_fn=None, meta=meta)
        return out, meta
    finally:
        anchor._read_lines_full, anchor._raw_witness_read, anchor._repair_single_token = old_rl, old_wit, old_rep
        for k, v in saved.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v

FLAG = {'RAW_CROP_WITNESS_FLAG': '1'}
ADOPT = {'RAW_CROP_WITNESS_ADOPT': '1', 'RAW_WITNESS_ADOPT_PAIRS': '1:I'}

print('1. OFF (no env) => byte-identical: value unchanged, no witness meta')
out, meta = run('P1/26/6000', 'PI/26/6000')
check('value = the ladder read', out == 'P1/26/6000', out)
check('no witness keys in meta', 'witness_alt' not in meta and 'witness_adopted' not in meta)

print('2. FLAG tier — GATE exit: value kept, ambiguity stashed (1/I confusable, same length)')
out, meta = run('P1/26/6000', 'PI/26/6000', env=FLAG)
check('value kept (FLAG never swaps)', out == 'P1/26/6000', out)
check('meta.witness_alt = the raw reading', meta.get('witness_alt') == 'PI/26/6000')
check('meta.witness_pair = [1, I]', meta.get('witness_pair') == ['1', 'I'])

print('3. C1 pin — comparison is on the PRE-repair string (repair strips separators)')
# The repair returns a length-8 string (the sep-guard-off reality). A post-repair comparison
# would see 8 vs 10 chars and go silent; the pre-repair comparison must still fire.
strip_repair = lambda img, seg, vt: seg.replace('/', '')
out, meta = run('P1/26/6000', 'PI/26/6000', env=FLAG, repair=strip_repair)
check('flag STILL fires with a separator-stripping repair (pre-repair frame)',
      meta.get('witness_alt') == 'PI/26/6000', meta)
check("today's (post-repair) value is what returns", out == 'P1266000', out)

print('4. ADOPT tier — census-gated per pair')
out, meta = run('P1/26/6000', 'PI/26/6000', env={'RAW_CROP_WITNESS_ADOPT': '1'})
check('ADOPT armed but NO pairs enabled => no swap (C3 census gate)', out == 'P1/26/6000', out)
out, meta = run('P1/26/6000', 'PI/26/6000', env=ADOPT, repair=strip_repair)
check('ADOPT + pair 1:I => the WITNESS string commits VERBATIM (separators survive)',
      out == 'PI/26/6000', out)
check('adoption provenance in meta', isinstance(meta.get('witness_adopted'), dict)
      and meta['witness_adopted'].get('pair') == ['1', 'I'])

print('5. Sub-floor exit (no rung gates) — witness applies there too (both-exits pin)')
out, meta = run('P1/26/6000', 'PI/26/6000', rung_conf=36.0, env=FLAG)
check('sub-floor best still flagged', meta.get('witness_alt') == 'PI/26/6000')
check('sub-floor value kept', out == 'P1/26/6000', out)

print('6. Licence bounds — each refusal leaves today exactly')
out, meta = run('P1/26/6000', 'PI/26/600', env=FLAG)          # length differs
check('length difference => silent', 'witness_alt' not in meta)
out, meta = run('P1/26/6000', 'PX/26/6000', env=FLAG)         # 1/X not confusable
check('non-confusable pair => silent', 'witness_alt' not in meta)
out, meta = run('P1/2b/6000', 'PI/26/6000', env=FLAG)         # two differences
check('two differences => silent', 'witness_alt' not in meta)
out, meta = run('P1/26/6000', 'P1/26/6000', env=FLAG)         # identical
check('identical reads => silent', 'witness_alt' not in meta)

print('7. Scope bounds')
out, meta = run('Brambiewood', 'Bramblewood', env=FLAG, val_type='text')
check('free-text val_type is OUT of scope (names have their own machinery)',
      'witness_alt' not in meta)
old_rl, old_wit = anchor._read_lines_full, anchor._raw_witness_read
try:
    anchor._read_lines_full = lambda img, psm: ('P1/26/6000', 70.0, 70.0, [])
    called = {'n': 0}
    def _wit(crop, psm=7):
        called['n'] += 1
        return 'PI/26/6000'
    anchor._raw_witness_read = _wit
    os.environ['RAW_CROP_WITNESS_FLAG'] = '1'
    wide = Image.new('L', (400, 30), 255)   # >=300px: _light_prep IS raw — witness must not run
    meta = {}
    anchor._ocr_crop_laddered(wide, 'alphanumeric', verify_fn=None, meta=meta)
    check('crops >=300px wide: witness never read (duplicate of the light rung)', called['n'] == 0)
finally:
    anchor._read_lines_full, anchor._raw_witness_read = old_rl, old_wit
    os.environ.pop('RAW_CROP_WITNESS_FLAG', None)

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(0 if fails == 0 else 1)
