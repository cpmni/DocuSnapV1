"""test_code_separator_structure.py — pins for CODE_SEPARATOR_STRUCTURE_GUARD (2026-08-10).

Run: py -3.12 python_backend/tests/test_code_separator_structure.py

THE DEFECT. `anchor._repair_single_token` fixes a real PSM-7 artefact: a spaceless serial can come
back with a spurious '/' '\\' or '|' wedged into it ('H7R5326676' -> 'H/7R5326676'). It repairs this
by re-reading the same crop with a tessedit_char_whitelist that CANNOT emit those characters, and
accepting the result when its alphanumerics are identical. That acceptance test is satisfied by ANY
token whose only difference is a separator — including a reference code whose separators are
PRINTED. So 'PI/26/6000' was re-read as 'PI266000', matched on alphanumerics, and was committed with
a character silently deleted.

It is reached from BOTH crop paths: anchor.py's own rungs and, via the cross-import at
template_mapper.py:40, the Stage 0.5 `template_mapping` rung — which is where every measured
instance came through.

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

pytesseract.image_to_string = _REAL_IMAGE_TO_STRING
os.environ.pop(FLAG, None)
print(f"\n{passed} checks passed")
