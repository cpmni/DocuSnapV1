# HANDOVER — 2026-08-07 (overnight, autonomous)

**Branch:** `feat/reprocess-throughput-autostraighten` · **HEAD `15a90da`** · **NOTHING PUSHED** ·
installer not rebuilt · uncommitted batch: **none of mine** (only the owner's own two files, below).
**Context:** three arcs in one session — the Larkspur po_number clip (finished), a supplier-matching
fire found by the owner, and a release-blocking credit-note financial-safety bug found by Chris.

---

## TL;DR
1. **Larkspur po_number clip — DONE.** `TEMPLATE_PAD_WINDOW_CODE_LABELLED` (`3939564`, dark).
2. **Supplier corruption — FIXED, 2 iterations.** 15 of 22 Castellan credit notes were filing under the
   WRONG issuer (incl. `Bramblewood Joinery Ltd` — the owner's OWN company). Root cause: a shipped gate
   wired to one of a function's two callers. **4/21 -> 21/21; realdoc supplier 692/695 -> 695/695 = 100.0%.**
3. **Credit-note minus sign — DETECTION shipped, READ fix NOT built.** 16/16 credit notes filed as
   POSITIVE (a £160.32 credit became a £160.32 charge); 3 were silent and bulk-filed. Slice C
   (`CREDIT_SIGN_COHERENCE`, dark) flags them. **A credit note is now flagged and blocked, NOT read
   correctly — the user still types the minus by hand.**
4. **Every flag shipped this session is DEFAULT OFF.** Live behaviour is unchanged until the owner flips.

---

## COMMITTED (5 commits, all dark, none pushed)

### `3939564` TEMPLATE_PAD_WINDOW_CODE_LABELLED — Larkspur po_number clip
- **Root cause:** the 2026-08-09 pad-window CODE slice was scoped to LABEL-LESS boxes on a premise read
  from a NON-EXISTENT column (`anchor_label`). The real column is `anchor_text` and the box IS labelled,
  so the slice never fired. Separately, `_inline_code_reconcile` is inert here because its page-wide
  locate false-matches the FOOTER prose line.
- **Files:** `template_mapper.py`, `handler.js` (env bridge), `tests/test_template_pad_window_code.py`
  (34 pins), `stress_test/crop_recipe_sweep.js`.
- **Gates:** sweep REPEATS=3 → #625 recovered 3/3, 0 regressed, 0 false flags · corpus 288 docs 0 T→F,
  0 auto-file losses on correct values · realdoc M-set a strict SUBSET (17→15), healed #568/#588
  (`S-35727` → `WS-35727`, silent wrong auto-files).
- **Oracle:** SIGN OFF W/COND C1–C7, all built.
- **Flags:** `template_pad_window_code` + `template_pad_window_code_labelled` (bridged, both OFF).
  **The parent flag had NO Settings bridge before — it was never actually owner-flippable.**

### `63b1807` + `2c805f7` + `dfa60d8` — supplier matching (2 iterations)
**Iteration 1 — the vacuous-fit gate at the SECOND call site.**
- **Root cause:** `_fit_page_transform` has TWO callers. The `n_inliers < 3` refusal was written INLINE at
  engine.py's Stage-2 caller on 2026-08-01 and nowhere else, so Stage-0.5 `template_registration`
  consumed exactly the fits Stage 2 refuses. Template 32 has 2 landmarks, one the 3-char table header
  `'Qty'`; `_label_score('qty','castellan security systems') = 0.667 >= 0.6` (longest run `'ty'` from
  "securi**ty**", measured against the 3-char NEEDLE), so the page-wide fallback matched `'Qty'` onto the
  SUPPLIER LINE. The resulting 2-point fit is EXACTLY DETERMINED — residual 0 BY CONSTRUCTION, conf
  pinned 78, rotation −166.71° — and displaced the taught supplier box by **0.277 of the page**.
- **Fix:** ONE shared predicate `registration.is_unfalsifiable`, consumed by BOTH call sites, applied
  INSIDE `_fit_page_transform` so no future caller can miss it. Predicate is on **INLIERS, not n_points**
  (a 5-landmark RANSAC can still refit on 2 inliers: measured residual 1.1e-16, conf 78).
- **Gates:** 4/21 → 16/21 · realdoc supplier 692→693, SILENT regressions 26→24 · 21 pins.

**Iteration 2 — curated `template_fixed` supplier vs a MISREAD letterhead.**
- **Root cause:** Stage 0 seeds the template's `fixed_value` at conf 95; the Stage-0.5 merge
  (`engine.py:4905-4917`) lets a mapping READ displace it on AUTHORITY, guarded only by free-text
  conf<75. Edge-glyph misreads arrive ≥75 and win.
- **Fix:** decline the read and KEEP THE SEED when it is the same name misread (alnum-fold + Levenshtein
  ≤1) or debris (`len(fold)<3` vs a ≥8-char curated name). **Keep-the-seed, NOT snap-the-read** —
  keeping `method == 'template_fixed'` is what `BRANDING_NAMED_BLANK` and
  `TEMPLATE_FIXED_NAME_PRESENCE_VETO` key on exactly.
- **Gates:** **16/21 → 21/21** · **realdoc supplier 693 → 695/695 = 100.0%**, regressions 59→57,
  SILENT 24→23, diff DELETIONS ONLY · 27 pins.
- **Flags:** `template_fixed_near_match`, `template_fixed_fragment` (bridged, both OFF).

### `60f0eca` + `15a90da` — credit-note sign coherence (SLICE C ONLY)
- **Root cause:** the app has **no representation of a signed money value**. Sign destroyed at READ at
  TWO sites sharing ONE artefact — `anchor.py:2751-2753` (`re.search` span starts at the digits, and
  `.strip(" -:;,")` strips hyphens anyway) and **`keyword.py:1647-1651`** (Stage-1 twin, ~60-70% of
  fields) — plus independently at `validator.py:307` `CURRENCY_RE`.
- **The owner's "two negatives sum positive" is the parse defect, NOT an accumulation bug.** Measured:
  `parse_amount('-100.00') + parse_amount('-60.32') = +160.32`. No double-negation, no abs(), no concat.
- **Shipped:** `validator.credit_sign_note()` (pure, 3 arms, never negates/swaps) +
  `validator.type_expects_credit()` (tri-state, keyed on display name AND aliases, never an internal
  slug), threaded `process_docs` → `engine.extract(credit_expected=)` → `validate_and_adjust`.
- **Gates:** 33 pins · corpus 288 docs 0 T→F, **0 false alarms on invoice-typed docs** · **realdoc n=695
  IDENTICAL to baseline** · money suites pass.
- **Flag:** `CREDIT_SIGN_COHERENCE` — **NOT yet bridged in handler.js** (see FIRST ACTIONS).

---

## VERIFICATION STATE — read this before quoting any number

**Verified, artefacts read:** `stress_test/out/reg_BASE.md`, `reg_ARMED.md`, `reg_ITER2.md`,
`reg_CREDITSIGN.md`, `customer_score_{padlab,fs,cs}_{base,arm}.md`. Python suite 225/235 pass;
**the 7 failures are PROVEN PRE-EXISTING** (they fail identically with the kill switch off).

**Mid-session claims I got WRONG and corrected — do not re-inherit them:**
1. *"Nothing blocks a wrong-signed total from being filed."* **FALSE.** `renderer.js:4471` excludes
   flagged docs from File All Ready and `trust.js:466` returns `{ok:false}` for any noted field. The 13
   flagged were correctly excluded; the 3 filed because **DETECTION failed**. The credit-note bug is a
   detection bug, not a gate bug.
2. *"`engine.py:4973` / `_doctype_fixed_supplier` is the residual mechanism."* **FALSE — that code is
   DEAD.** It reads `f.get('key')` while the payload carries `field_key`, so it has never executed in
   production (already recorded in `pendingfeatures.md`, 2026-07-31; do NOT "fix" it casually).
3. *"`select_cross_sample` is unused."* **FALSE.** It is wired via `tryCrossSampleLandmarks` and is
   PREFERRED by `generateLandmarks`. It had already run for tpl 32 (4 confirmed docs, landmark
   `source='cross_sample'`) and still produced the degenerate 2-landmark set.
4. I initially missed **`keyword.py:1647-1651`**, the Stage-1 sign killer (gary caught it).

**BLIND GATES — never quote these as evidence:**
- Customer corpus fires registration **0 times in 1793 field wins** → blind to iteration 1.
- Customer corpus resolves issuer via `template_mapping` **282/282, never `template_fixed`** → blind to
  iteration 2.
- **`customer_corpus_score.js` `normMoney` strips `-` via `[^0-9.]`**, so the total lane compares
  MAGNITUDES while the generator emits SIGNED credit-note GT (`gen_customer_test.py:642`). **17 of 36
  corpus credit notes have the sign lost and score CORRECT.** An ADDITIVE sign census
  (`total_sign_got`/`total_sign_gt`) was added; the score and pass/fail criteria are DELIBERATELY
  unchanged (that is the owner's call).

**Measurement caveat:** n=21 quantises at 4.76% and Chris's n=18 at 5.6% — **neither batch can express
"98%"**. The only set that can is realdoc's supplier field (n=695).

**Chris (sandbox, contained):** round 1 **18/18**; armed retest **18/18** (same, no regression, no
near-misses). His non-supplier findings are OUT OF SCOPE and NOT implemented — see "Needs the USER".

---

## FIRST ACTIONS for the fresh session
1. **Bridge `CREDIT_SIGN_COHERENCE` in `handler.js _reconcileEnv`** (the other four flags are bridged;
   this one is env-only, so the owner cannot flip it from Settings yet). Same pattern as the lines above it.
2. **Ask the owner to flip and eyeball**, in this order: `template_fixed_near_match` +
   `template_fixed_fragment` (supplier, 21/21), then `template_pad_window_code` +
   `..._labelled`, then the credit-sign flag once bridged. **App RESTART required** (main-process JS).
3. **Build credit-note SLICE A** (preserve the sign at read) — designed + Oracle-vetted, conditions in
   the Deferred block below. Without it the user hand-types a minus on every credit note.

---

## DEFERRED — designed + vetted, NOT built (load-bearing conditions, do not build these wrong)

**Credit-note slice A — preserve the sign at READ.** Change the SHARED config pattern
(`validation_patterns.currency`) so one edit fixes both read sites; patching `anchor.py` alone is the
per-path hack CLAUDE.md forbids and leaves Stage 1 broken. Also remove `-` from the `anchor.py:2753`
strip-set.
- **BLOCKING (Oracle A1):** a bare `-?` MANUFACTURES a new class — `TOTAL-------160.32` and
  `Total-160.32` capture `-160.32`, inverting a CHARGE into a CREDIT. **VERIFIED.** Requires a
  left-boundary lookbehind, e.g. `(?<![0-9A-Za-z.,-])-?`. ASCII hyphen only (not `–`/`—`), adjacency-strict.
- Scope to the LEADING sign only. Trailing-minus / parens / `CR` stay UNPARSED — that is only safe
  BECAUSE slice C flags them (pinned as an accepted trade-off).
- **Expect a second note wave:** the confirmed corpus holds credit-note totals POSITIVE, so signed reads
  will shape-mismatch their scope history. Measure it before shipping; lever = Learning Repair.

**Credit-note slice B — signed arithmetic.** Add `parse_amount_signed()`; **do NOT change `parse_amount`
in place.** A signed `parse_amount` alone is a NET SAFETY LOSS: `total_reconciles` would abstain on every
credit note, and if the guard is relaxed naively `tol = max(total*0.02, 0.05)` collapses to 5p,
`total < subtotal - tol` fires on every well-formed credit note, and `- discount` double-negates. B2 must
be **magnitude reconciliation + a separate sign-coherence assertion**.

**SIGN-BLIND COMPARATORS (three, verified) — never build a sign check on one:**
`text_normalise._EDGE_RE` (`normalise_for_tokens('-160.32') == '160.32'`, byte-mirrored in JS + golden
corpus — do NOT "fix" it), `validator.CURRENCY_RE`, and `customer_corpus_score.normMoney`.

**Registration follow-ups (`pendingfeatures.md`, ranked, with measurements):**
- **(0) `select_cross_sample`'s `pos_tol=0.015` is TIGHTER than the measured page jitter (~0.021)**, so it
  rejects the entire letterhead/address/title and keeps whichever two words jittered least. De-meaning the
  per-document global offset takes tpl 32 from **1 qualifying landmark to 9** without admitting a single
  floater (`pack`/`pir` stay rejected at 0.059/0.095). Owner-diagnosed: a landmark's coordinate should be
  an OUTPUT of finding it, not the criterion for choosing it.
- (1) `_excludeBoxesFor` disqualifies taught LABEL zones as landmarks (starves sparse templates).
- (2) Ask for a 2nd/3rd document after a thin teach (plumbing exists, nothing asks).
- (3) Refuse to store a <3 landmark set (it can only ever produce an unfalsifiable fit).
- (4) Registration as a WITNESS not an AUTHORITY (owner-designed corroboration model).
- (5) Rotation-locked / overdetermined fit (owner-designed; makes the residual meaningful).
- (6) `_fit_page_transform` pairs a taught WORD centre against a located LINE centre.
- Also filed: `_label_score` partial credit lets a PROSE line (0.875) outrank a 1-glyph-garbled true
  caption (0.75).

---

## NEEDS THE USER
- **Flip the flags + restart + reprocess** (see FIRST ACTIONS 2).
- **Chris's non-supplier findings — vet, none implemented:** credit-note totals lose the minus sign
  (now detectable via slice C); **teaching appears to do nothing until "Reprocess all in queue"** (his
  top friction, both rounds); a stale "you don't have that document type yet" message (he reported it
  FIXED on retest); changing the type blanks already-read values (FIXED/not seen on retest); **teaching a
  field invents characters** (`CCN5464` → `CCNS5464` / `"CN5464`) and pins them for every future doc from
  that sender — this one interacts with taught refs and is unguarded.
- **Owner decisions on the credit-note arc:** the review-burden trade-off (slice C contradicts
  `feedback_minimal_interaction_autofile`); remediation of the 16 already-filed documents (wrong XML on
  disk, and their confirmed values are the poison slice A will trip over); suppressing the "lower the
  auto-file bar" nudge on a batch containing a currency note.
- **CLAUDE.md + `tests/test_template_target_word_snap.py` carry the OWNER's own uncommitted edits** —
  left untouched all session; do not stage them.

---

## KEY FACTS / PATHS
- **Live DB:** `%APPDATA%\ScanFinder\docusnap.db`. Castellan credit notes = docs **705–726**, template
  **32**; its `template_fields.supplier_name.fixed_value = 'Castellan Security Systems'`, `is_variable=0`.
- **Revert bookmarks:** `bookmark-2026-08-06-pre-registration-fix`, `bookmark-2026-08-07-pre-creditnote-sign`,
  `bookmark-2026-08-09-padcode`.
- **Chris sandbox 2 is STILL RUNNING** — Electron on CDP **9223** (the npm wrapper was killed, the app
  survived). Fresh DB at
  `…\scratchpad\chris-sandbox2\userData\docusnap.db` (holds his 18-doc run; the 16 positive totals and the
  3 silent ones are in `extractions` — **the best evidence set for slice A**). Kill via
  `Get-NetTCPConnection -LocalPort 9223`.
- **Harnesses** (Git Bash; `node_modules/electron/dist/electron.exe`, NEVER `electron.cmd`):
  - `stress_test/registration_gate_probe.js` — 3-way A/B over the 21 Castellan docs, per-doc
    value+method+conf+NOTE and a registration census by method AND template.
  - `stress_test/crop_recipe_sweep.js` — `REPEATS=3` (the clip shuffles with DPI ±1).
  - `stress_test/realdoc_regression.js` — the go/no-go (n=695). **Read the .md report; never trust the
    exit code.**
  - `stress_test/customer_corpus_score.js` — now emits the additive sign census.
  - `scratchpad/`: `monotonicity.py`, `autofile_census.py`, `labelled_code_population.py`,
    `reg_landmark_probe.py`, `label_triangulation_probe.py`, `supplier_iteration_log.md` (per-iteration
    scores + exact failure cases).
- **Python:** `py -3.12`; set `PYTHONIOENCODING=utf-8` or Windows cp1252 kills test prints with `→`/`£`.
- **Latent-import trap hit FOUR times this session** — `engine.py` did not import `registration` or
  `name_match`; `validator.py` did not import `os`; `process_docs` imports validator as `_validator`. A
  module-load smoke CANNOT catch a call-time NameError — verify the symbol is in scope (I used AST).
- **Advisors:** gary corrected 3 premises in the supplier arc and 5 in the credit arc; Oracle SENT BACK
  the first supplier design (the gate already existed at the sibling call site) and killed a zero-yield
  staged flip. Log: `docs/oracle_log.md` (3 new entries).
