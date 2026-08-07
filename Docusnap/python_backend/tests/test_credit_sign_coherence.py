#!/usr/bin/env python3
"""tests/test_credit_sign_coherence.py — CREDIT_SIGN_COHERENCE (gary -> Oracle SIGN-OFF-W/COND
C1/C2, 2026-08-07). Slice C of the credit-note minus-sign incident.

THE INCIDENT (customer-proxy, found twice independently): 16/16 credit notes were stored, displayed
and FILED with the minus sign gone — a page printing `TOTAL £-160.32` filed as `160.32`, turning a
£160.32 credit into a £160.32 charge. THREE of the sixteen carried NO warning at all
("High · 85%", "Nothing was flagged") and bulk "File All Ready" wrote them to disk. The app then
invited the user to LOWER the auto-file threshold.

WHY NOTHING CAUGHT IT — `validator.total_reconciles` opens
    if not (total and total > 0 and subtotal and subtotal > 0): return None
so it only ever sees MAGNITUDES and is structurally incapable of detecting a sign inversion. The
three silent documents escaped through three UNRELATED arms:
  * `1,455.12` — no subtotal captured -> the whole reconciliation block is skipped;
  * `160.32`   — subtotal 133.60 + tax 27.84 = 161.44 vs 160.32, delta 1.12 inside the 2% tolerance
                 3.21 -> `reconciles=True` -> "CLOSE -> trust". It did not merely MISS the error, it
                 AFFIRMED the sign-wrong value;
  * `342.24`   — subtotal present but tax AND shipping both absent -> the NEUTRAL arm.
So the 13 that WERE flagged were flagged by luck, and the silent rate is not a stable 3/16: capture a
subtotal on the next scan and a silent one starts reconciling.

THIS IS A DETECTION FIX ONLY. Everything downstream was already correct — ONE note blocks bulk
"File All Ready" (renderer.js `isFlagged`), blocks backend auto-file (trust.js: any noted field ->
{ok:false}), and surfaces in Review. No new gate was added, and none is wanted.

Run: py -3.12 python_backend/tests/test_credit_sign_coherence.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import validator as v
from extraction import text_normalise as tn

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


N = v.credit_sign_note

# ── ARM 1: the type expects a credit but the total is POSITIVE ─────────────────────────────────
check("ARM1: credit type + positive total -> NOTE (the incident class)",
      "credit note" in (N("160.32", None, True) or "").lower())
check("ARM1: credit type + negative total -> silent (the correct case must not nag)",
      N("-160.32", None, True) is None)
check("ARM1: credit type + parenthesised total is treated as negative -> silent",
      N("(160.32)", None, True) is None)
check("ARM1: unknown type + positive total -> abstains (never guesses a direction)",
      N("160.32", None, None) is None)

# ── ARM 2: the RAW text carried a negative marker the reader did not commit ────────────────────
# This is the LOAD-BEARING arm for the accounting forms the read layer deliberately does not parse,
# and for the CLIPPED-SIGN class (a tight taught crop cutting the '-' glyph BEFORE OCR runs), which
# no read-layer fix can ever see.
for raw, label in (("(160.32)", "accounting parentheses"),
                   ("160.32-", "trailing minus"),
                   ("CR 160.32", "CR credit marker"),
                   ("£-160.32", "symbol then minus"),
                   ("-£160.32", "minus then symbol")):
    check(f"ARM2: raw {label!r} but committed positive -> NOTE",
          N("160.32", raw, None) is not None)
check("ARM2: a clean positive raw on an unknown type -> silent",
      N("160.32", "£160.32", None) is None)

# ── ARM 3: negative total on a CHARGE type — the mirror arm ────────────────────────────────────
# This is what makes a future read-layer sign fix safe: if a table rule or dot leader is ever read
# as a minus, this arm catches the inversion in the opposite direction.
check("ARM3: invoice type + negative total -> NOTE",
      N("-160.32", None, False) is not None)
check("ARM3: invoice type + positive total -> silent",
      N("160.32", "£160.32", False) is None)

# ── THE FALSE-NEGATIVE GUARD (Oracle SEAM 3) ───────────────────────────────────────────────────
# A dot leader or table rule must NEVER be read as a sign. Verified against the real shapes:
#   bare  -?  on 'TOTAL-------160.32' captures '-160.32'  <- would invert a CHARGE into a CREDIT
# The marker patterns use a left-boundary lookbehind so they cannot fire on these.
for raw in ("TOTAL-------160.32", "Total-160.32", "1,234.56-160.32", "TOTAL---- 160.32"):
    check(f"SEAM3 GUARD: {raw!r} is NOT read as a negative marker",
          N("160.32", raw, False) is None)

# ── ORACLE C1: the arm must NOT be built on the shared comparator, which is SIGN-BLIND ──────────
# `text_normalise._EDGE_RE` strips edge non-alphanumerics, so the pipeline's shared compare form
# cannot distinguish a signed read from an unsigned one. Any sign check built on it would be a dead
# guard that greens every test and never fires. This pins the blindness so nobody assumes otherwise.
check("C1: normalise_for_tokens IS sign-blind ('-160.32' == '160.32') — pinned so no future sign "
      "check is ever built on it",
      tn.normalise_for_tokens("-160.32") == tn.normalise_for_tokens("160.32") == "160.32")
check("C1: credit_sign_note still detects what the comparator cannot",
      N("160.32", "-160.32", None) is not None)

# ── never fires on an empty/missing total (another gate's problem) ─────────────────────────────
check("empty total -> silent", N("", "(160.32)", True) is None)
check("None total -> silent", N(None, None, True) is None)

# ── ORACLE C2: type resolution keys on PRINTED-TITLE phrases, never an internal name ───────────
T = v.type_expects_credit
check("C2: 'Credit Note' expects a credit", T("Credit Note") is True)
check("C2: a custom type named 'CN' ALIASED 'Credit Note' expects a credit "
      "(CLAUDE.md: a custom type is identified by its aliases, never its arbitrary internal name)",
      T("CN", ["Credit Note"]) is True)
check("C2: 'Invoice' expects a charge", T("Invoice") is False)
check("C2: 'Refund Receipt' expects a credit", T("Refund Receipt") is True)
check("C2: an unrecognised type abstains rather than guessing", T("Widget Report") is None)
check("C2: no type at all abstains", T(None) is None)

# ── THE ACCEPTED TRADE-OFF, PINNED (Oracle) ────────────────────────────────────────────────────
# The read layer deliberately does NOT parse parens / trailing-minus / CR into a signed value.
# That is only safe BECAUSE arm 2 flags them. If a future dev teaches the reader to parse one of
# these, they must move the flag with it — this pin forces them to confront that rather than
# silently deleting a human checkpoint.
check("TRADE-OFF PIN: '(160.32)' is NOT parsed to a negative number by the read layer...",
      v.parse_amount("(160.32)") == 160.32)
check("...and is therefore FLAGGED instead (delete this pairing and money goes silently wrong)",
      N("160.32", "(160.32)", None) is not None)

# ── switch defaults OFF ─────────────────────────────────────────────────────────────────────────
check("CREDIT_SIGN_COHERENCE defaults OFF",
      os.environ.get("CREDIT_SIGN_COHERENCE") in (None, "0"))
check("the module flag is OFF at import (OFF must be byte-identical)",
      v._CREDIT_SIGN_ON is False)

# ── end-to-end through validate_and_adjust (the wiring, not just the predicate) ────────────────
FIELDS = [{"key": "total_amount", "type": "currency"}]


def run_validate(total, credit_expected, armed=True):
    v._CREDIT_SIGN_ON = armed
    try:
        out = v.validate_and_adjust(
            {"total_amount": {"value": total, "confidence": 85, "method": "anchor_inline"}},
            FIELDS, credit_expected=credit_expected)
        return out["total_amount"]
    finally:
        v._CREDIT_SIGN_ON = False


r = run_validate("160.32", True)
check("WIRING: a positive credit-note total is NOTED and capped (this is the exact state that "
      "reached 'High 85% / Nothing was flagged' and got bulk-filed)",
      r.get("validation_note") and r.get("confidence") <= 85)
r = run_validate("-160.32", True)
check("WIRING: a correct negative credit-note total passes clean",
      not r.get("validation_note") and r.get("confidence") == 85)
r = run_validate("160.32", True, armed=False)
check("WIRING: switch OFF is byte-identical (no note, confidence untouched)",
      not r.get("validation_note") and r.get("confidence") == 85)
r = run_validate("160.32", False)
check("WIRING: a positive INVOICE total is untouched (no false alarm on the common case)",
      not r.get("validation_note"))

print()
print(f"{fails} FAILED" if fails else "All CREDIT SIGN COHERENCE pins passed")
sys.exit(1 if fails else 0)
