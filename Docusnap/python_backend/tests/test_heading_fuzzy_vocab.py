"""
test_heading_fuzzy_vocab.py — LEVER 1: fuzzy-to-closed-vocabulary title recovery (HEADING_FUZZY_VOCAB),
Herald/Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-26. The exact _despaced_heading test only recovers a
CLEANLY letter-spaced title; a single GARBLED glyph ("PU RC fa ASE ORDER" -> "purcfaaseorder") or a
SINGLE-word letter-spaced title ("I N V O I C E") slips through, the type never scores from its own
title, and the doc falls to a same-logo sibling / generic fingerprint (the Northgate PO->Invoice flip).
_fuzzy_heading is ADDED beside the exact arm: difflib block-ratio >= 0.82 against the tiny closed
vocabulary (type names ∪ aliases), argmax + 0.08 margin (Oracle C3), single-word admitted only when
genuinely fragmented (preserves the alias contract).

Pins: FIRE the two garble classes (with heading True = Seam B); C3 near-miss ('purchase ledger'@~0.815)
and margin (two near-equal vocab words) do NOT fire; C4 OFF byte-identical (fuzzy off => the garble is
NOT recovered); the 'WORK SHEET' alias contract is preserved (fuzzy never collapses a word-spaced
single-word spelling — that stays the alias mechanism's job).

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_heading_fuzzy_vocab.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import keyword

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1
def setenv(name, v):
    if v is None: os.environ.pop(name, None)
    else: os.environ[name] = v

PATTERNS = {"document_type_keywords": {
    "Purchase Order":     ["purchase order", "po number", "po no"],
    "Invoice":            ["invoice", "invoice no", "bill to"],
    "Sales Order":        ["sales order"],
    "Delivery Note":      ["delivery note", "delivery docket"],
    "Service Worksheet":  ["service worksheet"],
}}
KNOWN   = ["Purchase Order", "Invoice", "Sales Order", "Delivery Note", "Service Worksheet"]
ALIASES = {"Service Worksheet": ["Worksheet"]}   # a single-word title alias — the contract to protect
VOCAB_LC = {"purchase order", "invoice", "sales order", "delivery note", "service worksheet", "worksheet"}

LETTERHEAD = "Northgate Textiles\nWeavers Mill, Preston Way\nPR1 4XX\n"

def detect(ocr):
    return keyword.detect_document_type(ocr, PATTERNS, known_types=KNOWN, type_aliases=ALIASES)

def main():
    setenv("HEADING_FUZZY_VOCAB", "1"); setenv("HEADING_LETTER_SPACING", "1")

    # ── FIRE 1: a GARBLED multi-word title the EXACT test misses (single-glyph corruption) ──
    # Confirm the exact arm genuinely CANNOT (so this is a real fuzzy win, not double-covered).
    check("premise: exact _despaced_heading REJECTS the garble 'pu rc fa ase order' (needs fuzzy)",
          keyword._despaced_heading("pu rc fa ase order", "purchase order") is False)
    g = LETTERHEAD + "PU RC fa ASE ORDER    Order No. PO-60892\nOrder Date 22/01/2026\n"
    r = detect(g)
    check("FIRE: garbled 'PU RC fa ASE ORDER' -> Purchase Order (fuzzy recovery)",
          r is not None and r["type"] == "Purchase Order")
    check("FIRE: Seam B — heading is True (title_trusted set)",
          r is not None and r.get("heading") is True)

    # ── FIRE 2: a SINGLE-word letter-spaced title (the born-digital tracking gap) ──
    inv = "I N V O I C E\nBill To: A Customer\nTotal 100.00\n"
    ri = detect(inv)
    check("FIRE: single-word 'I N V O I C E' -> Invoice + heading True",
          ri is not None and ri["type"] == "Invoice" and ri.get("heading") is True)

    # ── C3 near-miss: 'purchase ledger' ~= 0.815 < 0.82 -> does NOT fire Purchase Order ──
    pl = LETTERHEAD + "PURCHASE LEDGER\nAccount summary\n"
    rl = detect(pl)
    check("C3 near-miss: 'PURCHASE LEDGER' (~0.815) is NOT typed Purchase Order",
          (rl or {}).get("type") != "Purchase Order")

    # ── alias contract: 'WORK SHEET' (word-spaced single-word) must NOT fuzzy-collapse to worksheet ──
    ws = "WORK SHEET\nJob details\n"
    rw = detect(ws)
    check("alias contract: word-spaced 'WORK SHEET' is NOT fuzzy-typed Service Worksheet "
          "(fragmentation gate — that stays the alias mechanism's job)",
          (rw or {}).get("type") != "Service Worksheet" or rw.get("heading") is not True)

    # ── C4 OFF byte-identical: fuzzy off -> the garble is NOT recovered ──
    setenv("HEADING_FUZZY_VOCAB", "0")   # letter-spacing still ON — proves the garble needs FUZZY, not exact
    ro = detect(g)
    check("C4 OFF: HEADING_FUZZY_VOCAB=0 -> garbled title is NOT typed Purchase Order (byte-identical off)",
          (ro or {}).get("type") != "Purchase Order")
    roi = detect(inv)
    check("C4 OFF: HEADING_FUZZY_VOCAB=0 -> single-word letter-spaced 'I N V O I C E' not recovered",
          (roi or {}).get("type") != "Invoice" or roi.get("heading") is not True)
    setenv("HEADING_FUZZY_VOCAB", "1")

    # ── direct _fuzzy_heading unit pins (threshold + margin belt, C3) ──
    check("unit: 'pu rc fa ase order' fuzzes to 'purchase order' (0.889 >= 0.82, clear margin)",
          keyword._fuzzy_heading("pu rc fa ase order", "purchase order", VOCAB_LC) is True)
    check("unit: 'pe u rc h as io o rd e r' fuzzes to 'purchase order' (worst real garble 0.857)",
          keyword._fuzzy_heading("pe u rc h as io o rd e r", "purchase order", VOCAB_LC) is True)
    check("unit: 'purchase ledger' does NOT fuzz to 'purchase order' (0.815 < 0.82)",
          keyword._fuzzy_heading("purchase ledger", "purchase order", VOCAB_LC) is False)
    check("unit: single-word 'i n v o i c e' fuzzes to 'invoice' (fragmented)",
          keyword._fuzzy_heading("i n v o i c e", "invoice", VOCAB_LC) is True)
    check("unit: 'work sheet' does NOT fuzz to 'worksheet' (not fragmented — alias contract)",
          keyword._fuzzy_heading("work sheet", "worksheet", VOCAB_LC) is False)
    check("unit: single intact token 'wksheet' does NOT fuzz to a 'work sheet' alias (multi-token gate "
          "— a compact misspelling is the exact alias mechanism's job, not fuzzy)",
          keyword._fuzzy_heading("wksheet", "work sheet", VOCAB_LC) is False)
    check("unit: short-abbreviation floor — 'p o' never fuzzes to 'po'",
          keyword._fuzzy_heading("p o", "po", VOCAB_LC) is False)
    # C3 margin belt: a garble near-equidistant between two vocab phrases HOLDs (no clear winner).
    check("C3 margin: 'purchase order' vs a vocab carrying 'purchase orders' -> margin < 0.08 -> HOLD",
          keyword._fuzzy_heading("purchase order", "purchase order",
                                 {"purchase order", "purchase orders"}) is False)

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
