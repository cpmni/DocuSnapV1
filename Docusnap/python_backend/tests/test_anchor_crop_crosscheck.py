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


def _run(anchor_row, *, crop_reads, inline_reads, field_key="invoice_number", validation="alphanumeric"):
    """Drive extract_with_anchors with the rigid crop stubbed to `crop_reads` and the
    full-page label harvest stubbed to return `inline_reads` beside a located label."""
    orig_crop, orig_loc, orig_filter = (anchor._crop_and_ocr,
                                        anchor._locate_for_relocation, anchor._filter_anchors)
    anchor._crop_and_ocr = lambda *a, **k: crop_reads
    anchor._locate_for_relocation = lambda *a, **k: {
        "label_box": {"x_norm": 0.40, "y_norm": 0.30, "w_norm": 0.08, "h_norm": 0.02},
        "inline_value": inline_reads,
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

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
