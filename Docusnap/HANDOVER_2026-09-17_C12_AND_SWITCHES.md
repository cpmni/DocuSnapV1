# HANDOVER 2026-09-17 — (A) C12: the "re-import as one document" recovery action · (B) the remaining 47 dark-switch tests

> Companion to `HANDOVER_2026-09-17.md` (read that first for the state of the tree). Written for a **claude-opus-4-8**
> session: every step is spelled out; do not assume context. Source of truth for each switch = its comment block in
> `database/dark_switches.js` (the ⚑ FLIP GATE lines) + `docs/oracle_log.md` (the verdicts); plain-English meaning =
> `docs/DARK_SWITCH_LEDGER.md`. This file ORGANISES that work; it does not replace those three files.

---

# PART A — C12: a one-click way back when the splitter cut a document in two

## A1. Why this exists (plain terms first)
The multi-document splitter sometimes cuts one real document into two (page 2 repeated the letterhead, a badly scanned
page 1, a same-supplier stack that fooled it). The mig-180 pair belt (DARK) now HOLDS both halves in Review with a note
that says "page N of that scan may belong to this document" — but the note can only point at a hidden folder
(`.sf_separated_originals` inside the import folder) where the untouched original PDF was set aside. A customer has no
button that puts the two halves back together. The Oracle made this a **condition of the mig-180 flip (C12)**: the belt may
go ON for customers only once the pair reason carries a one-click recovery — either **"Re-import as one document"** (take
the original from `.sf_separated_originals` and import it whole) or **"Rejoin with previous"** (merge the two segment
PDFs back into one document). Until then mig 180 stays dark.

## A2. What exists today (verified facts — cite these to the advisors)
- **The originals ARE kept.** `src/modules/processing/handler.js` `_separateBatchDocuments` (~line 2949-2966): before the
  segments are imported, the original PDF is `renameSync`'d into `path.join(folderPath, SEPARATED_DIR)` where
  `SEPARATED_DIR = '.sf_separated_originals'` (grep the constant). The rewrite record is `{ original, segments:[basenames in
  page order], separators, weak:[…] }`. The importer refuses to import from `.sf_separated_originals` (a 2026-09-14 fix — grep
  `sf_separated_originals` in `fileKinds`/handler).
- **Each segment becomes its own document row** (`documents` table: `original_filename` = `<stem>_split_p<a>.pdf` or
  `_p<a>-<b>.pdf`, `folder_path` = the import folder, `working_path` = the app's copy under `userData/inbox/<docId>.pdf`,
  `page_count`). The segment PDF itself is written by `python_backend/pdf_splitter.py` (pypdf) next to the original.
- **The pair note names the partner page** (`split_plan.pairSentences` — "the next page (2) may belong to it" / "it may
  continue the previous page (1)") and the reason panel exposes `subkind: 'pair'` + `partnerPage` (`review/handler.js`
  `get-auto-file-reason`). So Review already KNOWS which two documents are the pair and where the original lives —
  the recovery action only has to act on that.
- **Review has a Split tool but no join.** `split-pdf` IPC (`src/main.js` / processing handler; pypdf split by ranges or
  `every` N) — the inverse operation's precedent for UI + IPC + the file-write pattern. `delete-document(id, filePath)` and
  `reprocess-document` exist. The Review reason panel copy lives in `src/windows/review/renderer.js` (~line 3350,
  `'segment-hold'`).
- **Filing consequences to respect:** a document that has already FILED (status `confirmed`, copied into the output
  tree) cannot simply be deleted — un-filing is a separate, audited operation (the Learning Repair console does
  "send back to Review, replace in place"). The pair belt's whole point is that NEITHER half filed, so C12 can start
  with the held-pair case only.

## A3. The two candidate shapes (design the choice; do not pre-decide)
1. **Re-import as one document** (the Oracle's first wording): from the pair reason, one button → the app locates
   `.sf_separated_originals/<original>` (the rewrite's `original`), imports it as ONE document with separation
   DISABLED for that file (a per-file "do not split" flag threaded into the pre-pass — `buildSegmentArgs` / the
   `_separateBatchDocuments` file list), then removes the two segment documents (their rows + working copies +
   the segment PDFs in the import folder) in the SAME transaction-like sequence, with an audit row. Pros: the original
   bytes, no PDF surgery, one code path (the normal importer). Cons: a re-read (OCR again), the original may be a
   3+-document stack where only ONE pair was wrong — re-importing the whole stack undoes the correct cuts (then the
   user needs Split again). Needs a "which pages" notion → really only clean for a 2-segment original.
2. **Rejoin with previous** (the Oracle's alternative): merge THIS segment's PDF onto the previous segment's PDF
   (pypdf concat, page order by the `_split_p` ranges), keep the earlier document's row (its reads are the first-page
   reads a human would expect), update its `page_count` + working copy, remove the later row, clear both pair
   sentences, audit. Pros: local, keeps every other cut intact, exactly what the note describes. Cons: PDF surgery
   (must preserve rotation applied to the working copies; the two working copies may have been auto-rotated
   independently), the merged doc must be re-read or at least re-marked for one look (its page 2 now exists — fields
   read from page 1 stay valid, but `page_count` and the preview change).
Either way: the original stays in `.sf_separated_originals` (never deleted), the action is admin/edit-gated like Split,
and the result LANDS IN REVIEW held (never auto-files — a human just told us the machine got it wrong).

## A4. How to run the design (the standing gate: advisors → Oracle → build)
1. **barry** (product): the user flow from the pair note → the button → what the user sees after; naming; the
   3-segment-original case; whether "Rejoin" should also be offered on ANY 1-page segment (not just pair-marked
   ones) — the owner's Review has Split, so a symmetric Join is natural.
2. **eric** (Electron): the IPC + preload surface, sender guards (`requireRole('admin','edit')`), path containment
   (the original must resolve INSIDE `<import folder>/.sf_separated_originals`; `_allowedOpenRoots`), the working-copy
   rewrite (`ensureWorkingCopy` semantics), broadcasting the queue change, undo (the audit chain pattern of the
   activity strip: `src/lib/reviewEvents.js`).
3. **gary** (Python/pypdf + tests): the join primitive (a `--join` mode on `pdf_splitter.py` or a sibling script;
   rotation handling; page-order from the `_split_p` ranges), the DB sequence + rollback, the pins (a Node pin over a
   fixture DB for the row surgery; a Python pin for the join; the "never auto-files" pin; the "original untouched"
   pin; the audit row pin).
4. **Oracle** LAST. Expect conditions about: never deleting a filed document; the 3-segment case; watch-folder
   originals (the watch path also sets originals aside — `applySeparationToTracked`); the mig-176 merged-cut mark on
   a joined multi-page result (a JOINED doc is a multi-page HEURISTIC-shaped doc — should it carry the 176 "look
   first" sentence? probably yes: one look); and that the pair sentences are cleared on BOTH rows.
5. Build DARK? This is a UI action, not a reading change — it needs no switch, but it needs the pair belt's data
   (`subkind:'pair'`, `partnerPage`) which only exists when mig 180 is ON. Plan: build the action unconditionally
   (works on any pair-marked doc), then the mig-180 flip census (Part B, item 47) makes the belt live.
6. Log the verdict in `docs/oracle_log.md`; record the design in `docs/designs/`; update `docs/DARK_SWITCH_LEDGER.md`
   (the mig-180 entry's flip gate) and `pendingfeatures.md` (the "Rejoin owed" lines from 2026-09-16/17).

## A5. Acceptance (what "done" looks like)
- From a pair-held document in Review, one click rejoins/re-imports; both pair sentences gone; the result is ONE
  document in Review (held, not filed) with the right page count and preview; the original still in
  `.sf_separated_originals`; an audit row; undo within the session (or a clear statement that undo = Split).
- Pins green; `node scripts/run-pins.js` green; a manual live-vet by the owner on the sandbox app (port 9223 recipe in
  `HANDOVER_2026-09-17.md`) using `ctrl5_blur_copperfield.pdf` / `ctrl3_b2b_thornbury.pdf` from the soak folder.

---

# PART B — the remaining dark switches: what each one still needs

**Numbers at HEAD (2026-09-17 evening):** `TEST_SWITCH_KEYS` = **47**. Ledger tally: 1 READY-but-declined · 5 HELD ·
34 WAITING · 1 PARKED · plus the feature master `departments_enabled` and today's `segment_pair_hold`, which have their
own (non-census) gates. Flipped so far: migs 148, 171, 172, 173, 174, 175, 181, 182, 183.

## B1. The test recipes (three kinds — every switch below names which one it needs)
**Recipe 1 — the 700-corpus flip census (the safety gate for every READING switch).** Memory
`project_flip_corpus_pipeline_20260912.md`; method + prior results `TESTING/_measure/flip_corpus_20260912/CENSUS.md`;
the reusable runner + comparator `TESTING/_measure/flip_corpus_20260912/rerun_20260916/`.
1. COPY the fixture `Desktop\Flip Corpus 700\warm_700.db` to scratch and migrate the copy to HEAD (the Desktop fixture is
   never touched; the 09-16 runner has the copy+migrate step).
2. Baseline = `RR_APP_ENV=1` (the app's real flag environment; `=0` is the vacuous-arm trap). The switch lever is the
   SHELL ENV the harness spawns with, NOT a DB write (the flags are read outside the mirrored `_appSpawnEnv`).
3. One ARM per switch: baseline OFF vs ON over the 400 GT docs (~10 min per arm). Compare with the comparator: **M=0**
   (no new would-auto-file of a WRONG value), the would-file SET delta (removals = holds are fine; additions must equal
   GT), the FIRE count (the switch must actually do something — 0 fires = vacuous, stays dark), value changes listed.
4. Run arms DETACHED (`Start-Process bash …`, the Bash tool caps background jobs at 10 min); NEVER run the pin suite while
   arms run; kill a stuck arm by PID (bash first, then its electron children).
5. A PASS twice (two separate runs at two code points, like 156/159) = flip-ready; the flip itself = the recipe in
   `HANDOVER_2026-09-17.md` §7 (a labelled `@DEFAULT_FLIP` UPSERT migration + delist + pins + ledger).
**The 09-12 KEY FINDING (load-bearing):** the synthetic corpus proves SAFETY (M=0) but cannot show EFFICACY for GEOMETRY
fixes (clip/skew/drift arcs fire 0 there because the shipped keyword read + pad-window already recover the easy
geometry). For those, efficacy = a re-judge on the owner's real exhibits (a COPY of the live DB — never the live file;
the 09-10 night run `TESTING/_measure/night_20260910/` is the template) or a real skewed batch.
**Recipe 2 — the realdoc 605 harness** (`stress_test/realdoc_regression.js`, `RR_APP_ENV=1`, the owner's confirmed values as GT):
M=0 + zero per-field accuracy drop + would-file set-equality where the gate says so. Corpus = `Desktop\ScanFinder Test
Corpus` (605 papers + `rr_ids.txt`). Caveat: the live DB was reset 2026-09-06, so the `rr_ids.txt` selection is vacuous
against the live DB — run it against the corpus DB/fixtures, not the live copy.
**Recipe 3 — the separator census + e2e** (only for splitter switches): `TESTING/_measure/watch_separate_soak_20260916/`
(`seg_census3.py`, `weak_cut_census2.py`, `e2e4_tail.sh`, `soak_e2e_check.js`, RESULT.md).

## B2. Group by what each switch needs
Per-key gate text = the ⚑ line in `database/dark_switches.js`; plain meaning = the ledger. "R1" = Recipe 1 etc.

**(a) Reading switches — Recipe 1 is the whole gate (then Oracle, then the owner's go). 27 keys.**
Run these as an overnight batch (one arm each; ~10 min/arm → plan a night run: repo `NIGHT_RUN.md` is the queue + DONE
ledger; "going to bed" = start it). Report per switch: M, fires, would-file delta, value changes.
- Reference-flag family (migs 107-118, all REVIEW-BOUND — expect M=0 trivially; the question is fires + no new filer):
  `format_variance_relax`, `format_variance_relax_ref`, `format_variance_relax_ref_inline`, `filing_sanity_ref_corrob_soften`,
  `filing_sanity_ref_history_soften`, `resolve_ref_near_miss`, `resolve_ref_positional`.
- `confusion_precedence` (mig 119; review-bound; needs the corpus to hold ≥3-doc correction histories to fire at all —
  the 700 corpus may be vacuous → then a live-copy re-judge).
- `format_class_join` (mig 120) — **HOLD**: 09-12 census M=0 but a blast-radius finding (re-arms total-format checks on
  unrelated invoices → 7 new review-bound total notes). Needs a look at WHY before any flip; not a census problem.
- 09-06 log-review arcs: `anchor_bare_label_fuzzy`, `anchor_labelless_currency_refuse`, `type_uninstalled_heading_fold`
  (its efficacy = the 09-06 text census 20/20 Ironclad → Statement; safety = R1).
- `buyer_issued_convention_one_confirm` (mig 125) — fires only after a human "confirm which company" answer; R1 is
  vacuous → design a fixture with one convention record, then R1 for safety.
- 09-07 placement arcs: `teach_angle_compose_null_abstain` (NOT a flip candidate alone — see its dark_switches note),
  `reread_hold_corrob_release`, `template_date_left_clip_grow`, `template_pad_date_containment_flag`,
  `template_clip_commit_left_slack` (read `TESTING/_measure/clip_left_slack_20260907/diff_off_on.txt` first — the
  owner was told to read it before it stays ON).
- `inline_disagree_corrob_soften` (mig 135/136).
- Name-grow belts (mig 140): `template_name_grow_band_pick`, `template_name_cut_defer_cap`, `keyword_superstring_name_note`
  — their gate ALSO wants customer_name accuracy via `teach_run_ab` / `score_teach_run` ≥ today (the teach-side harness,
  `HANDOVER_2026-08-08_OVERNIGHT.md`).
- `template_code_read_widen` (mig 141) — geometry: R1 for safety; efficacy needs a real wider-docket exhibit.
- `type_split_teach_scope_suppress` (mig 144) — read-only, not in the auto-file path: pins + realdoc wouldAsk(ON) ⊆ wouldAsk(OFF).
- `template_edge_clip_heal` (mig 151) — geometry; its 88-floor relax needs `_corrobLicensedKeyword` scoped to the
  `_edgeclipheal` family FIRST (a code precondition), then R1 + an adversarial neighbour set.
- `role_disagree_refuse_at100` (mig 152) — R1/R2 with wouldFile(ON) ⊆ wouldFile(OFF) (it only ever REMOVES a filer).
- `trust_ref_role_shape` (154) + `template_drift_override_guard` (157) — safety-passed on the synthetic set 09-12 (M=0);
  efficacy = the 09-10 live re-judge (20 held Thornbury invoices; live #243 `CH1 2HU` → `Larch & Hollow Cafe Co`).
  Both are close to flip-ready: one more R1 pass at HEAD + Oracle + owner.
- `note_topic_dedup` (158) — cosmetic (note text only): R1 must show the auto-file SET identical ON == OFF.
- `template_date_invalid_yield_lowconf` (166) — R1/R2: M=0 + set-equal would-file + zero date-accuracy drop (Oracle C5).
- `date_forms_wide` (167) — R1/R2 + the `VAL_CENSUS_DIR` crop/keyword acceptance census OFF vs ON where every NEW
  acceptance is eyeballed against the page; run with mig 166 in its OFF state so the two date fixes are measured apart.
- `template_fragment_containment_yield` (100), `template_locate_role_qualifier` (99) — R2 (the realdoc-605 gates queued since 08-31).

**(b) HELD — flag/hold arcs (5). Their HOLD leg is safe by construction; R1 must show wouldFile(ON) == wouldFile(OFF)
(they remove no filer, add none). Their AUTO-FILE upgrades are separate arcs, each with its own Oracle conditions.**
`template_taught_corrob_adopt` (153; PHASE 2 @90 auto-file census-gated), `template_code_left_grow` (161; Phase 2 needs an
independent family per Oracle C5), `filing_sanity_ref_reinstate` (160; HARD dep `filing_value_sanity_flags` ON),
`deskew_retry_field_adopt` (162; gate C11 = the 605 corpus REQUIRED + Demo 369, cells {162 OFF/ON} × {153 OFF/ON}, fires
adjudicated AT THE PIXELS; runner `TESTING/_measure/deskew_field_adopt_20260912/run_gate.sh`; zero fires ⇒ stays dark),
`deskew_false_absent_reflag` (163; hold leg: wouldFile set-equality + the truthful-note pin; its RELEASE leg is SEND BACK
with H1-H5 — do not build it).

**(c) Switches with a NAMED precondition or a non-census gate (6).**
- `optional_soft_flag_autofile` (142) — CODE FIRST: `_flaggedSoftAware` must treat any `_isLaneHoldNote` row as never-soft
  (Oracle C10 of mig 162; `pendingfeatures.md` 2026-09-12). Then R1 with role-value M=0 + a census that each new filer's
  ONLY prior blocker was a soft optional note.
- `corrob_autofile_band88` (145) — reach census + R1 + the both-ON cell with 142; requires `corroboration_autofile` ON.
- `filing_sanity_confusable_prefix_autofile` (149) — NOT auto-file-neutral: R2 + a constructed graduated scope +
  arc-inert vs arc-live decomposition + an adversarial mirror set; HARD dep `filing_sanity_confusable_soften` (ON since 148).
- `sweep_inview_recheck` (150) — a UX cadence judgment, not a census: it re-offers the countdown on ANY eligible held doc
  on view. Owner vet + a Chris round (`/christest`), then flip.
- `quick_reprocess_enabled` (104) — its own gate (Plan B: the `ocr_recipe` stamp + `ocrCacheUsable`; `HANDOVER_2026-09-01_EVENING.md`).
- `departments_enabled` (164) — a FEATURE MASTER, not a reading toggle: needs D2b (/v1 intake dept tagging), D3/D4
  (taggers + Settings UI) and the denial matrix built first (`docs/designs/DEPARTMENTS_D2_PLAN_2026-09-15.md`). No census.

**(d) Declined / parked (2).**
- `deskew_corrob_autofile` — OWNER 2026-09-17: stays OFF pending further testing (the 09-16 corpus run was byte-identical
  to OFF; a real skewed batch is the only test that can show it earning its place).
- `anchor_axis_lock` (155) — PARKED: 0 fires on every corpus; stays dark unless a real case appears.

**(e) Today's belt (1).**
- `segment_pair_hold` (180) — Recipe 3 cells (Oracle C9): (i) `real_34.pdf` RASTERISED at 150 and 200 DPI (render with
  pypdfium2, re-save as image PDFs) → the weak count must be 0 and, via the value check, held 0; (ii) a young-install stack
  (templates only for the SUCCESSOR's supplier) → the inconclusive count; (iii) the "email-arm-only STRONG" alternative
  class as a census ARM over stacks/real_34/controls (would catch a Sage-class full-header repeat without a page number);
  (iv) 178+179+belt ON over controls3/5 → every sibling false cut held; (v) a count of "complete later page after an
  unread earlier number". PLUS **C12 (Part A) shipped.** Then Oracle, then the owner's go.

## B3. Suggested order (highest value per hour first)
1. **C12** (Part A) — unblocks the belt that closes the last silent-truncation class.
2. **An overnight R1 batch** over group (a) — one arm per switch, ~27 arms × 10 min ≈ 5 h. Write the queue into
   `NIGHT_RUN.md` first (the owner's convention), start it detached, read every comparator report in the morning
   (never claim a pass you did not read), then present the passers for a batch flip like migs 172-174.
3. The two near-ready ones first inside that batch: `trust_ref_role_shape` (154) and `template_drift_override_guard` (157)
   — both already safety-passed once and live-confirmed.
4. `format_class_join` — a LOOK (why the blast radius), not a re-run.
5. The HELD five — R1 set-equality only; flip their hold legs in one batch if the owner wants the flags live.
6. The preconditions group (c) one at a time; `departments_enabled` is a feature build, schedule it separately.

## B4. Rules that must not be broken while doing this
- Never test on the owner's live DB (`%APPDATA%\ScanFinder`); copy it (`.db` + `-wal` + `-shm`) if you need real exhibits.
- Never edit a mapper/engine `.py` while an arm is running (later cells run different code — kill, then relaunch).
- A flip is approval-class: the owner says which key, then the recipe; every flip = its own labelled migration + pin.
- Keep the ledger current: strike the entry, add the DONE sentence, fix the count in the intro paragraph.
- Explain results to the owner in plain terms (what the fix does for a customer, what the test showed, what could go wrong).
