"""
test_heading_letter_spacing.py — SLICE 1: letter-spacing heading recovery (HEADING_LETTER_SPACING),
Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-21. A document-TYPE heading in a tracked/letter-spaced display
font ("PURCHASE ORDER") OCRs as fragmented pseudo-words ("PU RC HASE ORDER"); the between-words-only
\\s* matcher can't match it, the type never scores from its own title, and the doc mis-types to a
same-logo sibling. detect_document_type now recovers a letter-spaced title on the top-band leftmost
column segment by EXACT collapsed-equality, forcing BOTH the 2.0 score AND the exposed heading signal
(Seam B) so title_trusted is set and the downstream cascade is actually fixed.

Pins (Oracle condition 2): the mode-1 unit asserts type==Purchase Order AND heading is True (not just
the type — else Seam B ships green-but-broken); the FP negatives must stay green (no false type); and
the OFF-pin proves byte-identical (letter-spaced input detects None/not-purchase_order with the switch
off = the pre-fix bug).

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_heading_letter_spacing.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import keyword

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1
def setenv(v):
    if v is None: os.environ.pop("HEADING_LETTER_SPACING", None)
    else: os.environ["HEADING_LETTER_SPACING"] = v

# Realistic shipped-ish buckets + the type NAMES (name_alias_lc is built from known_types, so a
# built-in type's NAME gets the same treatment as a custom alias — the uniformity the owner asked for).
PATTERNS = {"document_type_keywords": {
    "Purchase Order": ["purchase order", "po number", "po no"],
    "Invoice":        ["invoice", "invoice no", "bill to"],
    "Sales Order":    ["sales order"],
}}
KNOWN = ["Purchase Order", "Invoice", "Sales Order"]
ALIASES = {}   # (a custom type would add title aliases here; same code path)

def detect(ocr):
    return keyword.detect_document_type(ocr, PATTERNS, known_types=KNOWN, type_aliases=ALIASES)

LETTERHEAD = "Larkspur Interiors\nThe Design Rooms, 3 Chapel Lane\nHarrogate HG1 2PZ\nT 01423 560118\n"

def main():
    # ── RED-FIRST: the exact live garble (doc 192) ──────────────────────────────
    setenv("1")
    ls = LETTERHEAD + "PU RC HASE ORDER    Order No. PO-62560\nOrder Date 22/01/2026\nSteel plate 6mm 84.79\n"
    r = detect(ls)
    check("FIXED: letter-spaced 'PU RC HASE ORDER' -> type is Purchase Order",
          r is not None and r["type"] == "Purchase Order")
    check("FIXED: Seam B — heading is True (so title_trusted is set + the cascade is fixed)",
          r is not None and r.get("heading") is True)
    # The recovered title earned the strong HEADING multiplier (2.0), not a weak 1.0 mention: at this
    # fixture's position_weight (1.0) a heading scores 2.0 and a non-heading would score 1.0.
    check("FIXED: it earned the heading multiplier (>=2.0, not a weak 1.0 mention; Seam B forced)",
          r is not None and r["all_scores"].get("Purchase Order", 0) >= 2.0)

    # A clean title still works and is unchanged (regex match; recovery never reached).
    clean = LETTERHEAD + "PURCHASE ORDER    Order No. PO-62560\nOrder Date 22/01/2026\n"
    rc = detect(clean)
    check("clean 'PURCHASE ORDER' still detects Purchase Order + heading True (unchanged)",
          rc is not None and rc["type"] == "Purchase Order" and rc.get("heading") is True)

    # ── OFF-pin: byte-identical to the pre-fix bug ──────────────────────────────
    setenv("0")
    ro = detect(ls)
    check("OFF-pin: with HEADING_LETTER_SPACING=0 the letter-spaced title does NOT type Purchase "
          "Order (the pre-fix bug — proves red-first + byte-identical off)",
          ro is None or ro["type"] != "Purchase Order")
    setenv("1")

    # ── FP negatives (must stay green — no false Purchase Order) ─────────────────
    def not_po(ocr, why):
        r = detect(ocr)
        got = (r or {}).get("type")
        check(f"FP-negative: {why} -> NOT Purchase Order (got {got!r})", got != "Purchase Order")

    not_po(LETTERHEAD + "PO Box 12, Harrogate\nInvoice No. INV-5\n", "'PO Box 12' (real word 'box' stays)")
    not_po(LETTERHEAD + "please order online at our store\nInvoice No. INV-5\n", "prose 'please order online'")
    not_po(LETTERHEAD + "P O 12345\nInvoice No. INV-5\n", "bare 'P O 12345' spaced code (short-name guard)")
    # A de-spaceable title placed BELOW the top band must not be recovered (positional bound).
    below = LETTERHEAD + ("line\n" * 30) + "PU RC HASE ORDER\n"
    rb = detect(below)
    check("FP-negative: a letter-spaced phrase BELOW the top band is NOT recovered as a title",
          (rb or {}).get("type") != "Purchase Order" or (rb or {}).get("heading") is not True)

    # ── the short-name guard directly ───────────────────────────────────────────
    check("guard: _despaced_heading rejects a <5-char collapsed phrase ('po')",
          keyword._despaced_heading("p o 12345", "po") is False)
    check("guard: still recovers a real >=5-char title ('purchase order')",
          keyword._despaced_heading("pu rc hase order", "purchase order") is True)

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
