"""OCR date pre-clean (space/split tolerance) — validator._date_preclean, salvage-tier only.
oscar (OCR cause) + reggie (regex) + Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-16.

An OCR word-break split a date "15/06/2026" into "1 5/06/2026"; the salvage locator then grabbed
the sub-run "5/06/2026" and SILENTLY filled the WRONG date 05-06-2026 above the review threshold.
_date_preclean rejoins the digit-split BEFORE the salvage locator — corrected value, kept at the
salvage confidence tier (80, review-held) so a recovered split date can NEVER auto-file.

Pins the Oracle conditions:
  1 GUARD (the seam) — the preclean is in salvage ONLY, not parse_date: a spaced date does NOT parse
    start-to-end (stays out of the conf-94 clean tier) and is recovered at the conf-80 salvage tier.
  2 SILENT-WRONG   — "1 5/06/2026" -> 15-06-2026 (NOT 05-06-2026).
  3 NO-JOIN        — "15 Jun 2026" unaffected; "1 5 06 2026" (spaces AS separators) -> None.
  4 RESIDUALS      — leading-stray-digit + two-date-2-digit-year glue stay review-held (never <88).
  5 TWIN vectors   — the shared vector set (also run through the JS twins) — exact expected outputs.

Run:  py -3.12 tests/test_date_preclean.py   (from python_backend/)
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import validator
from extraction.validator import (_date_preclean, salvage_date, salvage_date_detail,
                                   parse_date, _CLEAN_SALVAGE_CONF, _CLEAN_DATE_CONF)

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


validator.set_date_order("dmy")

# ── PIN 5: the shared twin vector set (must match the JS _datePreclean byte-for-byte) ──
print("-- _date_preclean transform (twin vectors) --")
VECTORS = {
    "1 5/06/2026":     "15/06/2026",   # the reported OCR split
    "16 / 03 / 2026":  "16/03/2026",   # spaces around separators
    "15 Jun 2026":     "15 Jun 2026",  # DD MMM YYYY — digit-space-LETTER never joined
    "Aug 3 2024":      "Aug 3 2024",   # MMM DD YYYY — month name present -> digit-join GATED off (day-year space kept)
    "Sep 15, 2024":    "Sep 15, 2024", # month-name date unaffected
    "2 0 2 6-06-15":   "2026-06-15",   # 3+-digit split needs zero-width lookaround
    "1 5 06 2026":     "15062026",     # spaces AS separators -> bare run, no separators
    "15-06-2026":      "15-06-2026",   # already clean -> no-op
    "  15/06/2026 .":  "15/06/2026.",  # trailing " ." collapses at the separator; salvage locator ignores the dot
}
for src, want in VECTORS.items():
    got = _date_preclean(src)
    check(f"_date_preclean({src!r}) == {want!r}  (got {got!r})", got == want)


# ── PIN 2: the silent-wrong is fixed (15, not 05) ──
print("-- silent-wrong fix --")
d, n = salvage_date_detail("1 5/06/2026")
check("salvage '1 5/06/2026' -> 15 June 2026 (NOT 5 June)", d is not None and d.date() == date(2026, 6, 15))
check("  ... and it is a SINGLE candidate (n==1, verbatim capture)", n == 1)
check("salvaged value formats to canonical '15-06-2026'", d is not None and d.strftime("%d-%m-%Y") == "15-06-2026")
# GUARD: normalise_date uses parse_date (clean tier) which is DELIBERATELY not precleaned, so a
# spaced value is NOT rewritten here — the salvage path (validate_and_adjust) is where the fix lands.
check("normalise_date('1 5/06/2026') is NOT rewritten (preclean is salvage-only, not parse_date)",
      validator.normalise_date("1 5/06/2026") == "1 5/06/2026")


# ── PIN 1: the GUARD — preclean is salvage-only, NEVER parse_date ──
print("-- confidence-tier guard (salvage only, not parse_date) --")
check("parse_date('1 5/06/2026') is None  (space still breaks the clean tier — NOT precleaned)",
      parse_date("1 5/06/2026") is None)
check("parse_date('15/06/2026') parses (clean tier untouched)",
      parse_date("15/06/2026") is not None and parse_date("15/06/2026").date() == date(2026, 6, 15))
check("tier constants intact: salvage 80 < critical floor 88 < clean 94",
      _CLEAN_SALVAGE_CONF == 80 and _CLEAN_DATE_CONF == 94 and _CLEAN_SALVAGE_CONF < 88 < _CLEAN_DATE_CONF)


# ── PIN 3: no-join safety ──
print("-- no-join / month-name safety --")
check("salvage '15 Jun 2026' -> 15 June (month-name path unaffected)",
      salvage_date("15 Jun 2026") is not None and salvage_date("15 Jun 2026").date() == date(2026, 6, 15))
check("salvage '1 5 06 2026' is None (spaces AS separators -> no separators -> not a date)",
      salvage_date("1 5 06 2026") is None)
check("salvage 'Colour Issues' is None (no date content)", salvage_date("Colour Issues") is None)
check("existing 'Inv01-May-2024x' still salvages 1 May 2024 (regression)",
      salvage_date("Inv01-May-2024x") is not None and salvage_date("Inv01-May-2024x").date() == date(2024, 5, 1))
check("existing '16 / 03 / 2026' still salvages (regression)",
      salvage_date("16 / 03 / 2026") is not None and salvage_date("16 / 03 / 2026").date() == date(2026, 3, 16))


# ── PIN 4: residuals stay review-held (accepted behaviour — never a silent auto-file) ──
print("-- residuals (accepted, review-held) --")
# A leading stray digit joins and yields a valid-but-different date — review-held via conf 80, never <88.
d2, _ = salvage_date_detail("2 2/4/26")
check("leading-stray '2 2/4/26' -> a valid date (joined), recovered at salvage tier (review-held)",
      d2 is not None)   # the point is it's salvage-tier (80), NOT a silent auto-file
# Two dates, first with a 2-digit year, glue into one absurd-year candidate — review-held, obviously wrong.
d3, n3 = salvage_date_detail("02/04/26 05/06/2026")
check("two-date-2-digit-year glue does not silent-auto-file (absurd year OR multi-date, salvage-held)",
      (d3 is None) or (d3.year > 2100) or (n3 > 1))


print()
if fails:
    print(f"FAILED: {fails} check(s)")
    sys.exit(1)
print("ALL PASS")
