# Keyword-superstring grow — "extend the mapped read until it corroborates the keyword" (2026-09-08)

Owner ask (Review screenshot, Ridgeway Plant Hire delivery docket): *"When the keyword has pulled a longer read than the mapping,
can we extend the mapped/anchored read to see if it eventually corroborates with the keyworded value?"*
Advisors: 007 (geometry, pixel replay), gary (engineering + tests), Oracle (vet — §6). Status: **SPEC, not built.**

## 1. The exhibit (live doc 14, fresh install, mig 137, 200 DPI; template 1 taught on a sibling whose customer was "Halcyon Leisure Group")
"Deliver To" block of four lines: `Willowbrook Nurseries` / `Greenacres, Mill Lane` / `Taunton` / `TA1 4QN`.
- `customer_name`: the taught Stage-0.5 mapping box read **`Willowbrook Nurserie:`** @90 (`template_mapping`, label "Deliver To") and WON;
  the keyword lane read **`Willowbrook Nurseries`** @78 (`keyword_override`) and LOST on confidence; anchor lane skipped (no anchors
  learned); the validator's label-guard (`validator.py:535`) then capped the winner to 35 for the trailing colon. The box's right edge
  clips the final `s`; the sliver OCRs as `:`.
- Sibling exhibit (same doc): `delivery_number` rigid taught box `JN-72756` vs label-anchored inline `DN-78756` (adopted, flagged ≤70,
  shape-warn) vs keyword `DN-78756` @93 — the class-G softener (`inline_disagree_corrob_soften`) is DARK after mig 137; two glyphs differ
  (substitution, not a superstring) → **a separate item, not this arc** (owners: `_pick_fuller_code` + class G + mig-133 left slack).

## 2. Facts established (traced / measured 2026-09-08)
- **F1 (007, pixel replay on the STORED box):** `_find_edge_cut_words` (`template_mapper.py:3154`) returns `right_cut='Nurseries'`
  (overhang ≈17 px = 1.4 glyphs vs floor 0.0045) — the overhang floor is NOT the blocker; comparator + page-present witness pass; a grown
  re-read yields `Willowbrook Nurseries` @94. The grown re-read's ROW PICK fails: the stored box is 0.0157 tall on a 0.0097 line (the
  teach snap pads 0.15·h per side, `src/windows/shared/boxSnap.js:98`); the free-text preview fast path (`anchor.py:3360
  _noise_smooth_retry`) adds 0.5·h headroom and picks the best-confidence segment across PSM 6/7 (`:3418-3426`) — confidence-picked, not
  band-picked → `Greenacres. Mill Lane` @95.7 → comparator token-count 3≠2 → silent `name_declined`. An R8-style padded PSM-6 read with
  an in-band line pick returns the right name even UNGROWN; the in-band chooser exists only for structured types (`ANCHOR_LINE_SELECT`,
  `anchor.py:3449`, OFF).
- **F2 (in-app replay, `stress_test/trace_one_doc.js 14` with the app's env builders + `NAMEGROW_CENSUS_DIR`):** NO name-grow census line.
  The guard cut-tests `read_box = _expand_box(target_box, expansion)` when the abs read succeeded (`template_mapper.py:3365-3369`) — the
  EXPANDED read box, not the stored box 007 measured — so in-app the word no longer overhangs, `_find_edge_cut_words` finds no cut and the
  leg returns `None` silently. The existing `TEMPLATE_NAME_EDGE_GROW` (ON on the owner's DB, in `ALL_ON_DEFAULTS_93`) is structurally
  blind on this road. (An earlier replay of mine wrote nothing for a different reason — a POSIX census path Python could not open.)
- **F3 (007, the class):** all 21 Ridgeway dockets ran post-teach; the box width equals the SAMPLE's value. 7 siblings clipped
  (`Kinofisher Print Studic`, `Corvus Security Servic`, `Aldermoor Engineerir`, `Larch & Hollow Cafe C/Cc/(`), 13 fell to keyword @80.
  **Two clipped names AUTO-FILED today** — doc 21 (`auto_threshold`, `Aldermoor Engineerir` @77, overall 93) and doc 19 (`auto_reprocess`).
  `customer_name` is non-role, so the 88 critical floor never applies; only a `validation_note` blocks (`trust.js:~1047`). Doc 8's `(`
  confirm is a rubber-stamp (poisoned GT). The class = "value wider than the taught sample" (`ANCHOR_VALUE_RIGHT_GROW`'s class,
  `anchor.py:4278`) — a LIVE silent wrong-metadata auto-file on optional name fields.
- **F4 (gary, structure):** Stage 0.5 (`engine.py:8434`) runs before Stage 1 (`:8842`) — the mapper never sees the keyword read; the keyword
  payload carries NO geometry (`keyword.py:1553-1560`); a regrown read is `mapping` family (`_crosscheck_witness_bucket :2276`) and
  `name_unclip_reconcile` excludes mapping (`:7343`), refuses any noted field (`:7328`) and needs keyword AND crop (`:7353`);
  `validator.validate_and_adjust` (`:10391`) precedes the unclip (`:11004`). Available in the engine: `_s05_read_geom[key]`
  (`template_mapper.py:2671`), `_s05_pages` (`:8532`), `_line_cache` (`:8528`).
- **F5 (doctrine):** corroboration = ≥2 independent PAGE families; a box is evidence about WHERE never WHETHER; fail-toward-review;
  DARK + census before any flip (new key = seed-OFF mig 140 + `TEST_SWITCH_KEYS` in `database/dark_switches.js`; the release gate refuses
  a force-ON); note-demoters ride `corrob_note_recompute_fc`; "two owners of one class" refused (Oracle 2026-08-11 C6); name-grow v1: no
  witness may clean-commit a free-text name.

## 3. gary — engineering design (engine pass before Stage 4)
- `_reconcile_name_keyword_regrow(results, field_defs, ocr_text)` at ~`engine.py:10373`, BEFORE `validator.validate_and_adjust` — no note
  exists yet, so it is a VALUE reconcile (not a note-demoter; the linchpin does not apply; `fc_delta` is computed later).
- Scope: `value_quality.is_name_like_field`, not `supplier_name`, type text/multiline_text, single-line, method == `template_mapping`
  EXACTLY (a fired `_namegrow` / `_inline` / `_relocated` is skipped — disjoint owners, C6).
- Trigger: an un-noted `1_keyword` ledger candidate K with `_name_grow_comparator(winner, K, cut_word)` True (reused verbatim — ONE
  comparator for both owners; `_name_norm_token` strips the colon).
- Grow: `template_mapper.regrow_name_read(page, read_geom, lines, last_token_norm, ocr_text_fn)` — the row-band word straddling the
  box's right edge whose norm text strictly startswith the last token, NO overhang floor (the text is the floor), grow to `wx2+0.004`,
  keep the 2× width cap (`:3415`), `_crop_and_ocr(page, grown, 'text', …)` like-for-like, `_gate_value(shape_mode='ignore')`.
- Agreement: `_name_norm_join(grown) == _name_norm_join(K)`. Belts: C3 remnant page-absent, C5 `name_quality` no worse.
- Outcome v1: adopt the grown surface, `confidence = min(conf, 70)`, `validation_note = _NAME_REGROW_NOTE`, marker `name_kw_regrow`;
  census `_name_grow_census(..., 'kw_regrow_<adopt|disagree|nocut|glue>')` (ONE census file for both owners). v1 injects nothing into
  the ledger; v2 injects `template_mapping_regrown` un-noted so `_corrobLicensed` sees two families.
- Switch `template_keyword_superstring_grow` → env `TEMPLATE_KEYWORD_SUPERSTRING_GROW` (`!= '0'`); bridge in `_reconcileEnv`
  (`handler.js:151`); mig 140 seeds `'false'`; add to `TEST_SWITCH_KEYS`. OFF = early return = byte-identical.
- Pins (`python_backend/tests/test_name_keyword_regrow.py`, the `FakePage` mold of `test_template_name_edge_grow.py`): (1) the exhibit with
  `over_r=0.002` (UNDER the mapper floor — proves this pass is not the mapper leg) → adopted ≤70 + note + marker, then
  `validate_and_adjust` → NO label note (the ordering property, executing); (2) grown `Nurseriez` ≠ K → untouched; (3) glue: K
  `Willowbrook Nurseries Ltd` → no fire; (4) `Acme` vs K `Acme Ltd` → no fire (not this arc); (5) left-edge straddle → no fire;
  (6) winner `_namegrow`/`_inline`/`_relocated` → no fire (C6); (7) noted K → no fire; (8) `supplier_name` → no fire; (9) OFF →
  deepcopy-identical + OCR stub call count 0; (10) ORDER pin: call index < `validator.validate_and_adjust(`; (11) TIER pin: winner @95 →
  ≤70 + note; (12) seam: `_reconcile_name_truncation` leaves the adoption untouched; (13) TRADE-OFF pin: same geometry, NO keyword →
  untouched. JS: key ∈ `TEST_SWITCH_KEYS`, mig 140 seeds false, bridge emits `=1` iff `'true'`.
- Corpus: `RR_APP_ENV=1 RR_DB=<db.backup() copy of arm137.db>` OFF vs ON → M=0 + zero ref/date delta (honest limit: realdoc GT is
  ref/date only → proves no-harm, not the heal); the heal gate = the `kw_regrow_adopt` census list eyeballed against renders.
- Effort ~half a day: (1) switch plumbing OFF-inert → (2) `regrow_name_read` + geometry pins → (3) engine pass + pins → (4) census →
  (5) docs.

## 4. 007 — geometry design (Fix 0 row pick + textual trigger + locate-tier stop)
- **Fix 0 (prerequisite, own switch):** in-band ROW PICK for single-line name-like `text` on the Stage-0.5 crop read AND the guard's
  grown re-read — R8 recipe (pad 0.5·h, 20 px border, no upscale, PSM 6 `image_to_data`), group lines, commit the line whose centre lies
  in the TAUGHT box's band (`reslice.pick_in_band_line` discipline); ≥2 in-band lines → abstain.
- **Trigger:** geometric (v1) OR textual — fold F = `_name_norm_join` after dropping trailing `[:;.,|'-]` and empty-core tokens; fire when
  F(M) is a proper token-prefix of F(K), or v1's last-token repair holds against K's last token. Closes v1's recorded gap (a whole last
  word outside the box → no cut word).
- **Stop = the LOCATE tier, never the keyword** (no geometry): walk right through row-band locate words while gap ≤1.5·g (snap-union
  rule 2, `:3245`), the union stays a prefix of F(K), width ≤2× taught (`:3347`), not past the page edge; stop when union == F(K). Band =
  the taught row's WORD height (from the pick), not `max(wh,sh)·0.6` (`:3175`), which would admit the address line on a taller box
  (measured margin 0.0112 vs 0.0094). Multi-column: the 1.5·g contiguity stop (`cluster_value_words`, `:2817`).
- **Agreement:** grown in-band read == F(K) AND the absorbed locate words reconstruct F(K)'s tail (no short-token skip). Both.
- **Seam:** relies on the locate tier (else inert), K's column split, the taught row band. Weakens: the floor's nick protection (mitigated:
  whole locate WORDS must reconstruct K's tail); v1's last-token-only bound (a glued-column K can steer the grow). Left edge OUT. Fix 0
  changes the rigid read on every over-tall free-text box — regression surface; abstain on multi-line.
- **Tier:** flag-only ≤70 + note in v1. Deciding failure: a keyword column-split miss (`Willowbrook Nurseries Site`) steers the grow, the
  crop reads the same superstring, "two families agree" on a wrong value — and the auto-file door for non-role names is open (F3).
  Clean tier later = inject the grown read as a mapping-family ledger candidate (the reslice witness-producer pattern, `engine.py:4882`)
  and let `_corrobLicensed` decide.
- **Census:** instrument the decline row with `new` + the trigger; arms on `TESTING/_measure/reset_arm_20260908/arm137.db` via
  `realdoc_regression.js` (`RR_APP_ENV=1 OCR_RENDER_DPI=200 NAMEGROW_CENSUS_DIR`): OFF / pick-only / pick+textual — ref/date lanes
  md5-identical. Name GT is absent from realdoc AND the customer corpus → the real gate = the owner's 21 Ridgeway dockets + Hard Set names,
  GT = the printed page. Fire = a census row; false fire = grown ≠ printed, or a heal of an already-correct value. Gate: fires>0
  (non-vacuous), false fires 0, would-file delta only ever REMOVES eligibility (19/21 → review), every `name_declined` row vetted. Owed:
  Learning Repair on docs 8/19/21.

## 5. Where the two designs disagree (for the Oracle)
- Site: engine pass (gary — the keyword read only exists post-Stage-1) vs mapper-side Fix 0 + trigger (007 — but the mapper never sees K).
- Whether Fix 0 alone heals the exhibit: F2 says the in-app leg never reaches its re-read (no cut on the EXPANDED box), so a better row
  pick inside it heals nothing unless the cut test changes too.
- F3 (two auto-filed clipped names): a separate note-only guard NOW vs waiting for the arc.

## 6. Oracle verdict — **SEND BACK (both designs)**, redirected build order
**Premise corrections (traced):**
- **F2 is FALSIFIED as a mechanism:** `abs_expanded` is set only when the TIGHT read was EMPTY (`template_mapper.py:2493-2496`); the
  exhibit's tight read returned `Willowbrook Nurserie:`, so `:3368` cut-tested `target_box` — the same stored box 007 replayed. The leg has
  two SILENT exits before any census line — `:3366-3367` (no locate lines) and `:3374-3375` (no cut) — and `_name_grow_census` never
  `makedirs` (`:3284`), so "no census line" is NOT evidence until a positive-control line exists. Instrumenting the mapper leg is the
  gating item for everything below (a `nocut` in-app on the stored box while 007's replay finds one = a frame mismatch — page/DPI/cache —
  to fix in the mapper first).
- **007's "Fix 0 alone heals the exhibit, even ungrown" is an accident of box height:** R8 pads 0.5·h HORIZONTALLY too (`reslice.py:39`,
  `_crop_padded :54-65`); on the over-tall box (≈37 px) padx ≈ 18 px ≥ the 17 px overhang — the hpad did the grow, with none of the
  leg's protections. On a snug box it would not.
- **gary's engine pass is WRONG LAYER for v1:** `regrow_name_read → _crop_and_ocr(page, grown, 'text')` is the same preview fast path
  (`anchor.py:3561-3566 → _noise_smooth_retry :3414-3425`, confidence-picked) that F1 measured returning `Greenacres. Mill Lane` on the
  grown box → `kw_regrow_disagree` → untouched: inert on the exhibit, depends on Fix 0 without saying so, and is a THIRD owner of the
  clipped-name class (mapper leg + `_reconcile_name_truncation` + this) — C6. A floor-waived straddle is `_find_edge_cut_words(floor_waived=True)`,
  not a new function. A note written before Stage 4 is overwritten by the label-guard (`validator.py:532-536` rebuilds `validation_note`).
- **007's textual trigger lets the keyword STEER the geometry:** an over-capture `Willowbrook Nurseries Site` walks the grow to absorb
  `Site`, both witnesses agree on the wrong superstring, and in v2 that auto-files. gary's reuse of `_name_grow_comparator` (same token
  count, last-token completion only, `:3319-3333`) refuses that case — keep gary's trigger, drop 007's walk.
- **The v1 name-grow contract's safety net is wrong:** "declines silent, the wordness flag + picker remain the net" (`:3392-3397`, `:716`) —
  but `name_structure_flag` is structural (`wordness.py:134-159`) and a name-shaped remnant (`Aldermoor Engineerir`) passes it by design.
  F3 (two silent wrong auto-files on an optional field) is the proof; **fix now.**

**The redirected build (all DARK + `TEST_SWITCH_KEYS`, flag-only in v1):**
0. **Instrument** the mapper leg: census at guard ENTRY (`entered`, `template_mapper.py:3365`), `nolines` at `:3367`, `nocut` at `:3375`;
   `_name_grow_census` creates its dir. Replay doc 14 in-app → a positive-control line.
1. **Fix 0 on the GROWN re-read only** (`:3423`): vertical pad 0.5·h, hpad 0, PSM 6 `image_to_data`, `reslice.pick_in_band_line`,
   ≥2 in-band lines → decline (noted per 2a). The tight read untouched.
2. **F3 belts:** (a) mapper — a geometrically PROVEN right cut whose heal fails → `defer_cap` (`_edgecut` ≤70 + `_EDGE_CUT_NOTE`, the road
   at `:2634-2638` / `:2691-2696`) instead of `None` at `:3394-3397` (reverses v1's "names never take the defer-cap"; update the flag block +
   pin). (b) engine, ZERO OCR, AFTER Stage 4: `template_mapping` name winner M, un-noted `1_keyword` K, `_name_grow_comparator(M, K)` true,
   M NOT word-bounded page-present (`_uv_text_page_present`, the name_unclip C3 belt) → value UNCHANGED, `corrected_to = K`, cap ≤70, note
   (the label-guard's note survives; `trust.js:1077-1083` blocks on `corrected_to` regardless). No method suffix (S3). Catches the
   sub-floor nick (`Willowbrook Nurserie` clean, no colon) that no geometry can.
3. **v2 clean road** (later, own key + census): inject the in-band grown read as an un-noted `template_mapping_regrown` ledger candidate
   (the reslice witness-producer pattern) and demote the note through `corrob_note_recompute_fc` gated on `_corrobLicensedKeyword`
   (`trust.js:566`) — never a private agreement predicate.
No `regrow_name_read`. The owner's "extend the mapped read until it corroborates the keyword" is realised as: the mapper leg grows
(the ONE owner of grow geometry), the in-band re-read becomes the witness, the keyword only TRIGGERS/NOTES (v1) and licenses (v2).

**Conditions:**
- C1 entry/nolines/nocut census + `makedirs`; doc 14 replay = positive control (a frame mismatch fixed first).
- C2 Fix 0 grown-re-read only, hpad 0, in-band pick, ≥2 in-band → decline+note.
- C3 belts 2(a) + 2(b): same-token-count comparator, page-present belt, after Stage 4.
- C4 no `regrow_name_read`; a floor-waived grow = a parameter on `_find_edge_cut_words`.
- C5 pins that survive a future dev: non-empty tight read → cut test on `target_box`; `Willowbrook Nurseries Site` vs `Willowbrook Nurserie:`
  → NO fire; no keyword → untouched; 3-line grown crop → band line, 2 in-band → decline+note; a word 0.3·h right of the grown box is NOT
  absorbed; the label-guard note survives 2(b).
- C6 gate: arms OFF / mapper / mapper+note on `TESTING/_measure/reset_arm_20260908/arm137.db` via `realdoc_regression.js` — ref/date
  md5-identical, would-file delta only REMOVES; census `entered>0` and doc 14 = `healed_flagged` or the note (positive control, else
  vacuous). Name accuracy: `teach_run_ab.js` + `score_teach_run.py` `customer_name` ≥ today (Hard Set is cold — Stage 0.5 never runs there;
  vacuous for this change). Learning Repair docs 8/19/21.

**Codes** (the `JN-72756`/`DN-78756` sibling): unchanged — a separate item (`_pick_fuller_code` + class G + mig-133 left slack).

## 7. BUILT 2026-09-08 (steps 0-3, commit `139780a`) — status + the in-app finding
- **Step 0 (instrumentation):** `entered` / `nolines` / `nocut` (+ the read box and the row-band words near its right edge) /
  `band_abstain_<n>`; the decline row carries `new`; `_name_grow_census` creates its dir (a POSIX or absent dir had swallowed every
  line). **Positive control on doc 14 achieved** — and it settles the premise argument: in-app the name leg is ENTERED and exits at
  `nocut`. The read box is the DRIFT-PLACED one (x 0.0705–0.2403; the located "Deliver To" sits 0.0065 further right than on the taught
  sample), not the stored 0.064–0.234 that 007 replayed. `Nurseries` spans 0.1773–0.2445, so the box cuts its final `s` by 0.0042
  (≈7 px), and the v1 floor `max(0.004, 0.6·g)` = 0.00448 refuses it by 0.0003 — half a pixel. gary's floor hypothesis was right for
  the frame the app reads; F1 measured the wrong frame; F2 was not the mechanism. **The floor is the seam** for this class (a
  floor-waived cut test = a parameter on `_find_edge_cut_words`, C4 — NOT built: the nick protection stands until a census says
  otherwise).
- **Step 1 (`template_name_grow_band_pick`)** and **belt 2(a) (`template_name_cut_defer_cap`)** are built and pinned but cannot reach
  doc 14 (no cut ⇒ the leg never re-reads). They reach any sibling whose cut clears the floor (the gate arms count them).
- **Belt 2(b) (`keyword_superstring_name_note`) FIRES in-app on doc 14** (`LOG Keyword-superstring note: customer_name 'Willowbrook
  Nurserie:' … 'Willowbrook Nurseries' -> review with the fuller reading offered (corrected_to)`) — the zero-OCR net for the sub-floor
  nick, exactly as ruled. Belt census: `kw_note_entered` / `kw_note_fired` / `kw_note_skip:<why>` rows explain every decision.
- Keys: mig 140 seeds all three OFF; `TEST_SWITCH_KEYS` = 27; bridge lines in `_reconcileEnv`; pins listed in the commit.
- **Gate (C6) arms:** `TESTING/_measure/name_grow_belts_20260908/run_arms.sh` — OFF / mapper / mapper+note on the post-137 copy with the
  census per arm. Results: _appended below when the chain finishes._
