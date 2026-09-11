# Ref arbiter — page-absent clip: upstream heal + reinstatement fallback (design, 2026-09-11)

> **STATUS: Arc B BUILT DARK (Oracle SIGN OFF WITH CONDITIONS B1-B5, folded in; seed OFF; flip owner-gated,
> census owed). Arc A SEND BACK — parked, measure first (see the Oracle verdict at the bottom).** Owner
> exhibit (Ridgeway Plant Hire Worksheet, live): page prints "Reference No. **WS-73673**";
> committed `reference_number` = **VS-72672** (`template_mapping`, Stage 0.5, @90) — WRONG (W→V clip + digit
> noise); Gate C fired "doesn't appear on this page" → HELD (not auto-filed) but the correct on-page keyword
> read `WS-73673` (@85) was discarded. Advisors: 007 (crop/precedence forensic), reggie (predicate), gary
> (merge/fact-check/census). Log: `docs/oracle_log.md`.

## Root cause (two layers)
- **UPSTREAM (PRIMARY) — a Stage-0.5 crop CLIP, never edge-checked (007).** `template_mapper._extract_one`
  reads the taught box FRESH (`_crop_and_ocr`, template_mapper.py:2784; committed plain `template_mapping`@90,
  :2993 — no healer/relocate ran; MEMORY ruled out — VS-72672 was never confirmed). The box is on the right
  value (debug crop shows the right digits) but its **frozen normalised left edge lands right of the W** on
  this wider/skewed sibling → severs the W's left stroke → reads **V** (the letter-twin of the documented
  `DN↔YN` edge-clip class, template_mapper.py:892-900); digit read-noise (73673→72672) on the tight low-res
  crop on top. **Why edge-checking missed it:** `edge_contact`/`_crop_edge_contact` is an **anchor.py (Stage-2)
  debris-strip signal, NEVER computed for a Stage-0.5 template_mapping crop** (zero hits in template_mapper.py);
  every Stage-0.5 clip-healer is DARK (read-widen mig141, pad-window, edge-clip-heal mig151, taught-corrob
  mig153); the synthetic quiet-zone can't recover clipped-out ink (template_mapper.py:823); the one live
  cross-check (`_inline_code_reconcile`) declined on a caption-locate miss; and `VS-72672` is **shape-valid**
  (`reference_code`) AND folds to the same skeleton as `WS-73673`, so every shape-gated backstop is blind.
- **DOWNSTREAM (FALLBACK) — the arbiter never reselects (reggie+gary).** The merge protects a Stage-0.5
  `_is_stage05_located` winner by AUTHORITY, not confidence (engine.py:9532; the "90 vs 85" is a renderer
  artefact — a keyword@99 would still lose); `_override_eligible` (:3781) refuses to reconsider it. Gate C
  (`_flag_filing_value_sanity`, :7424/:7478) computes page-absence and, in the absent branch (:7590), only
  writes a `validation_note` — "**Flag-only — never edits or replaces a value**" (:11544). The correct keyword
  read is retained in `_field_candidates` (`_remember_candidates` :3765) but every downstream pass skips a
  noted field, so the wrong off-page value is frozen as emitted and the on-page candidate discarded.

## Fact-check — genuinely UNCOVERED (gary)
- `_crosscheck_corroborated_alternative` (engine.py:2357): guard `winner.method=='anchor_crop_crosscheck'` +
  needs ≥2 families → does not apply (ours is `template_mapping`, single keyword family).
- mig-153 `template_taught_corrob_adopt`: trigger is a `_padcodeflag` + `_pad_witness` + ≥2-family corrob →
  does not apply (page-absence, single family), even flipped ON.
- resolve_ref (mig 113/115): single-glyph near-miss of a confirmed literal + skips a noted field + suggest-only
  → does not apply (multi-glyph, fresh value, Gate C already noted).
- **New arc required. But it FOLDS into the mig-153 adopt machinery** (same guardrails — `_uv_restore_demotion`,
  review-bound cap <88, `_corrobadopt` suffix), re-triggered by Gate-C absence.

## Arc A (PRIMARY, upstream) — Stage-0.5 clip heal on page-absence
Arm/extend the edge-clip family (mig 151 `_EDGE_CLIP_HEAL` + its dep `_PAD_WINDOW_CODE`) so a Stage-0.5 taught
CODE/ref read that Gate C would find **page-absent** is re-read from a **real padded row-bounded window** of
neighbouring page pixels (psm6) and, if the wider read is **placement-certified** (`_snap_union_witness`
un-cut-edge anchor + slot-fill — judged by PLACEMENT, not shape/OCR-conf, so it sees a letter-fold-invisible
W→V) AND the recovered value is on-page + shape-valid, ADOPT it. 007's creed: **remove the misalignment, don't
compensate** — if the crop reads `WS-73673`, mapping+keyword agree, Gate C passes, it auto-files correctly and
Arc B never triggers. **007 measurements to settle first (pixel-proof the clip):** (1) stored box-left-x vs the
W ink-left-x on this doc (or teach-sample width vs this doc's width); (2) a wider row-bounded re-read recovers
`WS` ⇒ clip; (3) **verify `reference_number`'s DB type is `reference_code`/`alphanumeric`** — if not, the whole
code cross-check family never applies (a larger gap). The current edge-clip-heal trigger is "shape-invalid
tight read"; A widens it to "**page-absent committed token**".

## Arc B (FALLBACK, downstream) — Gate-C page-absence reinstatement (new, mig 160)
For the residual case where the crop genuinely can't recover (ink clipped out) but an independent on-page family
read it right. A new review-bound pass `_reinstate_page_absent_ref` after `_flag_filing_value_sanity`
(engine.py:11550), gated `filing_sanity_ref_reinstate` (env `FILING_SANITY_REF_REINSTATE`), HARD dep
`filing_value_sanity_flags` ON (a customer default). Pure predicate `_should_reinstate_ref(winner, cands,
fmt_entry, ocr_text)` — reinstate value C iff (ALL):
- winner is `_is_stage05_located` AND not a user literal (exclude override/template_fixed/manual/operator_pin/
  keyword_override, the :7245 set);
- winner is page-ABSENT (we only run when the ref field carries `_FILING_SANITY_ABSENT_MARK`);
- scope has a learned ref shape (`format_class_index[(sup,slug,ref)].shapes`); else None (cold-start inert);
- among ledger candidates: non-empty, **disagrees** with winner, `not noted`, conf ≥ 60, distinct stage,
  **on-page** (`_page_presence_corroborated`, :2280 — the same whole-token test that condemned the winner),
  **exact learned shape** (`shape_match_score == 1.0`), **dominant confirmed prefix** (`code_prefix == dom`),
  not another field's committed value, clip-guarded (not a sepless-substring of a longer same-line token);
- **neighbour-bleed guard** (mig-153 C1 analogue; keyword `box=None` so no positional guard → bound by
  edit-distance-to-winner: same length + same folded shape + differing positions ≤ `_REINSTATE_MAX_SUBS`=3 —
  needs a letters+digits variant of `digit_substitution_diff`, which returns −1 on the V→W letter diff);
- **exactly ONE** distinct qualifying value (else None — fail-toward-review).
On a hit: swap value/display to C, method → C's (honest provenance), **cap conf ≤69**, REPLACE the ABSENT note
with a truthful reinstate note ending `_FILING_SANITY_SOFTEN_MARK` (names both forms), trace
`ref_reinstate_page_present`, NO `was_corrected`/`corrections` row. Miss ⇒ byte-identical.

## The seam (A ↔ B and downstream)
- **A runs at Stage 0.5 (fixes the READ); B runs at Gate C (fallback).** If A adopts the on-page value, Gate C
  passes → B's ABSENT trigger never fires. They compose; A-first is load-bearing (007: shipping B alone leaves
  the clipped read committed wherever no keyword family fires).
- **B relies on:** the retained keyword candidate (`_field_candidates`), Gate C's absence verdict
  (`filing_value_sanity_flags` + ideally `page_match_v2`, both customer defaults), a learned ref `shapes` entry.
- **B replaces the `_FILING_SANITY_ABSENT_MARK` note** — SAFE post-reinstate: the value is now on-page so
  `_neitherOnPage` ("draw the box again") rightly stops firing; the hold survives (the lane-hold keys on note
  PRESENCE + value equality, composeNote.js:15/35/61 / handler.js:1663, not the ABSENT text). Ref is a ROLE
  field → the reinstate note blocks auto-file unconditionally (mig-142 can't soft-clear a role note) + ≤69 cap.
- **Invariant preserved:** "manual/authoritative anchors win on TYPE alone, not shape-vetoed" — B acts ONLY on
  page-absence (a taught box reading a value not printed on the page is the exact Gate-C defect), never on
  shape alone, and excludes user literals. Same doctrine as `_reconcile_blind_geometry` (:6666).

## Plumbing
- **Arc A:** flip/extend the existing mig-151 `template_edge_clip_heal` (+ dep `template_pad_window_code`) —
  widen its trigger to page-absence; no new migration (existing DARK keys) but its own gate.
- **Arc B:** **mig 160** seeds `filing_sanity_ref_reinstate='false'`; add to `TEST_SWITCH_KEYS` (→ 44);
  `handler.js` env plumbing; per-call env read; byte-identical OFF; SFDEV settings toggle.

## Tests + census (owner-owed at flip)
- **B unit** `test_ref_reinstate_page_absent.py` — reinstate; winner-correct byte-identical; cand dubious/
  not-on-page/ambiguous/user-literal/cold-start → None; OFF byte-identical. Each of the guards proven to FAIL
  with it removed; #1 the regression PIN. **Adversarial fixture** (mig-153 G2(b) precedent): a same-shape
  neighbour code on the page must NOT reinstate.
- **JS pin** `test_scope_trust.js` — a reinstated ref row (note, role field) is not auto-file-eligible + not
  soft-cleared by mig-142.
- **Census** (realdoc 605 + Demo Docs, OFF vs ON, `RR_APP_ENV=1 OCR_RENDER_DPI=200 FILING_VALUE_SANITY_FLAGS=1`):
  report every reselect via the trace, **adjudicate AT THE PIXELS** (corpus GT may rubber-stamp the off-page
  garble — a GT "regression" is likely the pipeline being RIGHT). **Gate: M=0 AND wouldFile(ON)==wouldFile(OFF)**
  (Phase-1 auto-file set identical — every reselected doc was already held and stays held), ref accuracy rises.
- Phase 2 (auto-file the reinstated/healed value) = a separate census-gated slice.

## Oracle verdict (2026-09-11) — SIGN OFF WITH CONDITIONS on B (build DARK) · SEND BACK A
- **Arc A SEND BACK (re-scope + measure).** The exhibit (3 scattered diffs) DEFEATS the existing edge-clip-heal:
  `_clip_contained` (template_mapper.py:2544, `_EDGE_CLIP_MIN_INTACT=3`) needs ≥3 intact un-cut-side glyphs + ≤2
  differing edge glyphs — here 0 intact both edges → arming mig-151 does NOT heal it. A real A must adopt on
  `_snap_union_witness`+whole-token-on-page+shape-valid while BYPASSING `_clip_contained` = a materially bigger
  change to the every-doc Stage-0.5 crop path. A2: gate the A build on 007's 3 pixel measurements as PRECONDITIONS
  (box-left-x vs W-ink; a wider psm6 re-read recovers WS incl. digits; `fields.type` for reference_number ∈
  {alphanumeric,reference_code} else the pad-code family never runs — A dead, B immune). If source-pixel severance
  or a text-typed field → DO-NOTHING on A, B-only. Own design/migration/census when/if pursued.
- **Arc B SIGN OFF WITH CONDITIONS — all built:** B1 use the STRICTER whole-token page test symmetric with Gate C
  (`cv.casefold() in toks`), NOT `_page_presence_corroborated` — DONE. B2 primary guards = dominant-prefix +
  `shape_match_score==1.0` + exactly-one + not-another-field's-value (edit-distance dropped as tuned-to-sample) +
  the adversarial same-shape-neighbour fixture (test_9) — DONE. B3 no corrected_to / no corrections row, method →
  candidate's, cap ≤69 — DONE; the ref-role note seam is pinned by test_scope_trust.js §28 (a ref-role note is
  never auto-file-eligible + never soft-cleared by mig-142). B5 mig 160 seed 'false', TEST_SWITCH_KEYS→44, HARD
  dep filing_value_sanity_flags ON — DONE.
- **B4 (owner-owed at flip):** pin the mig-158 `note_topic_dedup` interaction (the reinstate note is a rank-1
  ref-advisory; merged vs a lane-hold it keeps the doc held + the value reinstated — SAFE, hold keys on note
  PRESENCE + value equality, value set by Python) — a composeNote-level pin. Not a ship-blocker (byte-identical
  while either switch is OFF); land it before the flip.
- **Census (owner-owed at flip):** realdoc 605 + Demo OFF-vs-ON (`RR_APP_ENV=1 OCR_RENDER_DPI=200
  FILING_VALUE_SANITY_FLAGS=1`) → M=0 AND `wouldFile(ON)==wouldFile(OFF)` set-equality, adjudicated AT THE PIXELS
  (corpus GT may rubber-stamp the off-page garble → a "regression" is likely the pipeline being RIGHT), ref
  accuracy rises.

## BUILT (Arc B, DARK, seed OFF)
- `engine.py` — pure `_ref_reinstate_candidate(...)` (B1 whole-token + B2 guards) + method
  `_reinstate_page_absent_ref(...)` (env `FILING_SANITY_REF_REINSTATE`, keyed on `_FILING_SANITY_ABSENT_MARK`,
  called right after Gate C at :11550), + `_FILING_SANITY_REINSTATE_NOTE` constant. Adopt review-bound: value/
  method → candidate, cap ≤69, note replaces ABSENT, no corrected_to, `was_corrected=False`.
- `database/index.js` mig 160 seeds `filing_sanity_ref_reinstate='false'`; `dark_switches.js` (→44);
  `handler.js` env; `test_migration137` @44.
- Tests: `python_backend/tests/test_ref_reinstate_page_absent.py` 15/15 (11 predicate + 4 method; #1 regression
  PIN, #9 adversarial neighbour); `test_scope_trust.js` §28 (seam); mig-137 @44 — all GREEN.

## Open for Oracle
- The A-first ordering + the A↔B seam; is arming mig-151 for the page-absent case the right primary, or does A
  over-reach (page-absence is a broader trigger than shape-invalid)?
- B's neighbour-bleed guard with `box=None` (edit-distance bound instead of a positional guard) — sufficient?
- The `wouldFile(ON)==wouldFile(OFF)` Phase-1 set-equality claim; the note-replacement (ABSENT → reinstate) seam.
- The 007 pixel measurements as a build precondition; the DB-type check on `reference_number`.
- Blast radius: the ref arbiter + the Stage-0.5 crop path feed every doc; fail-toward-review; DARK + census.
