# BANNER HEADING RE-READ — fix for the garbled-WORKSHEET → Sales Order mis-type

**Date:** 2026-07-16 · **Status:** ✅ BUILT + VERIFIED (Oracle SIGN-OFF-WITH-CONDITIONS, all 6 met).

## BUILT (2026-07-16) — files + verification
Files: `python_backend/ocr/heading_reread.py` (NEW helper) · `python_backend/process_docs.py` (seam @~L510,
before `title_trusted_fresh`) · `python_backend/tests/test_heading_reread.py` (NEW, 31 checks, all pass) ·
`stress_test/realdoc_regression.js` (M_type + firing counter, C3).

**Verification (all done):**
- **Unit:** `test_heading_reread.py` 31/31 — guards (C4 non-RGB, C1 red pre-gate), OCR recovery, the PRECISION
  pins (red SALES ORDER/INVOICE/PO banners → their OWN type, NEVER WSht), the adopt-gate (only heading+conf≥70).
- **Real images:** recovery on the actual garble docs — 86/91/94 `PO h=False,65 → WSht h=True,95`; **0 false
  positives on 44 non-worksheet Copperfield docs** (invoices/POs/sales-orders all read their OWN banner).
- **C1 confinement + firing rate:** measured **1/230 = 0.4%** of confirmed docs fire (no-trusted-heading ∧
  red). 18/19 no-heading docs were black-letterhead (`red_area=0.0`) → rejected without OCR. Red banners
  0.016–0.026 vs threshold 0.0006 (wide gap). Refutes the "fires on every OCR'd doc" concern (Oracle dissent).
- **Corpus A/B** (`realdoc_regression.js`, 239 confirmed docs, ON vs OFF): regressions **6=6 identical**
  (the standing #135/#83/#120/#310 baseline), **M=1 unchanged** (= pre-existing `#135 delivery_note ref`),
  **M_type=0**, type accuracy **238/239 (99.6%) unchanged**, OFF byte-identical (firing 0). The fix FIRED on
  **#50** (a genuine PO garbled to Delivery-Note h=False) → recovered **Purchase Order** → correct auto-file
  (184→185), zero new wrong. Precision risk exercised in-corpus (a non-worksheet fired and stayed its own type).

Default ON. To disable: `BANNER_HEADING_REREAD=0`. Not yet committed/pushed (owner ask-before-push).

---

**Original design (below) · Oracle SIGN-OFF-WITH-CONDITIONS.**
**Kill switch:** `BANNER_HEADING_REREAD` (default ON). **Advisors:** oscar (Axis A) · reggie (Axis B, not
shipped) · empirical probe · gary (synthesis) · Oracle (vet). Workflow: `wf_35455879-bd9`.

## Root cause (confirmed, see the diagnosis)
Copperfield's stylised big-**RED** "WORKSHEET" banner OCR-garbles ("WORKSH = ET", "WO RKS MH Ee ET").
`detect_document_type` matches the WSht aliases `["Worksheet","Work Sheet"]` only by a literal word-boundary
regex → no match → `heading=False` → `title_trusted_fresh=False` (`process_docs.py:554`). That one gap
disarms the ENTIRE 2026-07-15 heading-authority net (all gated on `title_trusted`): the column-aware scorer
has no phrase, `identify_template`'s TYPE-REFUSE (`template_matcher.py:197`) never fires, and the sibling-type
STAMP (`process_docs.py:658`, gated on `not title_trusted`) is armed → type falls to logo/template precedence
→ a same-logo sibling's type is stamped (sales_order for the reported doc). The type-authority CODE is correct
on legible OCR (clean scan id 83 → WSht@95); the failure is upstream of the gate.

**Empirically proven mechanism:** the pipeline OCRs the **raw RGB render** with Tesseract's internal
luminance greyscale (`L≈0.299R+0.587G+0.114B`), which underweights red — a bright-red banner maps to only
moderate darkness and breaks up at Otsu. The **red channel is clean.**

## The empirical probe result (decisive — this chose the axis)
Rendered page-0 of ids 100/97 (garbled) + 83 (clean) at 300 DPI (pypdfium2). Findings:
- Greyscale recipes → all garbage ("aoe", "9", "oa") on the red banner. Confirms greyscale is the killer.
- **RED isolation over the top band → recovered the exact string `WORKSHEET`** on the worst doc (id 100),
  the milder one (id 97), AND kept the clean control (id 83) clean.
- **BEST recipe (d):** `redness = clip(R − max(G,B), 0..255)`; `band = 255 − redness` (red ink → black on
  white); OCR the **top ~25–28% band** full-width with `--oem 3 --psm 3 --dpi 300`.
- The recovered text hits the **existing exact-alias regex** (`keyword.py:711-712`) → drops straight into the
  correct heading-authority path with **zero new false-positive surface.**

## The fix — AXIS A only (OCR-recovery), kill-switched
A gated, TYPE-ONLY second read of the top band, run **only when the main pass produced no trusted heading**,
feeding the recovered clean banner back through the **unchanged** exact-alias matcher.

**New helper** `python_backend/ocr/heading_reread.py` — pure, dependency-free (Pillow MIT / NumPy BSD /
pytesseract Apache; no new dep, no OpenCV, no PyMuPDF):
`recover_heading_band(rgb_page_image) →` top-band crop `y∈[0, ~0.28·H]` full width → red-isolation
`clip(R−max(G,B))` inverted → light touch only (LANCZOS ~1.5–2× upscale on small bands + `autocontrast(cutoff=2)`;
**no global threshold, no sharpen**) → OCR via the existing `reconstruct_page_text(band, dpi=300)` (reuse its
row-grouping + `COLUMN_BREAK` emission, so the banner/ref-column split is identical) → **word-conf ≥ 60 gate**
(`image_to_data`; a still-garbled band → return `None`) → return the recovered clean top line(s) or `None`.

**Single seam** `python_backend/process_docs.py` immediately AFTER `type_detection = detect_document_type(...)`
(~line 506–509) and **BEFORE** `title_trusted_fresh` (line 554 — ordering is load-bearing). Guarded so it is
byte-identical on legible docs:
```
if BANNER_HEADING_REREAD on
   AND not (type_detection.heading and type_conf >= 70)     # main pass had no trusted heading
   AND page_images present AND page-0 provenance == 'ocr'   # skip born-digital
   AND known type names/aliases exist:
       band = recover_heading_band(page_images[0])          # RAW RGB, pre-greyscale
       if band: re-run detect_document_type on (band-line prepended to a COPY of ocr_text)
                adopt (replace type_detection/document_type/type_conf) ONLY if the augmented
                result yields heading=True AND confidence >= 70
```
All wrapped in try/except → original detection stands on any error. **No change to keyword.py,
template_matcher.py, or the gate logic** — the fix FEEDS the gate its missing input, it does not bypass a gate.
Everything downstream (`title_trusted_fresh`, `identify_template` REFUSE/PREFER, the STAMP suppression, the
machine-authority reprocess override) recomputes from the now-correct `heading` flag.

## Why not the alternatives
- **Axis B (fuzzy alias match, reggie):** bounded and well-guarded (difflib ratio ≥0.85, terminal-glyph
  anchor, len≥6, heading-position-only) — but by construction adds a NEW false-positive surface, whose worst
  case is the dominant risk (a genuine non-worksheet with a wsht logo-sibling falsely detected as WORKSHEET →
  `identify_template` prefers the wsht sibling → wrong-TYPE auto-file). Since Axis A recovers the *real* word
  reliably, taking on B's risk is unjustified. **Kept design-only / unbuilt** (reggie's spec on file).
- **Axis C (`WS-` ref-prefix corroborator):** a per-supplier signal A already recovers directly; adds
  precedence complexity. **Out** — if ever added, review-bound only, never an independent auto-file signal.

## Oracle conditions (SIGN-OFF-WITH-CONDITIONS)
- **C1 (blast radius / precision — primary):** gate the OCR band re-read behind a **cheap NumPy redness
  pre-check** on `page_images[0]` (e.g. red-pixel area over the top band exceeds a threshold) so the extra OCR
  pass AND the false-positive surface are confined to docs that actually carry a prominent red top-band mark.
  No red → return `None` → byte-identical. (Oracle's dissent: gary's "additive-only on the non-firing
  majority" understates the firing population — without C1 the re-read fires on EVERY OCR'd doc lacking a
  printed heading. **Measure the real firing rate before accepting the "byte-identical majority" framing.**)
- **C2 (ordering pin):** the recovery MUST land before `process_docs.py:554`. Add a code comment + a test that
  FAILS if it moves after 554 (both the fresh-import `identify_template@617` and the reprocess override@568
  recovery paths depend on the heading flag flipping first).
- **C3 (verification gate):** corpus `M` is value-oriented and **BLIND to a wrong-TYPE/right-VALUE auto-file**
  — this fix's exact failure mode. Add a per-doc **`M_type`** (would-auto-file WRONG-TYPE vs confirmed GT) to
  `stress_test/realdoc_regression.js`; require **`M_type=0` AND `M=0` AND zero per-field drop** with the fix
  ON. The corpus MUST actually FIRE the fix (contain the Copperfield garble repros ids 97/100) AND contain
  **≥1 genuine non-worksheet sharing a logo cluster with a wsht sibling** (else a green `M_type` is the house's
  "blind guard greens every test" trap). Assert `BANNER_HEADING_REREAD=0` is byte-identical to base. Make
  `M_type` a **permanent** harness metric.
- **C4 (non-RGB honesty):** handle mode `L`/`RGBA`/`P` inputs explicitly (convert or return `None`); state
  plainly that a greyscale-raster scan (no red channel) is an inert recall gap, not a covered case.
- **C5 (seam assertion):** unit-assert the recovered band line is prepended with its `reconstruct_page_text`
  `COLUMN_BREAK` intact, so `detect_document_type`'s column-aware `seg0` split yields "worksheet" as the
  leftmost heading and the far-right "Reference No. WS-65838" column never influences the alias match.
- **C6 (scope discipline):** ship Axis A only; keep Axis B design-only, Axis C out. Kill switch default ON.

## Test strategy (gary + Oracle)
- **Unit `test_heading_reread.py`:** the id 97 + id 100 page-0 crops as GARBLE-REPRO fixtures → assert the
  recovered top line hits the worksheet alias regex; id 83 control recovers clean, no regression.
- **Unit:** conf-gate rejects a synthetic low-conf/garbled band → `None`; born-digital + kill-switch-off →
  helper not invoked / byte-identical; non-RGB mode → `None` (C4).
- **Unit FALSE-POSITIVE precision set (governs the dominant risk):** red banners of "SALES ORDER"/"INVOICE"/
  "PURCHASE ORDER" → augmented re-detect does NOT yield Worksheet; a genuine non-worksheet WITH a wsht
  logo-sibling stays its true type, `M_type` unchanged.
- **Corpus** `realdoc_regression.js`: `M=0` AND `M_type=0` AND zero per-field drop with fix ON, incl.
  Copperfield + a same-letterhead multi-type supplier; `BANNER_HEADING_REREAD=0` byte-identical.
- **Pinned trade-offs:** (1) a still-garbled band the conf gate rejects → `None` → review held (a future dev
  can't "improve recall" by dropping the conf gate / adding fuzzy and silently reintroduce a wrong-type
  auto-file); (2) a genuine SALES ORDER red banner with a wsht sibling stays sales_order.

## Backward-compat / data
Byte-identical on the legible + born-digital population (guard skips them; kill switch =0 disables the whole
path); the exact-alias pins in `test_detect_type_aliases.py` stay green (Axis A doesn't touch keyword.py). **No
migration.** The already-mis-typed Copperfield worksheets are machine-assigned/needs_review (never auto-filed —
the standing `title_trusted=False` review-hold caught them), so a normal reprocess re-runs detection and now
recovers the correct Worksheet type; no stored-row rewrite needed. Human-confirmed types are never overridden.

## Open owner decisions
1. **`M_type` a permanent harness metric?** RECOMMEND yes — it protects every future type-authority change.
2. **Red-isolation math:** probe's best was `R−max(G,B)`; oscar's `min(G,B)` is a hedge for maroon/orange
   marks (not in the probe). RECOMMEND `R−max(G,B)` shipped, `min(G,B)` a tunable if off-red banners appear.
3. **Constants:** band height ~0.28, word-conf floor 60 — owner-tunable.
4. **Axis B/C:** stay unbuilt (recommended).

## Accepted residual gaps (honest)
(a) a worksheet banner garbled so badly even red-isolation yields <60 conf → stays in review (fail-safe recall
gap); (b) an off-red (maroon/orange) banner where `R−max(G,B)` under-isolates — HYPOTHESIS, not in the probe;
(c) a genuine non-worksheet red banner OCR-misread into the exact string "WORKSHEET" — bounded by the
exact-word requirement, near-zero.
