"""Lever E — HINT-BAND WHITESPACE NORMALIZE (2026-08-20, Oracle SIGN-OFF-WITH-CONDITIONS).

The Stage-2.5a issuer-band presence test (`_supplier_hint_upgrade`) was a raw
`val.lower() in ocr_top`. reconstruct_page_text renders a wide letter-spaced/centred letterhead
with 4-SPACE COLUMN BREAKS ("silverbeck    cleaning    supplies"), so a single-spaced CONFIRMED
hint value is NOT a substring and the "Company inferred… please confirm" note never sheds — even
with a usage>=42 hint present (measured: 16 live Silverbeck docs, all held). Lever E collapses
internal whitespace on BOTH sides, restoring the match through the CONFIRMED value.

Pins the Oracle conditions:
  kill-off        — HINT_BAND_WS_NORMALIZE unset/'0' -> the column-broken band does NOT match
                    (byte-identical: the bug is preserved when the switch is off).
  release (ON)    — armed, the column-broken band matches the confirmed hint -> (value, usage).
  no-swap         — armed, a DIFFERENT incumbent can never match (graduation confirms V only).
  usage-floor     — armed, a usage<3 hint is still rejected.
  clean-unchanged — a clean single-spaced band matches identically OFF and ON (no regression).

Run:  py -3.12 tests/test_hint_band_ws_normalize.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.engine import ExtractionEngine, _collapse_ws

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


# The Silverbeck band exactly as reconstruct_page_text emits it (4-space column breaks + junk token).
BAND = ("silverbeck    cleaning    supplies    *e brightworks house, 7 lather lane - "
        "suddsfield, sf2 6nn vat reg no gb 821 4458 39")
CLEAN = "silverbeck cleaning supplies ltd, 7 lather lane - suddsfield"
HINTS = [{"field_key": "supplier_name", "usage_count": 42, "hint_value": "Silverbeck Cleaning Supplies"}]
ENGINE = ExtractionEngine.__new__(ExtractionEngine)   # no __init__: method only needs the static _accept_norm


def upgrade(band, incumbent="Silverbeck Cleaning Supplies", hints=HINTS):
    return ExtractionEngine._supplier_hint_upgrade(ENGINE, incumbent, hints, band, None)


check("_collapse_ws collapses 4-space runs", _collapse_ws("a    b   c") == "a b c")
check("_collapse_ws None -> ''", _collapse_ws(None) == "")

os.environ.pop("HINT_BAND_WS_NORMALIZE", None)
check("OFF: column-broken band does NOT match (byte-identical bug preserved)", upgrade(BAND) is None)
check("OFF: clean single-spaced band matches (unchanged)", upgrade(CLEAN) == ("Silverbeck Cleaning Supplies", 42))

os.environ["HINT_BAND_WS_NORMALIZE"] = "1"
check("ON: column-broken band matches the confirmed hint", upgrade(BAND) == ("Silverbeck Cleaning Supplies", 42))
check("ON: clean single-spaced band still matches", upgrade(CLEAN) == ("Silverbeck Cleaning Supplies", 42))
check("ON no-swap: a different incumbent never matches", upgrade(BAND, incumbent="Acme Ltd") is None)
check("ON: usage<3 hint still rejected",
      upgrade(BAND, hints=[{"field_key": "supplier_name", "usage_count": 2,
                            "hint_value": "Silverbeck Cleaning Supplies"}]) is None)

os.environ.pop("HINT_BAND_WS_NORMALIZE", None)
print(f"\n{'PASS' if not fails else 'FAIL'} — {fails} failure(s)")
sys.exit(1 if fails else 0)
