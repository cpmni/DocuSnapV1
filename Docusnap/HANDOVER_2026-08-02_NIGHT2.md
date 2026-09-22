# HANDOVER 2026-08-02 NIGHT2 (SFDEV every-step trace + anchor crop RIGHT-grow + template-finetune arc)

Follows `HANDOVER_2026-08-02_NIGHT.md` / `_OVERNIGHT.md`. Branch
`feat/reprocess-throughput-autostraighten` · **HEAD `3655f9f`** (local — verify push state; prior
pushed baseline was `8237771`/`9458552`) · installer predates the week (rebuild to ship) · tree clean
except pre-existing untracked (old handovers, owner backup dirs, security report, a script).

## ⏳ A/B GATE IS STILL RUNNING — read it FIRST
Background run `b1542e5up` (bash, detached) started 21:06: realdoc_regression OFF then ON
(`ANCHOR_VALUE_RIGHT_GROW=1`), 493 confirmed docs each (~18-20 min total). At wrap it was still in the
OFF phase. **It is the flip-gate for the crop right-grow (`3655f9f`).**
- Reports: `stress_test/out/rg_off_report.txt` · `rg_on_report.txt`. Per-doc dumps:
  `rg_off.jsonl`/`rg_on.jsonl` (+ `_dump`).
- **Read the verdict:** `py -3.12 <scratchpad>/rg_diff.py` (scratchpad path in the memory file) — or
  re-create: it loads rg_off/on.jsonl by id, lists per-doc ref/date changes off→on, and greps each
  report for `silentAutoFile (M)` + `silentWrong`.
- **GATE (Oracle):** ON `silentAutoFile (M)` must NOT exceed OFF · ON `silentWrong` must NOT exceed
  OFF · every ref/date change off→on must be a HEAL toward GT (the chopped-value-recovered class),
  never a new wrong. Read through `stress_test/gt_overrides.json` (a "regression" that is the pipeline
  now reading the TRUE value vs a mis-confirmed GT is a WIN).
- If green → flip is the owner's call (see the main.js export GOTCHA below — a setx alone won't reach
  the Python spawn).

## TL;DR
Continuation session (owner present, hands-on). Two features SHIPPED (both dark/inert-safe), one arc
opened + investigated to root:
1. **SFDEV every-step trace — slice 1 (`e5e6c64`)**: the dev inspector now shows a COMPLETE per-field
   ladder (every read stage's outcome incl. skipped/no_candidate/already_resolved + skip reason),
   not just winners. **Live-confirmed** on the owner's reprocess (12 `step` events in the fresh diag).
2. **Anchor crop RIGHT-grow — slice 1 (`3655f9f`, DARK)**: the crop no longer chops a ref value
   longer than the taught box (`PO-25909` → was cropped `No. PO-2590!`). Seats the crop's right edge
   on the MEASURED `inline_box`. Kill switch `ANCHOR_VALUE_RIGHT_GROW` default OFF → byte-identical.
   **A/B gate running (above).**
3. **Template-system fine-tuning arc** — investigated the owner's two exhibits to root; the crop fix
   is the first per-method refinement. The arc's core design (below) is agreed but NOT built.

## Committed this session (local)
- `75f9fd5` docs(pendingfeatures): child-window minimise → visible bottom-left dock (owner "add to
  list"). Root: `minimizable:false` FORCED for parented children (`main.js:583`) because
  `skipTaskbar`. Design: hide()+in-app restore chip. eric to vet.
- `7ab1e75` docs(pendingfeatures): teach "Confirm what I read" bar — two filled buttons ambiguous +
  DESIGN PLAN (owner). Root: selected direction toggle uses `btn primary` (`teach/renderer.js:687`)
  same as the accept `rb-yes:692`. Plan: one primary=accept, Left/Above=segmented toggle, verify vs
  accept zones. Gate: chris+barry→eric→Oracle.
- `e5e6c64` feat(dev-inspector): SFDEV every-step ladder slice 1. See below.
- `3655f9f` feat(anchor): value-box RIGHT grow slice 1 (DARK). See below.

### `e5e6c64` — SFDEV every-step trace (slice 1)
- **Engine** (`python_backend/extraction/engine.py`): new guarded `_trace_steps(...)` emits one `step`
  event per CONFIGURED field per read stage (outcome ∈ won|lost|no_candidate|already_resolved|
  skipped); shared static `_merge_outcome` (refactored out of `_trace_stage` so the ladder can't
  disagree with the `merge` event); discriminator is value-TRUTHINESS first (a {value:None} seed is
  no_candidate, never a false won — SEAM 3b); SKIP rows emitted from OUTSIDE each stage gate
  (`matched_tmpl is None` after the `if templates:` block, `if not anchors:` before Stage 2) — the
  exhibit-A "green dots, no anchor rows" fix (SEAM 3a). Slice-1 scope = the four core stages
  (0/0.5/1/2); late 2.5/2.6 deferred to slice 2. Pure observation, never writes results, no-op off.
- **Inspector** (`src/windows/dev-inspector/{renderer.js,index.html}`): `buildModel` gains `step` +
  `anchor_reject` cases (anchor_reject was silently dropped); `renderField` shows an engine-declared
  "Every step" ladder (outcome→CSS via an allowlist) above the reconstructed "Winning lineage"
  (approx kept there only); live tick now `refreshSelectedDoc()` so a 120ms trace refresh doesn't
  wipe the field selection / crop-evidence pane.
- Vetted gary + eric (parallel) → Oracle SIGN-OFF-WITH-CONDITIONS, all applied. Pins:
  `python_backend/tests/test_stage_coverage_trace.py` (8 groups incl. completeness on a gate-false
  fixture, both exhibits, {value:None} trap, won↔merge parity, lost-retains-value, no-overclaim
  wording, trace-off inert) + `test_stage2_winner_consistency` (characterization pin). All green.
- **Deferred:** slice 1b = a shared ladder-model builder so the Review-window trace console gets it
  too (a 2nd consumer, diverged in MODEL SHAPE — Oracle: reconcile, don't lift). slice 2 =
  late-stage won/lost + rung-level fast-path skip reasons inside anchor.py.

### `3655f9f` — anchor crop RIGHT-grow (slice 1, DARK)
- **Root cause (007+oscar+gary, evidence-locked):** `_crop_and_ocr` (`anchor.py:~3308`) sizes the
  crop from the TAUGHT box width + a fixed ±20px label-blind pad → a value longer than the taught
  sample chops on the right; the built right-grow `ANCHOR_MAX_CROP_WIDTH` is dark AND arithmetically
  inert (`max_w_norm==w_norm` for every anchor in the live DB → `eff_w==w_norm`).
- **Fix:** new `_label_right_limit(field_key, located, anchor, direction, val_type,
  validation_patterns)` returns the value's MEASURED right edge from `located.inline_box`
  (cluster_value_words column, next-column-excluded by construction); `_crop_and_ocr` gains
  `right_limit_norm`, extends x2 RIGHTWARD ONLY (+`_RIGHT_GROW_GUARD_PX=10`, sized for the coarse
  ~120-DPI inline_box edge), never shrinks/past-page, left edge + crop body untouched (avoids the
  `ANCHOR_INLINE_FULLRES_REREAD` regression). Wired at rigid/drift/label-lock rungs only (admits
  content → NOT cross-check/registration). Rigid limit computed inside the frame-coincidence guard;
  arming extended to `(_want_lclamp or _want_rgrow)`. Skips the dead max_w_norm widen when a
  right-limit is present.
- **Scope = REF-LIKE keys with a validation pattern ONLY.** That rides the strict
  `_pattern_coverage>=0.8` credibility branch which rejects a merged `"PO-25909 Qty"` (0.67) — the
  SOLE guard on the cross-checkless label-lock rung (Oracle SEAM A). **DATE deferred to slice-1b
  (VERIFIED unsafe):** date credibility is substring (passes a merged date) AND
  `validator.parse_date("12/05/2026 Qty")` → None / `normalise_date` leaves it dirty → a merged date
  would commit dirty. Do NOT add `or val_type=='date'` to the helper until a date clean-token step
  lands + is pinned.
- Vetted 007 + oscar + gary → Oracle SIGN-OFF-WITH-CONDITIONS; every condition applied. Pins:
  `python_backend/tests/test_label_right_grow.py` (helper gate/SEAM-B, C1 measured-not-taught frame,
  grow-only geometry, no-double-apply, merged-column strict-credibility guard, OFF byte-identical,
  rung-discipline source pins). `test_label_left_clamp.py` source pin updated for the arming-OR.
  Regression `test_stage2_winner_consistency` + `test_precedence` green.

## Verification state (honest)
- SFDEV slice 1: pins green + LIVE-confirmed (owner reprocess, 12 step events in
  `Debug/diagnostic_2026-08-02T18-42-27-046Z.jsonl`).
- Right-grow slice 1: all pins green, DARK (byte-identical off). **Corpus A/B = IN-FLIGHT, verdict
  NOT yet read** (top of file).
- NOT verified: the right-grow's live effect on a real doc (dark; needs flip after the A/B) and the
  SFDEV inspector RENDER on the exhibits (renderer loads on next inspector open — code paths pinned,
  render eyeballed only via the owner's diag, not the live inspector window).
- Mid-session correction banked: I first said "no landmarks" for Northgate — WRONG; template 24 has 5
  landmarks, registration IS on. The chop is crop OCR/width, not a missing registration.

## FIRST ACTIONS (fresh session)
1. **Read the A/B verdict** (recipe at top). If green → owner flip decision for
   `ANCHOR_VALUE_RIGHT_GROW`. If a merged-column regression shows → it's the HYPOTHESIS Oracle flagged
   (sub-threshold gap); the fix is safe at ref/date scope only via strict credibility, so investigate
   that doc, don't widen scope.
2. **main.js export GOTCHA (gary):** `main.js:997-1000` only LOGS armed `ANCHOR_*` switches, it does
   NOT set them into the Python spawn env — so a `setx ANCHOR_VALUE_RIGHT_GROW 1` alone won't reach
   `process_docs`. (This is why "No." still bled last run despite the left clamp being "flipped".) To
   actually flip either clamp/grow live, export it into the spawn env in the processing handler, or
   set it in the shell that launches the app. Small deployment fix; decide before flipping.
3. **Continue the arc** — the agreed direction (below). The verify/consensus step is the next real
   build; the crop fix + SFDEV trace are its prerequisites (per-method accuracy + observability).

## The template-finetune arc — agreed direction (NOT built)
Owner vision: **fine-tune EACH detection method to ~90% accuracy individually → then agreement by
≥2 methods becomes reliable** (cross-method consensus = the "verify" step). Decomposition:
- **The core bug (proven live):** a genuinely-located Stage-0.5 `template_mapping` wins by pure
  AUTHORITY over a correct higher-confidence keyword (`engine.py:3975-3991` `continue` — skips
  keyword entirely; on reprocess_147045 the garbled mapping `»0-17039`@90 beat keyword
  `PO-17039`@93). Only a downstream `ref_length_flag` caught it. The `_blind_reg` branch (3982-3990)
  ALREADY does the right thing for a BLIND template_registration read — the arc extends that
  comparison to the LOCATED mapping, gated on a deterministic-shape disagreement.
- **"Primary method" = teach-first** (owner's clarification): push the user to TEACH a new/unseen
  layout to ESTABLISH its settings — NOT "taught value always wins." Take POSITION from teach, VALUE
  only after verification.
- **The verify step (barry tiers + gary):** stop treating "only one method spoke" (un-corroborated)
  as "two methods disagree" (contradicted). Three tiers: **Checked** (≥2 agree → auto-file) · **Read
  once** (one source, on-page → auto-file with a breadcrumb) · **Please confirm** (methods read
  DIFFERENT values / unreadable → held). The disagree-adopt case: when a curated mapping value FAILS
  a deterministic check (ref_length/shape) that a distinct-method peer PASSES, prefer/flag the
  shape-valid read instead of letting authority silently win.
- **The `»0-17039` class = crop OCR QUALITY** (oscar fix B): isolated tight crop OCRs worse than the
  full-page pass (upscale trigger is crop WIDTH not cap-height; no char whitelist). Fix B = char
  whitelist (structured code types) + cap-height-based upscale (~35px) + quiet-zone. **HARD ORDER
  (oscar seam):** B must NEVER land alone/before the crop-window fix A — a whitelisted clean-looking
  `PO-2590` (missing 9) would pass credibility and SILENT-file the wrong value.
- **SFDEV observability** underpins it all — the every-step ladder + the "why didn't the taught read
  fire" per-field skip reasons (slice 2) are how the arc is judged.
- Full advisor detail lives in this session's chat; the four consult verdicts (barry/gary/oscar/007 +
  Oracle ×3) are summarised above per fix.

## Deferred (designed, not built) — with the load-bearing conditions
- **Date right-grow (slice-1b):** needs a date clean-token step (parse_date does NOT strip a trailing
  merged token — verified). Only then add `or val_type=='date'` to `_label_right_limit` + a
  merged-date pin.
- **oscar crop-OCR fix B:** char-whitelist + cap-height upscale. NEVER before crop-window A. Cap-height
  trigger (not width) so A's wider crops don't lose resolution.
- **SFDEV slice 1b** (shared ladder builder → Review console) + **slice 2** (late-stage won/lost +
  anchor.py rung skip reasons).
- **The verify/consensus step** (disagree-adopt + the Checked/Read-once/Please-confirm tiers) — the
  arc's flagship; gary+barry designed the shape, needs its own build + Oracle gate.
- Carried from prior handovers: teach-first flow S0 gate · GT-poison eyeball (doc86/154/285/218) ·
  the two pendingfeatures design entries (child-window minimise, teach confirm-bar).

## Needs the USER
- A/B flip decision (once the verdict is read).
- The main.js `ANCHOR_*` export deployment fix before any live flip.
- Whether to push the local commits (`75f9fd5`→`3655f9f`) — I did not push (no ask).

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` (read-only rule; 493 confirmed docs). Probes this session
  were all read-only (`mode=ro`).
- A/B bg id `b1542e5up`; reports + jsonl in `stress_test/out/rg_*`; diff script in the session
  scratchpad (see memory). Harness: `ELECTRON_RUN_AS_NODE=1 [ANCHOR_VALUE_RIGHT_GROW=1]
  RR_CONSENSUS=… RR_DUMP=… ./node_modules/.bin/electron stress_test/realdoc_regression.js` — the
  `spawn('py',…)` inherits process.env (that's how the switch reaches Python).
- Tests: JS via Electron-as-Node; Python via `py -3.12 python_backend/tests/<f>.py`
  (`PYTHONIOENCODING=utf-8` for the ⇒/→ chars).
- Fresh diag from the owner's reprocess: `Debug/diagnostic_2026-08-02T18-42-27-046Z.jsonl` (has the
  SFDEV `step` ladder live + the crop slices under `%TEMP%\ds-devslices`).
