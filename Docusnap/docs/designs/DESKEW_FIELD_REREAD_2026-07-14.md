# Auto-straighten a flagged field on import — FIELD-SCOPED design (Oracle-signed direction)

**Status:** DESIGNED + Oracle-vetted (2026-07-14). NOT BUILT. Owner chose the **field-scoped** approach over
whole-doc. Build fresh (touches the core extraction pipeline — do NOT rush).

## Problem
Folder import does NOT straighten pages (only single-reprocess `deskewOnce` + the Review "Straighten all"
toggle do). A skewed scan reads with its skew; a ⊕-taught value box mis-registers; the doc lands in Review
flagged (the ⑂ Resolve picker `candidates` + a caption-demotion `validation_note`). Owner wants ambiguous
imports to self-heal.

## Two live proof cases (BOTH directions occur — straighten is NOT monotone)
- **Kingfisher (deskew HELPS):** raw customer read garbled "Customer eu"@69 (flagged); deskew → clean
  "Kingfisher Print Studio"@89. (The merged caption-band-exclusion fix makes the DESKEWED relocate read clean.)
- **delivery_docket_12 (deskew HURTS):** raw "Larch & Hollow Cafe Co"@87 CORRECT; deskew "ae Cafe Co"@78
  WORSE. A ⊕ box is registered to RAW geometry; a small rotation mis-registers it. The stored @78 came from
  the owner running **Straighten-all ON** (a live defect — see Slice 2).

## Chosen approach — FIELD-SCOPED re-read (Oracle's recommendation over whole-doc)
Whole-doc dual-read (re-extract both ways, pick the better record) was SENT BACK by Oracle: re-extracting the
whole doc from a rotated geometry can clear the customer flag AND silently shift a digit in a clean, unflagged
`reference_number` (rigid box mis-register) → reviewer confirms → **silent wrong file**. Fixable only with 7
vetoes (A1–A7) that force it to behave field-locally anyway. So do it field-locally from the start:

**Re-read ONLY the flagged field on a deskewed page; adopt nothing else; review-bound.** Avoids the
sibling-corruption / type-flip / supplier-flip holes BY CONSTRUCTION.

### Trigger (narrow)
A NAME-like non-supplier field carrying the caption-demotion / relocate-disagreement note (i.e.
`_field_candidate_emit` armed OR `caption_bleed`) — NOT broad `needs_review`. AND `detect_skew_angle(raw
pages) ≥ floor` (self-gating: no skew → no deskew read → nothing to do). AND not born-digital. AND
not-already-deskewed (Straighten-all off — see Slice 2).

### The re-read + adopt gate (field-local, corroboration-first)
1. Deskew the page(s) (`ocr/tesseract.py _apply_skew_rotation` at the detected angle) — needs the Slice-0
   `_extract_document(deskew_pages=True)` refactor so a second OCR+extract runs on the rotated pages.
2. Take R's value for the FLAGGED FIELD ONLY (ignore every sibling in R — never adopt them).
3. **Corroboration (the common case):** the caption-demotion already KEPT the correct keyword value. If R's
   flagged-field read AGREES (`_cmp_norm`) with that kept keyword value → two independent methods agree on the
   straightened page → the disagreement was a skew artifact → **CLEAR the field's note** (picker gone). Oracle:
   for the caption_bleed class, clearing is legitimate because rotation mechanically removes the cause AND the
   field-scoped nature means no sibling was touched.
4. **Fill (rarer):** if the field had NO clean keyword incumbent and R reads a clean name → adopt R's value
   **review-bound** (`min(conf,69)` + corrected_to + note), never silently.
5. **Keep raw on any doubt:** R empty / R disagrees / R garbled / R not kin → keep O, stay flagged. RAW is the
   privileged default. This is what keeps docket_12 correct: its raw read is clean → not flagged → the trigger
   never fires → deskew never runs. If it somehow ran, R("ae Cafe Co"@78) disagrees with the kept value → keep raw.

### Oracle conditions to carry over (from the whole-doc vet — the safe subset that still applies)
- **A7 / note stamp:** any flag-clear or adopt must go through a PERSISTED `validation_note` mechanism (the
  `_flag_type_ambiguity` pattern, engine.py ~3374), NOT a bare `_needs_review` set (dead-set trap: the pipeline
  reassigns `needs_review`, and `trust.isAutoFileEligible` gates on the persisted note). For slice 1, a
  corroborated flag-clear that lets the doc auto-file is acceptable ONLY for the caption_bleed name class (not
  a filing-critical field); if unsure, keep it review-bound.
- **Own `field_defs` copy** for the second pass (process_docs.py ~682 mutates `active_fields['type']` in place).
- **Provenance gate** (born-digital → skip), reuse `_page_ok`.
- Verify `engine.extract` re-entrancy: reset all per-file state or use a FRESH engine for the deskew pass
  (gary — `_field_candidates` resets at engine.py:1805; confirm nothing else persists).
- **Frame coherence:** if an adopted value / cleared field's candidate boxes are in the DESKEWED frame, carry
  `read_geometry=deskewed, angle` so the Review display straightens to match (else the ⑂ boxes draw off).

### Build order
- **Slice 0 (pre-req, byte-identical):** factor the per-file body (`process_docs.py` ~446-812) into
  `_extract_document(filepath, deskew_pages, deskew_min_angle) -> result`; give it its own field_defs copy.
  Gate: corpus M=0 + full per-field parity with the feature OFF.
- **Slice 1:** the trigger + deskew re-read + field-local corroborate/adopt above. Kill switch
  `deskew_retry_ambiguous_enabled` / env `DESKEW_RETRY_AMBIGUOUS=0` (default on). Reuse the `_maybe_gate_reread`
  injection pattern (`_i2d`/`_read_region`/`_page_ok`) on the DESKEWED pages with a NAME adopt gate
  (name_quality + agreement with keyword) instead of the format `is_adoptable`.
- **Slice 2 (separate):** retire Straighten-all's FORCED read — make the toggle display-only (region.py
  `--deskew` for ⊕-box alignment is legit; keep) OR route its stored read through the same keep-the-better
  check so it can never store worse-than-raw. This is the WRONG-LAYER fix Oracle named for the docket_12
  Straighten-all harm. Reprocess-only → never auto-files → not a ship-blocker; but it actively degrades
  taught-box fields while ON.

### Verification gate
- `stress_test/realdoc_regression` M=0 + zero per-field drop, feature ON vs OFF on the SAME live DB (inertness).
- customer_name is NOT corpus-scored → M=0 proves INERTNESS, not correctness. Correctness = the E2E pair:
  **docket_12 keeps raw "Larch & Hollow Cafe Co"@87** (a rigid `anchor_crop` field, raw-clean, must NEVER be
  replaced by a lower-conf straightened garble — pin it) and **Kingfisher clears its flag / adopts the clean
  straightened read** with the picker gone. Use `DESKEW=1` in `stress_test/_trace_docs.js` to reproduce a
  deskew-only straddle.
- Unit pins (each must fail on its bug): keep-raw when the deskew read disagrees/garbles (docket_12 direction);
  clear-flag when it corroborates (Kingfisher); no-retry when detect_skew→0; born-digital skip; kill switch;
  the A7 persisted-note-blocks-auto-file pin; and "no feature path yields status auto-filed" unless corroborated.

### Method pre-signal (oscar, cost optimisation — predictor only, not a decider)
The flagged field's `method` predicts direction: rigid `anchor_crop` / template-absolute → favour RAW (skip or
weight-raw); label-relative (`anchor_crop_relocated`/`anchor_inline`/`keyword`) + `caption_bleed` → favour
straighten. Use it to decide WHETHER to spend the re-OCR + WHICH clean fields to watch; still read-and-compare.

## Advisor trail
oscar (OCR/adopt test) + gary (pipeline/Option-B seam) designed; Oracle SIGN OFF WITH CONDITIONS on the seam,
SEND BACK on whole-doc adopt (the 3 holes), recommended this field-scoped shape. See the task transcripts
2026-07-14. Related: the caption-band-exclusion fix (committed 6f60276, merged PR #10) is the upstream that
makes the deskewed relocate read clean.
