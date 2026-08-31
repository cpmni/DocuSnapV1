"""
test_crosscheck_corroboration.py — pins the E2 cross-check keyword-corroboration CLEAR.
Run: py -3.12 python_backend/tests/test_crosscheck_corroboration.py

WHAT THIS PINS. anchor.py's authoritative-crop cross-check, on a crop-vs-fullpage DISAGREEMENT,
flips the value to the full-page/inline read, caps it 70, and notes "please verify" — and via
Tier-A that FLAGGED read wins over the clean keyword incumbent, so a doc whose value is already
correct is PERMANENTLY held (re-teaching the taught box can't clear it — it's a read-vs-read
disagreement, not a position error). A taught 2x crop that spans two rows on a skewed scan is a
framing artifact, not a real second read.

E2 clears that flag ONLY when an INDEPENDENT Stage-1 keyword/override read normalises-equal to the
flipped value (oscar's "two independent reads agree" bar), restoring the field to a corroborated
confidence >= the 88 critical-field floor and dropping the note. The value NEVER changes -> accuracy
is byte-identical; only the flag/confidence move.

THE ANTI-LOOSEN PIN (Pin B): an uncorroborated disagreement (no keyword peer, or a DISAGREEING peer)
must STAY flagged. A future dev must NOT make the clear fire on the crop alone — that would silently
auto-file a mangled crop (the City-Office 152574->192074 class). Option-A regression pin: the surviving
FILED confidence must be >= 88, not the keyword's own 85 (which the critical-field floor still holds).
"""
import os, sys
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))
from extraction.engine import _crosscheck_keyword_corroborated as corrob, _CROSSCHECK_CORROB_CONF

fails = 0
def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1

XC = "anchor_crop_crosscheck"
def d(v, method=XC): return {"value": v, "method": method}
def kw(v, method="keyword"): return {"value": v, "method": method}

print("_CROSSCHECK_CORROB_CONF clears the 88 critical-field floor:")
check("restored confidence >= 88 (Option-A's 85 keyword would still be held)", _CROSSCHECK_CORROB_CONF >= 88)

print("\nPin A — corroborated disagreement CLEARS:")
check("ref: keyword 'DN-23333' == flip 'DN-23333' -> True", corrob(d("DN-23333"), kw("DN-23333"), False) is True)
check("keyword_override peer also corroborates", corrob(d("DN-23333"), kw("DN-23333", "keyword_override"), False) is True)

print("\nPin B — uncorroborated disagreement STAYS FLAGGED (anti-loosen guard):")
check("no keyword peer (None) -> False", corrob(d("DN-23333"), None, False) is False)
check("disagreeing keyword peer 'IN-23333' -> False", corrob(d("DN-23333"), kw("IN-23333"), False) is False)
check("peer is not a keyword read (hint) -> False", corrob(d("DN-23333"), kw("DN-23333", "hint"), False) is False)
check("data is NOT a crosscheck flip (plain anchor_crop) -> False", corrob(d("DN-23333", "anchor_crop"), kw("DN-23333"), False) is False)
check("empty flipped value -> False", corrob(d(""), kw("DN-23333"), False) is False)
check("empty keyword value -> False", corrob(d("DN-23333"), kw(""), False) is False)

print("\nPin C — NORMALISED equality (never raw ==):")
check("'DN-23333' vs 'DN 23333' (separator/space) -> True", corrob(d("DN-23333"), kw("DN 23333"), False) is True)
check("'DN-23333' vs 'DN-99999' -> False", corrob(d("DN-23333"), kw("DN-99999"), False) is False)

print("\nDate arm — calendar-aware (separator-only difference agrees):")
check("date '29/05/2026' vs '29-05-2026' -> True", corrob(d("29/05/2026"), kw("29-05-2026"), True) is True)
check("date '29/05/2026' vs '01/06/2026' -> False", corrob(d("29/05/2026"), kw("01/06/2026"), True) is False)

print("\nWiring (source) — the merge clear is Option B + env-gated:")
eng = open(os.path.join(_HERE, '..', 'extraction', 'engine.py'), encoding='utf-8').read()
i = eng.find("_crosscheck_keyword_corroborated(data, existing")
blk = eng[i:i + 700]
check("clear is gated on CROSSCHECK_KEYWORD_CLEAR (kill switch)", "CROSSCHECK_KEYWORD_CLEAR" in eng[max(0, i - 400):i])
check("restores confidence to _CROSSCHECK_CORROB_CONF", "_CROSSCHECK_CORROB_CONF" in blk)
check("re-bases method to anchor_inline (Option B, not keep-the-85-keyword)", '"method": "anchor_inline"' in blk)
check("strips the crosscheck note + was_corrected + corrected_to",
      all(k in blk for k in ("validation_note", "was_corrected", "corrected_to")))

print(f"\n{fails} FAILED" if fails else "\nAll cross-check corroboration checks passed")
sys.exit(1 if fails else 0)
