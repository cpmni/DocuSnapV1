# Confusable RELEASE (paddle-agree → clear the soften note → auto-file) — the seams to close BEFORE building it

Date 2026-09-23 (evening). Status: **BUILT DARK the same night — `glyph_confusable_release`, mig 211** (gary design →
Oracle SIGN-OFF-W/COND C0-C11, `docs/oracle_log.md`). The DOWNGRADE leg (`glyph_confusable_resolve`, mig 210) is
built DARK too. This note records, at source, every downstream arm that re-judges a ref whose soften note the
RELEASE cleared, and how the build answered each seam:
- Seam 1 (G1): the release ABSTAINS on a veto-fallthrough doc (`veto_fallthrough`) — the confident DOWNGRADE copy
  beats G1's "couldn't be confirmed" note; the G1 predicate is pinned to refuse the released shape anyway.
- Seam 2 (Fix A): OFF in production (corrected below) — an `anchor_inline` release goes straight to eligible; the
  census's own geometry, kept in slice 1 (Oracle Q4).
- Seam 2b: population bounded to mapped-template docs (`_s05_pages`); accepted for slice 1 (Oracle Q5).
- Seam 3/3b: the fc −12 and the boost lift a released doc — a NAMED precondition (`role_disagree_refuse_at100`) and
  a flip-census classification (a)/(b)/(c), not a code change.
- Seam 4: the ambiguous flag is RE-INVOKED inside the release path (Oracle C5) — never by reordering.
- Seam 5: the release keys on a producer TAG (`self._soften_meta`, confusable-soften only, map-pair page form).
- Seam 6 (clip): a SECOND PP read on a 1.0×h-wide crop must still contain the value (boundary-guarded) AND the
  weakest glyph on the narrow read must clear 0.80 — the one both-wrong clipped read scored 0.505.
- NEW (Oracle P1, verified at source): trust.js `_pageFamilyDisagrees` would hold most of the cold soften set anyway
  (the whole-page `S0-` read is a recorded keyword-family disagreement; only the mig-191 suppression lifts it, for a
  taught on-shape winner) → the release runs the SAME rule in-engine (`_glyph_release_page_family_disagrees`, parity-
  pinned against trust.js with shared fixtures) and abstains where trust.js would hold. C0 targeted run on the owner's
  DB copy: the Chris exhibit #45 `PO-22954` is category (ii) — held ONLY by the note (overall 81 = −12 fc penalty).

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

## Seam 2 — Fix A inline-harvest absence hold (`engine.py` ~:12757, `INLINE_HARVEST_ABSENCE_HOLD`) — **OFF in production**
- ⚠ CORRECTED 2026-09-23 (gary F4, verified at source): `INLINE_HARVEST_ABSENCE_HOLD = os.environ.get(…, '0') != '0'`
  (engine.py:612) — default **OFF**, and NOT mirrored anywhere in `src/` (so `RR_APP_ENV=1` is OFF too; the
  2026-07-26 evening handover reverted it to '0'). The first draft of this note said "default ON" — WRONG.
- So the general-doc twin of G1 does NOT re-judge a released `anchor_inline` ref: after the RELEASE pops the note, an
  `anchor_inline` winner goes STRAIGHT to eligible (subject to every other gate). There is no "safe by re-note" for that
  method — the census (whose crops are word-geometry boxes, i.e. the `anchor_inline` shape) is the evidence for it.
- Consequence for the design: a method-scoped RELEASE (`anchor_inline` only) would be the census's own geometry but is
  the first thing a future dev widens; gary recommends one universal path with the clip guard instead (Seam 6).

## Seam 2b — `_s05_pages` is set ONLY on a mapped-template doc (gary F3, verified: engine.py:9245 reset, :9599 assign
inside `if tmpl_mappings and page_images` :9514)
- The hold, the DOWNGRADE and the RELEASE all abstain `no_box` when `_s05_pages` is None — i.e. on any doc NOT matched to
  a template with enabled mappings, even when `_field_read_geom` holds the anchor box. The population is therefore
  bounded to taught/mapped suppliers (the graduated class the owner auto-files). D5's 40/40 on Print Tracker is
  consistent (it has a template with mappings). Widening to `crop_pages` unconditionally would widen the mig-207 HOLD
  too → its own census (gary Q5, slice 2).

## Seam 3b — the format-consistency penalty (gary F6, verified: validator.py:1023-1042)
- `format_consistency_delta` counts a VALUED field WITH a note as a MISMATCH → −12 for the first mismatch (cap −25);
  with no mismatch and ≥3 valued + ≥2 supported fields → +3 per supported field (cap +10). So clearing the note moves
  the overall by TWO routes — the −12 disappears (and up to +10 appears) BEFORE the per-field boost's delta/n. The flip
  census must classify every new file: (a) already ≥ floor OFF-arm, (b) crosses via the fc lift (what any clean doc
  gets), (c) crosses ONLY via the per-field boost — report (c) separately.

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
