# OCR slice-preprocessing study — can we FIX THE READING of confusable glyphs?

Owner's steer (2026-09-22): stop GUESSING the value (blind letter→digit map); if a human reads the glyph
clearly, the ink is on the page and the OCR is mishandling the pixels — manipulate the slice so the software
reads it right. oscar + 007 consulted (both verified in code). Verdict: **worth running** — it converts the
"recoverable vs not" question from opinion into counts, reuses machinery that already exists, and needs no new
shipped dependency for the high-value recipes.

## The honest split it will measure
- **MARGINAL** — the discriminating ink (a 5's top bar, a 0's open counter, an 8's loop) is IN the 200-DPI
  capture but the shipped light-first ladder mishandles it. **Recoverable** by better preprocessing. Expected:
  0/O, 5/S, 2/Z, 8/B, 6/G mostly here.
- **GENUINELY ABSENT** — the distinguishing feature was never captured (a sans-serif `1` and a plain-bar `I`
  are geometrically identical; a worn glyph). **No recipe recovers information that isn't there.** The owner's
  exhibit `1625802868`/`I625802868` may be here — a sans-serif leading 1. For this class the only reading-layer
  lever is a **digit whitelist when the field's shape is known** (constrain the alphabet — a recognition-time
  context, NOT the dropped output guess).
- **OTHER** (wrong-row / clipped / length-diff) — a placement problem, not preprocessing; out of this study.

## Design (the two experts, consolidated)
**1. Gather real misread slices** (`gather_slices.py`) over `Desktop\ScanFinder Test Corpus` (605 + GT):
run `process_docs --trace --slice-dir --dpi 200`, parse the trace for each field's committed read + its
`slice` event {field,bbox,page}. Diff committed vs `ground_truth.json`; keep **edit-distance == 1 with a
confusable char pair** (1↔I/l, 0↔O/Q, 5↔S, 2↔Z, 8↔B, 6↔G, 7↔T) = the DISCOVERY set. Re-derive the RAW crop
from a fresh 200-DPI pypdfium render of the bbox + 0.3×h headroom (NOT the captured png, which may be
pre-prepped). ALSO harvest ~100-200 slices the ladder read CORRECTLY = the CONTROL set (measures breakage).
Owner's live Print Tracker slices = a separate VALIDATION set (owner drops the PDFs + a 1-line GT per ref;
the live DB is blocked to Claude's tools). Expected discovery volume: modest (~20-60) — many corpus misreads
are wrong-row, not confusable.

**2. Preprocessing matrix** (`sweep_recipes.py`), apply-order crop→grey→upscale→[contrast]→[sharpen]→binarise→
[morphology]→OCR. Ranked knobs: **binarisation** (#1 lever — changes stroke topology: Otsu / Sauvola k∈{.2,.3,.5}
/ adaptive-mean/gaussian / a "none" grey arm), **upscale** to cap-height ≈36 LANCZOS, **PSM** 7/8/10, **whitelist**
(digits when the shape is all-digit — the near-deterministic 1/I fix, measured separately), CLAHE/gamma (gated to
low-contrast), unsharp, 1px morphology (high-variance), median denoise. **First-cut pilot ≈24 recipes**:
binarise{none,Otsu,Sauvola.3,adaptive-gauss} × CLAHE{off,on} × PSM{7,8,10} × whitelist{none,digit-if-known},
trimmed. Expand only the knobs that move the needle.

**3. Measurement** (`analyse.py`): GT-anchored ONLY — per (slice,recipe) FIXED (wrong→correct) / BROKE
(correct→wrong on a control) / NET = FIXED−BROKE. Immune to the "two preps agreed on the same wrong glyph" trap
(5:1 false:true in the code) because a common-mode agreement on the wrong value still scores as a failure.
Per-glyph-pair matrix (rows = pairs, cols = recipes) → is there a universal recipe or is it glyph/font specific
(likely the latter → ship a SHORT 2-3-recipe ladder, not one). Per-char Tesseract confidence is uncalibrated —
NEVER the arbiter, only a secondary permit to attempt a re-read.

**4. Ship bar:** a targeted re-read on FLAGGED fields is worth building if a fixed recipe or ≤3-recipe ladder
delivers **FIXED/flagged ≥ ~30-40% with BROKE ≈ 0** on the controls; if best NET < ~15% or BROKE > 0, keep the
review flag. Weighted as REVIEW-EFFORT SAVED + fewer wrong values shown, NOT auto-file rate.

## Integration seam (if a winner emerges)
A CONDITIONAL confusable rung in `ocr/region_core.py` `process` (the light-first ladder ~:167) + its twin
`anchor._crop_and_ocr` — fires ONLY when the read trips the existing confusable/shape condition, byte-identical
on every other crop. The recipe is a WITNESS fed into the EXISTING `reslice.positional_consensus` (≥3 distinct
pixel sources, strict majority, review-bound) — never an outright replace. A recovered NO-HISTORY ref CORRECTS
the displayed value + KEEPS its "confirm once" note; it lifts the review hold ONLY on a confirmed shape (≥N
confirms) or an independent page-duplicate — never on "the recipes agreed." Same OFF-vs-ON M=0 / BROKE≈0 gate as
every other dark switch before a flip.

## OSS (no new shipped dependency for the high-value recipes)
Shippable in numpy/scipy already vendored: greyscale, Otsu, adaptive-mean, **Sauvola** (~15 lines: local mean+std
via two uniform_filter passes), morphology (`scipy.ndimage`), median, unsharp, whitelist/PSM — Tesseract 5
(Apache-2.0), pytesseract (Apache-2.0), pypdfium2 (BSD-3), Pillow (HPND), numpy/scipy (BSD-3). DEV-ONLY unless
ported/vendored: CLAHE + bilateral/NLM (OpenCV Apache-2.0 / scikit-image BSD-3) — PREFER numpy/scipy-expressible
recipes; flag any CLAHE/OpenCV-only winner as needing a porting decision before it can ship. Reference-font glyph
templates for the geometry test = a bundled permissive font (DejaVu). AVOID PyMuPDF (AGPL) — pypdfium2 covers it.

## Harness layout
`TESTING/_measure/confusable_slices_20260922/` — `gather_slices.py`, `sweep_recipes.py`, `analyse.py`,
`slices/{raw,meta,index.jsonl}`, `results/{results.csv,report.md}`.
