# HANDOVER — 2026-08-11 DAY 2 (owner-directed autonomous run)

**Branch** `feat/teach-side-overnight` · HEAD `8c6237e` · ALL PUSHED, tree clean.
**Migrations: 62 now exists in code** (61+62 both apply on the app's NEXT start — the live DB was
still at 60 when checked this morning; the "migration 61" line in the previous handover was stale).
**Owner's four-part order, all delivered:** (0) corroboration, (1) taught label = sole keyword at
TEMPLATE level, (2) LIST data type, (3) Chris fixes — plus the live serials repair and
**`OWNER_TEST_SCRIPT_2026-08-11.md`** (the step-by-step test list + the KEEP-YOUR-DB
recommendation). **Read that script first — it is the actionable summary of everything here.**

## What shipped (11 commits)

1. **Live serials teach REPAIRED in the live DB** (no commit — data): the two caption-committing
   mappings + two frozen serials fields deleted; backup
   `Desktop\TESTING\_measure\live_backup_20260811_120903.db`. 24 docs still carry the old value
   until reprocessed.
2. **Chris UI batch** (`b6bf307`,`fafb84e`,`4cb7c00`,`3a2128a`): Approve two-step arm made
   unmissable + stale-error clear (there was NEVER a backend refusal and NO self-approval rule —
   the review doc's triage hypothesis was wrong; first click silently armed and 5s-reverted);
   post-batch folder copy; true "132 of 200" counter; Home need/ready split
   (`documents.getReviewSplit`, same predicate as the Review window); honest auto-file card; bin
   shows filename + **Restore all**; reprocess-all always confirms; teach picker filter; honest
   wizard tally; "Save teaching & file"; locate-box glow ring + zoom reset (finding 5); ONE
   unknown-sender phrase; recovery-code Copy/Print; tutorial + onboarding copy truth.
3. **Young-identity corroboration** (`ca0bb49`, under `template_identity_on_page`): the wordmark
   abstain ADMITTED unconditionally; a YOUNG frozen-supplier template (frozen-string confirms < 3,
   `TEMPLATE_IDENTITY_YOUNG_N`) now must be NAMED on the page. Trace-proved the Chris leak came via
   the KEYWORD arm ("@a eens Ee 80% via keywords") while the guard refused both healthy templates —
   the abstain was the door. Sandbox repro now REFUSES (docs → "Sender not identified").
   **Youth stays keyed on the frozen-string count DELIBERATELY** — bound-doc count reads the poison
   as mature (the sandbox garble has 21 confirmed docs from File-All-Ready). Residuals (a) name-
   drift keeps a wordmark young, (b) split-brain frozen-garble/corrected-dominant — both PINNED.
   19+3 pins; coldstart2 vs OFF-twin `coldstart2_y0` byte-identical (mature snapshot,
   class-absent; the sandbox is the heal evidence). Slices 2 (buyer_issued mark) + 3 (VAT
   contradiction rail) designed in `pendingfeatures.md`, NOT built.
4. **Template-scoped taught-label keyword** (`a2faa45` + `ca0bb49` batch): **migration 62** rebuilds
   `field_label_overrides` with `template_id NOT NULL DEFAULT 0` + 4-tuple UNIQUE (ONE transaction,
   throws rather than stamps — Oracle ship-blocker fixed); teach writers pass their template;
   `merge_label_overrides(…, template_id=)` applies a scoped row only when THAT template matched;
   0 = doc-type-wide (admin/preset unchanged). ⊕ path SKIPS the write when the doc has no template
   (fallback-to-wide would recreate the bleed). **Backup restore REMAPS template_id through
   tmplMap; orphans DROPPED never widened** (second Oracle ship-blocker; pinned ×3). Admin Learning
   list shows "replaces built-ins" + "<template> only" tags (deletion is the only remediation once
   rows exist). **NEW Settings toggle** `teach_label_becomes_keyword` + wiring pin. Still OFF.
5. **Corroboration RECORD + SURFACE** (same commits): `engine._build_corroboration_emit` — per
   committed field, which INDEPENDENT method families read the same value, bucketed via the
   Oracle-ratified `_crosscheck_witness_bucket` with **`template_fixed` special-cased into its own
   `memory` family INSIDE the emit only** (Oracle C1 — the shared bucket is live in the flipped-ON
   crosscheck reconcile and must not be re-tuned). Persisted to new `extractions.corroboration`;
   survives reprocess merge on both keep branches (Oracle C2, merge battery +3). Review shows
   "✓ Two independent readings agree" (positive-only, note-suppressed); SFDEV ★FINAL shows
   corroborated / sole witness / amber uncorroborated-with-the-differing-value. **Record-only:
   base arm byte-identical (185 docs, 0 diffs). NOT wired to selection/trust/auto-file — that is
   step 3 of the owner's ordered plan, deliberately not this slice.** 14 pins.
   Kill `FIELD_CORROBORATION_EMIT=0`.
6. **LIST field type** (`8c6237e^`): value = 'A; B; C' delimited string; `_search_for_label`
   `collect=True` (ONE scan, shared guards; per-value pipeline factored to `_post_label_value`,
   shared); method `keyword_list`; exact dedupe first-seen. **Ownership: the collect scan ALONE
   writes list fields** (Stage-0/0.5 reclaim, anchor + late-rescue + hint skips) — pinned
   narrowing of the manual-anchors-win invariant. Never freezes (`_buildTemplateFields` rule E —
   the serials-defect lever); never a ref/date role; Stage-4.5 rail + 2.5b corrector skip; trust
   untouched (list blocks sub-100 auto-file, accepted v1). Teach surfaces refuse/warn at teach
   time (Oracle C1). Flag `list_field_scan` OFF + bridge + toggle + wiring pin. 10+2 pins;
   corpus: base byte-identical pre/post refactor AND armed-with-zero-list-fields byte-identical.
   **Residuals named:** vertical-column layout reads element 1; no count witness v1.
   Corpus layout evidence: `gen_customer_test.py:523` prints one 'Serial No: <sn>' line PER serial.

## Verification state

Green: all 11 new/extended pin suites (identity 22, label 13+13 JS, corroboration 14, list 10,
build-template-fields, backupservice, reprocess-merge battery, settings-wiring, workflow ×2,
search-window ×3, freeze_guard, doctype_presets, structural_fields, scope_trust). Corpus arms:
5 runs, every one byte-identical where it must be. `test_label_overrides.py` still exactly its 2
recorded pre-existing failures. **NOT done: no UI smoke of anything (the owner's script covers
it); no realdoc_regression.js run; Oracle vetted all four changes (no SEND BACK) and every
BLOCKING condition was closed the same session.**

## Gotchas found this session

- **electron.exe does NOT support `--check`** — it silently "fails" every file; use plain `node
  --check` for syntax (ABI irrelevant).
- **Git toplevel is `C:\GIT Projects`**, not the Docusnap folder; `.gitignore` has an unanchored
  `templates/` rule that makes `git add` WARN about `src/modules/templates` — the tracked handler
  commits fine; don't panic, and never `git add -A`.
- The old coldstart2.json (08-10) was a 66-doc fresh subset — NOT comparable to today's 185-doc
  runs; always regenerate the baseline with today's harness before diffing.
- An unmigrated snapshot DB + new `getForExtraction` columns = `safe()` returns [] silently in
  harnesses — arms measure zero overrides on old snapshots; the labelkw backfill arms construct
  rows in memory WITHOUT template_id (= doc-type-wide semantics), so future labelkw arms should
  add template ids.

## NEXT

1. Owner walks `OWNER_TEST_SCRIPT_2026-08-11.md` (A smoke ×6 → B Chris ×11 → C identity → D label
   flip → E corroboration → F list type) and makes the flag calls in its table.
2. `deskew_on_import` still 'true' in the live DB — still disables `teach_angle_compose_scan`.
3. Corroboration step 3 (let agreement/disagreement MOVE something) — only after the record has
   accumulated on real documents; the recorded disagreements are also the measurement base for
   the VAT-contradiction rail (buyer-issued slice 3).
4. Chris finding 6 (heading-as-company) + buyer-issued slice 2 — designed in `pendingfeatures.md`.
5. The I→1 raw witness — unchanged, Oracle-signed, not built (`HANDOVER_2026-08-11_NIGHT.md`).
