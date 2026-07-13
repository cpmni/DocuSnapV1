"""
born_digital text-layer extraction — detection gate, the points->top-left
page-normalised coordinate transform (y-flip), and word/line grouping. Uses a
FAKE pypdfium2 page (scripted char boxes), so it needs no real PDF and no
Tesseract — mirroring the repo's stubbed-OCR test convention.
"""
import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ocr import born_digital as bd

fails = []
def check(name, got, exp):
    if got == exp: print(f"  OK  {name}")
    else: print(f"  FAIL {name}: got={got!r} exp={exp!r}"); fails.append(name)
def approx(name, got, exp, tol=0.01):
    if got is not None and abs(got - exp) <= tol: print(f"  OK  {name} ({got:.3f})")
    else: print(f"  FAIL {name}: got={got} exp~={exp}"); fails.append(name)


class FakeTextPage:
    def __init__(self, chars):  # chars: (char, left, bottom, right, top) in POINTS
        self.chars = chars
    def count_chars(self): return len(self.chars)
    def get_charbox(self, i): return self.chars[i][1:]
    def get_text_range(self, i, count): return "".join(c[0] for c in self.chars[i:i+count])

class FakePage:
    def __init__(self, w, h, chars): self._w, self._h, self._tp = w, h, FakeTextPage(chars)
    def get_size(self): return (self._w, self._h)
    def get_textpage(self): return self._tp


W, H = 612.0, 792.0  # US Letter points

def word(text, x_left, y_top_pt, cw=8.0, ch=12.0):
    """Lay out `text` as left-to-right char boxes on a row whose TOP is y_top_pt
    points from the page bottom (PDFium origin)."""
    out, x = [], x_left
    for c in text:
        out.append((c, x, y_top_pt - ch, x + cw, y_top_pt)); x += cw
    return out

# Page: "INVOICE" near the top, then a space, then "# 2371" on a row below.
chars = []
chars += word("INVOICE", 460, 762)
chars += [(" ", 540, 750, 548, 762)]
chars += word("#", 500, 720)
chars += [(" ", 508, 708, 516, 720)]
chars += word("2371", 545, 720)

print("Detection gate:")
# Few chars -> not enough to call born-digital.
check("short page not born-digital", bd.assess_page(FakePage(W, H, chars))[0], False)
# Pad to >=40 alnum chars -> born-digital.
big = chars + word("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 50, 600)
ok, n, text = bd.assess_page(FakePage(W, H, big))
check("text-rich page IS born-digital", ok, True)
check("full text reconstructed", "2371" in text, True)
# Hybrid/garbage guard: a layer of mostly symbols is rejected.
junk = [("@", 10*i, 600, 10*i+8, 612) for i in range(50)]
check("symbol-only layer rejected (hybrid guard)", bd.assess_page(FakePage(W, H, junk))[0], False)
# No text layer at all.
check("empty page not born-digital", bd.assess_page(FakePage(W, H, []))[0], False)

print("Coordinate transform (points bottom-left -> top-left normalised) + grouping:")
lines = bd.page_lines(FakePage(W, H, chars))
texts = [ln["text"] for ln in lines]
check("two lines grouped", len(lines), 2)
check("first line is INVOICE", texts[0], "INVOICE")
check("second line is '# 2371'", texts[1], "# 2371")
inv, row2 = lines[0], lines[1]
# y-flip: INVOICE top is 762pt -> y_norm = 1 - 762/792 = 0.038 (near top).
approx("INVOICE y_norm near top", inv["y_norm"], 1 - 762/792)
# INVOICE sits ABOVE the 2371 row.
check("INVOICE above the 2371 row", inv["y_norm"] < row2["y_norm"], True)
# x-norm of '2371' word: left 545pt -> 545/612 = 0.890.
w2371 = next(w for w in row2["words"] if w["text"] == "2371")
approx("'2371' x_norm left edge", w2371["x_norm"], 545/612)
# big x-gap between '#' and '2371' splits them into separate words.
check("'#' and '2371' are separate words", [w["text"] for w in row2["words"]], ["#", "2371"])

print("Punctuation glue in line reconstruction (_join_words):")
def _w(t): return {"text": t}
# A comma/period the text layer emits as its OWN gap/baseline-split word must glue
# back: a date keeps the space AFTER the comma ("6, 2026"); a decimal rejoins both
# sides ("42.35"). Otherwise the date/amount patterns + parse_date silently fail.
check("date comma glues, keeps trailing space",
      bd._join_words([_w("March"), _w("6"), _w(","), _w("2026")]), "March 6, 2026")
check("decimal point rejoins both sides",
      bd._join_words([_w("42"), _w("."), _w("35")]), "42.35")
check("dotted numeric date stays intact",
      bd._join_words([_w("6"), _w("."), _w("3"), _w("."), _w("2026")]), "6.3.2026")
check("'#'+digits stays separate (not attaching punct)",
      bd._join_words([_w("#"), _w("2371")]), "# 2371")

print("Column-gap break in line reconstruction (_join_words):")
def _wg(t, x1, x2, h=0.012):  # a word with geometry, on one row
    return {"text": t, "x1": x1, "x2": x2, "y1": 0.20, "y2": 0.20 + h}
# Two side-by-side columns on one visual row (BILL FROM value …big gap… BILL TO value): a
# column-wide gap must emit a 4-space break so keyword.py's `{4,}`-space guard takes only the
# value's own column — the fix for the merged-supplier "Profile Construction ACME Inc" bug.
col = bd._join_words([_wg("Profile", 0.120, 0.161), _wg("Construction", 0.166, 0.245),
                      _wg("ACME", 0.384, 0.428), _wg("Inc", 0.432, 0.451)])
check("column gap emits a 4-space break", "    " in col, True)
check("splits into the two company columns",
      [s.strip() for s in re.split(r' {4,}', col) if s.strip()],
      ["Profile Construction", "ACME Inc"])
# A NORMAL inter-word space (small gap) is NOT a column break.
check("normal word gap stays a single space",
      bd._join_words([_wg("Profile", 0.120, 0.161), _wg("Construction", 0.166, 0.245)]),
      "Profile Construction")
# Regression guard: a wide-but-value gap ("# 2371", ~0.06 apart) must NOT be mistaken for a
# column — else a '#'-prefixed invoice number would be truncated to '#'.
check("wide value gap '# 2371' stays joined (not a column)",
      bd._join_words([_wg("#", 0.817, 0.830), _wg("2371", 0.890, 0.942)]), "# 2371")

print("Two-pass line grouping — nearest-anchor re-home (3-column header):")
# The #1344-class bug: a value's row is NOT aligned with the label column to its left.
# A single greedy pass glues the value to whichever row was SEEDED FIRST (the upper
# "BILLING ADDRESS" at a slightly higher cy), so the value's own "INVOICE NUMBER"
# label reads EMPTY and keyword extraction grabs the wrong column. Two-pass assigns
# each word to its NEAREST anchor line, so the value re-homes to its own label's row.
# Geometry (ch=12, H=792 → tol 0.006 norm = 4.75pt): BILLING cy_pt 494, value cy_pt
# 489.5 (Δ4.5<tol from BILLING → NOT its own anchor in PASS 1), INVOICE cy_pt 488.5
# (Δ1.0 from value). Old pass → value joins BILLING; new pass → value joins INVOICE.
hdr  = word("BILLING", 60, 500)          # cy_pt 494 (upper row, LEFT column)
hdr += word("INVOICE", 380, 494.5)       # cy_pt 488.5 (lower row, RIGHT column)
hdr += word("NUMBER", 445, 494.5)        #   same row as INVOICE
hdr += word("317437", 400, 495.5)        # cy_pt 489.5 — the VALUE, drifts between rows
hlines = bd.page_lines(FakePage(W, H, hdr))
val_line = next((ln for ln in hlines if "317437" in ln["text"]), None)
check("value line found", val_line is not None, True)
check("value re-homes to its INVOICE NUMBER row (not BILLING)",
      val_line is not None and "INVOICE" in val_line["text"] and "NUMBER" in val_line["text"]
      and "BILLING" not in val_line["text"], True)
bill_line = next((ln for ln in hlines if "BILLING" in ln["text"]), None)
check("BILLING row does NOT swallow the value",
      bill_line is not None and "317437" not in bill_line["text"], True)

print("Two-pass line grouping — stacked-rows guard (each amount keeps its own row):")
# The trade-off PASS 2 must NOT break: a stacked totals block at NORMAL line spacing
# (~15pt = 0.019 norm >> tol) must keep each amount on its OWN label's row — nearest-
# anchor must never cross-pull "387.74" up to the "Total" row (or a future tol/nearest
# tweak that merged them would silently move which total keyword pairs). A 0.5pt
# baseline drift of each amount vs its label is included on purpose.
tot  = word("Subtotal", 60, 300)         # row 1 label
tot += word("387.74", 400, 299.5)        #   row 1 amount (0.5pt baseline drift)
tot += word("Total", 60, 285)            # row 2 label, 15pt below (well separated)
tot += word("426.32", 400, 284.5)        #   row 2 amount
tlines = bd.page_lines(FakePage(W, H, tot))
sub_line = next((ln for ln in tlines if "387.74" in ln["text"]), None)
tot_line = next((ln for ln in tlines if "426.32" in ln["text"]), None)
check("subtotal amount stays on the Subtotal row",
      sub_line is not None and "Subtotal" in sub_line["text"] and "426.32" not in sub_line["text"], True)
check("total amount stays on the Total row",
      tot_line is not None and "Total" in tot_line["text"] and "387.74" not in tot_line["text"], True)
check("stacked rows are two distinct lines", sub_line is not tot_line and sub_line is not None, True)

if fails:
    print(f"\n{len(fails)} FAILED"); sys.exit(1)
print("\nAll born_digital checks passed.")
