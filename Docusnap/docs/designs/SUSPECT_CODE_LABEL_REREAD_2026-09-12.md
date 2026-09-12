# Suspect-code label re-read — the first-pass, text-led sibling of `_widen_code_read` (2026-09-12)

> **⚠ OUTCOME 2026-09-12: Oracle SEND BACK → DO NOTHING. NOT BUILT. Do not re-attempt without a real exhibit.**
> Both pillars are FALSE at source (verified): (1) `VS-72672` is SHAPE-VALID (`_fold_shape` → `@@-#`, same as
> `WS-73673`; mig-160 log "the shape-valid VS-72672"), so the `shape_match_score != 1.0` trigger never fires on the
> motivating exhibit — the Ridgeway ref is the shape-valid+page-absent LEFT-CLIP class already healed by mig-161 +
> mig-162; the shape-invalid-tilt-garble class the trigger targets has no exhibit in the corpus. (2) The
> safety-by-construction claim is INVERTED: `_relocate_and_read` (:2140) returns `_geometric() or _inline()` — the
> tilt-UNSAFE box re-crop runs FIRST, so on a stacked-code layout it can adopt a shape-valid WRONG-ROW neighbour.
> Full verdict + revival conditions: `docs/oracle_log.md` 2026-09-12. Everything below is the (rejected) design record.

**Status:** REJECTED (Oracle DO NOTHING, 2026-09-12) — was: designed, 007 + reggie converged; NOT built. Owner asked (2026-09-12) to check viability of "position shouldn't matter — straighten,
locate the label, read the value" and formulate a plan; he floated "loosen the ~1.4-line drift threshold" as a
thought. **Viability verdict: the floor-loosen is the WRONG lever (rejected); a suspect-read-triggered label re-read
is viable, in the safe form the codebase already uses for the same-box case.**

## 1. Root cause — a READING failure with CORRECT placement (007)
The Ridgeway exhibit (`reference_number`, page prints `WS-73673`, app commits `VS-72672` @95 + page-absent note)
is NOT a drift/placement problem. A ~1.5° skew leaves the label correctly located (match_score high, box-centre
shift 0.0117, sub-`_DRIFT_FLOOR`), but the **axis-aligned tight crop reads ACROSS the tilted line** — a value box
of width `w` at angle θ spans `w·tanθ` into the neighbouring row (≈30% of a row at θ=1.5°, `w=0.15`). This is a
defect of the reading window's ORIENTATION, independent of WHERE it is seated. The abs rung commits it because it
is gated `shape_mode='ignore'` (template_mapper.py:2885-2893) — a stationary box "can't drift", so learned shape
is not vetoed — and `VS-72672` is TYPE-valid (`reference_code`).

## 2. Why the floor-loosen is rejected (007, FACT)
`_label_drifted` (template_mapper.py:1605-1642) keys on LABEL-CENTRE MOVEMENT; on a tilt the label didn't move, so
the drift test correctly says "not drifted". Lowering `_DRIFT_FLOOR` (0.02) toward one row (~0.013) still wouldn't
catch a 0.0117 shift, re-opens the fuzzy-caption casualties the floor accidentally guards (the "Chester"/0.667 and
"Credit Ref"→"Credit Date" classes, :1647-1650), and — decisively — even if it fired, the relocate's default
`_geometric()` path (:2003-2036) re-crops an AXIS-ALIGNED box → reproduces the same cross-row garble. Moving the
seat cannot fix a reading-window-orientation defect. **Wrong axis.**

## 3. The lever — suspect-read trigger → tilt-robust label read (007 + reggie converged)
Key: `_relocate_and_read` (:1976) has TWO paths — `_inline()` (:2085) harvests the value from the label's own
Tesseract-grouped LINE WORDS (tilt-robust to ~2-3°, no re-crop) and `_geometric()` (axis-aligned re-crop,
tilt-UNSAFE). The fix routes to the tilt-robust read and lets the safety gate reject the unsafe one automatically.

- **Trigger (reggie — REUSE, don't invent):** `_abs_code_read_suspect(abs_text, val_type, field_key, format_lookup)`
  = `val_type in _CODE_CROSSCHECK_TYPES` (codes/refs only) AND the scope's format entry has confirmed `shapes` AND
  `shape_match_score(abs_text, entry) != 1.0` AND NOT `value_is_confirmed_literal(abs_text, entry)`. This is the
  EXACT gate `_widen_code_read` (:2707-2709) / `_grow_code_left_read` (:2472-2475) already trust, plus the
  confirmed-literal carve-out `FORMAT_VARIANCE_RELAX_REF` uses (:1495). **Do NOT OR-in low confidence** (the
  Ridgeway garble reads @95 — confidence is a poor suspect signal). **Do NOT extend to date/currency**
  (self-validating; a skew date is mig-162's job, a wrong-row money value is `template_drift_row_pitch`'s).
- **Action (one site, :2901, after the same-box `_widen_code_read` returns None):** one guarded
  `_relocate_and_read` off the located label. Require the label credible: taught-exact OR
  `match_score ≥ _DRIFT_OVERRIDE_MATCH_FLOOR` (0.8, :84). **Adopt ONLY IF** the recovered value is shape-EXACT
  (`shape_match_score(result, entry) == 1.0`, mirroring :2717) AND page-present (a whole token in `_gatec_tokens`,
  the C2 witness :2447/:2490). Else the absolute read STANDS, byte-identical.
- **Why this is safe by construction (the convergence):** the shape-exact + page-present exit AUTOMATICALLY
  selects the `_inline()` recovery (which reads cleanly on a tilt) and REFUSES the `_geometric()` re-crop (which
  reproduces the garble → not shape-exact → refused). It can never swap one suspect for another (the two-ended
  garble `IN-64470`↔`DN-64472` stays a FLAG, never an adopt). A correct-but-unusual confirmed value can't trigger a
  needless relocate (carve-out), and even if it did, the relocate reads the SAME value → shape-miss vs itself →
  refused → abs stands. **It can only ever swap a shape-INVALID read for a shape-VALID, page-present one.**

## 4. Two layout classes (007)
- **INLINE (label + value share the line): FIRST-PASS-SAFE.** `_inline()` reads the tilted line's grouped words;
  this arc heals it on the first pass, no straighten. This is where the owner's principle holds directly.
- **LABEL-ABOVE (value a row+ below): NOT tilt-robust.** `_inline()` refuses (`_INLINE_ROW_OVERLAP_ON`, :2099);
  `_geometric()` garbles + mis-seats by ≈θ·dx. The shape-exact gate REFUSES it here → falls through to the EXISTING
  review-bound whole-page straighten-retry (mig 162/163). Complementary — do NOT duplicate; this arc is the
  first-pass text-led complement for the inline class only.

## 5. Outcome tier
Phase 1 — **REVIEW-BOUND**: adopt the recovered value with a lane-hold note ("read from the label after the box
looked wrong — confirm once"), out of every `CLEARABLE_NOTE_MARKS`/class-F set (the mig 162/163 pattern). Phase 2 —
**auto-file** (shape-exact + page-present + note-free) is defensible (the page-present witness is the safety) but
census-gated. **A page-absent→present transition always stays HELD** (never silently auto-filed — 007 Q4.3).

## 6. Guards — keep four, add the match-floor to the suspect path (reggie: the one necessary addition)
mig-157's match-floor lives INSIDE the `if _label_drifted(...)` branch (:2961-2965); a suspect trigger fires when
`_label_drifted` is FALSE, a path mig 157 does not cover — so the suspect path MUST re-apply
`_DRIFT_OVERRIDE_MATCH_FLOOR` itself. KEEP: caption-band-reject/`RELOCATE_CAPTION_EXCLUDE`; the exact-score
proximity tie-break; the `_target_inline_with_anchor` layout guard. Objective trigger only (shape/page-absent, not
confidence). No `_method` suffix (corrupts the corroboration bucket — pop provenance on a `_`-key). No new
validation pattern, no renderer twin → JS↔Python stay aligned by construction.

## 7. Seam (both)
- **mig-157 C1 (pin):** on refusal DO NOT set `anchor_stable=True` — leave it False so the registration arbiter
  stays live (:2957-2959). The mig-157 send-back was caused by exactly this fall-through.
- **Precedence (Oracle condition):** placing the heal at :2901 short-circuits the drift/registration path — allowed
  ONLY because it fires just on shape-invalid codes adopting shape-exact + witnessed. Confirm it never pre-empts a
  genuinely-drifted page's full-res `_geometric` path.
- **Prior art:** `_abs_edge_guard` (:636/:692) is already a gate-outcome-independent, read-quality-triggered re-seat
  via `_relocate_and_read`, but scoped to horizontal edge clips with an axis-aligned re-crop (tilt-unsafe). This is a
  NEW trigger for the same primitive, routed to the inline read — smallest-correct extension of a shipped family.

## 8. Census / flip gate (owner-owed before any customer default)
DARK switch, `TEST_SWITCH_KEYS`+1, `== "1"` env, byte-identical OFF. Gate: realdoc **M=0 on the 605** + zero
per-field drop + `wouldFile(ON)==wouldFile(OFF)` set-equality (Phase 1). **Tilt-stratified** (heals the tilt subset,
byte-identical on the level subset). **Casualty regression (must REFUSE):** Vellum & Crane #243 (Chester/0.667),
the Nordwind totals class, "Credit Ref"→"Credit Date", the "Beaumont" whole-line garble. Page-absent→present
transitions all HELD (instrument + pin). `_DRIFT_FLOOR` unchanged (pin against the naive fix). Cold-start scope
OFF==ON. Live Ridgeway #358: OFF `VS-72672` → ON `WS-73673` OR refused-to-review — reported honestly (heal vs
refuse; a rigid relocate that reproduces the garble is a refuse, not a bug).

## 9. Relationship to the shipped/dark work
Complements mig 162/163 (whole-page straighten-retry, review-bound): this catches the INLINE class on the FIRST pass
with no straighten, reducing reliance on the retry; the LABEL-ABOVE class still routes to the retry. Does not touch
`template_drift_row_pitch` (uniform row moves) or the pad-window reads (clipped crops) — a distinct, additive lever.
