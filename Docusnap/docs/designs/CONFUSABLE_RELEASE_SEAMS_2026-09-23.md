# Confusable RELEASE (paddle-agree → clear the soften note → auto-file) — the seams to close BEFORE building it

Date 2026-09-23 (evening). Status: **NOT BUILT.** The DOWNGRADE leg (`glyph_confusable_resolve`, mig 210) IS built
DARK. This note records, at source, every downstream arm that would re-judge a ref whose soften note the RELEASE
cleared — so the future build (and its Oracle re-vet with R1-R6 restated verbatim) starts from verified facts, not
the summary in `HANDOVER_2026-09-23_EVENING.md`.

## Where the RELEASE would sit
`engine.py` `_glyph_disagreement_hold` (called at ~:12151), inside the `_resolve` branch on PP AGREE. Today (DOWNGRADE)
it re-words the note; the RELEASE would instead `data.pop('validation_note')`. Everything AFTER :12151 in `extract()`
then sees an UN-NOTED ref for the first time.

## Seam 1 — G1 veto-fallthrough re-note (`engine.py` ~:12731) — the Oracle's R4
- Fires only on a doc whose template match arrived via the identity-veto FALL-THROUGH (`self._veto_fallthrough`).
- For each critical field WITHOUT a note: held with "This reference couldn't be confirmed anywhere else on the page"
  unless `_fallthrough_critical_corroborated(winner, cands, ocr_text, is_date)` (:2450) is True:
  (i) a DIFFERENT-method-family rail candidate normalise-equal to the winner, OR
  (ii) `_page_presence_corroborated(wv, ocr_text)` (:2430) — the alnum core, separator-tolerant, BOUNDARY-GUARDED.
- **For the soften set both legs FAIL by construction:** the soften fires only when the crop value is page-ABSENT as a
  whole token and the page's nearest token differs by one glyph → (ii) is False (the core differs in one char);
  (i) is False because the other family (keyword/full-page) read the `_near` form, not the winner.
- **Consequence:** on a fall-through doc the RELEASE clears the soften note and G1 immediately re-notes → still HELD
  (fail-toward-review, RELEASE inert there). NOT a safety hole — but the two branches must be PINNED: (a) fall-through
  doc → note cleared then G1 re-noted → `_needs_review`; (b) non-fall-through doc → note stays cleared → eligible.

## Seam 2 — Fix A inline-harvest absence hold (`engine.py` ~:12757, `INLINE_HARVEST_ABSENCE_HOLD`, default ON)
- The general-doc twin of G1: for a critical winner with method EXACTLY `anchor_inline` and no note,
  `_inline_absence_should_hold` (:3048) = `not _fallthrough_critical_corroborated(...)` → SAME predicate → for the
  soften set → True → re-notes "read from the page layout but couldn't …".
- **Consequence:** the RELEASE is inert for every `anchor_inline` winner (Print Tracker's refs are largely
  `anchor_inline` / `anchor_crop` / `anchor_crop_relocated` — see the 2026-09-23 diag). Design choice for the re-vet:
  (A) accept (RELEASE helps mapping / anchor_crop / anchor_crop_relocated winners only), or (B) let Fix A treat a
  PP-confident-agree as corroboration — which is exactly the "PP as a witness" door Oracle C1 closed. Recommend (A),
  pinned: an `anchor_inline` soften-set ref RELEASED then re-held by Fix A.

## Seam 3 — the learned-agreement boost (`engine.py` ~:12153) skips NOTED fields
- A DOWNGRADED ref stays noted → boost skipped → byte-identical (pinned by the mig-210 test's conf==90 asserts).
- A RELEASED ref becomes boost-eligible → its confidence may RISE toward the auto-file floor. Intended (that is the
  auto-file path), but it is a second behaviour change riding the note clear; the flip census must count docs whose
  overall crosses the floor ONLY because of the boost.

## Seam 4 — `_flag_ref_confusable_ambiguous` (:12145) already PASSED the field
- It runs BEFORE the glyph hold and skips a noted field. On the soften set it never judged the ref (the soften note was
  already there). After a RELEASE it does not re-run. So a class-outlier confusable that the ambiguous flag WOULD have
  held (had there been no soften) auto-files on Tesseract+PP agreement. That IS the RELEASE's purpose (the dual-reader
  census is the evidence that agreement is reliable) — but say so in the design; do not let the re-vet discover it.

## Seam 5 — producer discipline (Oracle R5): ONE note text, THREE producers
- `_FILING_SANITY_SOFTEN_NOTE` is written by the corrob-soften (:7985, ≥2 live families + confirmed literal), the
  history-soften (:8015, confirmed literal + backed glyph) and the confusable-soften (:8045, NO history, NO witness —
  PP would be its ONLY independent axis). The DOWNGRADE keys on the note TEXT and so treats all three alike (fine — it
  changes wording only). The RELEASE must state that it releases all three; the two history-backed producers carry
  MORE evidence than the confusable-soften, so releasing them is not looser — but the census population is defined by
  the confusable-soften trigger, so the flip gate covers exactly the weakest producer.

## Seam 6 — a CLIPPED crop can make BOTH readers wrong (found by the census's synthetic clip arm, 2026-09-23)
- `RESULT_ABSENT_20260923.md`: 18 soften slices left-shaved by ~55% of one glyph → 7 both-agree, 6 on the true value,
  **1 both WRONG** (`SO-82482` → `30-82482` by Tesseract AND PP). Same pixels, same loss — the exact shape Oracle R6
  feared for the `_absent` population (enriched for clipped taught boxes).
- Today it cannot reach the RELEASE (`S`↔`3` is not a `_CONFUSE_TO_DIGIT` pair → no soften → the ABSENT note holds),
  and every in-map pair (`S`↔`5`, `O`↔`0`, `I`↔`1`) resolved correctly under the clip (PP read `SO-` where Tesseract
  read `50-`/`$0-` → disagree → held). But the map is one edit away from admitting a pair PP shares.
- **Design requirement for the RELEASE:** a flush-edge guard — abstain (keep the note) when the value's first or last
  glyph box touches the crop edge (the mapper already knows the located box; `_crop_padded` adds the quiet zone, so a
  glyph on the padded edge means the box clipped it). Alternative: scope the RELEASE to the two history-backed
  producers (Seam 5) and leave the witness-less confusable-soften on the DOWNGRADE. Oracle's call at the re-vet.

## What the DOWNGRADE build already fixed for the RELEASE
- The exact-text "sole note" match (`_note0 == _FILING_SANITY_SOFTEN_NOTE.format(committed)`) fails closed when a
  later resolver changed the value — the RELEASE inherits it.
- D5 is answered: the paddle AGREE branch fires on real anchor reads (40/40 `glyph_check` AGREE, 0 `no_box`, on the
  owner's 2026-09-23 Print Tracker diag `Debug/diagnostic_2026-09-23T10-30-18-458Z.jsonl`).

## Flip gate (unchanged from the Oracle's R6)
`census_absent.py` over the prior dual-reader run: the SOFTEN set, pixel-adjudicated; common-mode (crop WRONG AND PP
agreed) must be 0. Results: `Desktop\TEMPTEST_dual_reader_absent\SUMMARY_ABSENT.md` + contact sheets.
