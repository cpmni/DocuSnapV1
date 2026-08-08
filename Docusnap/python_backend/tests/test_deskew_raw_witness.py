#!/usr/bin/env python3
"""
test_deskew_raw_witness.py -- the deskew RAW-frame witness (anchor.raw_crop_recheck), issue-3,
Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-24.

Pins the two-read-consensus recover-and-flag: heal a deskew-corrupted taught crop ONLY when the raw
crop AND the raw page text agree on a value that DISAGREES with the committed one; otherwise leave it
untouched. FAIL-TOWARD-REVIEW: never a silent wrong value; never a silent DROP of a correct value (a
lone raw dissenter the page can't corroborate is left alone -- the benign column-only crop class).

Tesseract-free: the raw-crop OCR + credibility are stubbed so the DECIDER logic is driven directly.
Run: cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_deskew_raw_witness.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import anchor

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond:
        fails += 1

_ORIG = (anchor._crop_and_ocr, anchor._crop_is_credible)

def recheck(committed, witness, raw_read, val_type="alphanumeric",
            box=(0.5, 0.2, 0.1, 0.02), page=object(),
            credible=lambda v, *a, **k: bool(v and str(v).strip())):
    """Drive raw_crop_recheck with a stubbed raw crop read + credibility (format_lookup=None ->
    _qualify_against_format is a no-op)."""
    anchor._crop_and_ocr = lambda *a, **k: raw_read
    anchor._crop_is_credible = credible
    try:
        return anchor.raw_crop_recheck(committed, box, page, witness, val_type, "po_number",
                                       "Order No.", None, set(), {})
    finally:
        anchor._crop_and_ocr, anchor._crop_is_credible = _ORIG

WIT = "PURCHASE ORDER  Order No. PO-98370  Order Date 12/09/2026"

def main():
    # (a) committed ABSENT from the page + raw crop credibly-DIFFERS + page-CORROBORATED -> flip+flag
    r = recheck("PO-98270", WIT, "PO-98370")
    check("(a) deskew-corrupted PO flips to the raw+page value, flagged",
          r is not None and r[0] == "PO-98370" and "please verify" in r[1])

    # (b) committed value is ON the page -> untouched (cheap pre-filter skips the re-crop entirely)
    check("(b) committed value ON the page -> untouched (byte-identical)",
          recheck("PO-98370", WIT, "SHOULD-NOT-BE-USED") is None)

    # (c) raw crop AGREES with the committed value -> no flip
    check("(c) raw crop agrees with committed -> no flip",
          recheck("PO-99999", WIT, "PO-99999") is None)

    # (d) raw crop a LONE dissenter (its value not on the page) -> no flip (guard vs a wrong raw read)
    check("(d) lone raw dissenter, not page-corroborated -> no flip",
          recheck("PO-98270", WIT, "PO-11111") is None)

    # (e) EXACT membership / disagreement (NO Hamming fold): 98270 vs 98370 differ by one digit
    check("(e1) _reads_disagree EXACT: PO-98370 != PO-98270",
          anchor._reads_disagree("PO-98370", "PO-98270", "alphanumeric") is True)
    check("(e2) _ref_witnessed EXACT: PO-98270 NOT witnessed by a page carrying PO-98370",
          anchor._ref_witnessed("PO-98270", WIT) is False)
    check("(e3) _ref_witnessed: PO-98370 IS witnessed",
          anchor._ref_witnessed("PO-98370", WIT) is True)

    # (f) CROP-FAMILY coverage (Oracle C2): relocated + registration covered, not just recovered/slipfix
    for m in ("anchor_crop", "anchor_crop_relocated", "anchor_crop_recovered",
              "anchor_crop_slipfix", "anchor_registration"):
        check(f"(f) crop family covers {m}", m in anchor._CROP_FAMILY_METHODS)
    check("(f2) a NON-crop method (anchor_inline) is NOT in the family",
          "anchor_inline" not in anchor._CROP_FAMILY_METHODS)

    # (h) raw_page0 None -> stage inert (matches the engine gate)
    check("(h) raw_page0 None -> None (inert off the deskew path)",
          recheck("PO-98270", WIT, "PO-98370", page=None) is None)

    # (i) DATE via CALENDAR compare, never verbatim text: a format-only diff must NOT flip
    check("(i) date format-only diff (12/09/2026 vs 12-09-2026) -> no flip",
          recheck("12-09-2026", "Order Date 12/09/2026", "12/09/2026", val_type="date") is None)
    r = recheck("13-09-2026", "Order Date 12/09/2026", "12/09/2026", val_type="date")
    check("(i2) date GENUINE calendar diff + page-corroborated -> flip",
          r is not None and r[0] == "12/09/2026")

    # (k) raw crop NOT credible -> no flip (fail-safe keep, never a silent swap to garbage)
    check("(k) raw crop not credible -> no flip",
          recheck("PO-98270", WIT, "garbage!!", credible=lambda v, *a, **k: False) is None)

    # (j) DOCUMENTED RESIDUAL (Oracle Seam C): a Stage-2.5d snap-INDUCED corruption on a constant-ish
    #     ref (the DN-22222 poisoned-dominant class) is OUT of scope of this anchor-frame witness --
    #     it runs pre-2.5d and is owned by 2.5d's own guard / Learning Repair. Pinned so a future dev
    #     doesn't assume post-snap coverage.
    check("(j) documented residual acknowledged (snap-induced corruption = out of scope)", True)

    print("\n" + ("ALL PASS" if fails == 0 else f"{fails} FAILED"))
    sys.exit(1 if fails else 0)

main()
