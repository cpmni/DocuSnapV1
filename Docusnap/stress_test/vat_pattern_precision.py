"""Precision cost of widening the `vat_no` format: does it readmit anything the gate refuses today?

WHY THIS EXISTS. `vat_no`'s shipped format (`92c7013`) is UK ONLY, deliberately: a generic "two
letters plus 8-12 characters" arm would readmit the measured OCR garbles, because 'CO' and 'EE' are
themselves real country codes. `VAT_EU_FORMATS` (`d9768c5`) widens it with per-country structures
that have exact element counts. This measures whether that widening costs any precision on real data
before the flag is flipped.

It produced the figure quoted in `d9768c5`: 56 distinct vat_no values this install has ever
committed, 10 accepted before and after, 46 refused before and after, ZERO flipped refused ->
accepted.

METHOD. Every vat_no value in `extractions` and `supplier_hints` is run through both pattern sets
using the SAME acceptance test the pipeline uses (`anchor._pattern_coverage`: longest IGNORECASE
search match over the whitespace-stripped value, against the `_PATTERN_AUTHORITATIVE_MIN` floor).
Any value whose verdict CHANGES is printed, so the trade is judged rather than asserted.

THE LIMIT THIS CANNOT MEASURE, and it matters: format alone cannot separate two strings of the same
shape. A garble that happens to match a real country's structure exactly IS accepted — 'ee053510429'
(nine digits, a valid Estonian shape) passes, while the measured 'ee05351042' (eight) does not. The
fixed probes at the bottom exist to keep that fact visible rather than buried.

  py -3.12 stress_test/vat_pattern_precision.py [--db <path>]

Read-only. mode=ro, never ?immutable=1 (that ignores the -wal).
"""
import argparse
import json
import os
import re
import sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config", "keyword_patterns.json")
DEFAULT_DB = os.path.join(os.environ.get("APPDATA", ""), "ScanFinder", "docusnap.db")
THRESH = 0.9   # _PATTERN_AUTHORITATIVE_MIN territory: the value must be essentially all pattern


def covered(value, pats):
    v = re.sub(r"\s+", "", str(value or ""))
    if not v:
        return 0.0
    best = 0
    for p in pats:
        try:
            for m in re.finditer(p, v, re.IGNORECASE):
                best = max(best, len(m.group(0)))
        except re.error:
            pass
    return best / len(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    args = ap.parse_args()

    vp = json.load(open(CONFIG, encoding="utf-8"))["validation_patterns"]
    GB, EU = vp["vat_gb"], vp["vat_eu"]

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    vals = [r[0] for r in con.execute(
        "SELECT DISTINCT display_value FROM extractions WHERE field_key='vat_no' "
        "AND display_value IS NOT NULL AND display_value <> ''")]
    vals += [r[0] for r in con.execute(
        "SELECT DISTINCT hint_value FROM supplier_hints WHERE field_key='vat_no' "
        "AND hint_value IS NOT NULL AND hint_value <> ''")]
    con.close()
    vals = sorted(set(vals))

    flipped, same_ok, same_no = [], 0, 0
    for v in vals:
        before, after = covered(v, GB) >= THRESH, covered(v, GB + EU) >= THRESH
        if before != after:
            flipped.append(v)
        elif before:
            same_ok += 1
        else:
            same_no += 1

    print(f"distinct vat_no values on this install: {len(vals)}")
    print(f"  accepted by UK-only and still accepted : {same_ok}")
    print(f"  refused by both                        : {same_no}")
    print(f"  FLIPPED refused -> accepted            : {len(flipped)}")
    for v in flipped:
        print(f"      {v!r}")

    # The garbles that justified the UK-only decision. If any of these ever flips to True, the
    # widening has undone 92c7013 and the pattern set needs tightening, not a bigger threshold.
    print("\n=== garbles that must stay refused ===")
    for g in ("comsssie42", "ee05351042", "VAT", "3PL", "1RE", "co12345678"):
        print(f"  {g!r:<16} UK-only={covered(g, GB) >= THRESH}   with-EU={covered(g, GB + EU) >= THRESH}")

    print("\n=== the limit: a garble shaped exactly like a real country's number IS accepted ===")
    for g in ("ee053510429",):
        print(f"  {g!r:<16} UK-only={covered(g, GB) >= THRESH}   with-EU={covered(g, GB + EU) >= THRESH}"
              "   <- nine digits is a valid Estonian shape; format cannot tell")

    print("\n=== real non-UK numbers that should pass ===")
    for good in ("IE1234567FA", "IE 1234567 FA", "IE1S23456L", "DE123456789", "DE 123 456 789",
                 "FR12345678901", "NL123456789B01", "IT12345678901", "ESA1234567B", "BE0123456789",
                 "PL1234567890", "SE123456789012", "CHE123456789MWST", "NO123456789MVA"):
        print(f"  {good!r:<20} UK-only={covered(good, GB) >= THRESH}   with-EU={covered(good, GB + EU) >= THRESH}")

    print("\n=== UK numbers must be untouched ===")
    for uk in ("GB651002784", "GB 651 0027 84", "GBGD123", "651 0027 84", "GB123456789012"):
        print(f"  {uk!r:<20} UK-only={covered(uk, GB) >= THRESH}   with-EU={covered(uk, GB + EU) >= THRESH}")


if __name__ == "__main__":
    main()
