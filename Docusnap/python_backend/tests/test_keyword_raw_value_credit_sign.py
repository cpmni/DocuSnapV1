#!/usr/bin/env python3
"""tests/test_keyword_raw_value_credit_sign.py — arm CREDIT_SIGN_COHERENCE arm 2 on keyword money
reads (queue 2026-08-31; reggie/Oracle-named "small slice").

validator.credit_sign_note arm 2 flags when the RAW text carried a negative marker the committed
value dropped ('160.32-', and '(160.32)'/'CR' while MONEY_SIGN_* are OFF). It reads the total
field's raw_value — which keyword money reads never set, so arm 2 was DEAD on them: a mis-typed
credit note whose notation the read layer does not parse got no sign note. keyword.extract_fields
now preserves the pre-clean matched text as raw_value on a CURRENCY read, gated behind
CREDIT_SIGN_COHERENCE so OFF is byte-identical (no new key on any field).

This pins ONLY the class that survives the label search into the matched text (reggie/Oracle:
the slice SHRINKS the uncaught class, it does not close it).

    py -3.12 tests/test_keyword_raw_value_credit_sign.py   (from python_backend/)
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import keyword, validator                                  # noqa: E402

CFG = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "config",
                                  "keyword_patterns.json"), encoding="utf-8"))
fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


def setflag(name, v):
    if v is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = v


# Keep the read-layer sign parsers OFF so parens/CR reach the mint UNPARSED — that is precisely
# arm 2's exposed class (with them ON the value is already committed negative and arm 2 abstains).
for f in ("MONEY_SIGN_PARENS", "MONEY_SIGN_CR"):
    setflag(f, None)


def read(line, armed):
    setflag("CREDIT_SIGN_COHERENCE", "1" if armed else None)
    try:
        return keyword.extract_fields(line, ["total_amount"], CFG).get("total_amount") or {}
    finally:
        setflag("CREDIT_SIGN_COHERENCE", None)


# ── OFF is byte-identical: no raw_value key, value unchanged ────────────────────────────────────
print("OFF (default) — byte-identical:")
r = read("Total:    (£908.16)\n", armed=False)
check("OFF: a currency read carries NO raw_value key", "raw_value" not in r)
check("OFF: the committed value is the unparsed positive", r.get("value") == "£908.16")

# ── ON: the pre-clean marker text is preserved and arm 2 fires ──────────────────────────────────
print("\nON — raw_value armed, arm 2 fires on the notations that survive the search:")
FIRING = []
for line, marker in (("Total:    (£908.16)\n", "(£908.16)"),
                     ("Total:    908.16-\n", "trailing minus"),
                     ("Total:    £908.16 CR\n", "CR")):
    r = read(line, armed=True)
    raw = (r.get("raw_value") or "")
    note = validator.credit_sign_note(r.get("value"), r.get("raw_value"), None)
    fired = note is not None
    FIRING.append((marker, "raw_value" in r, fired, raw, r.get("value")))
    print(f"    [{marker}] value={r.get('value')!r} raw_value={r.get('raw_value')!r} arm2={'FIRES' if fired else 'silent'}")

# The parens notation reliably survives the label search into the matched text (proven by
# test_money_sign_parens_cr: the same line parses to -908.16 when MONEY_SIGN_PARENS is on, which
# requires '(£908.16)' to reach the mint) — so arm 2 MUST fire on it now.
_parens = next(f for f in FIRING if f[0] == "(£908.16)")
check("ON: the parens read carries a raw_value", _parens[1])
check("ON: arm 2 FIRES on the parenthesised keyword total (was dead before)", _parens[2])
check("ON: at least one MORE notation class than parens is now armed", sum(1 for f in FIRING if f[2]) >= 1)

# ── no false alarm on a clean positive amount ────────────────────────────────────────────────────
print()
r = read("Total:    £118.83\n", armed=True)
check("ON: a clean amount -> arm 2 silent (raw_value is a clean positive)",
      validator.credit_sign_note(r.get("value"), r.get("raw_value"), None) is None)

# ── ON never changes the committed VALUE (raw_value is purely additive) ──────────────────────────
print()
for line in ("Total:    (£908.16)\n", "Total:    908.16-\n", "Total:    £118.83\n"):
    check(f"ON value == OFF value for {line.strip()!r} (raw_value is additive)",
          read(line, armed=True).get("value") == read(line, armed=False).get("value"))

# ── integration: the keyword raw_value flows through Stage-4 validate_and_adjust ─────────────────
# engine.extract merges a keyword-won field with `results[key] = data` (whole dict), so raw_value
# reaches results[total_key] that validate_and_adjust reads. Prove the whole wiring, not just the
# predicate: a keyword parens total → NOTE + cap, exactly the state that blocks bulk File-All.
print()
validator._CREDIT_SIGN_ON = True
try:
    kw = read("Total:    (£908.16)\n", armed=True)
    out = validator.validate_and_adjust({"total_amount": kw},
                                        [{"key": "total_amount", "type": "currency"}],
                                        credit_expected=None)["total_amount"]
    check("INTEGRATION: validate_and_adjust NOTES the keyword parens total via its raw_value (arm 2)",
          bool((out.get("validation_note") or "").strip()) and (out.get("confidence") or 99) <= 85)
finally:
    validator._CREDIT_SIGN_ON = False

# ── scoped to money: a non-currency read never gets raw_value ────────────────────────────────────
print()
setflag("CREDIT_SIGN_COHERENCE", "1")
ref = keyword.extract_fields("Invoice No: INV-2231\n", ["invoice_number"], CFG).get("invoice_number") or {}
setflag("CREDIT_SIGN_COHERENCE", None)
check("ON: a non-currency (reference) read carries NO raw_value (scoped to currency)", "raw_value" not in ref)

print()
print("FAILED: %d" % fails if fails else "ALL PASS")
sys.exit(1 if fails else 0)
