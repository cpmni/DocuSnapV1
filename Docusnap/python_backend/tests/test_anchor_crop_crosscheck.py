#!/usr/bin/env python3
"""
tests/test_anchor_crop_crosscheck.py
------------------------------------
AUTHORITATIVE-CROP CROSS-CHECK (oscar's silent-drift guard). A taught (authoritative)
rigid anchor_crop that reads a VALID-SHAPED ref number wins OUTRIGHT at Tier-A (a
structured value is regex-validated, never conf-capped) — so when the crop OCR mangles a
digit (City Office invoice "152574" -> "192074", both valid) the WRONG value files
SILENTLY at 97%. The guard cross-reads the same label off the full page; on DISAGREEMENT
it prefers the full-page value and routes to review (recover-and-flag), never letting the
crop win silently. INVARIANT: an authoritative anchor wins silently ONLY when two
independent reads AGREE.

No Tesseract: `_crop_and_ocr` (the rigid crop) and `_locate_for_relocation` (the full-
page label harvest) are stubbed; `_filter_anchors` is bypassed to isolate the rung.
    py -3.12 python_backend/tests/test_anchor_crop_crosscheck.py
Exit 0 = fixed, 1 = regressed.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor  # noqa: E402

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


class FakePage:
    size = (1000, 1000)

    def crop(self, box):
        return ("crop", box)


# A ref validation broad enough for both the crop read and the full-page read; a date pattern
# broad enough for numeric DD/MM/YYYY in either separator.
VPS = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"],
       "date": [r"\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}"]}


def _anchor(**ov):
    a = {"field_key": "invoice_number", "anchor_label": "Invoice No.", "direction": "right",
         "usage_count": 3, "confidence": 0.8,
         "x_norm": 0.55, "y_norm": 0.30, "w_norm": 0.10, "h_norm": 0.02,
         "last_authoritative_at": 20260616183000,
         "supplier_name": "City Office NI", "document_type": "Invoice"}
    a.update(ov)
    return a


def _run(anchor_row, *, crop_reads, inline_reads, geo_reads=None, match_score=1.0,
         field_key="invoice_number", validation="alphanumeric"):
    """Drive extract_with_anchors with the rigid crop stubbed to `crop_reads` and the
    full-page label harvest stubbed to return `inline_reads` beside a located label.
    If `geo_reads` is given, the SECOND _crop_and_ocr call (the value-below-label geometric
    re-read) returns it instead — the first call stays the rigid crop — so the FLAG-ONLY
    branch sees a (dis)agreement we control. `match_score` sets the stubbed label locate score."""
    orig_crop, orig_loc, orig_filter = (anchor._crop_and_ocr,
                                        anchor._locate_for_relocation, anchor._filter_anchors)
    if geo_reads is not None:
        _calls = {"n": 0}
        def _crop_stub(*a, **k):
            _calls["n"] += 1
            return crop_reads if _calls["n"] == 1 else geo_reads
        anchor._crop_and_ocr = _crop_stub
    else:
        anchor._crop_and_ocr = lambda *a, **k: crop_reads
    anchor._locate_for_relocation = lambda *a, **k: {
        "label_box": {"x_norm": 0.40, "y_norm": 0.30, "w_norm": 0.08, "h_norm": 0.02},
        "inline_value": inline_reads,
        "match_score": match_score,
    }
    anchor._filter_anchors = lambda anchors, *a, **k: anchors
    try:
        res = anchor.extract_with_anchors(
            "stub page text", [anchor_row], "City Office NI", "Invoice",
            page_images=[FakePage()],
            field_patterns={field_key: {"validation": validation}},
            validation_patterns=VPS, format_lookup=None)
    finally:
        (anchor._crop_and_ocr, anchor._locate_for_relocation,
         anchor._filter_anchors) = orig_crop, orig_loc, orig_filter
    return res.get(field_key) or {}


# 1. DISAGREEMENT: crop mangles 152574 -> 192074; the full page reads 152574.
#    The crop must NOT win silently — take the full-page value + flag for review.
print("1. crop/full-page DISAGREE -> full-page value, routed to review")
r = _run(_anchor(), crop_reads="192074", inline_reads="152574")
check("value corrected to the full-page read", r.get("value") == "152574")
check("method is the cross-check", r.get("method") == "anchor_crop_crosscheck")
check("confidence capped <= 70 (routed to review)", (r.get("confidence") or 100) <= 70)
check("was_corrected set (surfaces in review)", bool(r.get("was_corrected")))
check("validation_note explains the disagreement", "disagreed" in (r.get("validation_note") or "").lower())

# 2. AGREEMENT: crop and full page read the SAME value -> byte-identical (crop wins clean).
print("\n2. crop/full-page AGREE -> byte-identical, crop wins clean at high confidence")
r = _run(_anchor(), crop_reads="152574", inline_reads="152574")
check("value is the crop read", r.get("value") == "152574")
check("method stays anchor_crop", r.get("method") == "anchor_crop")
check("confidence NOT capped (clean authoritative crop)", (r.get("confidence") or 0) > 70)
check("no cross-check note", not r.get("validation_note"))

# 3. NON-AUTHORITATIVE (passive) anchor: the guard is scoped to taught anchors — untouched
#    even on disagreement (a passive crop never wins Tier-A; the shape veto guards it).
print("\n3. passive (non-authoritative) anchor -> guard does not fire")
r = _run(_anchor(last_authoritative_at=None), crop_reads="192074", inline_reads="152574")
check("passive crop read is untouched", r.get("value") == "192074")
check("passive method stays anchor_crop", r.get("method") == "anchor_crop")

# 4. NO CREDIBLE full-page read (harvest empty) -> can't prove disagreement -> keep the crop.
print("\n4. no credible full-page read -> byte-identical (can't prove disagreement)")
r = _run(_anchor(), crop_reads="192074", inline_reads="")
check("crop kept when the label can't be cross-read", r.get("value") == "192074")
check("method stays anchor_crop", r.get("method") == "anchor_crop")

# 5. DATE cross-check (the cross-supplier false-locate residual): the rigid crop reads a
#    wrong-but-valid DATE at the absolute box; the label cross-read gets a DIFFERENT valid date
#    -> flip to the full-page date + flag. (Extends the guard beyond ref to date fields.)
print("\n5. DATE crop/full-page DISAGREE -> full-page date, routed to review")
_da = _anchor(field_key="invoice_date", anchor_label="Invoice Date")
r = _run(_da, crop_reads="01/06/2026", inline_reads="29/05/2026",
         field_key="invoice_date", validation="date")
check("method is the cross-check (crop did not win silently)", r.get("method") == "anchor_crop_crosscheck")
check("value flipped to the full-page date (29/05)", "29" in (r.get("value") or "") and "05" in (r.get("value") or ""))
check("routed to review (confidence capped)", (r.get("confidence") or 100) <= 70)

# 6. DATE same calendar date, DIFFERENT separator -> NOT a disagreement (calendar-aware compare)
#    -> crop kept, byte-identical. This is the guard that a mere format difference can't false-flip.
print("\n6. DATE same date, different format -> byte-identical (calendar-aware compare)")
r = _run(_anchor(field_key="invoice_date", anchor_label="Invoice Date"),
         crop_reads="29/05/2026", inline_reads="29-05-2026",
         field_key="invoice_date", validation="date")
check("crop kept (format-only difference is not a disagreement)", r.get("method") == "anchor_crop")

# ── FLAG-ONLY value-below-label detector (007's variant for the false-locate residual) ──
# Value sits BELOW its caption (inline harvest empty), so the geometric re-read (label + offset)
# is the second independent read. On disagreement we KEEP the rigid value and only flag it — never
# flip, because a wrong ref/date becomes a filename + learning key and the re-OCR is unverifiable.
_bl = dict(field_key="invoice_date", anchor_label="Invoice Date", supplier_name="Anconia Corp",
           offset_dx_norm=0.0, offset_dy_norm=0.05)

# 7. CROSS-SUPPLIER, label located high-score, geometric read DISAGREES -> keep value + flag.
print("\n7. value-below-label cross-supplier DISAGREE -> keep rigid value, flag for review")
r = _run(_anchor(**_bl), crop_reads="01/06/2026", inline_reads="", geo_reads="29/05/2026",
         field_key="invoice_date", validation="date")
check("rigid value KEPT (not replaced by the geometric read)", "29" not in (r.get("value") or ""))
check("method stays anchor_crop (flag-only, not a flip)", r.get("method") == "anchor_crop")
check("confidence capped for review", (r.get("confidence") or 100) <= 70)
check("review note set", "verify" in (r.get("validation_note") or "").lower())

# 8. SAME-supplier -> scoped out (a same-supplier re-read can mis-seat; don't cry wolf).
print("\n8. value-below-label SAME-supplier -> not flagged (scoped to cross-supplier)")
_bs = dict(_bl); _bs["supplier_name"] = "City Office NI"
r = _run(_anchor(**_bs), crop_reads="01/06/2026", inline_reads="", geo_reads="29/05/2026",
         field_key="invoice_date", validation="date")
check("same-supplier not flagged", not r.get("validation_note"))

# 9. LOW label match_score -> suppressed (a mis-located label must not manufacture a spurious flag).
print("\n9. value-below-label low label match (0.7) -> suppressed (no spurious flag)")
r = _run(_anchor(**_bl), crop_reads="01/06/2026", inline_reads="", geo_reads="29/05/2026",
         match_score=0.7, field_key="invoice_date", validation="date")
check("low-match not flagged", not r.get("validation_note"))

# 10. AGREEMENT (geometric == rigid) -> byte-identical, no flag, clean confidence.
print("\n10. value-below-label AGREE -> byte-identical (no flag)")
r = _run(_anchor(**_bl), crop_reads="29/05/2026", inline_reads="", geo_reads="29/05/2026",
         field_key="invoice_date", validation="date")
check("agreement -> no flag", not r.get("validation_note"))
check("agreement -> value kept at clean confidence", (r.get("confidence") or 0) > 70)

# 11. _reads_disagree helper (shared by both cross-check branches): calendar-aware for dates.
print("\n11. _reads_disagree: calendar-aware for dates, string compare otherwise")
check("same date, different separator -> agree", anchor._reads_disagree("29/05/2026", "29-05-2026", "date") is False)
check("different dates -> disagree", anchor._reads_disagree("29/05/2026", "01/06/2026", "date") is True)
check("unparseable date -> never disagree", anchor._reads_disagree("garbage", "29/05/2026", "date") is False)
check("ref string differs -> disagree", anchor._reads_disagree("152574", "192074", "alphanumeric") is True)
check("empty read -> no disagreement", anchor._reads_disagree("", "152574", "alphanumeric") is False)

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
