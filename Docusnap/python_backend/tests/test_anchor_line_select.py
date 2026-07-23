"""
test_anchor_line_select.py — pins ANCHOR_LINE_SELECT (slice 1) + ANCHOR_ROW_GRACE (slice 2, DARK).
Oracle-signed design 2026-07-23: docs/designs/ANCHOR_LINE_SELECT_2026-07-23.md.
Run: py -3.12 python_backend/tests/test_anchor_line_select.py   (Tesseract-free — stubbed reads)

WHAT THIS PINS. The crop pad is a fixed +20px half-height, so a single-row taught box structurally
crops ~1.5-2.2 text rows; clean_crop_segment's FIRST-line take then commits/rejects on the wrong
row's garbage. The chooser (select_row_line) commits the ONE line inside the taught row's band that
passes the rung's own gates — and ONLY when it is unambiguous.

Pins (per the design doc):
 (a) two in-band qualifiers → reject (NEVER nearest-wins)
 (b) out-of-band-only qualifier → reject (never commit another field's row)
 (c) prep-scale invariance (the band is rescaled PER RUNG by the prepped image's height ratio)
 (d) meta from the SELECTED line's words only (feeds _TIER_A_OCR_MIN)
 (e) grace never above top_limit_norm + edge-touching line ineligible (slice 2)
 (f) free-text/currency/None: chooser never invoked, byte-identical with the flag ON
 (g) relocate-rung selection commits the rung-NATIVE method (anchor_crop_relocated)
 (h) chooser exception ⇒ exact status-quo
 (i) stacked-dates adversarial: an out-of-band parseable date must NOT commit (RED vs naive)
 (j) delivery_number's val_type resolves in-scope ('alphanumeric' via the label-override merge)
 (k) chooser-decline best_seg/return-best bookkeeping byte-identical to OFF
 (+) a shape-valid non-date ("99/99/2026") must NOT qualify on a date field

RED-FIRST PROOF (permanent): the _naive_select build (nearest-to-band-centre wins, no
exactly-one rule, no band requirement) is executed against the SAME pin fixtures and shown to
misbehave exactly where the real chooser refuses — so pins (a)/(b)/(i) demonstrably discriminate.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from PIL import Image                                            # noqa: E402
from extraction import anchor                                    # noqa: E402
from extraction.anchor import (select_row_line, _row_band,       # noqa: E402
                               _LINE_SELECT_TYPES, _clean_one_line)

fails = 0


def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond:
        fails += 1


def setenv(name, v):
    if v is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = v


def L(text, top, height, mean=90.0, mn=90.0):
    return {"text": text, "top": top, "height": height, "mean_conf": mean, "min_conf": mn}


REF_RX = re.compile(r"^[A-Z]{2,5}-\d{5}$")
ref_ok = lambda s: bool(REF_RX.fullmatch(s or ""))
DATE_RX = re.compile(r"\d{1,2}/\d{1,2}/\d{4}")
date_shape_ok = lambda s: bool(DATE_RX.search(s or ""))

BAND = (20.0, 44.0)   # a 24px taught row inside a padded crop


def _naive_select(lines, band, val_type, qualify_fn, edge_exclude=None):
    """The NAIVE build the pins must catch: nearest-to-band-centre qualifier wins —
    no in-band requirement, no exactly-one rule. Never ship this."""
    bc = (band[0] + band[1]) / 2.0
    best = None
    for ln in sorted(lines, key=lambda l: l.get("top", 0)):
        seg = _clean_one_line(ln.get("text"), val_type)
        if not seg or not qualify_fn(seg):
            continue
        if val_type == "date":
            from extraction import validator
            if validator.parse_date(seg) is None:
                continue
        d = abs((ln["top"] + ln["height"] / 2.0) - bc)
        if best is None or d < best[0]:
            best = (d, ln, seg)
    return (best[1], best[2]) if best else None


# ── _row_band arithmetic ───────────────────────────────────────────────────────
print("_row_band:")
check("band = taught box centred on cy, relative to final crop top",
      _row_band(100, 24, 58) == (100 - 12 - 58, 100 + 12 - 58))

# ── Pin (a): two in-band qualifiers → reject, never nearest-wins ──────────────
print("\nPin (a) — ambiguity refuses:")
two_inband = [L("DN-11111", 22, 12), L("DN-22222", 32, 12)]
check("two in-band qualifiers → None", select_row_line(two_inband, BAND, "alphanumeric", ref_ok) is None)
check("RED proof: the naive build would commit one of them",
      _naive_select(two_inband, BAND, "alphanumeric", ref_ok) is not None)

# ── Pin (b): out-of-band-only qualifier → reject; in-band one still wins ──────
print("\nPin (b) — the band is load-bearing:")
out_only = [L("vO. #%# garbage", 24, 18), L("DN-50755", 60, 18)]
check("out-of-band-only qualifier → None", select_row_line(out_only, BAND, "alphanumeric", ref_ok) is None)
check("RED proof: the naive build commits the other field's row",
      (_naive_select(out_only, BAND, "alphanumeric", ref_ok) or (None, None))[1] == "DN-50755")
mixed = [L("DN-12345", 22, 20), L("XX-99999", 60, 18)]
sel = select_row_line(mixed, BAND, "alphanumeric", ref_ok)
check("one in-band + one out-of-band qualifier → the in-band one",
      sel is not None and sel[1] == "DN-12345")

# ── Pin (i): stacked-dates adversarial (true row garbled) ─────────────────────
print("\nPin (i) — stacked dates, true row garbled:")
stacked = [L("vO. DN-50755", 22, 20), L("12/06/2026", 60, 18)]
check("wrong-row date is OUT of band → None (falls through to status quo)",
      select_row_line(stacked, BAND, "date", date_shape_ok) is None)
check("RED proof: the naive build commits the wrong row's date",
      (_naive_select(stacked, BAND, "date", date_shape_ok) or (None, None))[1] == "12/06/2026")
good_date = [L("739184", 2, 14), L("12/06/2026", 22, 20)]
sel = select_row_line(good_date, BAND, "date", date_shape_ok)
check("in-band date beside a number-row line → selected", sel is not None and sel[1] == "12/06/2026")

# ── A shape-valid non-date must NOT qualify on a date field ───────────────────
check("'99/99/2026' in band, shape-valid → NOT selected (parse_date bar)",
      select_row_line([L("99/99/2026", 22, 20)], BAND, "date", lambda s: True) is None)

# ── Pin (e, part 2): edge-touching line ineligible (slice 2 disqualification) ──
print("\nPin (e) — edge disqualification (ANCHOR_ROW_GRACE):")
edge_ln = [L("DN-12345", 1, 45)]   # in-band by overlap, but touches the crop top edge
check("edge-touching in-band qualifier is ineligible under edge_exclude",
      select_row_line(edge_ln, BAND, "alphanumeric", ref_ok, edge_exclude=(2.0, 82.0)) is None)
check("same line WITHOUT edge_exclude is selected (slice-1 behaviour preserved)",
      select_row_line(edge_ln, BAND, "alphanumeric", ref_ok) is not None)
bot_ln = [L("DN-12345", 30, 54)]   # bottom edge touch at 84
check("bottom-edge-touching line ineligible too",
      select_row_line(bot_ln, BAND, "alphanumeric", ref_ok, edge_exclude=(2.0, 82.0)) is None)

# ══ Ladder-level pins (monkeypatched _read_lines_full — no Tesseract) ══════════
CROP_BAND = (20.0, 44.0)          # crop frame: 84px tall


def make_stub(rows_fn):
    """rows_fn(img, psm, call_n) → (text, mean, min, lines) with geometry in the IMG frame."""
    calls = {"n": 0}

    def stub(img, psm):
        calls["n"] += 1
        return rows_fn(img, psm, calls["n"])
    return stub, calls


def run_ladder(stub, val_type, verify, band=CROP_BAND, crop_size=(100, 84), edge=False):
    orig = anchor._read_lines_full
    anchor._read_lines_full = stub
    try:
        meta = {}
        v = anchor._ocr_crop_laddered(Image.new("L", crop_size, 255), val_type,
                                      verify_fn=verify, meta=meta,
                                      row_band=band, edge_ineligible=edge)
        return v, meta
    finally:
        anchor._read_lines_full = orig


def two_row_rows(img, psm, n):
    s = img.height / 84.0          # the stub reports geometry in the RUNG image's frame
    lines = [L("DN-12345", 22 * s, 20 * s, mean=93.0, mn=91.0),
             L("WRONG-11111", 56 * s, 20 * s, mean=60.0, mn=32.0)]
    return "WRONG-11111\nDN-12345", 60.0, 32.0, lines


print("\nPin (c) — prep-scale invariance (band rescaled per rung):")
setenv("ANCHOR_LINE_SELECT", "1")
# 100px-wide crop → _light_prep upscales ×3; a missing rescale would push every line
# out of the crop-frame band and the fall-through would return the WRONG first line.
v, meta = run_ladder(make_stub(two_row_rows)[0], "alphanumeric", lambda t: bool(ref_ok(t)))
check("×3-prepped rung still selects the in-band row", v == "DN-12345")

# Force the HEAVY ×2 rung on a ≥300px crop: the light rungs (×1) return nothing.
def heavy_only_rows(img, psm, n):
    if n <= 2:
        return "", 0.0, 0.0, []              # light 7 + light 6: empty read
    return two_row_rows(img, psm, n)
v, meta = run_ladder(make_stub(heavy_only_rows)[0], "alphanumeric",
                     lambda t: bool(ref_ok(t)), crop_size=(400, 84))
check("heavy ×2 rung still selects the in-band row", v == "DN-12345")

print("\nPin (d) — meta from the SELECTED line only:")
v, meta = run_ladder(make_stub(two_row_rows)[0], "alphanumeric", lambda t: bool(ref_ok(t)))
check("min_conf is the line's 91, not the whole-crop 32", v == "DN-12345" and meta.get("min_conf") == 91.0)
check("conf is the line's mean 93", meta.get("conf") == 93.0)

print("\nPin (f) — excluded types: chooser never invoked, byte-identical ON vs OFF:")
for vt, txt in ((None, "Denver Trading"), ("text", "Denver Trading"), ("currency", "$123.45")):
    def flat_rows(img, psm, n, _t=txt):
        s = img.height / 84.0
        return _t, 88.0, 88.0, [L(_t, 22 * s, 20 * s, mean=88.0, mn=88.0)]
    spy = {"called": 0}
    orig_sel = anchor.select_row_line
    anchor.select_row_line = lambda *a, **k: (spy.__setitem__("called", spy["called"] + 1) or None)
    try:
        setenv("ANCHOR_LINE_SELECT", "1")
        on = run_ladder(make_stub(flat_rows)[0], vt, lambda t: True)
        setenv("ANCHOR_LINE_SELECT", None)
        off = run_ladder(make_stub(flat_rows)[0], vt, lambda t: True)
    finally:
        anchor.select_row_line = orig_sel
        setenv("ANCHOR_LINE_SELECT", "1")
    check(f"val_type={vt!r}: chooser not invoked + ON == OFF",
          spy["called"] == 0 and on == off)

print("\nPin (h) — chooser exception ⇒ exact status-quo:")
orig_sel = anchor.select_row_line
anchor.select_row_line = lambda *a, **k: (_ for _ in ()).throw(ValueError("boom"))
try:
    setenv("ANCHOR_LINE_SELECT", "1")
    on = run_ladder(make_stub(two_row_rows)[0], "alphanumeric", lambda t: True)
finally:
    anchor.select_row_line = orig_sel
setenv("ANCHOR_LINE_SELECT", None)
off = run_ladder(make_stub(two_row_rows)[0], "alphanumeric", lambda t: True)
setenv("ANCHOR_LINE_SELECT", "1")
check("raising chooser → result+meta identical to OFF", on == off and on[0] == "WRONG-11111")

print("\nPin (k) — chooser-decline bookkeeping byte-identical:")
def ambiguous_rows(img, psm, n):
    s = img.height / 84.0
    return ("DN-11111\nDN-22222", 70.0, 65.0,
            [L("DN-11111", 22, 10 * s, mean=70.0, mn=65.0).copy() | {"top": 22 * s},
             L("DN-22222", 33, 10 * s, mean=70.0, mn=65.0).copy() | {"top": 33 * s}])
setenv("ANCHOR_LINE_SELECT", "1")
on = run_ladder(make_stub(ambiguous_rows)[0], "alphanumeric", lambda t: bool(ref_ok(t)))
setenv("ANCHOR_LINE_SELECT", None)
off = run_ladder(make_stub(ambiguous_rows)[0], "alphanumeric", lambda t: bool(ref_ok(t)))
setenv("ANCHOR_LINE_SELECT", "1")
check("≥2 in-band decline → gate path identical (first line wins both ways)",
      on == off and on[0] == "DN-11111")
setenv("ANCHOR_LINE_SELECT", "1")
on = run_ladder(make_stub(two_row_rows)[0], "alphanumeric", lambda t: False)
setenv("ANCHOR_LINE_SELECT", None)
off = run_ladder(make_stub(two_row_rows)[0], "alphanumeric", lambda t: False)
setenv("ANCHOR_LINE_SELECT", "1")
check("verify-rejects-all → return-best path identical (best_seg + meta)", on == off)

# ══ Pin (g): the relocate rung commits its NATIVE method ═══════════════════════
print("\nPin (g) — rung-native method on the drift-relocate rung:")
PAGE = Image.new("L", (1000, 1000), 255)


def centred_rows(img, psm, n):
    H = img.height
    return ("WRONG ROW\nDN-12345", 60.0, 40.0,
            [L("WRONG ROW", 0.02 * H, 0.08 * H, mean=40.0, mn=40.0),
             L("DN-12345", 0.45 * H, 0.10 * H, mean=92.0, mn=92.0)])


orig_loc, orig_read = anchor._locate_for_relocation, anchor._read_lines_full
anchor._locate_for_relocation = lambda *a, **k: {
    "label_box": {"x_norm": 0.10, "y_norm": 0.50, "w_norm": 0.08, "h_norm": 0.02},
    "matched_text": "delivery no", "match_score": 1.0}
anchor._read_lines_full = make_stub(centred_rows)[0]
try:
    setenv("ANCHOR_LINE_SELECT", "1")
    res = anchor.extract_with_anchors(
        "Delivery No\nDN-12345", [{
            "field_key": "delivery_number", "anchor_label": "Delivery No", "direction": "right",
            "usage_count": 3, "confidence": 0.9, "supplier_name": "Thornbury",
            "document_type": "delivery_note", "x_norm": 0, "y_norm": 0,
            "w_norm": 0.2, "h_norm": 0.03}],
        "Thornbury", "delivery_note", page_images=[PAGE],
        field_patterns={"delivery_number": {"validation": "alphanumeric"}},
        validation_patterns={"alphanumeric": [r"[A-Z]{2}-\d{5}"]})
finally:
    anchor._locate_for_relocation, anchor._read_lines_full = orig_loc, orig_read
r = res.get("delivery_number") or {}
check("chooser-selected value commits", r.get("value") == "DN-12345")
check("method is the rung's NATIVE anchor_crop_relocated (provenance preserved)",
      r.get("method") == "anchor_crop_relocated")

# ══ _crop_and_ocr geometry pins (band, grace, clamp, scope) ═══════════════════
print("\n_crop_and_ocr geometry — band/grace/clamp/scope:")
REC = {}


def rec_ladder(crop, val_type=None, verify_fn=None, meta=None, page=None, box=None,
               top_limit_norm=None, row_band=None, edge_ineligible=False):
    REC.update({"crop_h": crop.size[1], "row_band": row_band, "edge": edge_ineligible})
    return None


def run_crop(val_type="alphanumeric", verify=lambda t: True, w_norm=0.2, h_norm=0.03,
             top_limit_norm=None):
    REC.clear()
    orig = anchor._ocr_crop_laddered
    anchor._ocr_crop_laddered = rec_ladder
    try:
        anchor._crop_and_ocr(PAGE, 0.5, 0.5, w_norm, h_norm, val_type,
                             verify_fn=verify, top_limit_norm=top_limit_norm)
    finally:
        anchor._ocr_crop_laddered = orig
    return dict(REC)


# base geometry: box_h = 30px, half_h = 15+20 = 35 → y1 465, y2 535, band (20, 50)
setenv("ANCHOR_LINE_SELECT", "1"); setenv("ANCHOR_ROW_GRACE", None)
r = run_crop()
check("slice 1: band = taught box relative to final crop top",
      r["row_band"] == (20.0, 50.0) and r["crop_h"] == 70 and r["edge"] is False)
setenv("ANCHOR_ROW_GRACE", "1")
r = run_crop()
check("grace ±0.6·box_h (18px) expands both ways + edge disqualification armed",
      r["crop_h"] == 106 and r["row_band"] == (38.0, 68.0) and r["edge"] is True)
r = run_crop(top_limit_norm=0.46)
check("pin (e): grace NEVER reaches above top_limit_norm (clamp runs after grace)",
      r["crop_h"] == 93 and r["row_band"] == (25.0, 55.0))
setenv("ANCHOR_LINE_SELECT", None)
r = run_crop()
check("slice-2 stacking: ROW_GRACE alone is INERT (no grace, no band)",
      r["crop_h"] == 70 and r["row_band"] is None and r["edge"] is False)
setenv("ANCHOR_LINE_SELECT", "1")
r = run_crop(val_type="currency")
check("currency is scope-cut: no band, no grace", r["crop_h"] == 70 and r["row_band"] is None)
r = run_crop(val_type="text")
check("free-text is scope-cut: no band", r["row_band"] is None)
r = run_crop(w_norm=0.0, h_norm=0.0)
check("no-dims 200×60 fallback: no band (inert)", r["row_band"] is None)
r = run_crop(verify=None)
check("gateless caller (verify_fn None): no band", r["row_band"] is None)
setenv("ANCHOR_LINE_SELECT", None); setenv("ANCHOR_ROW_GRACE", None)
r = run_crop()
check("both OFF: crop byte-identical geometry, no band", r["crop_h"] == 70 and r["row_band"] is None)

# ══ Pin (j): delivery_number resolves in-scope via the label-override merge ═══
print("\nPin (j) — val_type resolution:")
from extraction import keyword                                    # noqa: E402
merged = keyword.merge_label_overrides(
    {"field_patterns": {}},
    [{"doc_type_slug": "delivery_note", "field_key": "delivery_number", "label": "Delivery Note No"}],
    "delivery_note")
_vt = (merged.get("field_patterns", {}).get("delivery_number") or {}).get("validation")
check("override-seeded delivery_number → validation 'alphanumeric', in chooser scope",
      _vt == "alphanumeric" and _vt in _LINE_SELECT_TYPES)

# ══ Wiring (source) pins ══════════════════════════════════════════════════════
print("\nWiring (source):")
src = open(os.path.join(os.path.dirname(__file__), "..", "extraction", "anchor.py"),
           encoding="utf-8").read()
check("ANCHOR_LINE_SELECT defaults OFF (per-call env, \"0\" default)",
      src.count('os.environ.get("ANCHOR_LINE_SELECT", "0") != "0"') >= 2)
check("ANCHOR_ROW_GRACE is chained on _ls_on (inert without LINE_SELECT)",
      '_rg_on = _ls_on and os.environ.get("ANCHOR_ROW_GRACE", "0") != "0"' in src)
check("the LADDER NOTE is pinned in the source (do not remove lower rungs)",
      "THE LADDER NOTE" in src and "reopens the City Office" in src)
_reg = src.find('method = "anchor_registration"')
_regcall = src.rfind("gval = _crop_and_ocr(", 0, _reg)
_regline = src[_regcall:src.find("\n", src.find(")", _regcall))]
check("registration rung call still passes NO top_limit/max_w (do-not-fix-in-passing)",
      _regcall > -1 and "top_limit" not in _regline and "max_w" not in _regline)
check("clean_crop_segment docstring records the chooser supersession",
      "supersedes this take per rung" in src)

print(f"\n{fails} FAILED" if fails else "\nAll ANCHOR_LINE_SELECT checks passed")
sys.exit(1 if fails else 0)
