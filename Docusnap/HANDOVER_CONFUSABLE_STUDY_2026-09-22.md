# BUILD HANDOVER — confusable-glyph reading fixes (for a fresh session; owner runs Opus 5.5)

You are picking up a DESIGNED-BUT-NOT-BUILT programme. Read this whole file first, then the two design docs it
points to. Work in incremental steps. After each numbered STEP, STOP and report to the owner in plain English
before starting the next. Do NOT flip any switch on by default without re-running the advisor + Oracle gate.
(The explicit file:line detail below is for continuity, not because the work needs hand-holding — an Opus-tier
session will move through it quickly.)

---

# THE WIDER APP — read this if the owner raises ANY issue (not just the confusable study)
This handover's main job is the confusable programme (below), but the owner may point you at anything they see
in the app. Here is how to pick up cold and not break things.

## What the app is
**Scan Finder** (repo/DB name "DocuSnap") — a Windows desktop app: scans/PDFs → OCR → extract fields
(supplier, date, reference, totals, custom fields) → file them into `Company/Year/Month/DocType.Date.Ref.pdf`.
**Electron shell + Python OCR backend + SQLite**, fully offline. Stack + directory map + DB tables are in
`CLAUDE.md`.

## `CLAUDE.md` is the master index — start there
`CLAUDE.md` (repo root) is read before every response and is the source of truth for state + where things live.
It POINTS to deeper docs; read ONLY the one the task needs (token conservation is a hard rule):
- `docs/extraction-pipeline.md` — the full Stage 0-4.6 OCR/extraction internals. **Read before ANY
  extraction / anchoring / OCR / validation / confidence / auto-file change.**
- `docs/architecture-notes.md` — long per-file design notes (files marked ➜AN in the CLAUDE.md directory map).
- `docs/licensing.md`, `docs/detached-client.md`, `docs/features.md`, `docs/history.md`.
- `docs/session-log.md` — verbatim archive of old session blocks. Grep it (or the matching `HANDOVER_*.md`)
  before re-touching anything a recent session built.
- `MEMORY.md` + `memory/project_*.md` / `feedback_*.md` — durable per-feature facts + the owner's standing
  preferences. Grep by keyword.

## The pipeline + where things live (pointers, not detail)
- Python: `python_backend/process_docs.py` → `extraction/engine.py` runs staged: **Stage 0** template match
  (`template_matcher.py`) · **0.5** admin-drawn anchor→zone mapping (`template_mapper.py`) · **1** keyword regex
  (`keyword.py`) · **2** spatial anchors + logo (`anchor.py`) · **2.5** learned misread correction
  (`ocr_corrector.py`) · **4** validation (`validator.py`) · **4.5** format/shape consistency
  (`format_anomaly_checker.py`). OCR crop recipes in `ocr/region.py`/`region_core.py`/`text_enhance.py`.
- Electron: `src/main.js` (thin IPC router) → `src/modules/{processing,review,filing,settings,search,api,
  workflow,licensing}/handler.js` → `src/services/*` (transport-agnostic core) → `src/windows/*` (renderers).
- DB: `database/index.js` (migrations — currently at **mig 206**) → `database/modules/{documents,learning,
  templates,trust,document_types,licensing}.js`. **`trust.js` = the auto-file / hold gate** (`isAutoFileEligible`,
  the confirm gate, roleKeys note-blocks auto-file).
- Auto-file / holds: a doc auto-files only if its required role fields pass + no validation_note + the sender
  has GRADUATED (`trust.js`); a `validation_note` on a role field blocks auto-file (this is how most "held for
  review" outcomes happen).

## Working rules for ANY change (the owner enforces these)
1. **Verify system state AT THE SOURCE before asserting it** (query the DB, read the code, list the table). A UI
   flag or trace is NOT the state. This is the #1 owner rule (`feedback_second_guess_junctures`).
2. **Extraction/anchoring/OCR/validation fixes are SYSTEM fixes, not document fixes.** Never tune to one doc,
   filename, or coordinate. Every corpus doc is a TEST doc. State how the fix helps unseen suppliers.
3. **Accuracy / hold / auto-file changes go through the gate:** design with the advisors (`gary` Python,
   `oscar` OCR, `007` glyph geometry [spawn general-purpose + read `.claude/agents/007.md`], `reggie` regex,
   `eric` Electron), then **`oracle`** vets the consensus. Ship the change **DARK** (env-gated, byte-identical
   OFF, a kill switch key added to `dark_switches.js` `TEST_SWITCH_KEYS`), with a **pin** test and a
   **realdoc M=0** census (`stress_test/realdoc_regression.js`, `RR_APP_ENV=1`) before any default flip. **The
   flip is the owner's call.** Log Oracle verdicts to `docs/oracle_log.md`.
4. **Plain, non-technical explanations to the owner** (`feedback_simple_explanations`). Concise, no jargon.
5. **Owner shorthand:** "screenshot" / "N screenshots" = read the N newest images from
   `C:\Users\cmccu\Pictures\Screenshots`. "add to list" = add to `pendingfeatures.md`.

## Playbook for an owner-reported issue
1. If they mention a screenshot, read it (path above). Reproduce / locate the code (delegate a search to keep
   context lean).
2. **Verify the state at the source** (rule 1) — don't infer a template/field/setting/row exists from a UI
   signal.
3. Root-cause: FACT (verified in code/data) vs ASSUMPTION. Grep `MEMORY.md` + `docs/session-log.md` for prior
   art on the MECHANISM (not just the symptom) — this bug may have history.
4. If it touches extraction/OCR/holds/auto-file → the advisor+Oracle gate (rule 3). Pure UI/copy/renderer fixes
   are lower risk but still: renderer changes need the window reopened/app restarted to load.
5. Build DARK + pinned → census → report to the owner in plain terms → they decide the flip.
6. Small scope, fewest files, staged edits (owner rule `feedback_efficiency` / `feedback_staged_implementation`).

## Current state (confirm with `git log`/`git status` — this may be stale)
Branch `feat/teach-side-overnight`; migration **206**; `TEST_SWITCH_KEYS` = **10**; `node scripts/run-pins.js`
was 413 green. Recent ships this session (all pushed through ~`543b80e`): the date-hold fix
(`CORROB_DATE_FOLD_WIDE`, DARK), the mig-206 ref-confusable-literal disarm flip, the Quick File multi-doc
type-picker fix, the "recover original" button removal. The confusable programme below is DESIGNED, NOT BUILT.
Installer pair at `9ca65f1` under `dist/` + `client/dist/` (UNSIGNED — signtool is a no-op on this box; real
signing is a release-machine step).

---

## Goal (plain)
A scanned reference `1625802868` is read as `I625802868` — a `1` seen as a letter `I`. The owner wants the
software to READ the glyph correctly (not guess the value). Three levers were designed and Oracle-gated. Build
them IN THIS ORDER (Oracle ruling — do not reorder):
1. **Preprocessing study** — sweep image treatments to see which fix real misreads. Highest value. May make #3
   unnecessary.
2. **Born-digital trip-wire** — a census that decides ship-or-skip.
3. **Glyph gallery** — the big one; build last, only for glyphs #1 still can't fix.

## Read these before touching code
- `docs/designs/OCR_SLICE_STUDY_2026-09-22.md` — the STEP 1 design (preprocessing study).
- `docs/designs/GLYPH_GALLERY_AND_BD_CORROBORATION_2026-09-22.md` — the full design for STEP 2 (Feature 2) and
  STEP 3 (Feature 1), with every Oracle condition. This is the source of truth for the *why*.
- `docs/oracle_log.md` (2026-09-22, bottom) — the Oracle verdicts + conditions.

## HARD ENVIRONMENT FACTS — get these wrong and everything silently breaks
- **Python:** dev uses `py -3.12`. Run a python pin from `python_backend/` like:
  `PYTHONIOENCODING=utf-8 py -3.12 -m tests.test_NAME`. **Never** use inline `py -c` (owner rule).
- **JS pins run under Electron-as-Node, NOT node:**
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe path/to/test_X.js`. Plain `node` fails on the
  native better-sqlite3 ABI. The full suite: `node scripts/run-pins.js` (this one is a plain-node launcher).
- **The corpus:** `Desktop\ScanFinder Test Corpus` — 605 papers + `ground_truth.json` + `rr_ids.txt`. NEVER test
  on the duplicate-heavy raw folders. GT can be POISONED (confirmed history holds `P1` for a real `PI`, etc.), so
  when you check whether a changed read is right/wrong, LOOK AT THE PIXELS, not GT.
- **The realdoc harness:** `stress_test/realdoc_regression.js`, run under Electron-as-Node, with `RR_APP_ENV=1`
  (mirrors the shipped switch state — `RR_APP_ENV=0` is a vacuous-arm trap), `OCR_RENDER_DPI=200` (the product
  DPI), `RR_DB=<a warm db>`, `RR_IDS=<ids>`, `RR_CONSENSUS=<out.jsonl>`. See the existing census runners under
  `TESTING/_measure/*/arm_run.sh` for the exact env block to copy. **Never run `run-pins.js` while a realdoc arm
  is running** (both spawn Electron and contend).
- **The live DB is BLOCKED** to your tools (`%APPDATA%\ScanFinder\docusnap.db`). For the owner's live Print
  Tracker slices you must ask the owner to drop the PDFs + a one-line correct value into a folder.
- **Commits:** branch `feat/teach-side-overnight`. Commit with the co-author line
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (keep whatever the current attribution reminder says).
  The owner pushes unless they say otherwise; ask.
- **DARK-switch machinery pattern** (copy an existing one, e.g. mig 204 in `database/index.js` + the key in
  `database/dark_switches.js` `TEST_SWITCH_KEYS` + the setting→env one-liner in
  `src/modules/processing/handler.js` around line 123, e.g. `ref_confusable_confirmed_literal_disarm` at :412).
  A new dark switch: seed OFF via a migration, add to `TEST_SWITCH_KEYS`, mirror setting→spawn-env. Then the
  count pins `database/modules/test_migration137_test_switch_reset.js` +
  `database/modules/test_migration163_deskew_false_absent_reflag.js` +
  `src/modules/processing/test_env_road_post_reset.js` need their expected counts updated. (`TEST_SWITCH_KEYS`
  is 10 as of HEAD.)

## ⛔ ORACLE BLOCKING RULES — never violate these (they are why the design is safe)
For the GLYPH GALLERY (Feature 1):
- **C1 (ship-blocker):** when the gallery settles a glyph, it corrects only the **displayed value** and **KEEPS
  the confirm-once note**. It writes **NO `corrected_to`** and **NO corrections-learning row**. (Else the gallery
  poisons itself — a wrong settle becomes learning that corrupts future exemplars.)
- **C2:** the gallery is NOT a voter inside `reslice.positional_consensus`. ADOPT a corrected glyph ONLY when the
  gallery verdict AND a SEPARATE `positional_consensus` (≥3 distinct pixel sources) AGREE. Cold/abstain/disagree →
  today's flag behaviour (no change).
- **C3:** NEVER let the gallery lift the review hold or auto-file. That is a separate, later, separately-Oracle-
  gated slice (S4). The confirm-once note stays the only checkpoint; do not touch `trust.js`.
- Capture only on a HUMAN confirm (`reviewService.js:441`, `if (!_via)`), only on scanned pages, only structured
  single-token fields, and only when `box_count == len(confirmed)` AND per-char box widths look sane.
For the BORN-DIGITAL TRIP-WIRE (Feature 2):
- It only FLAGS, never changes a value. Its catch set is a broken/lying text layer (wrong code points, gross
  misalignment), NOT confusable-only differences. If the census finds that class empty on real docs → DO NOTHING
  (don't ship it).

## Re-consult the gate before any default flip
Every one of these ships DARK (off by default), byte-identical when off. Turning one ON for customers is an
approval-class action: re-run the census gate for that feature, spawn the advisors (oscar/007/gary) + Oracle,
and get the owner's explicit go. Advisors run via the Agent tool (`gary`, `oscar`, `oracle` are registered;
`007` = spawn `general-purpose` and tell it to read `.claude/agents/007.md`).

---

# STEP 1 — the preprocessing study (build + run the pilot)
Design: `docs/designs/OCR_SLICE_STUDY_2026-09-22.md`. Goal: measure which image treatments turn a real misread
into the correct read, WITHOUT breaking clean reads. This tells us how much of the problem is fixable by better
reading vs genuinely unreadable ink.

Build under `TESTING/_measure/confusable_slices_20260922/`:
1. **`gather_slices.py`** — for each corpus doc run `process_docs.py --trace --slice-dir slices/<docid>/ --dpi
   200` (the trace emits per-field committed values + `slice` events `{field, bbox, page}`; see
   `engine._capture_slice` at `python_backend/extraction/engine.py:5735`). Diff each committed read vs
   `ground_truth.json` with the project's `text_normalise`. Keep only **edit-distance == 1 with a confusable char
   pair** (1↔I/l, 0↔O/Q, 5↔S, 2↔Z, 8↔B, 6↔G, 7↔T) = the DISCOVERY set. **Re-derive the RAW crop** from a fresh
   200-DPI pypdfium render of the bbox + 0.3×height headroom (NOT the captured png — it may already be prepped).
   Save `slices/raw/<id>.png` + `slices/meta/<id>.json` {doc, field, page, bbox, wrong_read, correct, glyph_pair,
   shipped_read_correct:false}. ALSO harvest ~100-200 slices the app read CORRECTLY (`shipped_read_correct:true`)
   = the CONTROL set (measures breakage).
2. **`sweep_recipes.py`** — a `RECIPES` list of ~24 pure functions `(raw PIL 'L' crop, field_shape) → (prepped
   image, tesseract_config)`. First-cut set (design §2): crop+0.3h → grey → upscale to cap-height ≈36 (LANCZOS)
   → sweep binarise ∈ {none, Otsu, Sauvola(k=0.3), adaptive-gaussian} × CLAHE ∈ {off,on} × PSM ∈ {7,8,10} ×
   whitelist ∈ {none, digit-if-shape-is-all-digit}. Reuse the in-tree Sauvola in `python_backend/ocr/text_enhance.py`.
   Run each recipe over every slice, one `pytesseract.image_to_string`, write `results/results.csv`
   (slice_id, glyph_pair, recipe_id, read, correct, is_control).
3. **`analyse.py`** — per recipe: **FIXED** (discovery wrong→correct) and **BROKE** (control correct→wrong);
   **NET = FIXED − BROKE**; a per-glyph-pair matrix. Score ONLY against the known-correct answer (immune to "two
   recipes agreed on the same wrong glyph"). Write `results/report.md`.
**Deliverable to the owner:** the per-glyph-pair scorecard + which recipes fix what with BROKE≈0. Ship bar:
FIXED/flagged ≥ ~30-40% with BROKE ≈ 0 → a shipped targeted re-read is worth it; otherwise keep the flag.
**Only ship recipes expressible in numpy/scipy** (no new runtime dep); flag any CLAHE/OpenCV-only winner as
"needs a port decision". No slice study winner may auto-file a no-history ref — corrects the value + keeps the
"confirm once" note (design §Integration seam).

# STEP 2 — the born-digital trip-wire census (decide ship or skip)
Design: `GLYPH_GALLERY_AND_BD_CORROBORATION_2026-09-22.md` § Feature 2. Build `bd_corroborate.py compare(...)` +
run the census FIRST (S0). Count real gross-mismatch catches (pixel-adjudicated) + false-holds on clean
born-digital docs + wall-clock. Ship S1 only if catches non-empty AND clean-digital false-hold ≈0. Else DO
NOTHING and tell the owner so. VERIFY `page_images` are populated for born-digital pages first (they are —
`tesseract.py:1052/1098` — but confirm before relying on it).

# STEP 3 — the glyph gallery (the big feature; build LAST, only if STEP 1 leaves residual)
Design: `GLYPH_GALLERY_AND_BD_CORROBORATION_2026-09-22.md` § Feature 1 — follow its slice breakdown EXACTLY:
S0 (table `glyph_samples` + `src/services/glyphGalleryService.js` + capture, WRITE-ONLY, DARK) → S1 (pure numpy
matcher `python_backend/extraction/glyph_gallery.py`, unit-tested off fixtures) → S2 (read integration behind the
existing flag, gallery-must-CONCUR-with-positional_consensus, FLAG-tier only, keep note, NO corrections row) → S3
(census + Oracle + flip) → **S4 deferred** (hold-lift; separate Oracle gate; NEVER fold into S2). Obey C1/C2/C3
above. The load-bearing safety is the three-layer poison guard + required-concurrence + never-lift-hold. Build S0
first (it can start populating a `-TEST` gallery for later census data even before the matcher exists).

## Honest expectation to keep in front of the owner
- The `1/I` sans-serif case may be GENUINELY unreadable from the pixels (no serif captured) — every lever will
  correctly ABSTAIN there and keep it review-bound. That is the right answer, not a failure.
- The gallery does NOTHING for a brand-new sender (empty gallery) — it only helps REPEAT senders, and only as a
  held pre-fill until the deferred S4. Modest reward for a lot of machinery — which is why it is LAST.
- STEP 1 (preprocessing) is the highest-value, widest-reach lever. Do it, report the numbers, and let the results
  decide whether STEP 3 is even worth building.
