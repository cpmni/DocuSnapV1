# Ridgeway worksheet ref garble — DEFINITIVE root cause: sub-floor SKEW, not a clip (2026-09-12)

> The "why are the crops so bad" exhibit, run to ground. The earlier framing (007 "wider page froze the box
> left edge" + a raw-render probe that TRIMMED the left 14% to *simulate* a clip) was WRONG — it manufactured
> a horizontal overhang that does not exist. The real mechanism is a VERTICAL skew row-offset. Arc A
> (`template_code_left_grow`, mig 161) and Arc B (`filing_sanity_ref_reinstate`, mig 160) both correctly
> ABSTAIN here (their guards are for a same-row horizontal clip / an on-page keyword candidate) — keep them
> DARK as nets for their true classes, but neither fixes this doc.

## The exhibit
RidgewayPlantHire worksheet_07 (doc 358, tpl 16), `reference_number`. Page prints `WS-73673`; the Stage-0.5
`template_mapping` taught-box read committed `VS-72672`; Gate C flags "doesn't appear on this page"; held.

## Measured (headless, product 200 DPI, the doc's own raw frame — `scratchpad/arcA_diag.py`)
- **TIGHT crop of the taught box → `'ara Pt ee pes ae'`** (total garble).
- Taught box `target_y = 0.1402`; the actual `WS-7367x` text row sits at **y ≈ 0.1519** → **~0.0117 lower**.
- The wider pad read (`_read_pad_window_code`) reaches down and recovers **`WS-73672`** (right prefix, one digit
  off — skew still degrades even the wider read) but its box is at y=0.152 → `_row_aligned = False`,
  `_clip_edges = None` (the token is NOT overhanging the box — it's on a *different row*).
- The doc is visibly skewed; tpl 16 `sample_deskew_angle = 0.5°`; `deskew_on_import` OFF; `auto_rotate` ON
  (orientation only); `deskew_review_retry_enabled` ON; `ocr_dpi=200`.
- tpl 16 has **5 landmarks + 120 sample words** (registration is viable, ≥3 inliers) and 19 distinct confirmed
  `WS-#####` refs (rich learned shape; dominant `WS`).

## Root-cause chain
1. The doc is skewed, so the ref text row is ~0.0117 below where the axis-aligned taught box sits.
2. The drift guard locates "Reference No." but its displacement (~0.0117) is **below `_DRIFT_FLOOR = 0.03`**, so
   `_label_drifted` is False → the "label found at its spot" branch sets **`anchor_stable = True`** and lets the
   stationary absolute read stand (template_mapper.py ~2830).
3. `anchor_stable = True` makes the **registration arbiter fallback-only path SKIP** (it fires only when the
   anchor is not a usable local signal, i.e. `anchor_stable = False`) — so the 5 available landmarks are never
   used to relocate the box to the skewed row.
4. So neither relocation path runs; the tight crop at the un-skewed y lands off-row and garbles → `VS-72672`
   commits under `shape_mode='ignore'` (shape-valid) → Gate C page-absent flag → held.

**The gap:** a sub-`_DRIFT_FLOOR` skew that still mis-seats the *tight crop* enough to garble is invisible to
BOTH the drift guard (label within floor) and registration (suppressed by `anchor_stable=True`). `_DRIFT_FLOOR`
(3% page height) is far coarser than a line pitch (~1.4% here), so a ~0.85-line vertical skew slips under it.

## Candidate fix directions (for 007 → gary → Oracle)
- **(a) Label→value re-derive even within the drift floor.** When the field's OWN label is located, seat the
  value crop at label-position + the stored drift-invariant offset (a rigid label→value link that tracks the
  skewed row) *even when the shift is sub-floor* — but re-derive the BOX position, never "re-read the whole OCR
  line" (the documented "Beaumont Care Homes → garble" regression the current stationary branch avoids).
- **(b) Tie `_DRIFT_FLOOR` to line height** (the deferred idea in extraction-pipeline.md:86): 0.0117 ≈ 0.85×
  line-pitch would exceed a line-height-scaled floor → drift guard fires → relocate. Blast radius: more
  relocations fire; own census.
- **(c) Deskew.** `deskew_review_retry_enabled` is ON — a review-bound whole-page straighten retry that adopts
  if overall confidence rises. Why didn't it straighten worksheet_07 (floor 0.3°? overall didn't rise? not run
  on reprocess?). If it's meant to catch exactly this, the bug may be there. Straightening aligns the row to
  the axis-aligned box → clean read + box on-row.
- **(d) Registration despite `anchor_stable`.** Let the registration arbiter also run when the fitted page
  transform says the taught target box maps to a meaningfully moved position, even if the local label looked
  "stable" — i.e. the box-divergence signal is independent of the label OCR (the arbiter's own contract).

007's creed applies: **remove the misalignment** (make the box track the skewed row), don't compensate with a
wider re-read (which still read one digit wrong on the skewed frame — proof that widening is a band-aid, not
the fix). Deskew (c) or the skew-robust label→value seat (a) are the "remove it" options.

## PROOF — deskew heals it (2026-09-12, `scratchpad/deskew_test.py` on the app's actual inbox/358.pdf)
- inbox/358.pdf ≡ the corpus PDF (identical render/skew) → the headless measurements describe the app's input.
- `detect_skew_angle = 1.7°` (well above the retry's 0.3° floor).
- RAW: tight box = garble `'PIER Ne A'`; pad = `WS-73672` off-row (y 0.152), row_aligned False.
- **STRAIGHTENED +1.7°: tight box = `'1S-73673'` (digits right), pad = `WS-73673` @92, y 0.145, clip=L,
  row_aligned True.** −1.7° = garbage (so +1.7° is the straighten direction).
- ⇒ Deskew REMOVES the tilt → the ref reads `WS-73673` cleanly. On the straightened frame Arc A's guards
  (clip=L + row-aligned) are even satisfied — but the app never straightens before Stage 0.5.
- The app's live `VS-72672` is a STALE poisoned commit — the CURRENT tight read garbles → `_gate_value`
  rejects → abs_text=None (007). Learning Repair owed on it regardless of the code fix.

## 007 corrections (folded)
- Stage-0.5 floor is `_DRIFT_FLOOR=0.02` (template_mapper.py:76), NOT 0.03 (anchor.py, Stage 2). Reject fix
  (b) line-height floor (label shift 0.010 < pitch 0.014) and (d) run-the-arbiter (value box_divergence ~0.012
  < the arbiter's own 0.02 gate; and `apply_box` crops AXIS-ALIGNED → reads the tilted row degraded anyway =
  compensate not remove). (c) DESKEW is the only "remove the tilt" fix.
- The fix is the EXISTING review-bound whole-page straighten retry `deskew_review_retry` (ON). OPEN FORK:
  **H1** it heals on a FULL reprocess (then `VS-72672` is stale/poisoned → Learning Repair + route the class
  off the imageless `--reextract` Quick path, which SKIPS the retry — process_docs `_deskew_retry_should_run`)
  vs **H2** the retry runs but its WHOLE-DOC adopt gate (`_deskew_retry_adopt`: straightened overall strictly
  > raw overall) won't adopt a single held field's rescue → make the adopt FIELD-SCOPED (adopt a
  raw-flagged/held field that straightens clean + now on-page, keep the hold note → never auto-files).
- DECISIVE measurement to pick H1/H2: run inbox/358.pdf through the FULL process_docs import path with
  `DESKEW_REVIEW_RETRY=1`, log `_max_skew`, `_oc0`, `_oc1`, adopted `reference_number`.

## Status
Arc A (mig 161) + Arc B (mig 160) BUILT DARK, both abstain here (correctly). This doc needs the skew/placement
layer. Next: 007 traces the drift guard + registration arbiter + deskew-review-retry for THIS doc and names
the fix; then gary (gate/tests/census) + Oracle. Memory: this file + `scratchpad/arcA_diag.py` (the measurement).

## 2026-09-12 (session 2) — THE DECISIVE MEASUREMENT: H1 + H2 + a third gate, H3
inbox/358.pdf run through the FULL `process_docs` import path (fresh render+OCR, faithful reprocess manifest
tpl 16, the real app spawn env mirrored — 148 vars incl. `DESKEW_REVIEW_RETRY=1` — `OCR_RENDER_DPI=200`;
runner `scratchpad/measure358.js`, read-only on the live DB):
- **`VS-72672` @95 is the CURRENT read, not a stale commit.** Both arms (retry OFF / ON) emit
  `reference_number = VS-72672` @95 `template_mapping` + the Gate-C absent note; corroboration disagree =
  `keyword: WS-73673`; `_shape_ok` True; overall 83. The "Learning Repair the stale VS-72672" item is MOOT
  (doc 358 is not confirmed; `documents.reference_number` is NULL).
- **H3 (new): the retry NEVER RAN.** No "Straighten+reread" line in the ON arm. `_deskew_retry_should_run`
  keys on the engine's `_needs_review` (process_docs.py:1292), which is **False** for this doc: engine.py:12427-
  12431 keeps `_needs_review` only via `_any_note`/validator, and Gate C's absent writer (:7729) never raises
  it. The doc is review-bound on the JS side (a noted ref-role field is refused by `isAutoFileEligible`), but
  the retry's entry door reads the engine flag → blind to every note-only hold.
- **H2 CONFIRMED (forced-open probe, scratch copy with the door patched True):** `_max_skew` 1.7 ≥ 0.3 →
  straightened pass → taught box reads `MS.72672` → `_padcodeflag` → the existing TAUGHT-CORROB-ADOPT (mig 153)
  adopts **`WS-73673` @82 `template_mapping_corrobadopt`**, corroboration `{mapping + keyword agree,
  independent_agree: true}`, `_shape_ok` True, TCA note. Straightened overall **79 < raw 83** (the confident
  garble @95 inflates raw) → `_deskew_retry_adopt` refuses → "kept raw". So even with the door open, the
  WHOLE-DOC gate throws away a corroborated field rescue.
- **Arc B abstains by its own bar, not a bug:** trace `ref_reinstate` → `has_fmt` true, shapes `['@@-#']`,
  **`dominant: null`** — the scope has only 3 HUMAN-confirmed refs (`value_counts` total 3 < `DOMINANT_MIN_COUNT`
  5; the other 17 `WS-` refs are `machine_value_counts`, which `build_prefix_index` ignores). The ledger DID hold
  `WS-73673` (`keyword_override` @85, on-page). Arc B will arm itself after two more human confirms in scope;
  the deskew route is history-independent.
- ⇒ THE FIX = the deskew retry with (1) a note-held ENTRY door and (2) a FIELD-SCOPED corroborated adopt when
  the whole-doc gate refuses — design `docs/designs/DESKEW_RETRY_FIELD_ADOPT_2026-09-12.md` (gary → Oracle).
