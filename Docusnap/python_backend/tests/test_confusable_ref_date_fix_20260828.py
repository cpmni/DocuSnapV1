"""Pins for the 2026-08-28 confusable-ref / date fixes (Oracle SIGN-OFF-W/COND).

  Fix #1  REF_PREFIX_CONFUSABLE_ADOPT_LENGTH_NOTE — route the ref-LENGTH-guard note into the P
          adopt arm, so a P1->PI ref the length guard flags (the witness form already carries
          corrected_to=PI) is adopted instead of held (invoice_0016-14: P1/26/1150 -> PI/26/1150).
  Fix #2  TIER_A_DATE_PLAUSIBILITY — an AUTHORITATIVE date anchor OCR-misread into an implausible
          date (a date-shaped confusable reference read as the date) no longer wins Tier-A OUTRIGHT
          over a valid located mapping date (invoice_0015-15: 26-01-2361 -> 16-06-2026).

Both DARK, default OFF, OFF byte-identical. The heavy behavioural proof (the adopts + the date
flip + M=0) is the realdoc gate; these pins guard the wiring + the accepted trade-offs.

Run: py -3.12 python_backend/tests/test_confusable_ref_date_fix_20260828.py
"""
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
for k in ('REF_PREFIX_CONFUSABLE_ADOPT', 'REF_PREFIX_CONFUSABLE_ADOPT_LENGTH_NOTE', 'TIER_A_DATE_PLAUSIBILITY'):
    os.environ.pop(k, None)
import extraction.engine as E

FAILED = []
def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)

SRC = Path(E.__file__).read_text(encoding='utf-8')

# ── Fix #1: marks + routing ───────────────────────────────────────────────────
print("Fix #1 — the ref-length note routed to the P adopt arm")
check("marks defined, non-empty, distinct",
      bool(E._REF_LENGTH_NOTE_MARK) and bool(E._REF_LENGTH_WITNESS_NOTE_MARK)
      and E._REF_LENGTH_NOTE_MARK != E._REF_LENGTH_WITNESS_NOTE_MARK)
# Oracle C1: the witness mark is the LONGER unambiguous substring, NOT the bare tail
# "Please pick the right value." (one glyph from the 5697 blind-geom + 5967 D1 notes).
check("witness mark == 'references usually have' (not the 1-glyph tail)",
      E._REF_LENGTH_WITNESS_NOTE_MARK == "references usually have")
check("plain mark == 'possibly an extra or missing digit'",
      E._REF_LENGTH_NOTE_MARK == "possibly an extra or missing digit")
# Oracle C2 non-collision: each mark's literal appears in the source ONLY as its constant
# definition — the notes reference it BY NAME — so it can never match the 5697 blind-geom
# ("please pick the right value") or the 5967 D1 ("for the right value.") notes.
check("plain-mark literal appears once (def only; notes use the constant name)",
      SRC.count('"possibly an extra or missing digit"') == 1)
check("witness-mark literal appears once (def only; notes use the constant name)",
      SRC.count('"references usually have"') == 1)
check("both notes are BUILT from the marks (a reword makes the matcher inert, caught here)",
      "{_REF_LENGTH_NOTE_MARK}" in SRC and "{_REF_LENGTH_WITNESS_NOTE_MARK}" in SRC)
# The routing branch: gated on P_len_on + the marks, calls the arm, before the C branch.
check("P_len_on = P_on AND a DEDICATED sub-env (never folded into mig-81-live P_on)",
      'P_len_on = P_on and os.environ.get("REF_PREFIX_CONFUSABLE_ADOPT_LENGTH_NOTE"' in SRC)
i_branch = SRC.find("if P_len_on and (_REF_LENGTH_WITNESS_NOTE_MARK in note or _REF_LENGTH_NOTE_MARK in note):")
check("routing branch exists (P_len_on + both mark forms)", i_branch > 0)
check("routing branch calls the P adopt arm",
      "_try_prefix_confusable_adopt(key, data, rec_p, rec, sup, slug, page)" in SRC[i_branch:i_branch + 400])
i_c = SRC.find('if C_on and "was read the same way by two independent methods" in note:')
check("routing branch sits BEFORE the C branch (its own continue blocks fall-through)",
      0 < i_branch < i_c)

# ── Fix #2: Tier-A date plausibility ──────────────────────────────────────────
print("\nFix #2 — an implausible authoritative date loses Tier-A")
check("TIER_A_DATE_PLAUSIBILITY defaults OFF", E.TIER_A_DATE_PLAUSIBILITY is False)
i_block = SRC.find("_tier_a_date_block = (TIER_A_DATE_PLAUSIBILITY and key in date_field_keys")
check("Tier-A date-block wrap exists (flag + structural date role + authoritative)", i_block > 0)
check("wrap SCOPES on the structural date role (key in date_field_keys), not val_type",
      "key in date_field_keys" in SRC[i_block:i_block + 200])
check("wrap reuses the competitor-coupled _invalid_taught_date_yields (Oracle: the binary, not a new unary)",
      '_invalid_taught_date_yields(data.get("value"), existing.get("value"))' in SRC[i_block:i_block + 500])
check("NO new unary _date_is_implausible helper was minted", "_date_is_implausible" not in SRC)
i_tiera = SRC.find('if data.get("authoritative") and data.get("value") and data.get("located", True) and _ocr_clean and _cov_ok:')
check("the pinned Tier-A condition line stays BYTE-IDENTICAL + present", i_tiera > 0)
check("the wrap sits immediately BEFORE the Tier-A win", 0 < i_block < i_tiera)

# ── Fix #2 predicate behaviour (date-stable) ──────────────────────────────────
Y = E._invalid_taught_date_yields
NOW = datetime(2026, 10, 15)
def d(days):
    return (NOW + timedelta(days=days)).strftime('%d/%m/%Y')
check("the real case: taught '26-01-2361' vs mapping '16-06-2026' -> 'future' (blocks Tier-A)",
      Y('26-01-2361', '16-06-2026') == 'future')
check("a valid date never yields (both valid) -> ''", Y('16-06-2026', '16-06-2026') == '')
check("PIN post-dating: a legit ~100-day-ahead taught date does NOT yield (no false-refuse)",
      Y(d(100), d(0), NOW) == '')
check("an absurd >3y future taught date DOES yield", Y(d(1500), d(0), NOW) == 'future')

print("\n" + (f"{len(FAILED)} FAILED: " + ", ".join(FAILED) if FAILED else "ALL PINS PASS"))
sys.exit(1 if FAILED else 0)
