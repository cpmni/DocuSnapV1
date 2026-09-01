"""
test_accepted_chars.py — the operator CHARSET allowlist (2026-09-01, "These characters are fine";
reggie+gary → Oracle SIGN-OFF-WITH-CONDITIONS).

Pins the engine-side pieces of the flag path:
  · set_accepted_chars filters garble (only printable ASCII punctuation survives — Oracle's
    homoglyph/confusable guard: any non-ASCII char, U+FFFD, whitespace, or alnum is DROPPED).
  · a char in the effective spec is no longer flagged by charset_disallowed (the union at engine.py
    :9754 appends the accepted chars to the per-type spec before the diff).
  · a genuine garble (U+FFFD) still flags even with a normal char accepted.
  · empty allowlist → set leaves accepted_charset empty (byte-identical flag path).

Run:  py -3.12 python_backend/tests/test_accepted_chars.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from extraction.engine import ExtractionEngine
from extraction import format_anomaly_checker as fac

fails = 0
def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1

eng = ExtractionEngine()

# ── set_accepted_chars garble filter ──────────────────────────────────────────
eng.set_accepted_chars({"reference_code": ["&", "#"], "text": ["("]})
check("accepts printable ASCII punctuation", eng.accepted_charset.get("reference_code") == {"&", "#"})
check("per-type keying preserved", eng.accepted_charset.get("text") == {"("})

eng.set_accepted_chars({"reference_code": ["�"]})          # U+FFFD replacement — garble marker
check("U+FFFD refused (never widens the spec)", "reference_code" not in eng.accepted_charset)

eng.set_accepted_chars({"reference_code": ["А", "Ο", "－"]})    # Cyrillic A, Greek O, fullwidth hyphen (homoglyphs)
check("non-ASCII homoglyphs refused", "reference_code" not in eng.accepted_charset)

eng.set_accepted_chars({"reference_code": [" ", "\t"]})          # whitespace
check("whitespace refused", "reference_code" not in eng.accepted_charset)

eng.set_accepted_chars({"reference_code": ["A", "7"]})          # alnum — never flagged, meaningless to accept
check("alnum refused", "reference_code" not in eng.accepted_charset)

eng.set_accepted_chars({})
check("empty mapping -> empty allowlist (byte-identical)", eng.accepted_charset == {})

# ── the union effect: an accepted char drops out of the disallowed set ─────────
SPEC = "-/."                                   # reference_code spec from config
check("'&' flagged under the base spec", "&" in fac.charset_disallowed("INV&123", SPEC))
check("'&' NOT flagged once appended to the effective spec", "&" not in fac.charset_disallowed("INV&123", SPEC + "&"))
check("U+FFFD STILL flagged with '&' accepted (real garble persists)",
      "�" in fac.charset_disallowed("INV�123", SPEC + "&"))
check("None spec stays unconstrained (barcode/multiline)", fac.charset_disallowed("any#thing", None) == [])

print(f"\n{fails} FAILED" if fails else "\nAll accepted-chars pins passed")
sys.exit(1 if fails else 0)
