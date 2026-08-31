"""
test_label_capture.py — the LABEL-AS-VALUE class (007 instrumented replay → gary design → Oracle
ruling, built 2026-07-21). A correctly-taught 'below' anchor committed an OCR garble OF ITS OWN
LABEL ("Vetiver 10" / "Veliver to" ≈ "Deliver To") as the customer name on 12 of 20 live delivery
dockets, 7 of them UNFLAGGED — and on a graduated supplier that class files SILENTLY.

Four stacked slices are pinned here, each RED with its kill switch OFF and GREEN with it ON, so a
future dev cannot quietly restore any of them:

  A  ladder clamp          RELOCATE_CAPTION_EXCLUDE   the (P) caption clamp was applied to the crop
                                                      but NOT to the OCR ladder's preview fast path,
                                                      which re-cropped the PAGE with its own headroom
                                                      and restored the caption band. THE ROOT CAUSE.
  C  caption-band reject   CAPTION_BAND_REJECT        content (a fuzzy caption garble) AND geometry
                                                      (the read window still overlaps the located
                                                      caption) — neither signal separates alone.
  D  hold admits override  NAME_HOLD_ADMIT_OVERRIDE   the merge hold was dead whenever the clean
                                                      incumbent came from a label OVERRIDE.
  B  inline provenance     LABELLOCK_INLINE_PROVENANCE a NameError on the inline branch, swallowed by
                                                      a bare except AFTER the value had committed,
                                                      made the whole commit tail dead code.

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_label_capture.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from PIL import Image, ImageDraw, ImageFont
import pytesseract

TESSERACT = os.environ.get("TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe")

from extraction import anchor as A
from extraction.anchor import (_noise_smooth_retry, _read_window_top_norm, _is_caption_band_read,
                               _caption_top_limit, _eval_field_group)
from extraction.engine import _name_relocate_should_hold

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1

def setenv(key, val):
    if val is None: os.environ.pop(key, None)
    else: os.environ[key] = val


# ── synthetic page: a caption with the value printed just below it ────────────
W, H = 1700, 2200
CAP_Y, CAP_H = 400, 44          # "Deliver To"
VAL_Y = 470                     # "Denver Trading" — a REAL customer name that fuzzy-matches the caption
BOX_H = 160                     # the taught value box (a multi-line address block: generous height)

def _font(size):
    for name in ("arial.ttf", "DejaVuSans.ttf", "calibri.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()

def _page():
    img = Image.new("L", (W, H), 248)
    d = ImageDraw.Draw(img)
    f = _font(44)
    d.text((300, CAP_Y), "Deliver To", fill=20, font=f)
    d.text((300, VAL_Y), "Denver Trading", fill=20, font=f)
    d.text((300, 900), "Some other body text on the page", fill=20, font=_font(30))
    return img

VAL_BOX = {"x_norm": 290 / W, "y_norm": VAL_Y / H, "w_norm": 700 / W, "h_norm": BOX_H / H}
CLAMP   = (CAP_Y + CAP_H + 4) / H          # what _caption_top_limit produces for this layout
CAP_BOX = {"x_norm": 300 / W, "y_norm": CAP_Y / H, "w_norm": 260 / W, "h_norm": CAP_H / H}
# the relocated value box in _crop_and_ocr's CENTRE convention
RELO    = (640 / W, (VAL_Y + BOX_H / 2) / H, 700 / W, BOX_H / H)


def slice_A_ladder_clamp():
    print("\n── A: the ladder clamp (RELOCATE_CAPTION_EXCLUDE) ──")
    pytesseract.pytesseract.tesseract_cmd = TESSERACT
    if not os.path.exists(TESSERACT):
        print("SKIP (no tesseract at %s)" % TESSERACT); return
    p = _page()
    # the CLAMPED crop the caller hands the ladder — contains the value only
    crop = p.crop((290, int(CLAMP * H), 990, VAL_Y + BOX_H + 40))

    un = _noise_smooth_retry(crop, "text", -1.0, page=p, box=VAL_BOX)
    cl = _noise_smooth_retry(crop, "text", -1.0, page=p, box=VAL_BOX, top_limit_norm=CLAMP)
    # RED-FIRST: without the clamp the fast path re-crops the PAGE with its own headroom, restores
    # the caption band, and clean_crop_segment (first line wins) returns the CAPTION as the value.
    check("RED-FIRST: unclamped fast path returns the CAPTION, not the value (the root cause)",
          un is not None and "deliver" in un[0].lower())
    check("FIXED: the clamp is honoured — the fast path returns the VALUE",
          cl is not None and "denver" in cl[0].lower() and "deliver" not in cl[0].lower())

    # the caller only ever produces a clamp when the caption is CLEANLY above the value
    tl = _caption_top_limit(CAP_BOX, "below", RELO)
    check("_caption_top_limit clamps this layout (caption cleanly above the value)",
          tl is not None and abs(tl - ((CAP_Y + CAP_H) / H + 0.002)) < 1e-6)

    # DEGENERATE clamp: fall back to the CLAMPED crop we were handed, never to an unclamped read
    deg = _noise_smooth_retry(crop, "text", -1.0, page=p, box=VAL_BOX, top_limit_norm=0.999)
    check("degenerate clamp → falls back to the handed-in (already clamped) crop, never the caption",
          deg is None or "deliver" not in (deg[0] or "").lower())

    setenv("RELOCATE_CAPTION_EXCLUDE", "0")
    check("kill switch RELOCATE_CAPTION_EXCLUDE=0 → no clamp is produced (byte-identical)",
          _caption_top_limit(CAP_BOX, "below", RELO) is None)
    setenv("RELOCATE_CAPTION_EXCLUDE", None)


def slice_C_caption_band_reject():
    print("\n── C: the composed caption-band reject (CAPTION_BAND_REJECT) ──")
    setenv("CAPTION_BAND_REJECT", None)
    LBL, FK, PS = "Deliver To", "customer_name", (W, H)

    # geometry: the worst-case window vs the clamp
    top_open   = _read_window_top_norm(RELO, "text", H, None)
    top_closed = _read_window_top_norm(RELO, "text", H, CLAMP)
    cap_bottom = CAP_BOX["y_norm"] + CAP_BOX["h_norm"]
    check("geometry: the UNCLAMPED worst-case window reaches into the caption band",
          top_open < cap_bottom)
    check("geometry: the CLAMPED window does not", top_closed >= cap_bottom)

    # THE DISCRIMINATOR (Oracle): content and geometry each fail ALONE, only the pair separates.
    check("garble 'Vetiver 10' + window overlapping the caption → REJECT",
          _is_caption_band_read("Vetiver 10", LBL, FK, CAP_BOX, RELO, "text", PS, None) is True)
    check("garble 'Veliver to' + overlapping window → REJECT",
          _is_caption_band_read("Veliver to", LBL, FK, CAP_BOX, RELO, "text", PS, None) is True)
    check("PIN (the whole point of the geometry arm): real 'Denver Trading' read from a CLAMPED, "
          "caption-disjoint window is KEPT — even though it fuzzy-matches 'deliver'",
          _is_caption_band_read("Denver Trading", LBL, FK, CAP_BOX, RELO, "text", PS, CLAMP) is False)
    check("PIN: 'Delivery Solutions Ltd' from a disjoint window is KEPT",
          _is_caption_band_read("Delivery Solutions Ltd", LBL, FK, CAP_BOX, RELO, "text", PS, CLAMP) is False)
    check("PIN (the whole point of the content arm): an unrelated name in an OVERLAPPING window is "
          "KEPT — overlap alone never rejects",
          _is_caption_band_read("Halcyon Leisure Group", LBL, FK, CAP_BOX, RELO, "text", PS, None) is False)
    check("ACCEPTED+PINNED COST: an echo-named customer printed ABUTTING its caption (no clamp "
          "possible) loses this rung → rigid/keyword/review",
          _is_caption_band_read("Denver Trading", LBL, FK, CAP_BOX, RELO, "text", PS, None) is True)

    # scope
    check("supplier_name is EXCLUDED (its own identity defences apply)",
          _is_caption_band_read("Vetiver 10", LBL, "supplier_name", CAP_BOX, RELO, "text", PS, None) is False)
    check("a non-name field is EXCLUDED",
          _is_caption_band_read("Vetiver 10", LBL, "invoice_number", CAP_BOX, RELO, "text", PS, None) is False)
    check("a structured val_type is EXCLUDED (a caption is never a currency)",
          _is_caption_band_read("Vetiver 10", LBL, FK, CAP_BOX, RELO, "currency", PS, None) is False)
    check("no located caption box → no geometry → never reject (fail-safe)",
          _is_caption_band_read("Vetiver 10", LBL, FK, None, RELO, "text", PS, None) is False)
    check("a value ABOVE the caption is not a caption capture",
          _is_caption_band_read("Vetiver 10", LBL, FK, CAP_BOX, (0.4, 0.05, 0.3, 0.02), "text", PS, None) is False)

    # DOCUMENTATION PIN: why the existing flag family could not catch this class. The measured
    # scores ARE the ceiling — 'Veliver to' is indistinguishable from a real company name, so no
    # name_quality threshold can separate them and geometry is the only remaining discriminator.
    from extraction.value_quality import name_quality
    check("DOC PIN: name_quality('Veliver to') == name_quality('Denver Trading') == 1.0 — the nq<0.6 "
          "gate that protects the flag family is STRUCTURALLY BLIND to this class",
          name_quality("Veliver to") == 1.0 and name_quality("Denver Trading") == 1.0)
    check("DOC PIN: only the DIGIT-bearing variant ('Vetiver 10') dips below the 0.6 gate — which is "
          "why the live corpus was caught 5/12 of the time and missed the rest",
          name_quality("Vetiver 10") < 0.6)

    setenv("CAPTION_BAND_REJECT", "0")
    check("kill switch CAPTION_BAND_REJECT=0 → never rejects (byte-identical)",
          _is_caption_band_read("Vetiver 10", LBL, FK, CAP_BOX, RELO, "text", PS, None) is False)
    setenv("CAPTION_BAND_REJECT", None)


def slice_D_hold_admits_override():
    print("\n── D: the merge hold admits a keyword_override incumbent (NAME_HOLD_ADMIT_OVERRIDE) ──")
    setenv("NAME_HOLD_ADMIT_OVERRIDE", None)
    OVERRIDE = {"method": "keyword_override", "value": "Halcyon Leisure Group"}
    KEYWORD  = {"method": "keyword",          "value": "Halcyon Leisure Group"}
    # a caption capture the anchor FLAGGED (the only handle on the nq==1.0 variants)
    GARBLE   = {"method": "anchor_crop_relocated", "value": "Veliver to", "caption_bleed": True}
    # the digit-bearing variant, which the absolute junk floor catches unaided
    GARBLE_NQ = {"method": "anchor_crop_relocated", "value": "Vetiver 10"}
    CLEAN_RETEACH = {"method": "anchor_crop_relocated", "value": "Meadowvale Farm Supplies"}

    check("hold: flagged caption capture vs a plain keyword incumbent → True (unchanged)",
          _name_relocate_should_hold(KEYWORD, GARBLE, "customer_name") is True)
    check("FIXED: flagged caption capture vs a keyword_OVERRIDE incumbent → True (the guard was dead "
          "on every install carrying a label override for the field)",
          _name_relocate_should_hold(OVERRIDE, GARBLE, "customer_name") is True)
    check("FIXED: the junk-floor arm also reaches an override incumbent ('Vetiver 10', nq 0.5)",
          _name_relocate_should_hold(OVERRIDE, GARBLE_NQ, "customer_name") is True)
    check("DOC PIN: an UNFLAGGED nq-1.0 caption garble is NOT held by this guard at all — the anchor "
          "layer (slices A+C) is what has to stop it; the hold is only the residual net",
          _name_relocate_should_hold(KEYWORD, {"method": "anchor_crop_relocated",
                                               "value": "Veliver to"}, "customer_name") is False)
    check("PIN: a CLEAN re-teach still WINS against an override incumbent (no hold) — the teach must "
          "not be neutered by admitting overrides",
          _name_relocate_should_hold(OVERRIDE, CLEAN_RETEACH, "customer_name") is False)
    check("PIN: an override incumbent that AGREES with the relocate → no hold",
          _name_relocate_should_hold(OVERRIDE, {"method": "anchor_crop_relocated",
                                                "value": "Halcyon Leisure Group"}, "customer_name") is False)
    check("supplier_name still excluded",
          _name_relocate_should_hold(OVERRIDE, GARBLE, "supplier_name") is False)

    setenv("NAME_HOLD_ADMIT_OVERRIDE", "0")
    check("RED-FIRST / kill switch NAME_HOLD_ADMIT_OVERRIDE=0 → the override incumbent is NOT "
          "admitted (the pre-fix behaviour)",
          _name_relocate_should_hold(OVERRIDE, GARBLE, "customer_name") is False)
    check("kill switch does not touch the plain keyword incumbent",
          _name_relocate_should_hold(KEYWORD, GARBLE, "customer_name") is True)
    setenv("NAME_HOLD_ADMIT_OVERRIDE", None)


# ── B: the swallowed NameError made the whole commit tail dead for inline reads ──
INLINE_BOX = {"x_norm": 0.40, "y_norm": 0.2136, "w_norm": 0.30, "h_norm": 0.02}

def _drive_inline_labellock():
    """Run the real _eval_field_group down the label-lock INLINE-HARVEST branch and return the
    committed result. Stubs only the two page-reading helpers; every gate in between is real."""
    saved = (A._crop_and_ocr, A._locate_for_relocation, A._located_at_taught_position)
    try:
        # the rigid crop reads a DIFFERENT (drifted) name, so the label-lock rung engages
        A._crop_and_ocr = lambda *a, **k: "Willowbrook Nurseries"
        A._locate_for_relocation = lambda *a, **k: {
            "label_box": CAP_BOX, "match_score": 1.0,
            "inline_value": "Halcyon Leisure Group", "inline_box": INLINE_BOX}
        A._located_at_taught_position = lambda *a, **k: True
        anchors = [{"field_key": "customer_name", "anchor_label": "Deliver To", "direction": "below",
                    "x_norm": 0.4, "y_norm": 0.2278, "w_norm": 0.20, "h_norm": 0.0133,
                    "offset_dx_norm": 0.09, "offset_dy_norm": 0.025,
                    "usage_count": 2, "confidence": 1.0,
                    "last_authoritative_at": "2026-07-20 21:15:15",
                    "supplier_name": "Ridgeway Plant Hire", "document_type": "delivery_note"}]
        res = _eval_field_group(
            anchors,
            {"customer_name": {"validation": "text"}},   # field_patterns
            lambda k: None,                              # format_lookup
            set(),                                       # identity_labels
            {}, [], None,                                # line_cache, lines, multiline_lookup
            None,                                        # on_reject
            Image.new("L", (W, H), 250),                 # page0
            [], None, None,                              # page_text_lines, page_transform, slice_capture
            "Ridgeway Plant Hire", ["customer_name"], {})
        return res.get("customer_name")
    finally:
        A._crop_and_ocr, A._locate_for_relocation, A._located_at_taught_position = saved


def slice_B_inline_provenance():
    print("\n── B: the swallowed NameError on the inline branch (LABELLOCK_INLINE_PROVENANCE) ──")
    setenv("LABELLOCK_INLINE_PROVENANCE", None)
    r = _drive_inline_labellock()
    check("the inline harvest commits its value (sanity: the branch under test really ran)",
          r is not None and r.get("value") == "Halcyon Leisure Group"
          and r.get("method") == "anchor_crop_relocated")
    check("FIXED: the commit tail now RUNS on the inline branch — the provenance box is the INLINE "
          "box (top-left, not re-centred)",
          r is not None and r.get("box") is not None
          and abs(r["box"]["y_norm"] - INLINE_BOX["y_norm"]) < 1e-9)
    check("FIXED: an inline read carries NO crop confidence (it did not crop) — it must not inherit "
          "the rigid crop's numbers",
          r is not None and r.get("ocr_min_conf") is None)

    setenv("LABELLOCK_INLINE_PROVENANCE", "0")
    r0 = _drive_inline_labellock()
    check("RED-FIRST / kill switch =0 → the tail stays truncated: no provenance box (the pre-fix "
          "behaviour the swallowed NameError produced)",
          r0 is not None and r0.get("box") is None)
    check("kill switch =0 → the value still commits (the NameError landed AFTER the commit)",
          r0 is not None and r0.get("value") == "Halcyon Leisure Group")
    setenv("LABELLOCK_INLINE_PROVENANCE", None)


def main():
    slice_A_ladder_clamp()
    slice_C_caption_band_reject()
    slice_D_hold_admits_override()
    slice_B_inline_provenance()
    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
