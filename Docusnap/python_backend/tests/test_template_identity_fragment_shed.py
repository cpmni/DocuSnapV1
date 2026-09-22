"""Lever D — TEMPLATE-IDENTITY GEOMETRY FRAGMENT SHED (2026-08-20, gary -> Oracle SIGN-OFF-W/COND).

reconstruct_page_text renders a wide letter-spaced/centred letterhead with 4-space COLUMN BREAKS, so
the strict pick_issuer_geometry splits the issuer name into single-word segments and returns one word
('Cleaning'), never 'Silverbeck Cleaning Supplies' — so the geom-witness note never sheds over a
CLEAN, on-page letterhead. `fragmented_issuer_confirms` re-joins the MAXIMAL contiguous run of
letterhead-sized, name-shaped segments and CONFIRMS (boolean, fixed-target no-swap) when it equals the
confirmed issuer.

Pins:
  frag-sheds        — a column-broken name + trailing junk ('*e') CONFIRMS the target.
  no-swap           — a DIFFERENT target never confirms (D can only ever confirm the fill's value).
  superset (G5)     — a page printing 'X Ltd' (Ltd also big) does NOT shed for target 'X'.
  two-column        — 'X   Y' (both big) maximal-joins to a non-target string -> no shed.
  body-sized col    — an adjacent body-sized address column fails the size floor -> name run sheds,
                      address never joins.
  guards            — no geometry / med_h<=0 / lines!=rows -> False.
  REFACTOR PIN      — pick_issuer_geometry still returns a SINGLE word on the fragmented row (the
                      shared ASSERT path is byte-identical; D added no re-join there).

Run:  py -3.12 tests/test_template_identity_fragment_shed.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import letterhead as lh, chrome_band

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def norm(v):
    return " ".join(str(v or "").strip().lower().split())


TARGET = "Silverbeck Cleaning Supplies"
NAME_BIG = {"Silverbeck", "Cleaning", "Supplies"}


def build(ocr_text, big):
    """Build the {lines, rows, med_h} geometry the engine passes, from the SAME issuer band the
    function reads — so the band↔geometry line mapping is faithful. Name tokens get a letterhead
    height (>= 1.15*med_h); everything else is body-sized."""
    band = chrome_band.issuer_chrome_lines(ocr_text)
    lines = list(band)
    rows = [[(0, 0, 10, (20 if tok in big else 10), tok, 90) for tok in ln.split()] for ln in lines]
    return {"lines": lines, "rows": rows, "med_h": 10, "words": []}


# case 1 — the Silverbeck class: fragmented name + junk token -> CONFIRMS
g1 = build("Silverbeck    Cleaning    Supplies    *e", NAME_BIG)
check("frag name confirms target", lh.fragmented_issuer_confirms("Silverbeck    Cleaning    Supplies    *e", g1, TARGET, norm) is True)
check("no-swap: a different target never confirms", lh.fragmented_issuer_confirms("Silverbeck    Cleaning    Supplies    *e", g1, "Acme Ltd", norm) is False)

# case 2 — superset (Oracle G5): 'X Ltd' printed, Ltd also letterhead-sized -> NO shed for target 'X'
o2 = "Silverbeck    Cleaning    Supplies    Ltd"
g2 = build(o2, NAME_BIG | {"Ltd"})
check("superset (...Ltd) does NOT shed", lh.fragmented_issuer_confirms(o2, g2, TARGET, norm) is False)

# case 3 — two distinct companies on the row, both big -> maximal run != target -> NO shed
o3 = "Silverbeck    Cleaning    Supplies    Bramblewood    Ltd"
g3 = build(o3, NAME_BIG | {"Bramblewood", "Ltd"})
check("two-column row does NOT wrongly join", lh.fragmented_issuer_confirms(o3, g3, TARGET, norm) is False)

# case 4 — adjacent BODY-sized address column fails the size floor -> name run confirms
o4 = "Silverbeck    Cleaning    Supplies    41 Mill Road"
g4 = build(o4, NAME_BIG)
check("body-sized address column never joins; name confirms", lh.fragmented_issuer_confirms(o4, g4, TARGET, norm) is True)

# guards
check("no geometry -> False", lh.fragmented_issuer_confirms("x", {"rows": []}, TARGET, norm) is False)
check("med_h<=0 -> False", lh.fragmented_issuer_confirms(o4, {"lines": g4["lines"], "rows": g4["rows"], "med_h": 0}, TARGET, norm) is False)
check("lines!=rows -> False", lh.fragmented_issuer_confirms(o4, {"lines": g4["lines"], "rows": [], "med_h": 10}, TARGET, norm) is False)

# REFACTOR PIN — D added NO re-join to the shared ASSERT path: pick_issuer_geometry can only ever
# return a single column SEGMENT or abstain (None) on the fragmented row — NEVER the joined full name
# (that capability lives ONLY in fragmented_issuer_confirms). The BYTE-IDENTICAL refactor gate is the
# existing letterhead pick suite (test_letterhead_pick.py / test_letterhead_issuer.py); this asserts
# the invariant D relies on: the shared picker never produces the full name.
pick = lh.pick_issuer_geometry("Silverbeck    Cleaning    Supplies    *e", g1)
check(f"shared pick never yields the joined name (got {pick!r})",
      pick != TARGET and pick in (None, "Silverbeck", "Cleaning", "Supplies"))

print(f"\n{'PASS' if not fails else 'FAIL'} — {fails} failure(s)")
sys.exit(1 if fails else 0)
