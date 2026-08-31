"""test_code_separator_structure.py — pins for CODE_SEPARATOR_STRUCTURE_GUARD (2026-08-10).

Run: py -3.12 python_backend/tests/test_code_separator_structure.py

THE DEFECT. `anchor._repair_single_token` fixes a real PSM-7 artefact: a spaceless serial can come
back with a spurious '/' '\\' or '|' wedged into it ('H7R5326676' -> 'H/7R5326676'). It repairs this
by re-reading the same crop with a tessedit_char_whitelist that CANNOT emit those characters, and
accepting the result when its alphanumerics are identical. That acceptance test is satisfied by ANY
token whose only difference is a separator — including a reference code whose separators are
PRINTED. So 'PI/26/6000' was re-read as 'PI266000', matched on alphanumerics, and was committed with
a character silently deleted.

It is reached from BOTH crop paths: anchor.py's own rungs and the Stage 0.5 `template_mapping`
rung — which is where every measured instance came through. The Stage 0.5 reach is via
`anchor._ocr_crop_laddered` (called at anchor.py:3228, and :3012 on the free-text noise-smooth
retry), NOT via `template_mapper._crop_and_ocr`'s own `_repair_single_token` call: that one is
DEAD IN PRODUCTION, because `_crop_and_ocr` returns through `_ocr_crop_laddered` whenever
`ocr_text_fn is _ocr_text` — the default (template_mapper.py:737) and what engine.py passes.
Only a custom reader (a test stub) reaches the later call. Corrected 2026-08-10 after the first
version of this docstring cited the dead line.

MEASURED (live install, read-only census over documents whose page text is stored): 36 committed
invoice_numbers had lost a separator their own page text still prints; all 36 via template_mapping;
the guard keeps the separator on 36 of 36.

WHY A SHAPE RULE. An artefact separator is wedged into an unbroken run and leaves a ragged split —
typically a one-character group. A structured code splits into groups that each stand on their own.
That is the whole discriminator, and it needs no new inputs, no page text and no extra OCR.

THE ANTI-LOOSEN CONTRACT:
  * Every ON case has an OFF twin asserting today's behaviour, so "default OFF is safe" is asserted
    rather than assumed.
  * The docstring's own artefact example must STILL be repaired when the guard is armed. A guard
    that quietly disabled the repair would pass a naive "the slashes survived" test.
  * The armed structured case must not call pytesseract AT ALL — that pins the short-circuit, and it
    is also the control proving the value survived because the guard fired rather than because the
    stub happened to return the same string.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytesseract  # noqa: E402
from extraction.anchor import _repair_single_token  # noqa: E402

FLAG = "CODE_SEPARATOR_STRUCTURE_GUARD"
_calls = []


class _Stub:
    """Stands in for the re-read. Returns the whitelisted read: the same glyphs, separators gone —
    exactly what a `tessedit_char_whitelist` without '/' produces."""

    def __init__(self):
        self.real = pytesseract.image_to_string

    def __call__(self, img, config=""):
        _calls.append(config)
        return re.sub(r"[^0-9A-Za-z]", "", str(img))


def run(value, armed, val_type="alphanumeric"):
    """`img` doubles as the text the stub reads back, so no real image is needed."""
    _calls.clear()
    if armed:
        os.environ[FLAG] = "1"
    else:
        os.environ.pop(FLAG, None)
    return _repair_single_token(value, value, val_type)


passed = 0


def ok(name):
    global passed
    passed += 1
    print(f"  ok  {name}")


_REAL_IMAGE_TO_STRING = pytesseract.image_to_string
pytesseract.image_to_string = _Stub()

# ── 1. THE DEFECT, pinned OFF ───────────────────────────────────────────────
# Today's behaviour, so the flag's effect is demonstrable and the default is provably inert.
assert run("PI/26/6000", armed=False) == "PI266000", "OFF still strips the printed separators"
assert _calls, "OFF reaches the re-read"
ok("OFF: a printed separator is still deleted (today's behaviour, byte-identical)")

# ── 2. ARMED: the structured code keeps its separators ──────────────────────
assert run("PI/26/6000", armed=True) == "PI/26/6000", "armed keeps the printed separators"
assert not _calls, "armed short-circuits BEFORE the extra OCR passes"
ok("ARMED: a structured code survives, and costs no OCR (control: the stub was never called)")

# ── 3. ARMED: the docstring's own artefact is STILL repaired ────────────────
# 'H/7R5326676' splits into a ONE-character group, which is the artefact signature. If this ever
# starts returning the slashed form, the guard has become a blanket disable of the repair.
assert run("H/7R5326676", armed=True) == "H7R5326676", "armed still repairs a wedged separator"
assert _calls, "the artefact case does reach the re-read"
ok("ARMED: the wedged-separator artefact is still repaired (the guard is not a blanket disable)")

# ── 4. Both states protect a date-shaped token ──────────────────────────────
for armed in (False, True):
    assert run("22/06/2025", armed=armed) == "22/06/2025", f"date shape protected (armed={armed})"
ok("date-shaped tokens protected in BOTH states (the pre-existing guard is untouched)")

# ── 5. '|' and '\\' are never structural ────────────────────────────────────
# A pipe is a table rule and a backslash a stroke artefact; neither is a printed separator, so a
# token carrying one must still be repaired even though its groups are otherwise well-formed.
assert run("AB|1234", armed=True) == "AB1234", "a pipe is not a structural separator"
assert run("AB\\1234", armed=True) == "AB1234", "a backslash is not a structural separator"
ok("'|' and '\\' are still repaired when armed — only '/', '.', '-' can be structural")

# ── 6. The early returns are untouched ──────────────────────────────────────
assert run("Acme Supplies Ltd", armed=True) == "Acme Supplies Ltd", "multi-word untouched"
assert run("22/06/2025", armed=True, val_type="date") == "22/06/2025", "date field untouched"
assert run("PI266000", armed=True) == "PI266000", "a token with no separator is untouched"
ok("multi-word, date-typed and separator-free values take the existing early returns")

# ── 7. The real-world shapes from the census ────────────────────────────────
for v in ("PI/25/3861", "PI/26/6000", "OED/91377", "INV/2024/001", "SO-12-345"):
    assert run(v, armed=True) == v, f"{v} keeps its separators"
ok("every shape seen in the live census survives when armed")

# -- 8. THE ACCEPTED COST, pinned (Oracle C4) -------------------------------
# The guard's premise is that an artefact leaves a ONE-CHARACTER group ("H/7R5326676") while a
# structured code splits into groups that each stand on their own. That premise is a prior drawn
# from the docstring's single exhibit, not a measured property of Tesseract: nothing constrains a
# spurious stroke to position 1. So a genuine artefact that lands mid-token, with >=2 alphanumerics
# on BOTH sides, is no longer repaired -- 'AB12/34567' is kept as read.
#
# THE CLASS IS NARROWER THAN IT LOOKS, and the reason is worth keeping: the repair only ever fired
# when the whitelisted re-read DROPPED the character entirely. If OCR had substituted a glyph (a
# '/' that is really a misread '1'), the alphanumeric comparison at the accept site fails and
# nothing was repaired even before this guard. What is switched off is specifically "extra ink /
# hallucinated separator with >=2 alnum either side".
#
# DO NOT "fix" this by tightening the predicate to require a minimum group count or a letter
# prefix. Tightening it is exactly what re-breaks the 36 measured invoice_numbers, because
# 'PI/25/3861' and 'OED/91377' have different group shapes. If the mid-token class ever needs
# handling, it needs EVIDENCE about the token's own ink (the unwhitelisted PSM-8 pass), not a
# tighter shape prior.
assert run("AB12/34567", armed=True) == "AB12/34567", "mid-token artefact is NOT repaired when armed"
assert run("AB12/34567", armed=False) == "AB1234567", "...and WAS repaired before the guard"
ok("PINNED COST: a mid-token artefact with >=2 alnum either side is no longer repaired")

# -- 9. CURRENCY IS EXCLUDED (Oracle C5) ------------------------------------
# A '/' inside money is never a printed separator -- it is a misread decimal point. Keeping it
# would drop the value to review (better in principle) but that is an UNMEASURED change on the
# money lane, so currency keeps its existing behaviour and the guard's blast radius stays exactly
# the code fields it was measured on.
#
# THE EXPOSED SHAPE IS NOT THE OBVIOUS ONE. Oracle's example, '1234/56', never reaches the repair
# in EITHER state -- the pre-existing date-shape guard (\d{1,4}[./-]\d{1,2}) already claims it, so
# the concern was inert for that string. The money values that DO reach it are the ones too long to
# look like a date: '10603/44' is the misread of the exact value recorded in the 2026-08-09
# handover (a right-aligned '\u00a310,603.44'), and five digits before the separator take it clear of
# the date shape. That is the string worth pinning.
assert run("1234/56", armed=True, val_type="currency") == "1234/56", "date-shaped money: pre-existing guard"
assert run("1234/56", armed=False, val_type="currency") == "1234/56", "...in both states, unchanged"
ok("CORRECTION: the obvious money example is already claimed by the date-shape guard, not by this one")

assert run("10603/44", armed=True, val_type="currency") == "1060344", "currency keeps the old repair"
assert run("10603/44", armed=False, val_type="currency") == "1060344", "...identical to unarmed"
# CONTROL: the same string on a CODE field DOES take the guard. Without this the assertions above
# would also pass if '10603/44' simply failed the shape rule, and the exclusion would be untested.
assert run("10603/44", armed=True) == "10603/44", "the same token on a code field keeps its separator"
ok("currency is excluded from the keep -- control proves it is the TYPE doing the excluding")

pytesseract.image_to_string = _REAL_IMAGE_TO_STRING
os.environ.pop(FLAG, None)
print(f"\n{passed} checks passed")
