"""
test_keyword_anchor_corrob.py — pins the KEYWORD-ANCHOR CORROBORATION LIFT (fork A;
Oracle SIGN OFF WITH CONDITIONS 2026-07-23, C1-C8; kill KEYWORD_ANCHOR_CORROB).
Run: py -3.12 python_backend/tests/test_keyword_anchor_corrob.py

THE CLASS. The seeded/override keyword path is capped at 85 BY DESIGN (keyword.py:344, base 80
+5 — below trust.js's 88 critical floor, fail-toward-review), and the merge DISCARDED agreement:
an anchor-family read that normalises-equal to the keyword incumbent but lost the contest
vanished, so a correct, twice-read critical field held forever on young scopes (the Stage-4.5
support boost is blind to a supplier's first batch and lands 1 short at support 3-4).

THE FIX. Two differently-located agreeing reads = the E2 bar met: the surviving keyword read is
lifted to the SHARED corroborated constant (90, _CROSSCHECK_CORROB_CONF). Value + method kept;
no note changes; lone reads still hold.

ANTI-LOOSEN / FORK PIN (Oracle C4): the lift must NEVER extend to the capped recovery classes
(anchor_crop_recovered <=87 un-noted; slipfix; registration) — their caps encode GLYPH-level
doubt that a same-scan second OCR pass cannot clear (anchor.py:1247-1275: the designed escapes
are born-digital exact-text + the support boost). A future dev extending the incumbent or
witness tuples goes RED here.
"""
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))
from extraction.engine import _values_normalise_equal as eq          # noqa: E402
from extraction import engine as _eng                                 # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1


print("Shared agreement core (_values_normalise_equal — C1):")
check("ref alnum-core equal: 'WS 438527' vs 'WS-438527' -> True", eq("WS 438527", "WS-438527", False) is True)
check("ref case/sep fold: 'inv-16033' vs 'INV 16033' -> True", eq("inv-16033", "INV 16033", False) is True)
check("ref different digits -> False", eq("WS-438527", "WS-438528", False) is False)
check("empty side -> False", eq("", "WS-1", False) is False)
check("date calendar-equal across formats: '21/07/2026' vs '21-07-2026' -> True", eq("21/07/2026", "21-07-2026", True) is True)
check("date different day -> False", eq("21/07/2026", "22/07/2026", True) is False)
check("date day/month swap shares a core but is NOT equal (0ae0f46 C1 polarity)", eq("1/12/2026", "11/2/2026", True) is False)
# The date arm is E2-VERBATIM (Oracle C1): salvage-aware — a junk-wrapped date agrees with the
# clean read of the SAME calendar day ('2 12/06/2026' embeds 12/06/2026). It is also FAIL-OPEN on
# a fully unparseable side, which is why the GATE's placement AFTER the merge loop's date-parse
# credibility guard is LOAD-BEARING (pinned below): an unparseable witness never reaches the lift.
check("salvage-aware: junk-wrapped same-day agrees (E2-verbatim; kept value is the clean keyword read)",
      eq("2 12/06/2026", "12-06-2026", True) is True)

print("\nWiring (source) — the gate, its conditions, and the Oracle pins:")
src = open(os.path.join(_HERE, '..', 'extraction', 'engine.py'), encoding='utf-8').read()
g = src.find('os.environ.get("KEYWORD_ANCHOR_CORROB", "1") != "0"')
check("gate present, kill-switched default ON", g > -1)
blk = src[g:g + 1600]
check("C2: fires only on incumbent conf < 88",
      'int(existing.get("confidence") or 0) < 88' in blk)
check("C2: lift is max(existing, the SHARED 90 constant) — never a fixed overwrite",
      "max(int(existing.get(\"confidence\") or 0)" in blk and "_CROSSCHECK_CORROB_CONF" in blk)
check("incumbent tuple is EXACTLY keyword/keyword_override (C4 fork pin — no recovered/anchor classes)",
      'existing.get("method") in ("keyword", "keyword_override")' in blk)
check("witness tuple is EXACTLY inline/crop/relocated (no registration, no bare 'anchor', no recovered — C3/C4)",
      'data.get("method") in ("anchor_inline", "anchor_crop", "anchor_crop_relocated")' in blk)
check("critical roles only (date role or ref field)",
      "key in date_field_keys or _is_ref_field(key)" in blk)
check("noted incumbent/witness never fires (the flagged gate owns notes)",
      'not existing.get("validation_note")' in blk and 'not data.get("validation_note")' in blk)
check("uses the SHARED agreement core (C1 — no copy-pasted comparison)",
      "_values_normalise_equal(data.get(\"value\"), existing.get(\"value\")" in blk)
check("keeps value+method: results built from {**existing, confidence} only",
      re.search(r"results\[key\] = \{\*\*existing,\s*\n?\s*\"confidence\"", blk) is not None)

print("\nC1 — E2 shares the same core (drift tripwire):")
e2 = src.find("def _crosscheck_keyword_corroborated")
e2blk = src[e2:e2 + 900]
check("E2 predicate delegates to _values_normalise_equal",
      "_values_normalise_equal(data.get(\"value\"), kw_entry.get(\"value\")" in e2blk)
check("ONE shared 90 constant (_CROSSCHECK_CORROB_CONF) serves both paths",
      src.count("_CROSSCHECK_CORROB_CONF = 90") == 1 and src.count("_CROSSCHECK_CORROB_CONF)") >= 2)

print("\nC5 — placement + the recovered-class escape documented:")
check("gate sits AFTER the Tier-A outright win (authoritative peers resolve above)",
      0 < src.find('data.get("authoritative") and data.get("value") and data.get("located", True) and _ocr_clean and _cov_ok') < g)
check("gate sits BEFORE the drawn-source precedence guard",
      g < src.find('# Precedence: a deliberately DRAWN source outranks an AUTO-LEARNED'))
check("LOAD-BEARING placement: the date-parse credibility guard runs BEFORE the gate "
      "(the shared core's date arm is fail-open on unparseable — see its docstring)",
      0 < src.find('if validator.parse_date(data.get("value")) is None:') < g)
_cmt = src[max(0, g - 3400):g]
check("the recovered classes' escapes are named in the gate comment (born-digital + support boost; do-not-extend)",
      "anchor.py:1247-1275" in _cmt and "do NOT" in _cmt)

print("\nAnti-loosen — the seeded cap that makes holds fail-toward-review stays:")
kw = open(os.path.join(_HERE, '..', 'extraction', 'keyword.py'), encoding='utf-8').read()
check("seed_field_labels base stays 80 (below the 88 floor BY DESIGN — greppable pin)",
      '"base_confidence": 80' in kw or "'base_confidence': 80" in kw or "base_confidence=80" in kw
      or re.search(r"base_confidence[\"']?\s*[:=]\s*80", kw) is not None)

print(f"\n{fails} FAILED" if fails else "\nAll keyword-anchor corroboration checks passed")
sys.exit(1 if fails else 0)
