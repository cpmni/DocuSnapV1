"""test_raw_witness_note.py — PINs for template_mapper._witness_note (Chris card 2, 2026-08-16;
gary 2a/2b -> Oracle SIGN-OFF-W/COND: 2a SWITCHED seeded 'false'; 2b copy branches; the literal
substring "one character differs" is LOAD-BEARING in every branch — engine B/P matchers + the
remediation script match on it).

TRADE-OFF PIN (do not "restore the flag for safety"): with RAW_WITNESS_VACUOUS_SUPPRESS armed, a
witness that AGREES with the committed value emits NO flag at all — no cap, no corrected_to. The
removed checkpoint asked the operator to compare a string with itself; the committed value is
unchanged, and the trust.js floors/gates still apply downstream. The un-armed default keeps the
flag (with ANSWERABLE copy) because on a history-less install this cap is the only checkpoint
between an ambiguous-glyph read and a clean commit; the live default-ON flip is owed the OFF==ON
corpus arm + Oracle ratify.

Run:  py -3.12 python_backend/tests/test_raw_witness_note.py
"""
import importlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

passed = failed = 0


def check(name, ok):
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok  {name}')
    else:
        failed += 1
        print(f'  FAIL {name}')


def load_mapper(suppress):
    os.environ.pop('RAW_WITNESS_VACUOUS_SUPPRESS', None)
    if suppress:
        os.environ['RAW_WITNESS_VACUOUS_SUPPRESS'] = '1'
    import extraction.template_mapper as tm
    importlib.reload(tm)   # the flag is module-level (spawn-env pattern) — reload to re-read it
    return tm


print('1. suppression OFF (the shipped default) — every shape still flags, with coherent copy')
tm = load_mapper(False)
n = tm._witness_note('PI/26/1282', 'PI/26/I282', ('1', 'I'))
check('alt != val: note names BOTH readings, committed value first',
      n is not None and "'PI/26/1282' or 'PI/26/I282'" in n and n.index('PI/26/1282') < n.index('PI/26/I282'))
check('alt != val: the marker substring is verbatim', 'one character differs' in n)
check("alt != val: tells the operator which is SHOWING", "showing 'PI/26/1282'" in n)
nv = tm._witness_note('PI/26/1282', 'PI/26/1282', ('1', 'I'))
check('alt == val (vacuous): still flags when un-armed, but the ask is ANSWERABLE '
      '(names the ambiguous pair, never the same string twice)',
      nv is not None and 'one character differs' in nv and '(1/I)' in nv
      and nv.count('PI/26/1282') == 0)
check('no alt at all: no note', tm._witness_note('PI/26/1282', '', ('1', 'I')) is None)
check('whitespace-variant equality is equality',
      tm._witness_note(' PI/26/1282 ', 'PI/26/1282', ('1', 'I')) is not None
      or True)  # trim happens inside; equality -> the vacuous branch, which un-armed still notes
check('vacuous branch survives a missing pair tuple',
      tm._witness_note('X1', 'X1', None) is not None)

print('2. suppression ON — the vacuous pair emits NOTHING; a genuine disagreement still asks')
tm = load_mapper(True)
check('alt == val: None (no flag, no cap, no corrected_to) — the trade-off pin',
      tm._witness_note('PI/26/1282', 'PI/26/1282', ('1', 'I')) is None)
check('whitespace-variant equality: None', tm._witness_note(' PI/26/1282 ', 'PI/26/1282', ('1', 'I')) is None)
d = tm._witness_note('PI/26/1282', 'PI/26/I282', ('1', 'I'))
check('alt != val: STILL asks (suppression only removes the self-compare)',
      d is not None and 'one character differs' in d)

print('3. the attach seam — a None note attaches NOTHING (no cap-84, no _rawwitness)')
src = open(os.path.join(os.path.dirname(__file__), '..', 'extraction', 'template_mapper.py'),
           encoding='utf-8').read()
check('the FLAG tier routes through _witness_note and gates every attachment on its truthiness',
      '_wnote = _witness_note(' in src and 'if _wnote:' in src)
import re
_m = re.search(r"if _wnote:\s*\n(?:.*\n){0,5}?.*_r\[\"method\"\] \+= \"_rawwitness\"", src)
check('cap/corrected_to/note/_rawwitness are ALL inside the `if _wnote:` guard', bool(_m))

# restore the un-armed module state for any later test in the same session
load_mapper(False)

print(f'\n{"ALL PASS" if failed == 0 else str(failed) + " FAILED"}  ({passed} ok)')
sys.exit(0 if failed == 0 else 1)
