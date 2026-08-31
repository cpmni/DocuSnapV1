#!/usr/bin/env python3
"""
tests/test_locate_role_qualifier.py
-----------------------------------
PIN for TEMPLATE_LOCATE_ROLE_QUALIFIER (2026-08-31, reggie stop-vocabulary + 007 placement ->
Oracle SIGN-OFF-W/COND). The taught-total occurrence-selection fix: a bare "Total" mapping's
`_label_score` scores a boundary-aligned "total" 1.0, and a SPACE is a boundary, so "Net Total" /
"Goods Total" tie the clean grand "Total" at 1.0 and the proximity tie-break (or a confirm_value
carriers override fed a drifted rigid Net read) locks the WRONG row.

When armed, `_locate_anchor` (OCR) and anchor._locate_in_text_lines (born-digital) DEMOTE — never
veto — role-qualified "Total" occurrences using keyword._total_role_collision VERBATIM, preferring
a clean grand total; an all-role-qualified LOCAL window reports not-found so the caller's page-wide
leg runs, an all-role-qualified PAGE keeps today's pick (byte-identical).

Oracle-named pins covered here:
  1. RED-first row selection (OFF picks the nearer "Net Total"; ON picks the clean "Total").
  2. Divergence ("Net Total / Total VAT / Invoice Total" -> ON picks "Invoice Total"; an
     any-preceding-word rule would wrongly demote "Invoice Total" and no-op the fix).
  3. Carriers fallback (an armed needle's all-qualified confirm_value carrier set must NOT steal
     the Net line -> fall back to the clean floor set).
  4. Local-all-qualified -> None (the page-wide leg trigger); page-wide-all-qualified keeps the pick.
  5. Born-digital twin parity + its own page-wide leg.
  6. Vocab-identity (the demotion CALLS keyword._total_role_collision — the leg cannot be a copied
     stop-list; monkeypatching keyword's helper changes the locate's decision).
  7. Leg-deleted -> RED (arming OFF reverts the bug) + OFF byte-identical.

Usage:  py -3.12 python_backend/tests/test_locate_role_qualifier.py
Exit 0 = pin holds. Exit 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper as tm  # noqa: E402
from extraction import anchor as anc          # noqa: E402
from extraction import keyword as kw           # noqa: E402


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return bool(condition)


class FakePage:
    def __init__(self, size=(1000, 1000)):
        self.size = size

    def crop(self, box):
        return ("crop", box)


def lines_stub(lines):
    return lambda crop: lines


def _matched(located):
    return (located.get("matched_text") if located else None) or ""


def _armed(on):
    """Set the module flag both paths read (anchor.py reads tm._LOCATE_ROLE_QUALIFIER_ON)."""
    tm._LOCATE_ROLE_QUALIFIER_ON = on


# ── 1. RED-first row selection ──────────────────────────────────────────────────
def test_red_first_row_selection():
    failures = 0
    print("1. bare 'Total' locate prefers the clean grand total over a nearer 'Net Total'")
    page = FakePage()
    # Taught box sits beside the FLOATED 'Net Total' row (nearest); the clean 'Total' row is
    # farther away, so proximity alone would steal the Net line.
    anchor_box = {"x_norm": 0.42, "y_norm": 0.54, "w_norm": 0.16, "h_norm": 0.05}
    both = [
        {"text": "Net Total 790.00",  "x_norm": 0.0, "y_norm": 0.52, "w_norm": 1.0, "h_norm": 0.04},
        {"text": "Total 1,578.24",    "x_norm": 0.0, "y_norm": 0.70, "w_norm": 1.0, "h_norm": 0.04},
    ]

    _armed(False)
    off = tm._locate_anchor(page, anchor_box, "Total", 1.0, lines_stub(both))
    if not check("OFF (bug): the nearer 'Net Total' row wins (RED-first documents the bug)",
                 _matched(off).lower().startswith("net total")):
        failures += 1

    _armed(True)
    on = tm._locate_anchor(page, anchor_box, "Total", 1.0, lines_stub(both))
    if not check("ON: the clean grand 'Total' row wins, not 'Net Total'",
                 _matched(on).lower() == "total 1,578.24".lower() or _matched(on).lower().startswith("total 1")):
        failures += 1
    _armed(False)
    print()
    return failures


# ── 2. Divergence (any-preceding-word rule would break this) ────────────────────
def test_divergence_invoice_total():
    failures = 0
    print("2. divergence: 'Net Total / Total VAT / Invoice Total' -> ON picks 'Invoice Total'")
    page = FakePage()
    anchor_box = {"x_norm": 0.42, "y_norm": 0.50, "w_norm": 0.16, "h_norm": 0.05}
    lines = [
        {"text": "Net Total 1200.00",   "x_norm": 0.0, "y_norm": 0.50, "w_norm": 1.0, "h_norm": 0.04},
        {"text": "Total VAT 240.00",    "x_norm": 0.0, "y_norm": 0.56, "w_norm": 1.0, "h_norm": 0.04},
        {"text": "Invoice Total 1440.00", "x_norm": 0.0, "y_norm": 0.62, "w_norm": 1.0, "h_norm": 0.04},
    ]
    _armed(True)
    on = tm._locate_anchor(page, anchor_box, "Total", 1.0, lines_stub(lines))
    m = _matched(on).lower()
    if not check("ON picks 'Invoice Total' (an any-preceding-word rule would wrongly demote it)",
                 m.startswith("invoice total")):
        failures += 1
    if not check("ON does not pick 'Net Total' or 'Total VAT'",
                 not m.startswith("net total") and not m.startswith("total vat")):
        failures += 1
    # A hypothetical any-preceding-word rule (demote whenever ANY word precedes 'Total') would
    # leave NO clean line here -> the fix would no-op. keyword._total_role_collision keeps
    # 'invoice' UNstopped by design, so this line stays clean:
    if not check("'invoice total …' is clean under the shipped stop-vocabulary",
                 tm._total_line_is_clean("Invoice Total 1440.00")):
        failures += 1
    _armed(False)
    print()
    return failures


# ── 3. Carriers fallback (confirm_value must not steal the Net line) ─────────────
def test_carriers_fallback():
    failures = 0
    print("3. an armed needle's all-qualified confirm_value carrier set falls back to the clean floor set")
    page = FakePage()
    anchor_box = {"x_norm": 0.42, "y_norm": 0.50, "w_norm": 0.16, "h_norm": 0.05}
    lines = [
        {"text": "Net Total 790.00",  "x_norm": 0.0, "y_norm": 0.50, "w_norm": 1.0, "h_norm": 0.04},
        {"text": "Total 1578.24",     "x_norm": 0.0, "y_norm": 0.66, "w_norm": 1.0, "h_norm": 0.04},
    ]
    # confirm_value is the DRIFTED rigid read (the Net value). Its carriers set = only the Net line.
    _armed(False)
    off = tm._locate_anchor(page, anchor_box, "Total", 1.0, lines_stub(lines), confirm_value="790.00")
    if not check("OFF: the carriers override steals the 'Net Total' line (RED-first)",
                 _matched(off).lower().startswith("net total")):
        failures += 1
    _armed(True)
    on = tm._locate_anchor(page, anchor_box, "Total", 1.0, lines_stub(lines), confirm_value="790.00")
    if not check("ON: all-qualified carrier set falls back to the clean 'Total' floor row",
                 _matched(on).lower().startswith("total 1578")):
        failures += 1
    _armed(False)
    print()
    return failures


# ── 4. Local-all-qualified -> None (page-wide leg); page-wide keeps the pick ─────
def test_local_all_qualified_triggers_pagewide():
    failures = 0
    print("4. local all-qualified -> None (fall through to page-wide); page-wide all-qualified keeps the pick")
    page = FakePage()
    anchor_box = {"x_norm": 0.42, "y_norm": 0.50, "w_norm": 0.16, "h_norm": 0.05}
    only_net = [{"text": "Net Total 790.00", "x_norm": 0.0, "y_norm": 0.50, "w_norm": 1.0, "h_norm": 0.04}]

    _armed(True)
    # LOCAL (expansion 0.0): all-qualified -> not found, so the caller's page-wide leg runs.
    loc = tm._locate_anchor(page, anchor_box, "Total", 0.0, lines_stub(only_net))
    if not check("LOCAL all-'Net Total' window -> None (page-wide leg trigger)", loc is None):
        failures += 1
    # PAGE-WIDE (expansion 1.0): no clean total exists anywhere -> DEMOTE never veto, read the Net row.
    pw = tm._locate_anchor(page, anchor_box, "Total", 1.0, lines_stub(only_net))
    if not check("PAGE-WIDE all-'Net Total' page -> keeps today's Net pick (never blank)",
                 _matched(pw).lower().startswith("net total")):
        failures += 1

    _armed(False)
    # OFF: LOCAL 'Net Total' still located today (byte-identical) — proves the None is the flag's doing.
    loc_off = tm._locate_anchor(page, anchor_box, "Total", 0.0, lines_stub(only_net))
    if not check("OFF: LOCAL 'Net Total' window still locates (byte-identical)",
                 loc_off is not None and _matched(loc_off).lower().startswith("net total")):
        failures += 1
    print()
    return failures


# ── 5. Born-digital twin parity + its own page-wide leg ─────────────────────────
def test_born_digital_twin():
    failures = 0
    print("5. born-digital twin (_locate_in_text_lines): parity + its own page-wide leg")
    lbox = {"x_norm": 0.40, "y_norm": 0.50, "w_norm": 0.16, "h_norm": 0.03}
    # In-band: nearer 'Net Total' + clean 'Total'. ON must prefer the clean one.
    in_band = [
        {"text": "Net Total 790.00", "x_norm": 0.0, "y_norm": 0.50, "w_norm": 1.0, "h_norm": 0.02, "words": []},
        {"text": "Total 1578.24",    "x_norm": 0.0, "y_norm": 0.52, "w_norm": 1.0, "h_norm": 0.02, "words": []},
    ]
    _armed(False)
    off = anc._locate_in_text_lines(in_band, lbox, "Total")
    if not check("OFF twin: nearer 'Net Total' wins (RED-first)",
                 _matched(off).lower().startswith("net total")):
        failures += 1
    _armed(True)
    on = anc._locate_in_text_lines(in_band, lbox, "Total")
    if not check("ON twin: clean 'Total' wins in-band",
                 _matched(on).lower().startswith("total 1578")):
        failures += 1

    # Page-wide leg: the row BAND holds only 'Net Total'; the clean 'Invoice Total' sits FAR outside
    # the band. The OCR path has a caller page-wide leg; born-digital has none, so the twin runs it.
    far_clean = [
        {"text": "Net Total 790.00",     "x_norm": 0.0, "y_norm": 0.50, "w_norm": 1.0, "h_norm": 0.02, "words": []},
        {"text": "Invoice Total 1578.24", "x_norm": 0.0, "y_norm": 0.85, "w_norm": 1.0, "h_norm": 0.02, "words": []},
    ]
    on2 = anc._locate_in_text_lines(far_clean, lbox, "Total")
    if not check("ON twin: band all-qualified -> page-wide finds the far 'Invoice Total'",
                 _matched(on2).lower().startswith("invoice total")):
        failures += 1
    _armed(False)
    off2 = anc._locate_in_text_lines(far_clean, lbox, "Total")
    if not check("OFF twin: only the in-band 'Net Total' is considered (byte-identical)",
                 _matched(off2).lower().startswith("net total")):
        failures += 1
    print()
    return failures


# ── 6. Vocab-identity: the leg CALLS keyword._total_role_collision (not a copy) ──
def test_vocab_identity():
    failures = 0
    print("6. vocab-identity: the demotion imports keyword's stop-vocabulary, does not copy it")
    # Direct predicate agreement with the shipped stop-sets.
    if not check("clean 'Total 10.00' is clean; 'Net Total' / 'Total VAT' are not",
                 tm._total_line_is_clean("Total 10.00")
                 and not tm._total_line_is_clean("Net Total 10.00")
                 and not tm._total_line_is_clean("Total VAT 2.00")):
        failures += 1
    if not check("a line with no boundary-aligned 'total' is not clean (Subtotal -> glued)",
                 not tm._total_line_is_clean("Subtotal 10.00")):
        failures += 1
    # The stop-vocabulary lives in keyword.py (import-not-copy): monkeypatch keyword's helper to
    # always-False and the locate's decision must FOLLOW — proving the leg calls it.
    _saved = kw._total_role_collision
    try:
        kw._total_role_collision = lambda line, s, e: False
        if not check("with keyword._total_role_collision stubbed False, 'Net Total' reads as clean",
                     tm._total_line_is_clean("Net Total 10.00")):
            failures += 1
    finally:
        kw._total_role_collision = _saved
    if not check("frozensets are keyword's own (precede {sub,net,goods,gross})",
                 {"sub", "net", "goods", "gross"} <= kw._TOTAL_ROLE_PRECEDE_STOP
                 and {"vat", "tax"} <= kw._TOTAL_ROLE_FOLLOW_STOP):
        failures += 1
    print()
    return failures


# ── 7. Leg-deleted -> RED / OFF byte-identical ──────────────────────────────────
def test_off_byte_identical():
    failures = 0
    print("7. OFF is byte-identical (no clean-total page unaffected; arming OFF reverts the bug)")
    page = FakePage()
    anchor_box = {"x_norm": 0.42, "y_norm": 0.60, "w_norm": 0.16, "h_norm": 0.05}
    clean_only = [{"text": "Total 1578.24", "x_norm": 0.0, "y_norm": 0.62, "w_norm": 1.0, "h_norm": 0.04}]
    _armed(False)
    off = tm._locate_anchor(page, anchor_box, "Total", 1.0, lines_stub(clean_only))
    _armed(True)
    on = tm._locate_anchor(page, anchor_box, "Total", 1.0, lines_stub(clean_only))
    _armed(False)
    if not check("a clean-total-only page: ON and OFF select the same row",
                 _matched(off) == _matched(on) and _matched(on).lower().startswith("total 1578")):
        failures += 1
    # A non-'Total' needle is never touched (arming gate).
    if not check("'Invoice Number' needle is not armed (arming gate)",
                 not tm._is_bare_total_needle("Invoice Number") and tm._is_bare_total_needle("Total:")):
        failures += 1
    print()
    return failures


# ── 8. End-to-end drift+relocate: the taught Net box, the committed grand total ──
def page_lines_stub(spec):
    """Crop-aware ocr_lines_fn: `spec` lines carry PAGE-normalised boxes (+ per-word boxes); the
    stub returns each line fully inside the requested crop, reported crop-relative (mirrors real
    image_to_data over a crop), so a LOCAL window sees only the rows it contains and the PAGE-WIDE
    crop sees them all."""
    def stub(crop):
        _, (x1, y1, x2, y2) = crop
        cw, ch = (x2 - x1) / 1000.0, (y2 - y1) / 1000.0
        if cw <= 0 or ch <= 0:
            return []
        cx, cy = x1 / 1000.0, y1 / 1000.0
        out = []
        for ln in spec:
            if (ln["x"] >= cx - 1e-9 and ln["y"] >= cy - 1e-9
                    and ln["x"] + ln["w"] <= cx + cw + 1e-9
                    and ln["y"] + ln["h"] <= cy + ch + 1e-9):
                words = [{"text": w["text"],
                          "x_norm": (w["x"] - cx) / cw, "y_norm": (w["y"] - cy) / ch,
                          "w_norm": w["w"] / cw, "h_norm": w["h"] / ch} for w in ln.get("words", [])]
                out.append({"text": ln["text"],
                            "x_norm": (ln["x"] - cx) / cw, "y_norm": (ln["y"] - cy) / ch,
                            "w_norm": ln["w"] / cw, "h_norm": ln["h"] / ch, "words": words})
        return out
    return stub


def test_end_to_end_drift_relocate():
    failures = 0
    print("8. end-to-end: taught box on 'Net Total', drift-relocate commits the clean grand total")
    page = FakePage((1000, 1000))
    # The floated totals block. The taught box sits on 'Net Total 790.00' (y 0.52); the real grand
    # 'Total 1,578.24' floats to y 0.70. The LOCAL window (anchor ±0.06) sees only 'Net Total'; the
    # PAGE-WIDE locate sees both.
    spec = [
        {"text": "Net Total 790.00", "x": 0.30, "y": 0.52, "w": 0.17, "h": 0.02,
         "words": [{"text": "Net", "x": 0.30, "y": 0.52, "w": 0.04, "h": 0.02},
                   {"text": "Total", "x": 0.35, "y": 0.52, "w": 0.05, "h": 0.02},
                   {"text": "790.00", "x": 0.41, "y": 0.52, "w": 0.06, "h": 0.02}]},
        {"text": "Total 1578.24", "x": 0.30, "y": 0.70, "w": 0.17, "h": 0.02,
         "words": [{"text": "Total", "x": 0.30, "y": 0.70, "w": 0.05, "h": 0.02},
                   {"text": "1578.24", "x": 0.41, "y": 0.70, "w": 0.08, "h": 0.02}]},
    ]

    def region_text(crop):
        _, (x1, y1, x2, y2) = crop
        ycen = (y1 + y2) / 2000.0
        return "1578.24" if ycen >= 0.60 else "790.00"

    # Taught 'Total' label anchor on the Net row; value box to its right (offset 0.11 right, level).
    mapping = {
        "field_key": "total_amount", "page_number": 0, "anchor_text": "Total",
        "ocr_type": "currency", "search_expansion": 0.0, "enabled": True,
        "anchor_x_norm": 0.30, "anchor_y_norm": 0.52, "anchor_w_norm": 0.14, "anchor_h_norm": 0.03,
        "target_x_norm": 0.41, "target_y_norm": 0.52, "target_w_norm": 0.08, "target_h_norm": 0.03,
        "offset_dx_norm": 0.11, "offset_dy_norm": 0.0,
    }
    fp = {"total_amount": {"validation": "currency"}}
    vp = {"currency": [r"[\d,]+\.\d{2}"]}

    def run():
        return tm.extract_with_mappings([page], [dict(mapping)], fp,
                                        ocr_lines_fn=page_lines_stub(spec),
                                        ocr_text_fn=region_text, validation_patterns=vp)

    _armed(False)
    off = run().get("total_amount", {})
    if not check(f"OFF (bug): commits the taught-box 'Net Total' value 790.00 (RED-first, got {off.get('value')!r})",
                 "790" in (off.get("value") or "")):
        failures += 1

    _armed(True)
    on = run().get("total_amount", {})
    _armed(False)
    v = on.get("value") or ""
    if not check(f"ON: the grand 'Total' 1578.24 is committed, not the Net 790.00 (got {v!r})",
                 "1578.24" in v and "790" not in v):
        failures += 1
    if not check("ON commit rides the template_mapping family (drift-relocate), not a fresh keyword read",
                 (on.get("method") or "").startswith("template_mapping")):
        failures += 1
    if not check("ON commit carries NO shapewarn / recon-adjust note (clean relocate)",
                 not on.get("validation_note") and "shapewarn" not in (on.get("method") or "")):
        failures += 1
    print()
    return failures


def main():
    print("=" * 70)
    print("TEMPLATE_LOCATE_ROLE_QUALIFIER — taught-total occurrence selection PIN")
    print("=" * 70)
    failures = 0
    failures += test_red_first_row_selection()
    failures += test_divergence_invoice_total()
    failures += test_carriers_fallback()
    failures += test_local_all_qualified_triggers_pagewide()
    failures += test_born_digital_twin()
    failures += test_vocab_identity()
    failures += test_off_byte_identical()
    failures += test_end_to_end_drift_relocate()
    print("=" * 70)
    if failures:
        print(f"FAIL: {failures} check(s) failed")
        return 1
    print("All TEMPLATE_LOCATE_ROLE_QUALIFIER pins hold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
