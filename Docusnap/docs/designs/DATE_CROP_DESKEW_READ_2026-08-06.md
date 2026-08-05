# Taught date/code crop misreads on a small-angle deskewed frame — read-path frame election

**Status:** DIAGNOSED (root cause PROVEN empirically), fix direction Oracle-PRE-VETTED (banked), NOT BUILT.
Owner chose (2026-08-06) to build this from a FRESH session — it's a CORE-pipeline change and a prior
attempt (`DESKEW_RAW_CROPS`) RED-gated. Read this + the related memories before building; do not rush.

## Problem
A taught template-mapping DATE (or code) box, read on the pipeline's **deskewed** frame under Straighten,
misreads a glyph on a slightly-tilted scan — the leading digit especially (`03/04/2026` → `33/04/2026` /
`13/04/2026`, or a year misread `2026`→`2096`). Keyword (full-line read) gets it right. The shipped
safety nets (below) catch the *dangerous* subset; the SAME-YEAR / same-shape misread (`03`→`08`,
`03`→`33` when it still parses) is the residual this arc targets at the root.

## PROVEN mechanism (empirical probe, `<scratchpad>/datecrop_probe.py`, on the filed Larkspur invoice_08
`Invoice.03-04-2026.INV-13355.pdf`, detected skew 1.80°, GT `03/04/2026`):
```
tight taught box   RAW psm7 'NrAIMMAINNAC'          DESK psm7 '3/04/2026'
box + small pad    RAW psm6 '03/04/2026'  ✓         DESK psm7 '13/04/2026'   (0→1 misread)
wide (incl. label) RAW psm6 'Invoice Date 03/04/2026' ✓   DESK 'woice Date 03/04/2026'
```
Two independent levers, both confirmed:
1. **Deskew DEGRADES the small-angle read.** The RAW frame reads the date CORRECTLY (with a pad + psm6);
   the DESKEWED frame misreads the leading digit. Matches the 2026-08-05 finding
   ([[project_deskew_degradation_20260805]]): *deskew in the 0.2–2° band buys the READ nothing (Tesseract
   self-tolerates ≤~2°) while smearing a noisy scan's ink under rotation.* invoice_08 @1.8° / invoice_14
   @2.2° sit squarely in that dead band.
2. **The tight crop + psm7 is fragile.** psm7 on the exact taught box garbles even the raw crop; a small
   pad + **psm6** (block mode) recovers it on RAW. The region ladder's recipe/pad for a tight single-value
   date box under-serves this case.

## The fix direction (Oracle-BANKED, evidence bar MET per [[project_deskew_degradation_20260805]])
A **read-path angle floor / raw-preferring frame election for CROP reads**: for a page whose detected tilt
is below ~2–3°, read the taught crops on the **RAW** frame (un-degraded pixels), **display straightening
untouched**. The read-path value of deskew is concentrated ≥~3° (feeder-jam / phone-photo), not the 0.2–2°
office-scan band.

### The load-bearing tangle (why `DESKEW_RAW_CROPS` RED-gated — DO NOT repeat naively)
Stored teach coords carry the TEACH doc's own tilt θ_teach; they match NEITHER frame of a differently-
tilted sibling. Naively reading RAW crops with stored coords MIS-PLACES on siblings (the RED gate:
customer −24 / issuer −5 / date −5, caption-grabs). The 2026-08-05 PIVOT — the **canonical LEVEL frame**
(`teach_angle_compose`, smoked live this session, owner-flippable) — fixes PLACEMENT by composing taught
coords to the straightened (level) frame. So the correct construction reads pixels RAW while keeping
placement on the level frame:
- Place the box on the LEVEL frame (compose, as `teach_angle_compose` already does — correct placement).
- Map that level box BACK to the raw frame via the **level→raw inverse** (`anchorLabel.js
  deskewedNormToRaw`: `raw = C + R(+θ)·(level − C)`; the compose is its inverse `R(−θ)` — pinned in
  `test_teach_angle_compose.py`). Read the RAW crop at those coords.
- Result: correct placement (level-composed) + un-degraded RAW pixels. This is the missing rung.

### Recipe half (independent, cheap, do BOTH)
Give the date/code crop read a **small pad + a psm6 (block) rung** ahead of / alongside psm7 — the probe
shows psm6+pad reads `03/04/2026` where psm7 garbles. This helps even without the frame election. Scope to
code/date val_types (`_SNAP_VAL_TYPES`); free-text already multi-line.

## Build order (multi-slice; each byte-identical OFF, corpus-gated)
- **Slice 0 (pre-req, byte-identical):** if not already available, factor the crop-read frame source so a
  crop can be read on EITHER the raw or the deskewed render at chosen coords (reuse `_apply_skew_rotation`,
  the `deskew_angles_out` per-page threading, and the compose/`deskewedNormToRaw` inverse). Gate: corpus
  M=0 + full per-field parity OFF.
- **Slice 1 — read-path angle floor for crops:** when `detect_skew_angle(page) < ~2.5°` AND the field is a
  code/date val_type, read the composed-level box mapped BACK to raw (Slice-0 inverse) on the RAW render;
  keep the deskewed read only as a fallback / corroborator. Kill switch `DATE_CROP_RAW_READ` default OFF.
- **Slice 1b — psm6+pad rung** for tight code/date crops (independent switch or folded in).
- **Slice 2 (separate, already named):** retire Straighten-all's FORCED deskewed read — make the toggle
  display-only or route its stored read through keep-the-better ([[project_deskew_field_reread]] Slice 2;
  it "actively degrades taught-box fields while ON").

## Verification gate (the RED-gate is the bar to clear)
- `stress_test/customer_corpus_score.js` BOTH renditions + `stress_test/realdoc_regression.js`, OFF vs ON:
  **M=0 + ZERO per-field drop on date AND every other lane** (the DESKEW_RAW_CROPS casualties were
  customer/issuer/date via mis-placement — those MUST NOT regress). Ideally +date heals on the tilted arm.
- The live invoice_08/invoice_14 class: date reads `03-04-2026` / `2026` CLEAN (owner-watched — the
  standalone harness reads the date correctly on some renders, so the app repro is the real confirmation).
- Pin: the compose+inverse round-trip (already partly pinned in `test_teach_angle_compose.py`); a
  differently-tilted sibling must place correctly on BOTH frames (the anti-DESKEW_RAW_CROPS pin).

## Already shipped (the pragmatic safety-net layer — this arc is the ROOT beneath them)
- `template_edge_cut_relocate` (142ab79) — clipped taught code boxes re-seat off the label.
- `template_clip_commit_edge_slack` (bbf35a3) — a trailing-glyph misread doesn't false-flag a correct code.
- `template_date_invalid_yield` (11aa400) — an IMPOSSIBLE misread date (day 33) yields to the keyword date.
- `template_date_future_yield` (e1996bb) — a WILDLY-future misread date (2096) yields to the keyword date.
These catch the *detectable-wrong* subset. The SAME-YEAR / still-parses misread (`03`→`08`) is uncaught by
any of them — it needs THIS read-path fix (make the crop read correctly), not another merge-layer guard.

Related: [[project_deskew_degradation_20260805]] · [[project_deskew_field_reread]] ·
[[project_detect_deskew_parked]] · `docs/designs/DESKEW_FIELD_REREAD_2026-07-14.md`.
