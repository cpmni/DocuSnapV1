# Confusable-glyph settling — the reading-layer programme (2026-09-22)

**Status:** DESIGN, advisor + Oracle gated. Nothing built. Owner-requested (2026-09-22): stop GUESSING the
value (blind letter→digit map, superseded — see `memory/feedback_fix_reading_not_guess_ocr`); FIX THE READING.
Advisors: oscar (OCR mechanics), 007 (glyph geometry/matching), gary (engineering) → **Oracle SIGN-OFF-WITH-
CONDITIONS on both features** (`docs/oracle_log.md` 2026-09-22). This doc is the authoritative build spec; a
fresh session can build S0 straight from it.

## The problem, precisely
A scanned Print Tracker reference `1625802868` is committed as `I625802868` — the digit `1` read as the letter
`I`. Print Tracker refs are **SCANS** (owner-confirmed) and **ALPHANUMERIC** (`1G25802868` legitimately carries
a `G`), so a digits-only whitelist is ILLEGAL — the software must read the glyph. The existing DARK
`_flag_ref_confusable_ambiguous` (`engine.py:6705`, called `:11939`) already DETECTS these, exposes the disputed
position `pos`, caps ≤69 + notes → held via `trust.js` roleKeys (auto-file blocked, zero trust.js change). What
is missing is a RESOLVER that reads the disputed glyph correctly.

## Why a human/Claude reads it but Tesseract doesn't (the framing that drives the design)
The information lives in TWO places, needing two different fixes:
1. **In the glyph pixels** — for a muddy `5`/`S`, `0`/`O`, `8`/`B`, the discriminating ink is captured but the
   shipped light-first ladder mishandles it → **better preprocessing** recovers it (the OCR_SLICE_STUDY lever).
2. **In the surroundings (context)** — for a genuinely serif-less `1` vs `I`, the glyph carries no difference;
   the answer is only in "this sender's `1`s look like this." No image trick invents a missing feature. The
   reading-layer levers here are the **learned glyph gallery** (compare to the sender's own confirmed ink) and,
   where the field is truly all-digit (NOT Print Tracker), a digit whitelist.

## The three-population split (every design decision keys off this)
- **MARGINAL** — ink present, prep mishandled → OCR_SLICE_STUDY recovers.
- **GENUINELY ABSENT** — feature never captured (sans-serif 1/I) → NOTHING recovers it; every lever must
  self-ABSTAIN here (stay review-bound). The gallery does this automatically (its 1-cluster and I-cluster are
  themselves indistinguishable → no margin → abstain).
- **PRESENT-BUT-NO-HISTORY** — the font renders `0`≠`O` and the scan kept it, but there's no history for THIS
  value and a same-pixel re-read shares the misread → the **gallery** (the sender's own confirmed glyphs from
  OTHER docs) is the one independent lever.

---

# BUILD ORDER (Oracle ruling — do NOT reorder)
1. **OCR_SLICE_STUDY** (`docs/designs/OCR_SLICE_STUDY_2026-09-22.md`) — the reading-layer preprocessing sweep.
   HIGHEST leverage (fixes the VALUE for EVERY supplier incl. cold, and can reach the auto-file path if BROKE≈0),
   and **may make the gallery redundant**. Run this study FIRST.
2. **Feature 2 (born-digital trip-wire) census** — cheap; the census is the ship/no-ship decision and **may
   collapse to DO-NOTHING**.
3. **Feature 1 (glyph gallery)** — LAST. Most machinery, narrowest reward (repeat suppliers only, held-for-
   review pre-fill). Build only for the residual glyphs a shipped preprocessing recipe still can't read.

Everything below is DARK, env-gated, byte-identical OFF, in `TEST_SWITCH_KEYS` (mig-137 reset), advisor+Oracle
gated before any flip.

---

# FEATURE 1 — LEARNED PER-TEMPLATE GLYPH GALLERY

## Premise (Oracle-verified independent axis)
The gallery matches the disputed glyph against the **sender's OWN confirmed ink from OTHER documents** — an
external template distribution, NOT a second read of the same pixels. This is the independent corroborator the
2026-08-11 raw-witness / `pendingfeatures.md:2943` second-witness ruling (same-pixel agreement measured **5:1
false:true**) was missing. Genuinely-absent 1/I self-abstains by cluster equidistance.
**Honesty for the owner:** F1 does NOTHING for a cold/new supplier (empty gallery → abstain → today's flag). It
heals REPEAT suppliers only, and only as a **held-for-review pre-fill** (no auto-file until the deferred S4).

## Storage (gary)
New table (next free migration, ≈208 — verify):
```
glyph_samples(id, supplier_name TEXT, document_slug TEXT, field_key TEXT NULL, char TEXT,
              crop_png BLOB, cap_h INTEGER, char_conf REAL, source_document_id INTEGER, created_at)
```
- **Key = (supplier_name, document_slug)** — the STABLE learning scope every other learning row uses
  (`field_anchors`/`supplier_hints`/`corrections`). NOT `template_id` (templates split/merge — `mergeInto`,
  identity-unfreeze). Glyph shape is a font property = scope-wide.
- **field_key NULLABLE** → pool a `5`/`0` across ref/date/total for denser digit exemplars (letters come mostly
  from refs). Oracle C6: pooling allowed ONLY because intra-cluster-agreement (C5) forces a bimodal (two-font)
  pool to ABSTAIN rather than mis-vote. Measure whether pooling actually beats per-field.
- **Blob, not feature-vector** — a size-normalised greyscale crop (cap-height ≈32px, a few hundred bytes PNG) is
  deterministic, inspectable, poison-forensic, matchable in pure numpy; keeps the door open to a better matcher
  without re-teaching (precedent: `template_logo_hashes`, `reslice.py`). No new shipped dependency.
- **Cap ~8 per (scope,char); a char is not vote-eligible until ≥N_min=3.** Evict lowest `char_conf` (a low-conf
  exemplar is the likeliest poison), tie-break newest; evict-for-diversity so scanner/ink variation is retained.
- Rides Settings backup/restore on the LEARNING side (`backupService` includes learning, excludes documents).

## Capture (gary + oscar; Oracle C4/C5)
- **Human confirm ONLY.** Hook in `reviewService.confirm` beside the learning writes (`reviewService.js:441`,
  gate `if (!_via)` — `_via` is only ever the machine sentinels `scope_sweep`/`auto_reprocess` at `:113-114`, so a
  human confirm is null). A machine echo must NEVER seed the gallery.
- **ASYNC/deferred** so it adds ZERO latency to the confirm click (return-latency probe at `:116`).
- **Per-char boxes:** `pytesseract.image_to_boxes(crop, config='--oem 3 --psm 8')` (image_to_data gives only
  WORD boxes). Coordinate gotcha: image_to_boxes is BOTTOM-LEFT origin — convert `top_tl = H - top_box`. Slice
  from the SAME (prepped/upscaled) image the boxes came from.
- **Alignment poison guard (primary):** accept the decomposition ONLY when `box_count == len(confirmed_value)`
  AND the recognised chars match the confirmed string; label each crop with the CONFIRMED char (so a misread
  glyph becomes the corrected exemplar we want). **Oracle C5 GAP FIX:** box_count==len passes a count-preserving
  mis-segmentation (one box spanning 1.5 glyphs) — ADD a per-char box **width/spacing sanity check**. Any failure
  → **capture NOTHING from this doc** (rejecting messy docs is free; the gallery fills from clean confirms).
- **Gates (all must hold):** human confirm; page provenance `ocr` (never born-digital — a vector `0` is crisp and
  would poison a scan gallery); structured single-token field (ref/date/total/code val_types — NOT free-text/name,
  proportional fonts break alignment); per-char conf ≥ floor; char ∈ {digits, the confusable letters}; and the
  field's read was NOT itself flagged/low-conf (don't learn a shape from an uncertain read).
- **Bbox source (BUILD PRECONDITION to verify, Oracle C4):** `extractions` stores NO bbox and `field_anchors`
  holds only TAUGHT geometry. So S0 must either (a) re-locate the value at confirm via the existing
  `ocr.targeted_reread.locate_value_region(page_data, confirmed_value, label)` (abstains on ambiguity), or (b)
  stash the read bbox during extraction and persist on confirm. Recommendation: capture geometry at extraction,
  do the pixel work once at confirm from `workingPath`. Scope this cost in S0.
- Put the persist in a NEW `src/services/glyphGalleryService.js` (testable in isolation), not inline.

## Match + the composition (007 + oscar; Oracle C1/C2/C3 — LOAD-BEARING)
- **Site:** consume the existing flag. `_flag_ref_confusable_ambiguous` hands `pos` + the candidate pair. Crop
  position `pos` from this doc's field box → normalise → match.
- **Normalise (007):** same binarise recipe both sides (reuse in-tree Sauvola `ocr/text_enhance.py`); size by
  **cap-height** to a fixed cell (~24×32); centre by ink CENTROID. **Do NOT square-normalise** — that destroys
  the 0/O and 1/I aspect discriminant; keep aspect as an EXPLICIT feature. No per-glyph deskew (rely on page
  deskew; multiple exemplars absorb residual tilt).
- **Metric (007):** hybrid, decided PAIRWISE among only the candidate classes (not 36-way): topological/structural
  features (**hole count / Euler — settles 6/G, 8/B**; **aspect — settles 0/O**; **top-right spur — settles 1/I**;
  corner sharpness) + **zero-mean NCC** on the normalised bitmap (settles whole-shape 5/S, 2/Z). k-NN (k≥3,
  MAJORITY not single-NN) of the query vs each candidate class's exemplars. Pure numpy + `scipy.ndimage.label`.
- **Verdict ONLY when:** both candidates have ≥N_min exemplars; the winning class's mean distance beats the
  runner-up by a **margin ≥ τ** (τ~0.6-0.7, tuned by leave-one-out then FROZEN); the winning class's exemplars
  agree among themselves (tight cluster — a bimodal pool ABSTAINS); AND the winner is an absolute good match
  (distance < CEILING — margin alone is fooled when BOTH candidates are far, e.g. a smudge). Else **"too close to
  call" → no verdict → stays review-bound.** Learned per-template guard: if a pair's clusters OVERLAP
  (inter-centroid < intra-spread) mark it **non-discriminable on this font → always review** (the honest
  "these two, on this font, we cannot tell apart").
- **THE COMPOSITION (Oracle C2, affirmed):** the gallery is a REQUIRED-CONCURRING independent witness, **NOT a
  voter** in `reslice.positional_consensus`'s majority (else 3 common-mode binarisation misreads outvote the 1
  correct gallery witness). Run `positional_consensus` SEPARATELY over ≥3 DISTINCT pixel source_keys
  (`reslice.py:288/301`). **ADOPT the corrected char ONLY when the ink-axis (gallery) AND the pixel-axis
  (positional_consensus) CONCUR.** positional_consensus is a VETO only — it can block an adopt, never manufacture
  one (the safe use of the weak 5:1 signal). Disagree / abstain / cold gallery → today's flag behaviour (no
  regression).
- **ADOPT effect (Oracle C1 SHIP-BLOCKER + C3):** correct the **DISPLAYED value** + **KEEP the confirm-once
  note** (stays sub-88, note in roleKeys → auto-file blocked; the boost at `engine.py:11957` `continue`s on any
  validation_note so ≤69 never re-lifts). **ADOPT writes NO `corrected_to` and NO corrections-learning row** —
  else the gallery SELF-REINFORCES (adopt-wrong → learning echo → poisoned exemplars → more wrong adopts). Mirror
  the reinstate arc (`engine.py:6823`) / confusion-precedence O2. Even a WRONG adopt is a wrong value SHOWN AT
  REVIEW under a note — never a silent misfile.
- **M=1 trap (Oracle C3):** hold-LIFT / auto-file on a matured gallery is **DEFERRED to a separate slice S4**,
  separately Oracle-gated, NEVER folded into the resolver and NEVER touching trust.js. The confirm-once note is
  the SOLE checkpoint.

## Poisoning guard — three layers (Oracle Q3)
1. **Capture:** human-confirm-only + box_count==len + **per-char width/spacing sanity (C5 gap fix)** + per-char
   conf floor + scanned-only + structured-only + not-itself-flagged. A mis-segmented/mislabelled crop never enters.
2. **Storage:** N_min=3 before vote-eligible; cap+evict-lowest-conf; a new exemplar that is a MAD/Hampel outlier
   vs its char's existing centroid is QUARANTINED (kept, not vote-counted, until a 2nd corroborating exemplar).
3. **Match:** k-NN k≥3 + margin + intra-cluster agreement (one bad exemplar loses to ≥3 good), AND the required
   concurrence with the pixel-axis means a poisoned gallery can only ever DOWNGRADE to review, never ADOPT alone.
   **Residual (accepted, fail-safe):** a SUSTAINED rubber-stamp (same wrong confirm ≥3× on a sender who never
   legitimately uses the rival glyph) builds a self-consistent poison cluster → a wrong verdict — but still HELD
   for review. **HYPOTHESIS the harness can't reach:** a mis-resolved supplier consults the WRONG scope's gallery
   (different font) → spurious margin → wrong ADOPT. Guard: require the gallery's scope to equal the read's
   scope; flag for the owner's live Print Tracker set.

## Slice breakdown (~5 slices, multi-day)
- **S0** — table + `glyphGalleryService` + capture (WRITE-ONLY), DARK. No reader. Ships inert; a `-TEST` build
  can start populating a gallery for census data before the matcher exists. (Resolve the C4 bbox-source question.)
- **S1** — the pure matcher `python_backend/extraction/glyph_gallery.py match(crop, exemplars_by_char, pos) →
  {char, margin} | None`, numpy-only, fully unit-tested off fixtures. No engine wiring.
- **S2** — read integration behind the flag: gallery-verdict-MUST-CONCUR-with-positional_consensus, FLAG-tier
  only (correct displayed value + keep note, sub-88), NO hold-lift.
- **S3** — census + Oracle + flip gate.
- **S4 (DEFERRED, separate gate)** — hold-LIFT / auto-file on a matured gallery. NEVER bundled into S2.

## Tests + gate
- **Unit `test_glyph_gallery.py`:** right char when one cluster clearly nearer; ABSTAIN on margin < τ (pins the
  genuinely-absent self-abstain); ABSTAIN when a candidate < N_min; a single poisoned exemplar among ≥3 clean
  loses (k-NN poison guard); length-mismatch capture skipped.
- **Unit JS `test_glyph_gallery_capture.js` (Electron-as-Node):** machine confirm (`_via` set) captures NOTHING;
  born-digital confirm captures nothing; cap+evict-lowest-conf holds; async-capture adds no confirm latency.
- **Realdoc M=0** (`realdoc_regression.js`, OFF byte-identical; ON zero per-field accuracy regression). **Adjudicate
  newly-changed reads AT THE PIXELS, not vs corpus GT** — GT may rubber-stamp a wrong glyph (REF_CONFUSABLE C5;
  this install's confirmed history has `P1` for a real `PI`).
- **Census cells:** BROKE=0 on a CONTROL set of correctly-read confusable-bearing refs; adopt/FIXED rate reported;
  a **POISON-INJECTION cell** (seed a rubber-stamped wrong exemplar ×3 → prove ADOPT still routes to review);
  genuine-digit-prefix repeat supplier `wouldFile(ON) ⊆ wouldFile(OFF)`.
- **PINS (the accepted trade-offs):** a cold-gallery or indistinguishable-pair confusable ref STAYS review-bound
  (does NOT auto-file) at ANY threshold — the S4-not-folded pin; ADOPT keeps the note (hold survives); ADOPT
  writes no corrections row (C1) — reprocess-after-ADOPT is idempotent.

## The seam
RELIES ON: the flag firing + exposing `pos`; the flagged field having a `box` (a pure keyword full-page read may
have `box=None` → gallery can't crop → stays review-bound, honest limit); page provenance `ocr`; the confirm
human/machine `_via` distinction; `positional_consensus` as the concurring pixel axis; correct supplier resolution.
WEAKENS: it changes a displayed character before a human sees it — if a human then rubber-stamps a gallery guess
the flag's purpose is blunted → mitigated by keep-note + never-lift-hold + required-concurrence. DISABLES no
trust.js safety (note stays in roleKeys).

---

# FEATURE 2 — BORN-DIGITAL TEXT-LAYER CORROBORATION TRIP-WIRE

**Does NOT apply to Print Tracker (true scans).** General robustness for a searchable PDF whose embedded text
layer is WRONG. Oracle: **SIGN-OFF-WITH-CONDITIONS, census-FIRST, may collapse to DO-NOTHING.**

## Premise (Oracle C1 FIX — read this before building)
`born_digital.assess_page` (`born_digital.py:37`, 0.30 alpha-ratio floor `:56`) already rejects a GARBAGE text
layer (falls back to OCR). What it can't catch is a WELL-FORMED but WRONG layer. **The catch set is
broken-ToUnicode/wrong-CMap PDFs** (glyphs print correctly but the extracted code points are wrong — the classic
"copy-paste gives gibberish but it prints fine") **and gross field/row layer-vs-print misalignment** — NOT a
confusable-only difference (a confusable-tolerant compare treats `INV-0O123`-vs-render as EQUAL, so the original
motivating example is OUTSIDE the feature). **Whether that class is non-empty on real docs is unknown → the
census decides ship vs DO-NOTHING.**

## Feasibility (Oracle-verified — no new plumbing)
`page_images` ARE populated for born-digital pages (`tesseract.py:1052` renders every page, `:1098`
`pages.append(img)` unconditional; `process_docs.py:1075` receives them). `born_digital.page_lines` (`:119`) gives
exact per-field geometry. So a targeted per-field OCR needs NO new render plumbing. NOTE: F2 REINTRODUCES per-field
OCR on the born-digital fast path that currently skips it → bound to role fields + MEASURE wall-clock.

## Design (targeted — the false-alarm control is the whole game)
- **Trigger:** run the image-OCR cross-check ONLY on the STRUCTURED role fields (ref/date/total) of a born-digital
  doc; optionally gate further on a smell (alpha-ratio near floor; a text-layer value failing its own validation
  shape). NEVER free-text/name; NEVER blanket-OCR every clean digital doc.
- **Compare:** crop the field's `page_lines` word-box region, OCR just that region (reuse the light-first ladder),
  normalise BOTH sides with the shipped `text_normalise` twin AND a **confusable-tolerant** compare (O/0, I/1,
  S/5 equal — a confusable diff is an OCR limitation, not proof the layer lies).
- **Decision (fail toward silence):** agree → a small capped confidence corroboration (≤98, never auto-file on
  this alone — mirror the boost cap at `engine.py:11969`); disagree BUT the image-OCR read is itself NOT credible
  (fails its field regex / low conf) → **NO flag** (can't tell a lying layer from a failed OCR → agreement-or-
  silence); disagree AND image-OCR credible & differs beyond confusable noise → **FLAG** ("the text stored in this
  PDF may not match what's printed — please check"), value UNCHANGED (trip-wire, never adopt OCR over the layer),
  review-bound, note in roleKeys.

## Slices + gate
- **S0 — the pure comparator** `bd_corroborate.py compare(text_layer_val, image_ocr_val, val_type) →
  agree|disagree_credible|inconclusive`, unit-tested off fixtures. **AND the census** (this IS the ship decision):
  count real gross-mismatch catches (pixel-adjudicated) + false-holds on the CLEAN born-digital majority + wall-
  clock, over 605 + Demo + any born-digital set. Ship only if catches non-empty AND false-hold ≈0 AND wall-clock
  acceptable — else DO-NOTHING.
- **S1** — wire behind the switch on role fields only, FLAG-only, credibility-gated + confusable-tolerant, DARK.
- **S2** — flip gate.
- **Tests:** `test_bd_corroborate.py` (clean layer+agreeing OCR→agree; lying CMap layer vs credible image-OCR→flag;
  garbage image-OCR→inconclusive/no-flag; confusable-only diff→NO flag). Realdoc M=0; the make-or-break metric =
  **newly-flagged count on CLEAN born-digital docs ≈ 0**; `wouldFile(ON) ⊆ wouldFile(OFF)`. PIN: a clean
  born-digital doc whose image-OCR merely confusable-differs from a correct layer is NOT flagged (still auto-files).
- **Seam:** it inverts the born-digital trust for the suspect subset — coordinate with `targeted_reread`'s
  page_ok born-digital-trusted gate (don't have one part trust the layer while another distrusts it). Converts a
  silent-wrong (trusted bad layer auto-files) into a flagged-uncertain, at the cost of some false HOLDS (held, not
  misfiled). HYPOTHESIS the harness can't reach: a layer wrong in a way the RENDERER also renders wrong (both
  sources are the PDF) → no lever catches it; out of scope.

## Setting/DARK (both features)
`glyph_gallery_enabled` / `born_digital_corroboration_enabled` seeded `'false'` (migration), added to
`TEST_SWITCH_KEYS` (`dark_switches.js`), one-liner setting→spawn-env in `handler.js` (the `:123` pattern). OFF ⇒
byte-identical (capture writes nothing, match/compare never consulted). Go-forward-only, no rewrite of existing
rows.

## OSS (no new SHIPPED dependency for either feature)
Tesseract 5 (Apache-2.0), pytesseract (Apache-2.0), pypdfium2 (BSD-3), Pillow (HPND), numpy/scipy (BSD-3) — all
vendored. Sauvola = in-tree `ocr/text_enhance.py`; hole-count = `scipy.ndimage.label`. Do NOT add OpenCV /
scikit-image / a CNN to the shipped runtime (pure-numpy template match suffices; a learned model adds weight +
licence risk). AVOID PyMuPDF (AGPL).

## Prior art this MUST NOT contradict
`pendingfeatures.md:2943-2991` (same-pixel second-witness: 5:1, FLAG-before-ADOPT — the gallery escapes it only
by being the INDEPENDENT-ink axis); `docs/designs/REF_CONFUSABLE_FLAG_2026-09-11.md` (the roleKeys/note seam F1
reuses); `docs/designs/OCR_SLICE_STUDY_2026-09-22.md` (the sibling reading-layer lever, ordered FIRST).
