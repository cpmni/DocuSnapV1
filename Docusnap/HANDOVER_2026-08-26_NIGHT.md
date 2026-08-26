# HANDOVER — 2026-08-26 NIGHT (identifier-registry arc + Chris R5 cards + switch inventory/flip)

**Branch** `feat/teach-side-overnight` · **HEAD `f2349f9`** · commits LOCAL / NOT pushed (owner reviews then
pushes — standing rule). Two commits landed this session: `d811cce` (the feature work) + `f2349f9` (mig 89 the
switch default-flip). Working tree: only pre-existing cruft left (CLAUDE.md M, `../Backup`, old `HANDOVER_*.md`,
`TESTING/_measure/*.db|*.js`, an `x` file) — DO NOT commit those. **One built-but-uncommitted change this turn:
the landmark snap (see TOP OF QUEUE #2).**

---

## ⏭ TOP OF QUEUE — BUILD THESE THREE FIRST (the features flagged tonight; full detail in `pendingfeatures.md` 2026-08-26 entries)

### 1. CLASS F — one general "corroboration clears a verification-doubt note" rule (DESIGNED, audited, NOT built)
**Owner exhibit:** SuperStore invoice_number 31901 held @78% by the edge-cut note ("fuller reading could not be
verified") EVEN THOUGH `template_mapping_edgecut`=31901 AND `keyword`=31901 (two page families agree). Owner:
"clear corroboration — why won't it clear? are there OTHERS so we aren't whacking 1 at a time?"
**gary AUDITED it (full table + test plan in `pendingfeatures.md:51`).** Answer: YES there are others, and ONE
general rule retires them. **Bucket (b) whack-a-mole notes:** `_EDGE_CUT_NOTE` (template_mapper.py:524),
`_FT_FALLTHROUGH_NOTE` (:784), `_NAME_GROW_NOTE` (:582, name-risk gate separately), + the value-rewritten-clean
family (anchor:1638/1647, engine:9272/6729). **THE RULE (new class F in `engine.py:_resolve_corroborated_notes`
:3517, DARK env):** clear a note iff (1) its MARK ∈ an allowlist `_VERIFICATION_DOUBT_NOTE_MARKS` (mirrored to
write sites like classFixService CLEARABLE_NOTE_MARKS so a reword goes inert) AND (2) `_corrob_licensed(rec)`
(≥2 DISTINCT page families {mapping,crop,keyword} agree, none disagree — engine.py:1800) AND (3) value passes
its learned shape (fail-closed on no-shape) AND (4) licensed on FAMILY AGREEMENT alone, NOT value==dominant (an
invoice# is unique per doc) AND (5, recommended) the agreeing witness is un-noted (Oracle-B3 `noted` bit).
**⚠ THE CAP CORRECTION (load-bearing):** clearing the note only drops the OVERALL penalty, NOT the per-FIELD
cap. The edge-cut caps invoice_number ≤70 (template_mapper:2458/1914) and `trust.js:1104-1120 weak-critical-field`
reads the FIELD confidence directly (70<88 → still held). **So class F MUST ALSO LIFT the field to 90** (like
`_d1` `_CROSSCHECK_CORROB_CONF`, engine.py:1084), not just pop the note. Matters doubly for a non-critical capped
code field (account_no) that `critfield_corrob_floor_relax` doesn't cover. **Seam that keeps bucket (c) safe (3
layers, verified):** distinct-family requirement + same-family skip (engine.py:1800/4172) → a self-agreeing
common-mode misread can NEVER license (the owner's exact worry, already structurally prevented); the shape-pass
leg auto-excludes shape-mismatch notes; the allowlist is DENY-BY-DEFAULT (disagreement / invalid-date / identity
/ "couldn't-confirm-anywhere" Fix-A / reconciliation notes never sweepable — keep DISAGREEMENT in its own
`_d1`-style arm, TOTALS in `_d2`; oracle_log:737 warns F must not co-arm with the recon-total demoter). **Gate:**
DEFAULT-OFF env, OFF==ON byte-identical, realdoc M=0 + zero accuracy drop; pins (F clears+lifts on 2-family/shape
-pass; a SINGLE-family or disagreeing or shape-failing record KEEPS the hold; a genuine clip VXS986-vs-VXS98624
stays in review; the allowlist↔write-site mirror). Harness can't bit-reproduce the live edge-cut misread → watch
the heal on the live doc via SFDEV before flip. **advisor+Oracle before flip.** This is the highest-value item.

### 2. LANDMARK BOX SNAP — ✅ BUILT THIS SESSION, UNCOMMITTED (needs a source pin + commit)
**Owner:** manual-landmark boxes sit loose/offset from the words; mapping boxes snap, landmarks didn't.
**DONE (uncommitted, in `src/windows/settings/renderer.js` `addLandmarkFromRect` ~3247):** the hand-drawn
landmark box is now word-snapped via `window.BoxSnap.snapBoxToWords` (same shared BoxSnap + the same
`template_box_word_snap`/TPL_SNAP_ON gate the mapping path uses), fail-closed to the drawn box. Frame-safe:
landmarks are drawn Straighten-OFF (UI-enforced), so tplImg is the raw page and the snapped coords are already
raw — no back-transform. Parse-checked OK. **FRESH SESSION: add a source pin** (e.g. assert `addLandmarkFromRect`
calls `snapBoxToWords`; a `test_settings_wiring.js` sibling) **then commit.** Mark the `pendingfeatures.md:32`
entry SHIPPED with the commit hash. (Do NOT rebuild — it's done.)

### 3. TARGETED FIELD RE-SLICE after a ⊕ box teach (DESIGN-STAGE, needs advisor+Oracle)
**Owner:** a box teach on a group re-OCRs the WHOLE page of each sibling (via the quiet-lane layout arm / manual
"Reprocess N") — unnecessary for a one-field change. Wants a targeted single-field re-read from the stored
image/words, no full-page OCR. **NOT built — needs its own design cycle.** Fix direction (in
`pendingfeatures.md:9`): re-read ONLY the changed field's target zone via `ocr/region.py` zone-OCR (or the stored
`documents.ocr_text`/word geometry where the value is textually present), update that one field + its holds,
skip Stages 0-4. Reuses the Stage-0.5 absolute-target read. Gate: fail-toward-review, OFF byte-identical, must
land the SAME value a full reprocess would (pin vs the full path). Pointers: `python_backend/ocr/region.py`,
`template_mapper.py` (absolute-target read), `src/modules/processing/rereadHolds.js`+`quietLane.js`,
`documents.working_path`/`ocr_text`. **Start with a design pass (gary/oscar → Oracle) before building.**

---

## WHAT SHIPPED THIS SESSION (committed `d811cce` + `f2349f9`, DARK unless noted)

- **Chris R5 cards** (`docs/CHRIS_FULL_APP_REVIEW_2026-08-26.md`): Card 1 draw-a-box nudge (DARK
  `position_teach_nudge` → NOW DEFAULT-ON, verified), Card 3 cold-start expectation one-liner, Card 4 blank-issuer
  "file under X" steer (DARK `issuer_suggest_on_blank_confirm` → NOW DEFAULT-ON, wiring verified end-to-end via a
  live CDP drive on an injected branding suggestion), Card 5 "Add <type>" name pre-fill, Card 6 practice-run
  stale-hint clear. Row badge routed through the ONE `classify()`. Quiet lane up to 2 workers
  (`quiet_reread_workers`=2; per-shard `_reprocessThreadCap` UNCHANGED so S3-C4 holds).
- **Supplier hard-identifier registry — slices 1a+1b BUILT DARK (`identifier_registry`).** Learn VAT/company-no/
  phone at confirm (name-gated, issuer-region, C2 seam pinned) + match → `suggested_supplier` (suggest-only, out
  of the auto-file corroboration math per Oracle C1). Extractor Py + JS twin with the UK VAT mod-97 checksum
  (checksum-NOT-fuzzy — the census proved a fuzzy fold would "repair" a misread into a valid-but-different VAT).
  mig 88 `supplier_identifiers`. **Census on the 1668-doc backup: reach high, 0 cross-supplier VAT collisions,
  buyer-issued closed — BUT the corpus is SYNTHETIC (every VAT fails the checksum), so the checksum's PRECISION on
  real numbers is UNMEASURED.** Files: `identifier_extract.py`, `identifierExtract.js`, `learning.js`
  (saveSupplierIdentifiers/retract/getAll), `reviewService.js` (learn hook), `repairService.js` (retract),
  `handler.js` (--identifiers-file), `process_docs.py`, `engine.py` (set_supplier_identifiers + the match arm).
  Full design+conditions in `memory/project_supplier_identifier_registry_20260826.md`.
- **The `issuer_sibling_fill` C2 batch** from the prior session rode along in this commit (gate met).

## SWITCH INVENTORY + FLIP (this session)
Ran a full inventory of ~152 boolean switches vs the live DB (`scratchpad/switch_inventory.js` pattern). Result:
**133 ON (migrations 70/80/81/82 + owner flips), 13 on-by-default, only 6 DARK.** Owner decision applied:
- **`mig 89` (committed): default-ON for new installs** `position_teach_nudge` + `issuer_sibling_fill` +
  `issuer_suggest_on_blank_confirm` (INSERT OR IGNORE, never overwrites a choice). **Live DB flipped to match.**
- **`identifier_registry` stays DARK** (Oracle SIGN-OFF-WITH-CONDITIONS — the gate below is unmet).
- Flagged-ON left ON per the agent rulings: `trust_company_key_own_scope` (correctness safety — prevents the
  Ironbridge 18-on-zero-confirms misfile), `name_dominant_snap` + `branding_strip_reg_boilerplate` (owner-flipped
  per-DB; their new-install default stays DEFERRED per the 08-25 rulings).
- The remaining truly-DARK: `identifier_registry`, `deskew_on_import` (WRONG LAYER — don't flip), `strict_100_autofile`
  (opt-in).

## OWED before flipping `identifier_registry` (do NOT flip on a real DB yet)
realdoc M=0 arm + a **REAL-CUSTOMER-VAT corpus** (the synthetic corpus can't validate the checksum's precision) +
Oracle final ratify. Slice 2 (warm identity-confidence lift + `disagreeing-identifier` HOLD — the only part that
can newly HOLD a doc; it enters the corroboration math) DEFERRED behind its own M=0 gate.

## Also on the vet queue (unchanged, owner-gated)
Cards 1 (now default-on) & 4 (now default-on) verified; the two 08-25 detection arcs; Card 4's engine detection
gap (finding 3 — the letterhead reader abstains on branded layouts; the registry is the warm complement).

## TRAPS / KEY FACTS (re-confirmed this session)
- This env's **Bash has NO npm/git/grep/cat/ls** — use the PowerShell tool + the dedicated Grep/Read/Write tools.
  `git`/`node`/`py -3.12` work in PowerShell. PowerShell has **no heredoc** — commit via `git commit -F <file>`.
- **`core.autocrlf=true`** (benign LF→CRLF warnings on add).
- Run JS tests with **`ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd <file>`**; Python with `py -3.12`.
- **Chris sandbox** left up: CDP **9223**, PID **20704** (`chris`/`plumber2026`), armed with the DARK switches +
  an injected branding suggestion; `scratchpad/chris-sandbox`. `/christest` rebuilds it. Chris transcripts come
  back empty — his report is transcribed into `docs/CHRIS_FULL_APP_REVIEW_2026-08-26.md`.
- **CDP-drive trap:** leftover modal overlays (z 99999, `data-help-ignore`) block queue-row clicks and leave
  `_lastRenderedDoc` stale — `page.reload()` the Review window between drives.
- Live DB: `%APPDATA%\ScanFinder\docusnap.db`, migration **89**.
